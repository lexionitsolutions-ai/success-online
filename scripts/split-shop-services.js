// Split the combined service without changing existing case IDs, uploads or payment history.
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createDatabase} from '../database.js';
import {serviceCatalog} from '../service-catalog.js';

export async function splitShopServices(db) {
  await db.transaction(async () => {
    const legacy = await db.one("SELECT * FROM services WHERE slug='shop-act-udyam'");
    const current = await db.one("SELECT * FROM services WHERE slug='shop-act'");
    assert.ok(!legacy || !current || !legacy.active, 'Both combined and separate Shop Act services are active; review before migrating.');
    if (legacy && !current) await db.run("UPDATE services SET slug='shop-act',name='Shop Act' WHERE id=$id", {$id:legacy.id});
    const shop = await db.one("SELECT * FROM services WHERE slug='shop-act'");
    assert.ok(shop, 'Shop Act service is missing; seed the catalog first.');
    const source = await db.one("SELECT * FROM variants WHERE service_id=$id AND name='Application' AND active=1", {$id:shop.id});
    assert.ok(source, 'Shop Act application variant is missing.');
    const sourcePrice = await db.one('SELECT * FROM service_prices WHERE variant_id=$id', {$id:source.id});
    for (const slug of ['shop-act','udyam-aadhaar']) {
      const catalog = serviceCatalog.find(service=>service.slug===slug);
      let service = await db.one('SELECT * FROM services WHERE slug=$slug', {$slug:slug});
      if (!service) {
        service = {id:`svc_${randomUUID()}`};
        await db.run('INSERT INTO services (id,name,slug,active,description,official_url,processing_period,admin_review_required) VALUES ($id,$name,$slug,1,$description,\'\',\'Confirm at intake\',1)', {$id:service.id,$name:catalog.name,$slug:slug,$description:catalog.description});
      }
      await db.run('UPDATE services SET name=$name,description=$description,active=1 WHERE id=$id', {$id:service.id,$name:catalog.name,$description:catalog.description});
      let variant = await db.one("SELECT * FROM variants WHERE service_id=$id AND name='Application'", {$id:service.id});
      if (!variant) {
        variant = {id:`var_${randomUUID()}`};
        await db.run("INSERT INTO variants (id,service_id,name,service_charge,official_fee,tax_rate,fields_json,documents_json,instructions,checklist_version,active) VALUES ($id,$service,'Application',$charge,$fee,$tax,'[]','[]','',1,1)", {$id:variant.id,$service:service.id,$charge:source.service_charge,$fee:source.official_fee,$tax:source.tax_rate});
        const config = sourcePrice?.original_config || JSON.stringify({serviceCharge:source.service_charge,officialFee:source.official_fee,taxRate:source.tax_rate});
        await db.run('INSERT INTO service_prices (variant_id,price,original_price,original_config) VALUES ($id,$price,$original,$config)', {$id:variant.id,$price:sourcePrice?.price ?? source.service_charge,$original:sourcePrice?.original_price ?? source.service_charge,$config:config});
      }
      await db.run('UPDATE variants SET fields_json=$fields,documents_json=$documents,instructions=$instructions,active=1 WHERE id=$id', {$id:variant.id,$fields:JSON.stringify(catalog.fields),$documents:JSON.stringify(catalog.documents),$instructions:catalog.instructions});
      const saved = await db.one('SELECT * FROM variants WHERE id=$id', {$id:variant.id});
      assert.deepEqual(JSON.parse(saved.fields_json),catalog.fields);
      assert.deepEqual(JSON.parse(saved.documents_json),catalog.documents);
      assert.equal((await db.one('SELECT name FROM services WHERE id=$id',{$id:service.id})).name,catalog.name);
    }
    assert.equal((await db.one('SELECT service_id FROM variants WHERE id=$id',{$id:source.id})).service_id,shop.id);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (existsSync('.env')) loadEnvFile('.env');
  const db = createDatabase();
  try {
    await splitShopServices(db);
    console.log('Verified separate Shop Act and Udyam Aadhaar services, Shop Act fields and documents. Existing Shop Act links and prices preserved; Udyam starts with the former combined service price.');
  } finally {await db.close();}
}
