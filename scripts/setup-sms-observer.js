// Add only the SMS evidence table; do not reseed accounts, prices, cases or storage.
import {readFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {parseEnv} from 'node:util';
import {createDatabase} from '../database.js';
import {smsObserverSchema} from '../sms-observer.js';
const productionFile=process.argv[2];
if(!productionFile)throw Error('Pass the linked production environment file for project verification.');
const local=parseEnv(readFileSync('.env','utf8')),production=parseEnv(readFileSync(productionFile,'utf8'));
const projectRef=new URL(production.SUPABASE_URL).hostname.split('.')[0],connection=new URL(local.DATABASE_URL);
if(!local.SUPABASE_URL || local.SUPABASE_URL!==production.SUPABASE_URL || !(decodeURIComponent(connection.username).includes(projectRef) || connection.hostname.startsWith('db.'+projectRef+'.')))throw Error('Local database does not match the linked production project. No schema changes made.');
loadEnvFile('.env');
const db=createDatabase();
try {
  if(!db.cloud)throw Error('A verified cloud database is required.');
  await db.transaction(async()=>{
    await db.exec(smsObserverSchema);
    await db.exec('ALTER TABLE public.sms_payment_observations ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.sms_payment_observations FROM anon, authenticated; ALTER TABLE public.sms_observer_devices ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.sms_observer_devices FROM anon, authenticated;');
  });
  const row=await db.one("SELECT relrowsecurity FROM pg_class WHERE oid='public.sms_payment_observations'::regclass");
  if(!row.relrowsecurity)throw Error('RLS verification failed.');
  console.log('SMS evidence table ready on the verified project; RLS enabled. Existing payment records were not changed.');
} catch(error) {console.error('SMS schema setup failed: '+(error.code || error.name));process.exitCode=1;}
finally {await db.close();}
