import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from '../server.js';
import { storageEnabled, writeStorage } from '../storage.js';
import { safeFileName } from '../archive.js';
let source;
try {
  if (!db.cloud || !storageEnabled()) throw new Error('Configure DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY first.');
  const username = process.env.INITIAL_ADMIN_USERNAME?.toLowerCase(), password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password || password.length < 10) throw new Error('Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD (10+ characters) for the migrated administrator.');
  const sourcePath = resolve(process.env.SQLITE_IMPORT_PATH || './data/success-online.sqlite');
  if (!existsSync(sourcePath)) throw new Error('SQLite source file not found. Set SQLITE_IMPORT_PATH to the database you want to import.');
  source = new DatabaseSync(sourcePath,{readOnly:true});
  await db.exec(readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  const tables = ['users','customers','services','variants','cases','documents','payments','notes','notifications','audit_logs','sync_jobs'];
  await db.transaction(async () => {
    // Serialize importers and refuse to overwrite an existing application database.
    await db.exec('LOCK TABLE users,customers,services,variants,cases,documents,payments,notes,notifications,audit_logs,sync_jobs IN EXCLUSIVE MODE');
    for (const table of tables) if ((await db.one(`SELECT COUNT(*) n FROM ${table}`)).n) throw new Error('Import requires empty application tables. Use a new Supabase project; no existing records will be overwritten.');
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        if (table === 'documents' && row.storage_path && !row.storage_path.startsWith('gdrive://') && !row.storage_path.startsWith('supabase://')) {
          const file = resolve(row.storage_path);
          if (!existsSync(file)) throw new Error(`Local document is missing for ${row.id}. Restore the document before importing.`);
          const path = `cases/${row.case_id}/${randomUUID()}/${safeFileName(row.file_name)}`;
          await writeStorage(path,readFileSync(file),row.mime_type);
          row.storage_path = 'supabase://' + path;
          row.drive_file_id = '';
        }
        if (table === 'users') {
          const [salt,hash] = row.password_hash.split(':');
          if (hash && timingSafeEqual(Buffer.from(hash,'hex'),scryptSync('Demo@12345',salt,32))) row.active = 0;
          if (row.username.toLowerCase() === username) {
            if (row.role !== 'admin') throw new Error('The initial admin username belongs to a non-admin account. Choose a different administrator username.');
            const salt = randomBytes(16).toString('hex');
            row.password_hash = `${salt}:${scryptSync(password,salt,32).toString('hex')}`; row.active = 1;
          }
        }
        const columns = Object.keys(row);
        await db.run(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(column => '$'+column).join(',')})`,Object.fromEntries(columns.map(column=>['$'+column,row[column]])));
      }
    }
    if (!await db.one('SELECT id FROM users WHERE LOWER(username)=$username',{$username:username})) {
      const salt = randomBytes(16).toString('hex');
      await db.run('INSERT INTO users VALUES ($id,$username,$name,$role,$hash,1,$at)',{$id:'usr_'+randomUUID(),$username:username,$name:process.env.INITIAL_ADMIN_NAME||'Administrator',$role:'admin',$hash:`${salt}:${scryptSync(password,salt,32).toString('hex')}`,$at:new Date().toISOString()});
    }
    await db.exec(`INSERT INTO integration_settings(name,value)
      SELECT 'CASE_REFERENCE_LAST_' || substr(ref,4,4),MAX(substr(ref,9)::bigint)::text FROM cases GROUP BY substr(ref,4,4)
      ON CONFLICT(name) DO UPDATE SET value=GREATEST(integration_settings.value::bigint,excluded.value::bigint)::text`);
  });
  console.log('Imported application records and local documents. Demo-password accounts were disabled; your configured administrator is active. Google credentials remain in environment variables.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { source?.close();await db.close(); }
