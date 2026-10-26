import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createDatabase } from '../database.js';
import { syncServiceForms } from '../service-catalog-sync.js';

if (existsSync('.env')) loadEnvFile('.env');
const db = createDatabase();
try {
  console.log(`Updated ${await syncServiceForms(db)} service form(s).`);
} finally {
  await db.close();
}
