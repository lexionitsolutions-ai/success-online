import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createDatabase} from '../database.js';
import {announcementSchema} from '../announcements.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
try {
  await db.transaction(async()=>{
    await db.exec(announcementSchema);
    if(db.cloud) await db.exec('ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.announcements FROM anon, authenticated;');
    await db.one('SELECT COUNT(*) count FROM announcements');
  });
  console.log('Announcement storage is ready. Only signed-in users can read announcements; posting and removal require an administrator.');
} finally {await db.close();}
