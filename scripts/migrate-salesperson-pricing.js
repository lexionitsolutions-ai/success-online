import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createDatabase} from '../database.js';
import {salespersonPricingSchema} from '../payments.js';

if (existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
try {
  await db.transaction(async()=>{
    await db.exec(salespersonPricingSchema);
    if(db.cloud) await db.exec('ALTER TABLE public.salesperson_prices ENABLE ROW LEVEL SECURITY; REVOKE ALL ON TABLE public.salesperson_prices FROM anon, authenticated;');
  });
  console.log('Salesperson pricing table is ready. Existing records were preserved.');
} catch(error) {
  console.error('Pricing migration failed:',error.code || error.name);
  process.exitCode=1;
} finally {await db.close();}
