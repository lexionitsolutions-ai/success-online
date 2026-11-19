import {randomUUID} from 'node:crypto';
import {serviceCatalog} from './service-catalog.js';

export function serviceOptions(service) {
  if(service.slug==='gazette') return [{name:'Without affidavit charges',field:'Do you have any evidence of the new name?',value:'Yes'},{name:'With affidavit charges',field:'Do you have any evidence of the new name?',value:'No'}];
  if(service.slug==='food-license') return Array.from({length:5},(_,i)=>({name:`${i+1} year${i?'s':''}`,field:'Licence duration',value:`${i+1} year${i?'s':''}`}));
  if(service.slug==='caste-validity') return ['Job','Education','Election'].map(value=>({name:value,field:'Caste Validity Certificate required for',value}));
  return [];
}
export function optionFields(service, option) {
  if(service.slug==='gazette') return service.fields;
  return service.fields.map(field=>field.label===option.field ? {...field,options:[option.value],required:true} : field);
}
// Keep legacy variants and case references intact; new intakes use explicit options.
export async function syncServiceOptions(db, {slugs} = {}) {
  for(const service of serviceCatalog) {
    if(slugs && !slugs.includes(service.slug)) continue;
    const options=serviceOptions(service);
    if(!options.length) continue;
    const row=await db.one('SELECT id FROM services WHERE slug=$slug',{$slug:service.slug});
    if(!row) continue;
    const legacy=await db.one("SELECT id FROM variants WHERE service_id=$id AND name='Application'",{$id:row.id});
    if(legacy) await db.run('UPDATE variants SET active=0 WHERE id=$id',{$id:legacy.id});
    for(const option of options) {
      const existing=await db.one('SELECT id FROM variants WHERE service_id=$id AND name=$name',{$id:row.id,$name:option.name});
      const values={$id:existing?.id || 'var_'+randomUUID(),$service:row.id,$name:option.name,$fields:JSON.stringify(optionFields(service,option)),$docs:JSON.stringify(service.documents),$instructions:service.instructions || ''};
      if(existing) await db.run('UPDATE variants SET fields_json=$fields,documents_json=$docs,instructions=$instructions,active=1 WHERE id=$id',{$id:values.$id,$fields:values.$fields,$docs:values.$docs,$instructions:values.$instructions});
      else await db.run('INSERT INTO variants VALUES ($id,$service,$name,0,0,0,$fields,$docs,$instructions,1,1)',values);
    }
  }
}

// Existing cloud installations also need the Gazette options on deployment.
// Lock and recheck so concurrent serverless cold starts cannot create duplicates.
export async function ensureGazettePricingOptions(db) {
  const service=await db.one("SELECT id FROM services WHERE slug='gazette'");
  if(!service) return false;
  const ready=async()=>{
    const rows=await db.all('SELECT name FROM variants WHERE service_id=$id AND active=1',{$id:service.id});
    return rows.some(v=>v.name==='With affidavit charges') && rows.some(v=>v.name==='Without affidavit charges') && !rows.some(v=>v.name==='Application');
  };
  if(await ready()) return false;
  return db.transaction(async()=>{
    if(db.cloud) await db.one('SELECT pg_advisory_xact_lock(73194205)');
    if(await ready()) return false;
    const legacy=await db.one("SELECT * FROM variants WHERE service_id=$id AND name='Application'",{$id:service.id});
    const original=legacy && await db.one('SELECT * FROM service_prices WHERE variant_id=$id',{$id:legacy.id});
    const existing=await db.all('SELECT id FROM variants WHERE service_id=$id',{$id:service.id});
    await syncServiceOptions(db,{slugs:['gazette']});
    const rows=await db.all('SELECT * FROM variants WHERE service_id=$id AND active=1',{$id:service.id});
    for(const row of rows.filter(v=>['With affidavit charges','Without affidavit charges'].includes(v.name))) {
      const fresh=!existing.some(v=>v.id===row.id);
      if(fresh && legacy) {
        await db.run('UPDATE variants SET service_charge=$price,official_fee=$fee,tax_rate=$tax WHERE id=$id',{$id:row.id,$price:legacy.service_charge,$fee:legacy.official_fee,$tax:legacy.tax_rate});
        await db.run('INSERT INTO salesperson_prices(sales_user_id,variant_id,price,updated_by,updated_at) SELECT sales_user_id,$variant,price,updated_by,updated_at FROM salesperson_prices WHERE variant_id=$legacy ON CONFLICT(sales_user_id,variant_id) DO NOTHING',{$variant:row.id,$legacy:legacy.id});
      }
      const base=fresh && legacy ? legacy : row;
      await db.run('INSERT INTO service_prices(variant_id,price,original_price,original_config) VALUES ($id,$price,$original,$config) ON CONFLICT(variant_id) DO NOTHING',{$id:row.id,$price:original?.price ?? base.service_charge,$original:original?.original_price ?? base.service_charge,$config:original?.original_config || JSON.stringify({serviceCharge:base.service_charge,officialFee:base.official_fee,taxRate:base.tax_rate})});
    }
    return true;
  });
}
