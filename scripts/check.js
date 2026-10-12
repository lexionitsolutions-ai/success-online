import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import './generate-apps-script.js';
import './generate-supabase-schema.js';
const required = ['server.js','service-catalog.js','public/index.html','public/app.js','public/styles.css','.env.example','google-apps-script/Code.gs','README.md'];
const missing = required.filter(f => !existsSync(f));
if (missing.length) {
  console.error('Missing files:', missing.join(', '));
  process.exit(1);
}
writeFileSync('public/script.js', readFileSync('public/app.js'));
for (const file of ['server.js','database.js','storage.js','initial-accounts.js','api/index.js','public/script.js','archive.js','operations-schema.js']) {
  const check = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (check.status) process.exit(check.status);
}
const test = spawnSync(process.execPath, ['--test', 'tests/business.test.js', 'tests/api.test.js', 'tests/ui.test.js', 'tests/postgres.test.js', 'tests/initial-accounts.test.js'], { stdio: 'inherit' });
process.exit(test.status);
