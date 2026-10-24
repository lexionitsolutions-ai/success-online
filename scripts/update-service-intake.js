// Apply requested intake presentation and field changes without changing prices or payments.
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import assert from 'node:assert/strict';
import {createDatabase} from '../database.js';
import {serviceCatalog} from '../service-catalog.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
const requestedSlugs=process.argv.slice(2);
const catalog=requestedSlugs.length ? serviceCatalog.filter(service=>requestedSlugs.includes(service.slug)) : serviceCatalog;
assert.equal(new Set(catalog.map(service=>service.slug)).size,new Set(requestedSlugs.length ? requestedSlugs : serviceCatalog.map(service=>service.slug)).size,'Unknown service slug');
try {
  await db.transaction(async()=>{
    let updated=0;
    for(const service of catalog) {
      const row=await db.one('SELECT id FROM services WHERE slug=$slug AND active=1',{$slug:service.slug});
      assert.ok(row,`Active service missing: ${service.slug}`);
      const variants=await db.all('SELECT id,fields_json FROM variants WHERE service_id=$service AND name=$name AND active=1',{$service:row.id,$name:service.variant || 'Application'});
      assert.ok(variants.length,`Active application variant missing: ${service.slug}`);
      await db.run('UPDATE services SET name=$name,description=$description WHERE id=$id',{$id:row.id,$name:service.name,$description:service.description});
      for(const variant of variants) {
        const fields=['income-certificate','domicile-certificate','caste-certificate'].includes(service.slug) ? service.fields : JSON.parse(variant.fields_json || '[]');
        await db.run('UPDATE variants SET fields_json=$fields,documents_json=$documents,instructions=$instructions WHERE id=$id',{$id:variant.id,$fields:JSON.stringify(fields),$documents:JSON.stringify(service.documents),$instructions:service.instructions || ''});
        const saved=await db.one('SELECT fields_json,documents_json,instructions FROM variants WHERE id=$id',{$id:variant.id});
        assert.deepEqual(JSON.parse(saved.fields_json),fields);
        assert.deepEqual(JSON.parse(saved.documents_json),service.documents);
        assert.equal(saved.instructions,service.instructions || '');
        updated++;
      }
      assert.equal((await db.one('SELECT name FROM services WHERE id=$id',{$id:row.id})).name,service.name);
    }
    console.log(`Updated and verified ${updated} service forms: names, fields, Marathi checklists and notes. Prices and payment history preserved.`);
  });
} finally {await db.close();}
