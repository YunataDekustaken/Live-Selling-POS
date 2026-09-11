export default function handler(req: any, res: any) {
  // Enable CORS for API requests
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

  const hasEnv = Boolean(
    (process.env.R2_ACCOUNT_ID || process.env.VITE_R2_ACCOUNT_ID) &&
    (process.env.R2_ACCESS_KEY_ID || process.env.VITE_R2_ACCESS_KEY_ID) &&
    (process.env.R2_SECRET_ACCESS_KEY || process.env.VITE_R2_SECRET_ACCESS_KEY) &&
    (process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME)
  );

  res.status(200).json({
    hasEnv,
    bucketName: process.env.R2_BUCKET_NAME || process.env.VITE_R2_BUCKET_NAME || '',
    publicDomain: process.env.R2_PUBLIC_DOMAIN || process.env.VITE_R2_PUBLIC_DOMAIN || ''
  });
}
