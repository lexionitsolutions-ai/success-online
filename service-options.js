import {randomUUID} from 'node:crypto';
import {serviceCatalog} from './service-catalog.js';

export function serviceOptions(service) {
  if(service.slug==='food-license') return Array.from({length:5},(_,i)=>({name:`${i+1} year${i?'s':''}`,field:'Licence duration',value:`${i+1} year${i?'s':''}`}));
  if(service.slug==='caste-validity') return ['Job','Education','Election'].map(value=>({name:value,field:'Caste Validity Certificate required for',value}));
  return [];
}
export function optionFields(service, option) {
  return service.fields.map(field=>field.label===option.field ? {...field,options:[option.value],required:true} : field);
}
// Keep legacy variants and case references intact; new intakes use explicit options.
export async function syncServiceOptions(db) {
  for(const service of serviceCatalog) {
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
