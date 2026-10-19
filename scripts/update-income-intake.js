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
      await db.run('UPDATE variants SET service_charge=20000,official_fee=0,tax_rate=0,fields_json=$fields,documents_json=$documents,instructions=$instructions WHERE id=$id', {
        $fields: JSON.stringify(income.fields), $documents: JSON.stringify(income.documents), $instructions: income.instructions, $id: variant.id
      });
      const pricing = JSON.stringify({serviceCharge:20000,officialFee:0,taxRate:0,testPricingExempt:true});
      await db.run('INSERT INTO service_prices(variant_id,price,original_price,original_config,updated_at) VALUES ($id,20000,20000,$config,$at) ON CONFLICT(variant_id) DO UPDATE SET price=20000,original_price=20000,original_config=$config,updated_at=$at', {$id:variant.id,$config:pricing,$at:new Date().toISOString()});
      const saved = await db.one('SELECT fields_json,documents_json FROM variants WHERE id=$id', { $id: variant.id });
      const fields = JSON.parse(saved.fields_json);
      assert.deepEqual(fields, income.fields);
      assert.deepEqual(JSON.parse(saved.documents_json), income.documents);
      const price = await db.one('SELECT price,original_config FROM service_prices WHERE variant_id=$id', {$id:variant.id});
      assert.equal(price.price,20000);
      assert.equal(JSON.parse(price.original_config).testPricingExempt,true);
      console.log('Verified Income Certificate service charge: INR 200; multiple Talathi Report pages enabled.');
      console.log('Verified ration card colours:', fields.find(field => field.label === 'Ration card colour').options.join(', '));
      console.log('Verified ration card areas:', fields.find(field => field.label === 'Ration card area').options.join(', '));
    }
  });
  console.log('Income Certificate intake options updated. Refresh the app to load them.');
} finally {
  await db.close();
}
