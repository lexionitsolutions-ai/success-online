import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pfDetails} from './pf-fixture.js';
import {paymentBlocksDeletion} from '../case-deletion.js';
import {testPort} from './test-port.js';

test('payment history protects paid, partial cash, refunded and submitted cases from deletion',()=>{
  for(const status of ['PAID','paid','verified','offline_approved','REFUNDED','AWAITING_VERIFICATION']) assert.equal(paymentBlocksDeletion({payment_state:'unpaid'},[{status}]),true,status);
  assert.equal(paymentBlocksDeletion({payment_state:'partially_paid'},[]),true);
  assert.equal(paymentBlocksDeletion({payment_state:'unpaid'},[{status:'FAILED',verified_at:'2026-11-03T00:00:00Z'}]),true);
  for(const status of ['PENDING','INITIATED','EXPIRED','CANCELLED','FAILED']) assert.equal(paymentBlocksDeletion({payment_state:'unpaid'},[{status}]),false,status);
});

test('sales can delete only their own unpaid cases; checkouts and uploads cannot reopen deleted cases',{timeout:30000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'case-delete-')),path=join(root,'db.sqlite'),port=await testPort(),origin=`http://localhost:${port}`;
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',DATABASE_PATH:path,STORAGE_PATH:join(root,'files'),PORT:String(port),APP_ORIGIN:origin,SHEETS_MODE:'demo',SESSION_SECRET:'isolated-delete-test-secret-not-production'},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',d=>errors+=d);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
    const request=async(route,{cookie,body,method=body?'POST':'GET'}={})=>{const response=await fetch(origin+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,response,data:await response.json()};};
    const login=async username=>(await request('/api/login',{body:{username,password:'Demo@12345'}})).response.headers.get('set-cookie').split(';')[0];
    const sales=await login('sales01'),other=await login('sales02'),admin=await login('admin01'),office=await login('backoffice01');
    const variant=(await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='pan').variants[0];
    const payload={variantId:variant.id,details:pfDetails,customer:{name:'Deletion Trial',mobile:'9876543210'},consent:true};
    const create=async extra=>(await request('/api/cases',{cookie:sales,body:{...payload,...extra}})).data.case;
    const clientRequestId=randomUUID(),c=await create({clientRequestId}),base='/api/cases/'+c.id;
    assert.equal(c.deletionAllowed,true);
    for(const cookie of [other,admin,office]) assert.equal((await request(base,{cookie,method:'DELETE'})).status,403);
    assert.equal((await request(base,{method:'DELETE'})).status,401);
    const pdf=Buffer.from('%PDF-1.4\ndelete fixture\n%%EOF');
    const uploaded=await request(base+'/documents',{cookie:sales,body:{docType:variant.documents[0].label,fileName:'test.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});
    assert.equal(uploaded.status,201);
    assert.equal((await request(base,{cookie:sales,method:'DELETE'})).status,200);
    assert.equal((await request(base,{cookie:sales})).status,404);
    assert.equal((await request('/api/cases/'+c.ref,{cookie:sales})).status,404);
    assert.equal((await request(base+'/finish-uploads',{cookie:sales,body:{}})).status,404);
    assert.equal((await request(base+'/payment-order',{cookie:sales,body:{}})).status,404);
    assert.equal((await request('/api/payments/'+c.payment.id,{cookie:sales})).status,404);
    assert.equal((await request('/api/payments/'+c.payment.id+'/submit',{cookie:sales,body:{utr:'111111111111'}})).status,404);
    assert.equal((await request(`/api/documents/${uploaded.data.documentId}/preview`,{cookie:sales})).status,404);
    assert.ok(!(await request('/api/cases',{cookie:sales})).data.cases.some(row=>row.id===c.id));
    assert.ok(!(await request('/api/payments',{cookie:sales})).data.payments.some(row=>row.case_id===c.id));
    assert.equal((await request('/api/cases',{cookie:sales,body:{...payload,clientRequestId}})).status,410);
    const verify=new DatabaseSync(path);
    assert.equal(verify.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='case.delete_unpaid' AND entity_id=?").get(c.id).n,1);
    assert.equal(verify.prepare('SELECT status FROM payments WHERE id=?').get(c.payment.id).status,'CANCELLED');
    verify.close();
    // Payment history, even with an outdated unpaid cache, is authoritative.
    for(const status of ['PAID','verified','offline_approved','REFUNDED','AWAITING_VERIFICATION']) {
      const paid=await create(),db=new DatabaseSync(path);
      db.prepare('UPDATE payments SET status=? WHERE id=?').run(status,paid.payment.id);db.close();
      const detail=(await request('/api/cases/'+paid.id,{cookie:sales})).data.case;
      assert.equal(detail.deletionAllowed,false,status);
      assert.equal((await request('/api/cases/'+paid.id,{cookie:sales,method:'DELETE'})).status,409,status);
    }
    await request('/api/payment-settings',{cookie:admin,body:{action:'enable-receiver',ownerConfirmed:true}});
    const a=await create(),b=await create();
    const batch=(await request('/api/payments/batch',{cookie:sales,body:{caseIds:[a.id,b.id]}})).data;
    assert.equal((await request('/api/cases/'+a.id,{cookie:sales,method:'DELETE'})).status,200);
    assert.equal((await request('/api/payments/'+batch.id,{cookie:sales})).status,410);
    const remaining=await request('/api/cases/'+b.id+'/payment-order',{cookie:sales,body:{individual:true}});
    assert.equal(remaining.status,201,JSON.stringify(remaining.data));assert.ok(remaining.data.upiIntent);
    const d=await create(),e=await create();
    const submitted=(await request('/api/payments/batch',{cookie:sales,body:{caseIds:[d.id,e.id]}})).data;
    assert.equal((await request('/api/payments/'+submitted.id+'/submit',{cookie:sales,body:{utr:'222222222222'}})).status,200);
    assert.equal((await request('/api/cases/'+d.id,{cookie:sales,method:'DELETE'})).status,409);
  } finally {child.kill();}
});
