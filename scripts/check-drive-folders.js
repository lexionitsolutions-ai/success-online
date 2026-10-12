import { loadEnvFile } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
if (existsSync('.env')) loadEnvFile('.env');
const db = new DatabaseSync(process.env.DATABASE_PATH || './data/success-online.sqlite');
for (const row of db.prepare('SELECT name,value FROM integration_settings').all()) process.env[row.name] = row.value;
const response = await fetch('https://oauth2.googleapis.com/token', {method:'POST',body:new URLSearchParams({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID || '',client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',refresh_token:process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',grant_type:'refresh_token'})});
const token = await response.json();
if (!response.ok) throw new Error(token.error_description || token.error || 'Google authorization failed');
if (process.argv[2] === '--account') {
  const identity = await fetch('https://www.googleapis.com/drive/v3/about?fields=user',{headers:{authorization:`Bearer ${token.access_token}`}});
  const account = await identity.json();
  if (!identity.ok) throw new Error(account.error?.message || 'Could not identify connected account');
  console.log(JSON.stringify({connectedGoogleAccount:account.user?.emailAddress}));
  db.close();
  process.exit(0);
}
async function check(label, id) {
  if (!id) return console.log(JSON.stringify({label,configured:false}));
  const result = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,mimeType,trashed,capabilities(canAddChildren)`,{headers:{authorization:`Bearer ${token.access_token}`}});
  const data = await result.json();
  console.log(JSON.stringify({label,id,status:result.status,folder:data.mimeType === 'application/vnd.google-apps.folder',trashed:data.trashed,canAddChildren:data.capabilities?.canAddChildren,error:data.error?.message}));
  return {response:result,data};
}
if (process.argv[2] === '--set-root') {
  const folderId = process.argv[3];
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(folderId || '')) throw new Error('Provide a valid folder ID');
  const folder = await check('New configured root',folderId);
  if (!folder.response.ok || folder.data.trashed || folder.data.mimeType !== 'application/vnd.google-apps.folder' || folder.data.capabilities?.canAddChildren !== true) throw new Error('New folder is unavailable or not writable; configuration was not changed');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [name,value] of [['GOOGLE_ROOT_FOLDER_ID',folderId],['GOOGLE_ROOT_FOLDER_INVALID','0']]) db.prepare('INSERT INTO integration_settings (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name,value);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  console.log('Main Drive folder verified and saved. Restart the backend to load it.');
} else await check('Configured root',process.env.GOOGLE_ROOT_FOLDER_ID);
for (const c of db.prepare('SELECT ref,drive_customer_folder_id,drive_case_folder_id FROM cases ORDER BY created_at DESC LIMIT 5').all()) {
  await check(`${c.ref} customer folder`,c.drive_customer_folder_id);
  await check(`${c.ref} case folder`,c.drive_case_folder_id);
}
db.close();
