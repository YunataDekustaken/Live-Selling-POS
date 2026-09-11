import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req: any, res: any) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { fileKey, base64DataUrl, config: clientConfig } = body || {};

    if (!fileKey || !base64DataUrl) {
      return res.status(400).json({ error: 'Missing required parameters (fileKey or base64DataUrl)' });
    }

    const accountId = (
      clientConfig?.accountId ||
      process.env.R2_ACCOUNT_ID ||
      process.env.VITE_R2_ACCOUNT_ID ||
      ''
    ).trim();

    const accessKeyId = (
      clientConfig?.accessKeyId ||
      process.env.R2_ACCESS_KEY_ID ||
      process.env.VITE_R2_ACCESS_KEY_ID ||
      ''
    ).trim();

    const secretAccessKey = (
      clientConfig?.secretAccessKey ||
      process.env.R2_SECRET_ACCESS_KEY ||
      process.env.VITE_R2_SECRET_ACCESS_KEY ||
      ''
    ).trim();

    const bucketName = (
      clientConfig?.bucketName ||
      process.env.R2_BUCKET_NAME ||
      process.env.VITE_R2_BUCKET_NAME ||
      ''
    ).trim();

    const publicDomain = (
      clientConfig?.publicDomain ||
      process.env.R2_PUBLIC_DOMAIN ||
      process.env.VITE_R2_PUBLIC_DOMAIN ||
      ''
    ).trim().replace(/\/+$/, '');

    if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
      return res.status(400).json({
        error: 'Incomplete R2 credentials. Please set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in Vercel Environment Variables or in App Settings.'
      });
    }

    const parts = base64DataUrl.split(',');
    const mimeType = parts[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const fileBuffer = Buffer.from(parts[1], 'base64');
    const cleanKey = fileKey.replace(/^\/+/, '');

    const host = `${accountId}.r2.cloudflarestorage.com`;
    const uriPath = `/${encodeURIComponent(bucketName)}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`;
    const endpoint = `https://${host}${uriPath}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.substring(0, 8);
    const region = 'auto';
    const service = 's3';

    const payloadHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

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

    const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n` +
      amzDate +
      `\n` +
      credentialScope +
      `\n` +
      canonicalRequestHash;

    const kDate = crypto.createHmac('sha256', 'AWS4' + secretAccessKey).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

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
        Authorization: authorizationHeader,
      },
      body: fileBuffer,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      return res.status(uploadRes.status).json({
        error: `R2 returned status ${uploadRes.status}: ${errText || uploadRes.statusText}`,
      });
    }

    let publicUrl = '';
    if (publicDomain) {
      publicUrl = `${publicDomain}/${cleanKey}`;
    } else {
      publicUrl = `https://${host}${uriPath}`;
    }

    return res.status(200).json({ success: true, url: publicUrl });
  } catch (err: any) {
    console.error('Vercel R2 upload function error:', err);
    return res.status(500).json({ error: err.message || 'Failed to upload to Cloudflare R2' });
  }
}
