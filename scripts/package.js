import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createZip } from '../archive.js';
const entries = [];
const files = ['package.json','package-lock.json','server.js','payments.js','PAYMENTS.md','database.js','storage.js','initial-accounts.js','vercel.json','service-catalog.js','operations-schema.js','archive.js','.env.example','.gitignore','.dockerignore','Dockerfile','render.yaml','README.md','DEPLOYMENT.md'];
function include(path) { entries.push({name:`Success Online/${path.replaceAll('\\','/')}`,data:readFileSync(path)}); }
for (const file of files) include(file);
for (const directory of ['public','google-apps-script','scripts','tests','api','supabase']) {
  for (const file of readdirSync(directory)) include(join(directory,file));
}
mkdirSync('deliverables',{recursive:true});
writeFileSync('deliverables/Success-Online-Handoff.zip',createZip(entries));
console.log('Created deliverables/Success-Online-Handoff.zip (source and setup files; excludes credentials and client data).');
