// Additive migration only: preserves users, prices, cases, and payment history.
import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {createDatabase} from '../database.js';
import {cashSchema} from '../cash-payments.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
try {
  await db.transaction(async()=>{
    await db.exec(cashSchema);
    if(db.cloud) await db.exec('ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.cash_accounts FROM anon, authenticated;');
  });
  console.log('Cash payment account schema is ready. Existing records were preserved.');
} finally {await db.close();}
