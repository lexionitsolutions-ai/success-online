import { loadEnvFile } from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, sep, join, dirname } from 'node:path';
import { sheetHeaders } from '../operations-schema.js';

if (existsSync('.env')) loadEnvFile('.env');
const workspace = resolve('.');
const dbPath = resolve(process.env.DATABASE_PATH || './data/success-online.sqlite');
if (!dbPath.startsWith(workspace + sep)) throw new Error('Database must be inside this workspace');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout=10000');
for (const setting of db.prepare('SELECT name,value FROM integration_settings').all()) process.env[setting.name] = setting.value;
const cloudOnly = process.argv.includes('--cloud-only');
const cases = cloudOnly ? [] : db.prepare('SELECT id,ref,drive_case_folder_id FROM cases').all();
const documents = cloudOnly ? [] : db.prepare('SELECT id,case_id,storage_path,drive_file_id FROM documents').all();
if (process.argv.includes('--inspect')) {
  const counts = {};
  for (const table of ['cases','documents','payments','notes','users','services']) counts[table] = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  console.log(JSON.stringify({ counts, driveMode:process.env.DRIVE_MODE, sheetsMode:process.env.SHEETS_MODE, driveFolders:cases.filter(c => c.drive_case_folder_id).length, cloudFiles:documents.filter(d => d.storage_path.startsWith('gdrive://')).length }));
  db.close();
} else {
  if (!process.argv.includes('--delete') && !cloudOnly) throw new Error('Use --inspect, --delete, or --cloud-only');
  const storageRoot = resolve(process.env.STORAGE_PATH || './demo-integrations');
  if (!storageRoot.startsWith(workspace + sep)) throw new Error('Storage must be inside this workspace');
  const files = documents.filter(d => !d.storage_path.startsWith('gdrive://')).map(d => resolve(d.storage_path));
  for (const file of files) if (!file.startsWith(storageRoot + sep)) throw new Error('Document path is outside the configured storage root');
  const cloud = { caseIds:cases.map(c => c.id), refs:cases.map(c => c.ref), folders:[...new Set(cases.map(c => c.drive_case_folder_id).filter(Boolean))], files:[...new Set(documents.filter(d => d.storage_path.startsWith('gdrive://')).map(d => d.drive_file_id))] };
  const manifestPath = join(dirname(dbPath),'deleted-case-cloud-cleanup.json');
  const pending = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath,'utf8')) : {};
  for (const key of ['caseIds','refs','folders','files']) cloud[key] = [...new Set([...(pending[key] || []), ...cloud[key]])];
  // Retain only cloud cleanup identifiers until linked Drive/Sheets cleanup succeeds.
  writeFileSync(manifestPath, JSON.stringify(cloud,null,2));
  let cloudError = null;
  try {
    if ((process.env.DRIVE_MODE === 'live' || process.env.SHEETS_MODE === 'live') && cloud.refs.length) {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {method:'POST',body:new URLSearchParams({client_id:process.env.GOOGLE_OAUTH_CLIENT_ID || '',client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',refresh_token:process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',grant_type:'refresh_token'})});
      const token = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(token.error_description || token.error || 'Google authentication failed');
      async function google(url, options={}) {
        const response = await fetch(url,{...options,headers:{authorization:`Bearer ${token.access_token}`,'content-type':'application/json',...options.headers}});
        if (!response.ok && response.status !== 404) throw new Error(`Google cleanup failed (${response.status})`);
        return response.status === 404 ? null : response.json();
      }
      if (process.env.DRIVE_MODE === 'live') for (const id of [...cloud.folders,...cloud.files]) await google(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {method:'PATCH',body:JSON.stringify({trashed:true})});
      if (process.env.SHEETS_MODE === 'live' && process.env.GOOGLE_OPERATIONS_SPREADSHEET_ID) {
        const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.GOOGLE_OPERATIONS_SPREADSHEET_ID)}`;
        const metadata = await google(`${base}?fields=sheets(properties(title))`);
        const tabs = new Set(metadata.sheets.map(s => s.properties.title));
        const refs = new Set(cloud.refs), caseIds = new Set(cloud.caseIds), ranges = [];
        for (const tab of Object.keys(sheetHeaders).filter(t => tabs.has(t))) {
          const escaped = tab.replaceAll("'", "''");
          const result = await google(`${base}/values/${encodeURIComponent(`'${escaped}'!A:Z`)}`);
          const rows = result?.values || [];
          for (let index=1; index<rows.length; index++) {
            const row = rows[index];
            const matches = ['Daily Report','Staff Performance'].includes(tab) || (tab === 'Documents' || tab === 'Cashflow' ? refs.has(row[1]) : tab === 'Sync Log' ? refs.has(row[2]) || caseIds.has(row[2]) : refs.has(row[0]));
            if (matches) ranges.push(`'${escaped}'!A${index+1}:Z${index+1}`);
          }
        }
        if (ranges.length) await google(`${base}/values:batchClear`,{method:'POST',body:JSON.stringify({ranges})});
      }
    }
    unlinkSync(manifestPath);
  } catch (error) { cloudError = error.message; }
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const c of cases) {
      const match = c.ref.match(/^SO-(\d{4})-(\d+)$/);
      if (match) {
        const name = `CASE_REFERENCE_LAST_${match[1]}`;
        const existing = Number(db.prepare('SELECT value FROM integration_settings WHERE name=?').get(name)?.value || 0);
        db.prepare('INSERT INTO integration_settings (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(name,String(Math.max(existing,Number(match[2]))));
      }
      for (const table of ['documents','payments','notes']) db.prepare(`DELETE FROM ${table} WHERE case_id=?`).run(c.id);
      db.prepare('DELETE FROM sync_jobs WHERE entity_id=?').run(c.id);
      db.prepare('DELETE FROM cases WHERE id=?').run(c.id);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  for (const file of files) if (existsSync(file)) unlinkSync(file);
  const mirror = join(storageRoot,'Success Online Operations.json');
  if (existsSync(mirror)) {
    const data = JSON.parse(readFileSync(mirror,'utf8')), refs = new Set(cases.map(c => c.ref));
    for (const ref of refs) { delete data.allCases?.[ref]; delete data.documents?.[ref]; }
    data.cashflow = (data.cashflow || []).filter(r => !refs.has(r.caseId));
    data.syncLog = (data.syncLog || []).filter(r => !refs.has(r.key));
    writeFileSync(mirror,JSON.stringify(data,null,2));
  }
  console.log(JSON.stringify({deletedCases:cases.length,deletedDocuments:documents.length,remainingCases:db.prepare('SELECT COUNT(*) AS n FROM cases').get().n,cloudCleanup:cloudError ? 'pending' : 'complete',cloudError}));
  db.close();
}
