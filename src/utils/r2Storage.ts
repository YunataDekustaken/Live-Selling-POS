import { safeGetItem, safeSetItem } from './storage';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicDomain: string; // e.g. "https://pub-xxxx.r2.dev" or custom domain
}

export interface ServerR2Status {
  hasEnv: boolean;
  bucketName?: string;
  publicDomain?: string;
}

const R2_CONFIG_KEY = 'live_pos_r2_config';

export async function checkServerR2Status(): Promise<ServerR2Status> {
  // Check if client-side Vite env vars are available
  const hasClientViteEnv = Boolean(
    import.meta.env.VITE_R2_ACCOUNT_ID &&
    import.meta.env.VITE_R2_ACCESS_KEY_ID &&
    import.meta.env.VITE_R2_SECRET_ACCESS_KEY &&
    import.meta.env.VITE_R2_BUCKET_NAME
  );

  try {
    const res = await fetch('/api/r2-status');
    if (res.ok) {
      const data = await res.json();
      if (data.hasEnv) {
        return data;
      }
    }
  } catch (err) {
    // offline or static mode
  }

  if (hasClientViteEnv) {
    return {
      hasEnv: true,
      bucketName: import.meta.env.VITE_R2_BUCKET_NAME || '',
      publicDomain: import.meta.env.VITE_R2_PUBLIC_DOMAIN || ''
    };
  }

  return { hasEnv: false };
}

export function getStoredR2Config(): R2Config {
  const saved = safeGetItem<any>(R2_CONFIG_KEY);
  const accountId = (saved?.accountId || import.meta.env.VITE_R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (saved?.accessKeyId || import.meta.env.VITE_R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (saved?.secretAccessKey || import.meta.env.VITE_R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = (saved?.bucketName || import.meta.env.VITE_R2_BUCKET_NAME || '').trim();
  const publicDomain = (saved?.publicDomain || import.meta.env.VITE_R2_PUBLIC_DOMAIN || '').trim();

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicDomain
  };
}

export function setStoredR2Config(config: R2Config): void {
  safeSetItem(R2_CONFIG_KEY, {
    accountId: config.accountId.trim(),
    accessKeyId: config.accessKeyId.trim(),
    secretAccessKey: config.secretAccessKey.trim(),
    bucketName: config.bucketName.trim(),
    publicDomain: config.publicDomain.trim().replace(/\/+$/, '')
  });
}

export function isR2Configured(config = getStoredR2Config()): boolean {
  return Boolean(
    config.accountId &&
    config.accessKeyId &&
    config.secretAccessKey &&
    config.bucketName
  );
}

// Convert base64 data URL to binary Uint8Array
export function dataUrlToUint8Array(dataUrl: string): { data: Uint8Array; mimeType: string } {
  const parts = dataUrl.split(',');
  const mimeType = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binaryStr = atob(parts[1]);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return { data: bytes, mimeType };
}

// Browser native AWS Signature Version 4 for Cloudflare R2 S3-compatible API
async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
}

async function getSignatureKey(key: string, dateStamp: string, regionName: string, serviceName: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256(new TextEncoder().encode('AWS4' + key), dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  return kSigning;
}

// Upload image binary to Cloudflare R2 (tries server proxy first, falls back to direct client-side S3 SigV4)
export async function uploadToCloudflareR2(
  fileKey: string,
  base64DataUrl: string,
  config = getStoredR2Config()
): Promise<{ success: boolean; url: string; error?: string }> {
  const cleanKey = fileKey.replace(/^\/+/, '');
  const accountId = (config?.accountId || '').trim();
  const bucketName = (config?.bucketName || '').trim();
  const accessKeyId = (config?.accessKeyId || '').trim();
  const secretAccessKey = (config?.secretAccessKey || '').trim();
  const publicDomain = (config?.publicDomain || '').trim().replace(/\/+$/, '');

  // 1. Try Server-Side API Proxy First (supports server .env credentials & bypasses browser CORS)
  try {
    const proxyPayload: any = {
      fileKey: cleanKey,
      base64DataUrl
    };

    if (accountId || accessKeyId || secretAccessKey || bucketName) {
      proxyPayload.config = {
        accountId,
        bucketName,
        accessKeyId,
        secretAccessKey,
        publicDomain
      };
    }

    const proxyRes = await fetch('/api/r2-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(proxyPayload)
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data.success && data.url) {
        return { success: true, url: data.url };
      }
    } else {
      const errData = await proxyRes.json().catch(() => ({}));
      if (!isR2Configured(config)) {
        return { 
          success: false, 
          url: base64DataUrl, 
          error: errData.error || 'Cloudflare R2 is not configured in .env or Settings.' 
        };
      }
      console.warn('Server proxy upload returned non-200, trying direct client upload:', errData);
    }
  } catch (proxyErr) {
    console.warn('Server proxy unavailable (e.g. offline mode), falling back to direct S3 SigV4:', proxyErr);
    if (!isR2Configured(config)) {
      return { success: false, url: base64DataUrl, error: 'Cloudflare R2 is not configured.' };
    }
  }

  // 2. Direct Client-Side S3 SigV4 Upload (using correct path-style endpoint)
  if (!isR2Configured(config)) {
    return { success: false, url: base64DataUrl, error: 'Cloudflare R2 is not configured.' };
  }
  try {
    const { data: fileBytes, mimeType } = dataUrlToUint8Array(base64DataUrl);

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const uriPath = `/${encodeURIComponent(bucketName)}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`;
    const endpoint = `https://${host}${uriPath}`;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = 'auto';
    const service = 's3';

    const payloadHash = await sha256Hex(fileBytes);

    const canonicalHeaders =
      `content-type:${mimeType}\n` +
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;

    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest =
      `PUT\n` +
      `${uriPath}\n` +
      `\n` +
      canonicalHeaders +
      `\n` +
      signedHeaders +
      `\n` +
      payloadHash;

    const canonicalRequestHash = await sha256Hex(canonicalRequest);

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n` +
      amzDate +
      `\n` +
      credentialScope +
      `\n` +
      canonicalRequestHash;

    const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
    const signatureBuffer = await hmacSha256(signingKey, stringToSign);
    const signature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const authorizationHeader =
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`;

    const uploadRes = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'x-amz-date': amzDate,
        'x-amz-content-sha256': payloadHash,
        Authorization: authorizationHeader
      },
      body: fileBytes
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      throw new Error(`R2 upload returned status ${uploadRes.status}: ${errText || uploadRes.statusText}`);
    }

    // Determine public URL
    let publicUrl = '';
    if (publicDomain) {
      publicUrl = `${publicDomain}/${cleanKey}`;
    } else {
      publicUrl = `https://${host}${uriPath}`;
    }

    return {
      success: true,
      url: publicUrl
    };
  } catch (err: any) {
    console.error('Cloudflare R2 direct upload error:', err);
    return {
      success: false,
      url: base64DataUrl,
      error: err.message || 'Upload to Cloudflare R2 failed'
    };
  }
}

export interface CloudBackupRecord {
  key: string;
  url: string;
  date: string;
  time: string;
  timestamp: number;
  itemCount: number;
  paymentCount: number;
  storeName: string;
  sessionDate: string;
}

const R2_BACKUP_HISTORY_KEY = 'live_pos_r2_backup_history';
const R2_LAST_BACKUP_KEY = 'live_pos_last_r2_eod_backup';

function safeStringToBase64(str: string): string {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => {
    return String.fromCharCode(parseInt(p1, 16));
  }));
}

export function getR2BackupHistory(): CloudBackupRecord[] {
  const list = safeGetItem<CloudBackupRecord[]>(R2_BACKUP_HISTORY_KEY);
  if (Array.isArray(list)) return list;
  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function getLastR2Backup(): CloudBackupRecord | null {
  const item = safeGetItem<CloudBackupRecord>(R2_LAST_BACKUP_KEY);
  if (!item) return null;
  if (typeof item === 'object') return item as CloudBackupRecord;
  if (typeof item === 'string') {
    try {
      return JSON.parse(item) as CloudBackupRecord;
    } catch {
      return null;
    }
  }
  return null;
}

export function saveR2BackupRecord(record: CloudBackupRecord): void {
  safeSetItem(R2_LAST_BACKUP_KEY, record);
  const current = getR2BackupHistory();
  const updated = [record, ...current.filter(r => r.key !== record.key)].slice(0, 30);
  safeSetItem(R2_BACKUP_HISTORY_KEY, updated);
}

export async function uploadJsonBackupToCloudflare(
  backupData: any,
  storeId: string,
  sessionDate: string,
  config = getStoredR2Config()
): Promise<{ success: boolean; url?: string; key?: string; record?: CloudBackupRecord; error?: string }> {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString([], { hour12: false }).replace(/:/g, '-');
    const cleanStore = (storeId || 'store').replace(/[^a-zA-Z0-9_-]/g, '');
    const fileKey = `backups/${cleanStore}/eod_${sessionDate || dateStr}_${timeStr}.json`;
    const latestKey = `backups/${cleanStore}/latest_eod_backup.json`;

    const jsonStr = JSON.stringify(backupData, null, 2);
    const base64DataUrl = `data:application/json;base64,${safeStringToBase64(jsonStr)}`;

    const res = await uploadToCloudflareR2(fileKey, base64DataUrl, config);
    if (!res.success) {
      return { success: false, error: res.error || 'Cloudflare upload failed' };
    }

    // Also update latest pointer
    try {
      await uploadToCloudflareR2(latestKey, base64DataUrl, config);
    } catch (_) {}

    const record: CloudBackupRecord = {
      key: fileKey,
      url: res.url,
      date: dateStr,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp: now.getTime(),
      itemCount: Array.isArray(backupData.allMines) ? backupData.allMines.length : 0,
      paymentCount: Array.isArray(backupData.allPayments) ? backupData.allPayments.length : 0,
      storeName: backupData.settings?.storeName || storeId,
      sessionDate: sessionDate || dateStr
    };

    saveR2BackupRecord(record);
    return { success: true, url: res.url, key: fileKey, record };
  } catch (err: any) {
    console.error('Error uploading JSON backup to Cloudflare:', err);
    return { success: false, error: err.message || 'Backup failed' };
  }
}

export async function fetchBackupFromCloudflare(
  fileKeyOrUrl: string,
  config = getStoredR2Config()
): Promise<{ success: boolean; data?: any; error?: string }> {
  // If full url and publicDomain exists, try direct GET
  if (fileKeyOrUrl.startsWith('http')) {
    try {
      const directRes = await fetch(fileKeyOrUrl);
      if (directRes.ok) {
        const data = await directRes.json();
        return { success: true, data };
      }
    } catch (_) {}
  }

  // Use server proxy endpoint /api/r2-get
  try {
    const res = await fetch('/api/r2-get', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileKey: fileKeyOrUrl,
        config: isR2Configured(config) ? config : undefined
      })
    });

    if (res.ok) {
      const resData = await res.json();
      if (resData.success && resData.data) {
        return { success: true, data: resData.data };
      }
      return { success: false, error: resData.error || 'Failed to download backup' };
    } else {
      const errJson = await res.json().catch(() => ({}));
      return { success: false, error: errJson.error || `Server returned ${res.status}` };
    }
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error fetching backup' };
  }
}

