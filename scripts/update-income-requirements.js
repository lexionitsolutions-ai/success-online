// Apply the income checklist update without changing configured prices or past payments.
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import assert from 'node:assert/strict';
import {createDatabase} from '../database.js';
import {serviceCatalog} from '../service-catalog.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
const income=serviceCatalog.find(s=>s.slug==='income-certificate');
try {
  await db.transaction(async()=>{
    const variants=await db.all("SELECT v.id FROM variants v JOIN services s ON s.id=v.service_id WHERE s.slug='income-certificate' AND v.active=1");
    assert.ok(variants.length,'No active income certificate variant found');
    for(const variant of variants) {
      await db.run('UPDATE variants SET fields_json=$fields,documents_json=$documents,instructions=$instructions WHERE id=$id',{$id:variant.id,$fields:JSON.stringify(income.fields),$documents:JSON.stringify(income.documents),$instructions:income.instructions});
      const saved=await db.one('SELECT fields_json,documents_json FROM variants WHERE id=$id',{$id:variant.id});
      assert.deepEqual(JSON.parse(saved.fields_json),income.fields);
      assert.deepEqual(JSON.parse(saved.documents_json),income.documents);
    }
    console.log(`Updated and verified income certificate requirements for ${variants.length} active variant(s). Configured prices and payment history preserved.`);
  });
} finally {await db.close();}
