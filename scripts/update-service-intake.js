// Apply intake changes; --set-caste-price explicitly applies the requested Rs 400 fee.
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import assert from 'node:assert/strict';
import {createDatabase} from '../database.js';
import {serviceCatalog} from '../service-catalog.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
const setCastePrice=process.argv.includes('--set-caste-price');
const setPolicePrice=process.argv.includes('--set-police-price');
const requestedSlugs=process.argv.slice(2).filter(value=>!['--set-caste-price','--set-police-price'].includes(value));
assert.ok(!setPolicePrice || requestedSlugs.includes('police-clearance'),'Select police-clearance when setting its price');
assert.ok(!setCastePrice || requestedSlugs.includes('caste-certificate'),'Select caste-certificate when setting its price');
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
        const fields=['income-certificate','domicile-certificate','caste-certificate','gazette','police-clearance','shop-act','udyam-aadhaar','caste-validity','ews-certificate'].includes(service.slug) ? service.fields : JSON.parse(variant.fields_json || '[]');
        await db.run('UPDATE variants SET fields_json=$fields,documents_json=$documents,instructions=$instructions WHERE id=$id',{$id:variant.id,$fields:JSON.stringify(fields),$documents:JSON.stringify(service.documents),$instructions:service.instructions || ''});
        const saved=await db.one('SELECT fields_json,documents_json,instructions FROM variants WHERE id=$id',{$id:variant.id});
        assert.deepEqual(JSON.parse(saved.fields_json),fields);
        assert.deepEqual(JSON.parse(saved.documents_json),service.documents);
        assert.equal(saved.instructions,service.instructions || '');
        if((setCastePrice && service.slug==='caste-certificate') || (setPolicePrice && service.slug==='police-clearance')) {
          const price=service.serviceCharge;
          assert.equal(price,service.slug==='police-clearance' ? 30000 : 40000);
          const config=JSON.stringify({serviceCharge:price,officialFee:0,taxRate:0,testPricingExempt:true});
          await db.run('UPDATE variants SET service_charge=$price,official_fee=0,tax_rate=0 WHERE id=$id',{$id:variant.id,$price:price});
          await db.run('INSERT INTO service_prices(variant_id,price,original_price,original_config,updated_at) VALUES ($id,$price,$price,$config,$at) ON CONFLICT(variant_id) DO UPDATE SET price=$price,original_price=$price,original_config=$config,updated_at=$at',{$id:variant.id,$price:price,$config:config,$at:new Date().toISOString()});
          const savedPrice=await db.one('SELECT price,original_config FROM service_prices WHERE variant_id=$id',{$id:variant.id});
          assert.equal(savedPrice.price,price);
          assert.equal(JSON.parse(savedPrice.original_config).testPricingExempt,true);
        }
        updated++;
      }
      assert.equal((await db.one('SELECT name FROM services WHERE id=$id',{$id:row.id})).name,service.name);
    }
    console.log(`Updated and verified ${updated} service forms.${setCastePrice?' Caste Certificate fee set to Rs 400.':''}${setPolicePrice?' Police Clearance Certificate fee set to Rs 300.':''}${!setCastePrice && !setPolicePrice?' Prices preserved.':' Requested fees exempt from test pricing.'} Payment history preserved.`);
  });
} finally {await db.close();}
