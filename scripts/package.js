import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createZip } from '../archive.js';
const entries = [];
const files = ['package.json','package-lock.json','server.js','acceptance-tests.js','staff-accounts.js','case-quotes.js','service-options.js','branch-account.js','staff-performance.js','cash-payments.js','case-deletion.js','case-discounts.js','intake-uploads.js','pf-credentials.js','service-catalog-sync.js','announcements.js','payments.js','payment-batches.js','reuploads.js','PAYMENTS.md','database.js','storage.js','initial-accounts.js','vercel.json','service-catalog.js','operations-schema.js','archive.js','.env.example','.gitignore','.dockerignore','Dockerfile','render.yaml','README.md','DEPLOYMENT.md'];
files.push('sms-observer.js','sms-auto-confirm.js','sms-checkouts.js');
function include(path) { entries.push({name:`Success Online/${path.replaceAll('\\','/')}`,data:readFileSync(path)}); }
for (const file of files) include(file);
for (const directory of ['public','google-apps-script','scripts','tests','api','supabase']) {
  for (const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory()) includeTree(path);else include(path);
  }
}
function includeTree(directory) {
  for(const entry of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name);
    if(entry.isDirectory()) includeTree(path);else include(path);
  }
}
for(const directory of ['android-sms-observer','docs']) includeTree(directory);
mkdirSync('deliverables',{recursive:true});
writeFileSync('deliverables/Success-Online-Handoff.zip',createZip(entries));
console.log('Created deliverables/Success-Online-Handoff.zip (source and setup files; excludes credentials and client data).');
