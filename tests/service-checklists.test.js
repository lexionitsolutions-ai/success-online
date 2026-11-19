import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {testPort} from './test-port.js';
import {editedDocuments} from '../service-checklists.js';
import {confirmTestReceiver,verifyTestOrder} from './payment-fixture.js';

test('checklist edits retain conditional rules and reject duplicate names or arbitrary metadata',()=>{
  const current=[{label:'Proof',required:true,when:{field:'Reason',equals:'Yes'},templateUrl:'/downloads/proof.pdf',section:'Evidence'}];
  const edited=editedDocuments([{originalLabel:'Proof',label:'Proof',note:'Updated',required:false,multiple:true,when:null,templateUrl:'https://unsafe.example'}],current)[0];
  assert.deepEqual(edited.when,current[0].when);assert.equal(edited.templateUrl,current[0].templateUrl);
  for(const documents of [[{label:'',note:'',required:true,multiple:false}],[{label:'Received Document',note:'',required:true,multiple:false}],[{label:'Proof',note:'',required:true,multiple:false},{label:'proof',note:'',required:true,multiple:false}]]) assert.throws(()=>editedDocuments(documents,current),e=>e.status===400);
});

test('admin checklists persist, new cases retain versions, and document storage respects roles',{timeout:40000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'checklist-admin-')),port=await testPort(),origin=`http://localhost:${port}`,path=join(root,'db.sqlite');
  let child;
  async function start() {
    child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',DATABASE_PATH:path,STORAGE_PATH:join(root,'files'),PORT:String(port),APP_ORIGIN:origin,SHEETS_MODE:'demo',SESSION_SECRET:'isolated-checklist-test-secret-not-production'},stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',d=>errors+=d);
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
  }
  const request=async(route,{cookie,body,method=body?'POST':'GET'}={})=>{const response=await fetch(origin+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,response,data:await response.json().catch(()=>({}))};};
  const login=async username=>(await request('/api/login',{body:{username,password:'Demo@12345'}})).response.headers.get('set-cookie').split(';')[0];
  try {
    await start();const admin=await login('admin01'),sales=await login('sales01'),other=await login('sales02'),office=await login('backoffice01');
    for(const cookie of [sales,other,office]) assert.equal((await request('/api/admin/services',{cookie})).status,403);
    const catalogue=(await request('/api/admin/services',{cookie:admin})).data.services;assert.equal(catalogue.length,16);
    const variant=catalogue.find(s=>s.slug==='pan').variants[0],route=`/api/admin/services/${variant.id}/checklist`;
    const payload={variantId:variant.id,details:{},customer:{name:'Checklist Client',mobile:'9876543210'},consent:true};
    const original=(await request('/api/cases',{cookie:sales,body:payload})).data.case;
    const documents=[{label:'Additional Evidence',note:'Please upload a clear copy.',required:true,multiple:true}];
    for(const cookie of [sales,office]) assert.equal((await request(route,{cookie,method:'PUT',body:{revision:0,documents}})).status,403);
    assert.equal((await request(route,{cookie:admin,method:'PUT',body:{revision:0,documents:[...documents,...documents]}})).status,400);
    assert.equal((await request(route,{cookie:admin,method:'PUT',body:{revision:0,documents}})).status,200);
    assert.equal((await request(route,{cookie:admin,method:'PUT',body:{revision:0,documents}})).status,409);
    const services=(await request('/api/services',{cookie:sales})).data.services;
    assert.deepEqual(services.find(s=>s.slug==='pan').variants[0].documents.map(d=>d.label),['Additional Evidence']);
    const fresh=(await request('/api/cases',{cookie:sales,body:payload})).data.case;
    assert.deepEqual(fresh.variant.documents.map(d=>d.label),['Additional Evidence']);assert.equal(fresh.details._intakeChecklist,undefined);
    assert.deepEqual((await request('/api/cases/'+original.id,{cookie:sales})).data.case.variant.documents,variant.documents);
    const pdf=Buffer.from('%PDF-1.4\nchecklist fixture\n%%EOF');
    const upload=(c,docType)=>request(`/api/cases/${c.id}/documents`,{cookie:sales,body:{docType,fileName:'evidence.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});
    assert.equal((await upload(original,'Additional Evidence')).status,400);
    assert.equal((await upload(fresh,variant.documents[0].label)).status,400);
    const uploaded=await upload(fresh,'Additional Evidence');assert.equal(uploaded.status,201,JSON.stringify(uploaded.data));
    assert.equal((await request('/api/cases/'+fresh.id,{cookie:sales})).data.case.document_state,'complete');
    const library=(await request('/api/workspace/documents',{cookie:sales}));assert.equal(library.status,200,JSON.stringify(library.data));
    assert.equal(Number(library.data.summary.bytes),pdf.length);assert.equal(library.data.documents[0].storage_path,undefined);
    assert.equal((await request('/api/workspace/documents',{cookie:other})).data.documents.length,0);
    assert.equal((await request('/api/workspace/documents',{cookie:office})).data.documents.length,0);
    assert.equal((await request('/api/workspace/documents?kind=bad',{cookie:sales})).status,400);
    await confirmTestReceiver(request,admin);await verifyTestOrder(request,admin,sales,fresh.payment.id,'381234567891');
    assert.ok((await request('/api/workspace/documents',{cookie:admin})).data.documents.some(d=>d.case_id===fresh.id));
    assert.ok((await request('/api/workspace/documents',{cookie:office})).data.documents.some(d=>d.case_id===fresh.id));
    assert.equal((await request('/api/workspace/documents?q=notfound',{cookie:sales})).data.total,0);
    assert.equal((await request('/api/workspace/documents?kind=image',{cookie:sales})).data.total,0);
    assert.equal((await request('/api/workspace/documents?kind=pdf',{cookie:sales})).data.total,1);
    const gazette=catalogue.find(s=>s.slug==='gazette'),g=gazette.variants[0];
    assert.equal((await request(`/api/admin/services/${g.id}/checklist`,{cookie:admin,method:'PUT',body:{revision:g.revision,allVariants:true,revisions:Object.fromEntries(gazette.variants.map(v=>[v.id,v.revision])),documents}})).status,200);
    assert.ok((await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='gazette').variants.every(v=>v.documents[0].label==='Additional Evidence'));
    const exit=new Promise(resolve=>child.once('exit',resolve));child.kill();await exit;await start();
    const restored=(await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='pan').variants[0];assert.equal(restored.documents[0].label,'Additional Evidence');
    assert.deepEqual((await request('/api/cases/'+original.id,{cookie:sales})).data.case.variant.documents,variant.documents);
    assert.equal((await request(route,{cookie:admin,method:'PUT',body:{revision:1,documents:[]}})).status,200);
    assert.equal((await request('/api/cases/'+fresh.id,{cookie:sales})).data.case.variant.documents[0].label,'Additional Evidence');
    const future=(await request('/api/cases',{cookie:sales,body:payload})).data.case;assert.equal(future.variant.documents.length,0);
    const reordered=[{label:'Second Document',note:'Second moved up',required:true,multiple:false},{label:'First Document',note:'First moved down',required:true,multiple:true}];
    assert.equal((await request(route,{cookie:admin,method:'PUT',body:{revision:2,documents:reordered}})).status,200);
    const ordered=(await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='pan').variants[0].documents;
    assert.deepEqual(ordered.map(d=>d.label),['Second Document','First Document']);assert.deepEqual(ordered.map(d=>d.checklistOrder),[0,1]);
    const orderedCase=(await request('/api/cases',{cookie:sales,body:payload})).data.case;assert.deepEqual(orderedCase.variant.documents.map(d=>d.label),['Second Document','First Document']);
  } finally {child?.kill();}
});
