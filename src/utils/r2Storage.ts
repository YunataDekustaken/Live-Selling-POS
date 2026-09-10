import { safeGetItem, safeSetItem } from './storage';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicDomain: string; // e.g. "https://pub-xxxx.r2.dev" or custom domain
}

const R2_CONFIG_KEY = 'live_pos_r2_config';

export function getStoredR2Config(): R2Config {
  const saved = safeGetItem<any>(R2_CONFIG_KEY);
  if (saved && typeof saved === 'object') {
    return {
      accountId: (saved as any).accountId || '',
      accessKeyId: (saved as any).accessKeyId || '',
      secretAccessKey: (saved as any).secretAccessKey || '',
      bucketName: (saved as any).bucketName || '',
      publicDomain: (saved as any).publicDomain || ''
    };
  }
  return {
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    publicDomain: ''
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

// Upload image binary directly to Cloudflare R2 using AWS SigV4 (Pure Client-Side)
export async function uploadToCloudflareR2(
  fileKey: string,
  base64DataUrl: string,
  config = getStoredR2Config()
): Promise<{ success: boolean; url: string; error?: string }> {
  if (!isR2Configured(config)) {
    return { success: false, url: base64DataUrl, error: 'Cloudflare R2 is not configured.' };
  }

  try {
    const { data: fileBytes, mimeType } = dataUrlToUint8Array(base64DataUrl);
    const cleanKey = fileKey.replace(/^\/+/, '');
    const accountId = config.accountId.trim();
    const bucketName = config.bucketName.trim();
    const accessKeyId = config.accessKeyId.trim();
    const secretAccessKey = config.secretAccessKey.trim();

    const host = `${bucketName}.${accountId}.r2.cloudflarestorage.com`;
    const endpoint = `https://${host}/${encodeURIComponent(cleanKey)}`;
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
      `/${encodeURIComponent(cleanKey)}\n` +
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
    if (config.publicDomain) {
      publicUrl = `${config.publicDomain.replace(/\/+$/, '')}/${cleanKey}`;
    } else {
      // Fallback: If public domain not specified, link directly to R2 dev public or s3 path
      publicUrl = `https://${host}/${cleanKey}`;
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
