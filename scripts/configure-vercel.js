import { writeFileSync } from 'node:fs';
const backend = process.env.BACKEND_ORIGIN;
if (!backend || !backend.startsWith('https://') || new URL(backend).pathname !== '/') throw new Error('Set BACKEND_ORIGIN to the HTTPS origin of your persistent Node backend');
writeFileSync('vercel.json', JSON.stringify({
  $schema: 'https://openapi.vercel.sh/vercel.json',
  framework: null, buildCommand: 'npm run build', outputDirectory: 'public',
  rewrites: [{ source: '/api/:path*', destination: `${backend.replace(/\/$/, '')}/api/:path*` }],
  headers: [{ source: '/(.*)', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Referrer-Policy', value: 'same-origin' }] }]
}, null, 2));
console.log('Vercel frontend configuration ready.');
