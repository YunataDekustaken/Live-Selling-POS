import express from 'express';
import path from 'path';
import fs from 'fs';
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

  // Image proxy route to bypass client-side CORS and prevent canvas tainting in collages
  app.get('/api/proxy-image', async (req, res) => {
    try {
      const imageUrl = req.query.url as string;
      if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
        return res.status(400).json({ error: 'Valid http/https url required' });
      }

      const response = await fetch(imageUrl);
      if (!response.ok) {
        return res.status(response.status).send(`Failed to fetch image: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      res.setHeader('Content-Type', contentType);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.send(buffer);
    } catch (err: any) {
      console.error('Image proxy error:', err);
      return res.status(500).json({ error: err.message || 'Image proxy failed' });
    }
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

  // Serve static assets from both /public/assets and root /assets
  app.use('/assets', express.static(path.join(process.cwd(), 'public', 'assets')));
  app.use('/assets', express.static(path.join(process.cwd(), 'assets')));

  // Check and stream uploaded store logo if present in assets, strictly isolated per business profile
  app.get(['/api/receipt-logo', '/api/profile-logo/:profileId?'], (req, res) => {
    const profileId = (req.params?.profileId || req.query.profileId || req.query.profile || req.query.p || '').toString().trim();
    const profileName = (req.query.profileName || req.query.name || '').toString().trim().toLowerCase();
    const isLeaf = profileId === 'prof_main' || profileName.includes('leaf') || (!profileId && !profileName);
    const isJoyful = profileId === 'prof_1788794471662' || profileName.includes('joyful');

    const possibleDirs = [
      path.join(process.cwd(), 'assets'),
      path.join(process.cwd(), 'public', 'assets'),
      path.join(process.cwd(), 'public')
    ];

    const cleanName = profileName.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    // Candidate file patterns for this profile
    const profileSpecificNames: string[] = [];
    if (profileId) {
      profileSpecificNames.push(
        `logo_${profileId}.png`, `logo_${profileId}.jpg`, `logo_${profileId}.jpeg`, `logo_${profileId}.webp`, `logo_${profileId}.svg`,
        `${profileId}_logo.png`, `${profileId}_logo.jpg`, `${profileId}.png`, `${profileId}.jpg`
      );
    }
    if (cleanName) {
      profileSpecificNames.push(
        `logo_${cleanName}.png`, `logo_${cleanName}.jpg`, `logo_${cleanName}.jpeg`, `logo_${cleanName}.webp`,
        `${cleanName}_logo.png`, `${cleanName}_logo.jpg`, `${cleanName}.png`, `${cleanName}.jpg`
      );
    }

    // Known specific profile logo files
    const leafDefaultNames = [
      'leafandlayer_logo.png', 'leafandlayer.png', 'leaf_and_layer_logo.png',
      'logo.png', 'logo.jpg', 'leaf_logo.png', 'leaf_logo.jpg'
    ];
    const joyfulDefaultNames = [
      'joyfulsurplus_logo.png', 'joyfulsurplus.png', 'joyful_surplus_logo.png', 'joyful_logo.png'
    ];

    let candidateNames = [...profileSpecificNames];
    if (isLeaf) {
      candidateNames.push(...leafDefaultNames);
    }
    if (isJoyful) {
      candidateNames.push(...joyfulDefaultNames);
    }

    const mimeTypes: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml'
    };

    for (const dir of possibleDirs) {
      if (!fs.existsSync(dir)) continue;

      // 1. Check exact candidate file names
      for (const name of candidateNames) {
        const fullPath = path.join(dir, name);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          const ext = path.extname(fullPath).toLowerCase();
          res.setHeader('Content-Type', mimeTypes[ext] || 'image/png');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          return fs.createReadStream(fullPath).pipe(res);
        }
      }

      // 2. Check profile-specific prefix match in assets directory
      if (dir.endsWith('assets') && (profileId || cleanName)) {
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const lowerFile = file.toLowerCase();
            const ext = path.extname(file).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) {
              const matchesProfile = (profileId && lowerFile.includes(profileId.toLowerCase())) ||
                                     (cleanName && lowerFile.includes(cleanName));
              if (matchesProfile) {
                const fullPath = path.join(dir, file);
                if (fs.statSync(fullPath).isFile()) {
                  res.setHeader('Content-Type', mimeTypes[ext] || 'image/png');
                  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                  return fs.createReadStream(fullPath).pipe(res);
                }
              }
            }
          }
        } catch {
          // ignore directory read error
        }
      }
    }

    return res.status(404).json({ hasLogo: false, message: `No logo file found for profile ${profileId || profileName || 'default'}` });
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
