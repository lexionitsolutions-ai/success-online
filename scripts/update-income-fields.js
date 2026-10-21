import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
import { createDatabase } from '../database.js';
import { serviceCatalog } from '../service-catalog.js';

if (existsSync('.env')) loadEnvFile('.env');
const db = createDatabase();
const income = serviceCatalog.find(service => service.slug === 'income-certificate');
try {
  await db.transaction(async () => {
    const variants = await db.all("SELECT v.id FROM variants v JOIN services s ON s.id=v.service_id WHERE s.slug='income-certificate' AND v.active=1");
    if (!variants.length) throw new Error('No active Income Certificate service found.');
    for (const variant of variants) {
      await db.run('UPDATE variants SET fields_json=$fields WHERE id=$id', { $fields: JSON.stringify(income.fields), $id: variant.id });
      const saved = await db.one('SELECT fields_json FROM variants WHERE id=$id', { $id: variant.id });
      assert.deepEqual(JSON.parse(saved.fields_json), income.fields);
    }
    console.log(`Updated and verified Income Certificate fields for ${variants.length} active variant(s).`);
    console.log('1 year:', income.fields.find(field => field.displayLabel)?.displayLabel);
    console.log('3 years:', income.fields.filter(field => field.when?.equals === '3 years').map(field => field.label).join(', '));
  });
} finally {
  await db.close();
}
