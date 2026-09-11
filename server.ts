import express from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Check R2 status (detects if server has .env variables configured)
  app.get('/api/r2-status', (req, res) => {
    const hasEnv = Boolean(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
    );
    res.json({
      hasEnv,
      bucketName: process.env.R2_BUCKET_NAME || '',
      publicDomain: process.env.R2_PUBLIC_DOMAIN || ''
    });
  });

  // R2 Upload Proxy Endpoint (Supports both client config & server .env fallback)
  app.post('/api/r2-upload', async (req, res) => {
    try {
      const { fileKey, base64DataUrl, config } = req.body;
      if (!fileKey || !base64DataUrl) {
        return res.status(400).json({ error: 'Missing required parameters (fileKey or base64DataUrl)' });
      }

      const accountId = (config?.accountId || process.env.R2_ACCOUNT_ID || '').trim();
      const accessKeyId = (config?.accessKeyId || process.env.R2_ACCESS_KEY_ID || '').trim();
      const secretAccessKey = (config?.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '').trim();
      const bucketName = (config?.bucketName || process.env.R2_BUCKET_NAME || '').trim();
      const publicDomain = (config?.publicDomain || process.env.R2_PUBLIC_DOMAIN || '').trim().replace(/\/+$/, '');

      if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
        return res.status(400).json({ 
          error: 'Incomplete R2 credentials. Please configure R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME in .env or in the App Settings.' 
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

      const kDate = crypto.createHmac('sha256', 'AWS4' + secretAccessKey.trim()).update(dateStamp).digest();
      const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
      const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
      const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
      const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

      const authorizationHeader =
        `AWS4-HMAC-SHA256 Credential=${accessKeyId.trim()}/${credentialScope}, ` +
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
        publicUrl = `${publicDomain.trim().replace(/\/+$/, '')}/${cleanKey}`;
      } else {
        publicUrl = `https://${host}${uriPath}`;
      }

      return res.json({ success: true, url: publicUrl });
    } catch (err: any) {
      console.error('Server R2 upload error:', err);
      return res.status(500).json({ error: err.message || 'Failed to upload to Cloudflare R2' });
    }
  });

  // R2 Download / Get Proxy Endpoint (Supports fetching private backups from R2)
  app.post('/api/r2-get', async (req, res) => {
    try {
      let { fileKey, config } = req.body;
      if (!fileKey) {
        return res.status(400).json({ error: 'Missing fileKey' });
      }

      if (typeof fileKey === 'string' && fileKey.startsWith('http')) {
        try {
          const urlObj = new URL(fileKey);
          fileKey = urlObj.pathname.replace(/^\/+/, '');
        } catch (_) {}
      }

      const accountId = (config?.accountId || process.env.R2_ACCOUNT_ID || '').trim();
      const accessKeyId = (config?.accessKeyId || process.env.R2_ACCESS_KEY_ID || '').trim();
      const secretAccessKey = (config?.secretAccessKey || process.env.R2_SECRET_ACCESS_KEY || '').trim();
      const bucketName = (config?.bucketName || process.env.R2_BUCKET_NAME || '').trim();

      if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
        return res.status(400).json({ error: 'Incomplete R2 credentials' });
      }

      const cleanKey = String(fileKey).replace(/^\/+/, '');
      const host = `${accountId}.r2.cloudflarestorage.com`;
      const uriPath = `/${encodeURIComponent(bucketName)}/${cleanKey.split('/').map(encodeURIComponent).join('/')}`;
      const endpoint = `https://${host}${uriPath}`;

      const now = new Date();
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
      const dateStamp = amzDate.substring(0, 8);
      const region = 'auto';
      const service = 's3';

      const payloadHash = crypto.createHash('sha256').update('').digest('hex');

      const canonicalHeaders =
        `host:${host}\n` +
        `x-amz-content-sha256:${payloadHash}\n` +
        `x-amz-date:${amzDate}\n`;

      const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

      const canonicalRequest =
        `GET\n` +
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

      const kDate = crypto.createHmac('sha256', 'AWS4' + secretAccessKey.trim()).update(dateStamp).digest();
      const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
      const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
      const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
      const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

      const authorizationHeader =
        `AWS4-HMAC-SHA256 Credential=${accessKeyId.trim()}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, ` +
        `Signature=${signature}`;

      const getRes = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'x-amz-date': amzDate,
          'x-amz-content-sha256': payloadHash,
          Authorization: authorizationHeader,
        },
      });

      if (!getRes.ok) {
        const errText = await getRes.text().catch(() => '');
        return res.status(getRes.status).json({ error: `R2 returned status ${getRes.status}: ${errText || getRes.statusText}` });
      }

      const text = await getRes.text();
      try {
        const json = JSON.parse(text);
        return res.json({ success: true, data: json });
      } catch {
        return res.json({ success: true, raw: text });
      }
    } catch (err: any) {
      console.error('Server R2 get error:', err);
      return res.status(500).json({ error: err.message || 'Failed to download from Cloudflare R2' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
