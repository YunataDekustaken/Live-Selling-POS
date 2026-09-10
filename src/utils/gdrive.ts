import { MinedItem } from '../types';
import { safeGetItem, safeSetItem } from './storage';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: any; expires_in?: number }) => void;
          }) => {
            requestAccessToken: (options?: { prompt?: string }) => void;
          };
        };
      };
    };
  }
}

const GDRIVE_CLIENT_ID_KEY = 'live_pos_gdrive_client_id';
const GDRIVE_AUTO_ARCHIVE_KEY = 'live_pos_gdrive_auto_archive';
const GDRIVE_LAST_ARCHIVE_KEY = 'live_pos_gdrive_last_archived';
const GDRIVE_USER_KEY = 'live_pos_gdrive_user';

let inMemoryToken: string | null = null;
let tokenExpiresAt = 0;

export function getStoredGDriveClientId(): string {
  return (safeGetItem(GDRIVE_CLIENT_ID_KEY) as string) || '';
}

export function setStoredGDriveClientId(clientId: string): void {
  safeSetItem(GDRIVE_CLIENT_ID_KEY, clientId.trim());
}

export function isGDriveAutoArchiveEnabled(): boolean {
  const val = safeGetItem(GDRIVE_AUTO_ARCHIVE_KEY);
  return val === null || val === undefined ? true : Boolean(val);
}

export function setGDriveAutoArchiveEnabled(enabled: boolean): void {
  safeSetItem(GDRIVE_AUTO_ARCHIVE_KEY, enabled);
}

export function getGDriveLastArchivedTime(): string {
  return (safeGetItem(GDRIVE_LAST_ARCHIVE_KEY) as string) || '';
}

export function setGDriveLastArchivedTime(timeStr: string): void {
  safeSetItem(GDRIVE_LAST_ARCHIVE_KEY, timeStr);
}

export function getGDriveUserInfo(): { email?: string; name?: string } | null {
  return safeGetItem(GDRIVE_USER_KEY) as { email?: string; name?: string } | null;
}

export function clearGDriveSession(): void {
  inMemoryToken = null;
  tokenExpiresAt = 0;
  localStorage.removeItem(GDRIVE_USER_KEY);
}

// Load Google Identity Services script if not loaded
export function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const existing = document.getElementById('gsi-client-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', (e) => reject(e));
      return;
    }
    const script = document.createElement('script');
    script.id = 'gsi-client-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(new Error('Failed to load Google Identity Services library: ' + e));
    document.head.appendChild(script);
  });
}

// Request access token using Google Identity Services (GSI)
export async function requestGDriveAccessToken(clientId?: string): Promise<string> {
  const cId = (clientId || getStoredGDriveClientId()).trim();
  if (!cId) {
    throw new Error('Please enter your Google OAuth Client ID in Settings first.');
  }

  // Return cached token if valid (with 60s buffer)
  if (inMemoryToken && Date.now() < tokenExpiresAt - 60000) {
    return inMemoryToken;
  }

  await loadGsiScript();

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services SDK unavailable.');
  }

  return new Promise((resolve, reject) => {
    try {
      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: cId,
        scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
        callback: async (response) => {
          if (response.error) {
            reject(new Error(response.error.message || response.error || 'Google authorization failed'));
            return;
          }
          if (response.access_token) {
            inMemoryToken = response.access_token;
            tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3500) * 1000;

            // Fetch user info for UI display
            try {
              const uRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${response.access_token}` }
              });
              if (uRes.ok) {
                const uData = await uRes.json();
                safeSetItem(GDRIVE_USER_KEY, { email: uData.email, name: uData.name });
              }
            } catch (e) {
              console.warn('Could not fetch user profile details:', e);
            }

            resolve(response.access_token);
          } else {
            reject(new Error('No access token received from Google.'));
          }
        }
      });

      client.requestAccessToken({ prompt: '' });
    } catch (err) {
      reject(err);
    }
  });
}

// Ensure a folder exists in Google Drive
export async function ensureDriveFolder(folderName: string, parentId: string | null, accessToken: string): Promise<string> {
  let query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    query += ` and '${parentId}' in parents`;
  }

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive`,
    {
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // Create folder if not found
  const meta: any = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder'
  };
  if (parentId) {
    meta.parents = [parentId];
  }

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(meta)
  });

  if (!createRes.ok) {
    const errJson = await createRes.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Failed to create folder ${folderName}`);
  }

  const created = await createRes.json();
  return created.id;
}

// Convert base64 data URL to binary Blob
function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Upload a single photo file to Google Drive using multipart upload
export async function uploadPhotoToDrive(
  fileName: string,
  base64DataUrl: string,
  folderId: string,
  accessToken: string
): Promise<{ id: string; name: string }> {
  const blob = dataUrlToBlob(base64DataUrl);
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'image/jpeg'
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const metaPart = `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}`;
  const mediaHeader = `${delimiter}Content-Type: image/jpeg\r\n\r\n`;

  const metaBlob = new Blob([metaPart]);
  const headerBlob = new Blob([mediaHeader]);
  const closeBlob = new Blob([closeDelimiter]);

  const multipartBody = new Blob([metaBlob, headerBlob, blob, closeBlob]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body: multipartBody
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to upload ${fileName}`);
  }

  return await uploadRes.json();
}

// Check if a mined item is older than specified days (default 7 days)
export function isItemOlderThanDays(item: MinedItem, days = 7): boolean {
  const now = Date.now();
  const cutoffTime = now - days * 24 * 60 * 60 * 1000;

  if (item.timestamp && item.timestamp > 0) {
    return item.timestamp < cutoffTime;
  }

  // Fallback check date string format (e.g. MMDD or Month D, YYYY or YYYY-MM-DD)
  if (item.date) {
    const parsed = Date.parse(item.date);
    if (!isNaN(parsed)) {
      return parsed < cutoffTime;
    }
  }

  return false;
}

// Archive all eligible mined items to Google Drive
export async function archiveOldPhotosToGDrive(
  mines: MinedItem[],
  daysThreshold = 7,
  forceAll = false,
  onProgress?: (message: string, current: number, total: number) => void
): Promise<{
  archivedMineIds: string[];
  totalArchived: number;
  folderName: string;
}> {
  // 1. Identify items with photos that meet the threshold
  const targetItems = mines.filter(m => {
    if (!m.photo || m.photo.trim() === '') return false;
    if (forceAll) return true;
    return isItemOlderThanDays(m, daysThreshold);
  });

  if (targetItems.length === 0) {
    return { archivedMineIds: [], totalArchived: 0, folderName: '' };
  }

  if (onProgress) onProgress('Connecting to Google Drive...', 0, targetItems.length);
  const token = await requestGDriveAccessToken();

  if (onProgress) onProgress('Locating LivePOS_Archives folder in Google Drive...', 0, targetItems.length);
  const rootFolderId = await ensureDriveFolder('LivePOS_Archives', null, token);

  // Group items by session date
  const grouped = new Map<string, MinedItem[]>();
  for (const item of targetItems) {
    const groupKey = item.date ? item.date.replace(/[^a-zA-Z0-9_-]/g, '_') : 'Past_Sessions';
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, []);
    }
    grouped.get(groupKey)!.push(item);
  }

  const archivedMineIds: string[] = [];
  let processedCount = 0;

  for (const [sessionKey, sessionItems] of grouped.entries()) {
    if (onProgress) onProgress(`Creating session folder: ${sessionKey}...`, processedCount, targetItems.length);
    const sessionFolderId = await ensureDriveFolder(sessionKey, rootFolderId, token);

    for (const item of sessionItems) {
      if (!item.photo) continue;
      processedCount++;
      const cleanBuyer = (item.buyer || 'Buyer').replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanCode = (item.controlCode || `item_${item.id}`).replace(/[^a-zA-Z0-9_-]/g, '');
      const fileName = `${cleanCode}_${cleanBuyer}.jpg`;

      if (onProgress) onProgress(`Uploading ${fileName} (${processedCount}/${targetItems.length})...`, processedCount, targetItems.length);

      try {
        await uploadPhotoToDrive(fileName, item.photo, sessionFolderId, token);
        archivedMineIds.push(item.id);
      } catch (uploadErr) {
        console.warn(`Failed to upload photo for ${item.controlCode}:`, uploadErr);
      }
    }
  }

  setGDriveLastArchivedTime(new Date().toLocaleString());

  return {
    archivedMineIds,
    totalArchived: archivedMineIds.length,
    folderName: 'LivePOS_Archives'
  };
}
