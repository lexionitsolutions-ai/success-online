import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
import { createDatabase } from '../database.js';
import { serviceCatalog } from '../service-catalog.js';

if (existsSync('.env')) loadEnvFile('.env');
const db = createDatabase();
const service = serviceCatalog.find(item => item.slug === 'domicile-certificate');
try {
  await db.transaction(async () => {
    const variants = await db.all("SELECT v.id FROM variants v JOIN services s ON s.id=v.service_id WHERE s.slug='domicile-certificate' AND v.active=1");
    if (!variants.length) throw new Error('No active domicile service found.');
    for (const variant of variants) {
      await db.run('UPDATE variants SET fields_json=$fields,documents_json=$documents,service_charge=20000,official_fee=0,tax_rate=0 WHERE id=$id', {$fields:JSON.stringify(service.fields),$documents:JSON.stringify(service.documents),$id:variant.id});
      const config = JSON.stringify({serviceCharge:20000,officialFee:0,taxRate:0,testPricingExempt:true});
      await db.run('INSERT INTO service_prices(variant_id,price,original_price,original_config,updated_at) VALUES ($id,20000,20000,$config,$at) ON CONFLICT(variant_id) DO UPDATE SET price=20000,original_price=20000,original_config=$config,updated_at=$at',{$id:variant.id,$config:config,$at:new Date().toISOString()});
      const saved = await db.one('SELECT fields_json,documents_json,service_charge FROM variants WHERE id=$id', {$id:variant.id});
      assert.deepEqual(JSON.parse(saved.fields_json),service.fields);
      assert.deepEqual(JSON.parse(saved.documents_json),service.documents);
      assert.equal(saved.service_charge,20000);
      assert.equal((await db.one('SELECT price FROM service_prices WHERE variant_id=$id',{$id:variant.id})).price,20000);
    }
  });
  console.log('Verified domicile documents: Father Aadhaar second, beneficiary notes added. Service charge INR 200.');
} finally {
  await db.close();
}
