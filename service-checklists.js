import {randomUUID} from 'node:crypto';
export const CHECKLIST_KEY='_intakeChecklist';
const key=id=>'SERVICE_CHECKLIST_'+id;
const parse=value=>{try{return JSON.parse(value || 'null');}catch{return null;}};
export function caseChecklist(c,variant) {
  const saved=parse(c.details_json)?.[CHECKLIST_KEY];
  return Array.isArray(saved?.documents) ? saved.documents : parse(variant?.documents_json) || [];
}
export async function checklistOverrides(db) {
  return new Map((await db.all("SELECT name,value FROM integration_settings WHERE name LIKE 'SERVICE_CHECKLIST_%'")).map(row=>[row.name.slice('SERVICE_CHECKLIST_'.length),parse(row.value)]));
}
export function withChecklist(variant,overrides) {
  const saved=overrides.get(variant.id);
  return {...variant,...(saved ? {documents_json:JSON.stringify(saved.documents)} : {}),checklist_revision:saved?.revision || 0};
}
export function editedDocuments(input,current) {
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  if(!Array.isArray(input) || input.length>80) fail('A checklist can contain up to 80 documents.');
  const seen=new Set();
  return input.map((item,index)=>{
    if(!item || typeof item!=='object') fail('Enter a valid document.');
    const label=typeof item.label==='string'?item.label.trim():'';
    if(!label || label.length>140 || /[<>\u0000-\u001f]/u.test(label) || label==='Received Document') fail('Use a document name between 1 and 140 characters.');
    if(seen.has(label.toLowerCase())) fail('Document names must be unique.');seen.add(label.toLowerCase());
    if(typeof item.required!=='boolean' || typeof item.multiple!=='boolean' || typeof item.note!=='string' || item.note.length>2000) fail('Enter valid document options and notes (up to 2000 characters).');
    const previous=item.originalLabel ? current.find(d=>d.label===item.originalLabel) : null;
    if(item.originalLabel && !previous) fail('This checklist has changed. Reload it and try again.');
    const result={...(previous || {}),label,required:item.required,multiple:item.multiple,note:item.note.trim(),checklistOrder:index};
    if(previous && previous.label!==label) {delete result.displayLabel;delete result.marathiLabel;}
    return result;
  });
}
export function createChecklistAdmin({db,send,body}) {
  return {handle:async(req,res,url,user)=>{
    const match=url.pathname.match(/^\/api\/admin\/services(?:\/([^/]+)\/checklist)?$/);
    if(!match) return false;
    if(user.role!=='admin') {send(res,403,{error:'Admin access required.'});return true;}
    if(req.method==='GET' && !match[1]) {
      const [services,variants,overrides]=await Promise.all([db.all('SELECT * FROM services WHERE active=1 ORDER BY name'),db.all('SELECT * FROM variants WHERE active=1 ORDER BY name'),checklistOverrides(db)]);
      send(res,200,{services:services.map(s=>({...s,variants:variants.filter(v=>v.service_id===s.id).map(v=>{const current=withChecklist(v,overrides);return {id:v.id,name:v.name,documents:parse(current.documents_json) || [],revision:current.checklist_revision};})}))});return true;
    }
    if(req.method!=='PUT' || !match[1]) {send(res,405,{error:'Method not allowed.'});return true;}
    const b=await body(req),variant=await db.one('SELECT * FROM variants WHERE id=$id AND active=1',{$id:match[1]});
    if(!variant) {send(res,404,{error:'Service request type not found.'});return true;}
    if(db.cloud) await db.one('SELECT pg_advisory_xact_lock(73194206)');
    const overrides=await checklistOverrides(db),current=withChecklist(variant,overrides);
    if(!Number.isInteger(b.revision) || b.revision!==current.checklist_revision) {send(res,409,{error:'Someone updated this checklist. Reload it before saving.'});return true;}
    const targets=b.allVariants===true ? await db.all('SELECT * FROM variants WHERE service_id=$service AND active=1',{$service:variant.service_id}) : [variant];
    const changes=targets.map(v=>{
      const selected=withChecklist(v,overrides);
      if(v.id!==variant.id && b.revisions?.[v.id]!==selected.checklist_revision) throw Object.assign(new Error('Another request type was updated. Reload before saving all checklists.'),{status:409});
      return {variant:v,documents:editedDocuments(b.documents,parse(selected.documents_json) || []),revision:selected.checklist_revision+1};
    });
    for(const change of changes) {
      const value={documents:change.documents,revision:change.revision,updatedBy:user.id,updatedAt:new Date().toISOString()};
      await db.run('INSERT INTO integration_settings(name,value) VALUES ($name,$value) ON CONFLICT(name) DO UPDATE SET value=excluded.value',{$name:key(change.variant.id),$value:JSON.stringify(value)});
    }
    await db.run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:'aud_'+randomUUID(),$actor:user.id,$action:'service.checklist_update',$type:'service',$entity:variant.service_id,$reason:`Updated ${changes.length} checklist(s); ${b.documents.length} document requirements; existing cases preserved.`,$at:new Date().toISOString()});
    send(res,200,{ok:true,updated:changes.map(c=>({id:c.variant.id,revision:c.revision}))});return true;
  }};
}
