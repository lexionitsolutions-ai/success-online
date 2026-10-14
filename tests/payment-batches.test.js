import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

test('combined checkout allocates one verified transfer across cases and protects ownership, totals and duplicate UTRs',{timeout:30000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'batch-payments-')),port=32000+Math.floor(Math.random()*3000),origin=`http://localhost:${port}`,dbPath=join(root,'test.sqlite');
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:dbPath,STORAGE_PATH:join(root,'files'),DRIVE_MODE:'demo',SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'test-only-combined-payment-session',APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',c=>errors+=c);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
    const request=async(path,cookie,body)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),response};};
    const login=async username=>(await request('/api/login',null,{username,password:'Demo@12345'})).response.headers.get('set-cookie').split(';')[0];
    const admin=await login('admin01'),sales=await login('sales01'),other=await login('sales02'),office=await login('backoffice01');
    await request('/api/payment-settings',admin,{action:'enable-receiver',ownerConfirmed:true});
    const services=(await request('/api/services',sales)).data.services,variant=services.find(s=>s.slug==='pf-assistance').variants[0];
    const create=async(cookie=sales)=>(await request('/api/cases',cookie,{variantId:variant.id,customer:{name:'Batch Client',mobile:'9876543210'},consent:true})).data.case;
    const [a,b,c,foreign]=await Promise.all([create(),create(),create(),create(other)]);
    assert.equal((await request('/api/payments/batch',sales,{caseIds:[a.id,foreign.id]})).status,403);
    assert.equal((await request('/api/payments/batch',admin,{caseIds:[a.id,foreign.id]})).status,400);
    assert.equal((await request('/api/payments/batch',office,{caseIds:[a.id,b.id]})).status,403);
    assert.equal((await request('/api/payments/batch',sales,{caseIds:[a.id,a.id]})).status,400);
    const combined=await request('/api/payments/batch',sales,{caseIds:[a.id,b.id],amount:1,status:'PAID'});
    assert.equal(combined.status,201,JSON.stringify(combined.data));
    const p=combined.data,base='/api/payments/'+p.id;
    assert.equal(p.amount,200);assert.equal(p.items.length,2);assert.equal(p.status,'PENDING');
    assert.equal(new URL(p.upiIntent).searchParams.get('am'),'2.00');
    assert.ok(new URL(p.upiIntent).searchParams.get('tn').startsWith('Batch Client - 2 work orders - '));
    assert.equal((await request(base,other)).status,403);
    assert.equal((await request('/api/payments/'+a.payment.id,sales)).data.id,p.id,'Opening a case payment shows its combined checkout');
    assert.equal((await request(`/api/cases/${a.id}/payment-order`,sales,{})).data.id,p.id);
    assert.equal((await request('/api/payments/batch',sales,{caseIds:[a.id,c.id]})).status,409);
    assert.equal((await request(base+'/verify',admin,{})).status,409);
    assert.equal((await request(base+'/initiate',sales,{method:'Google Pay'})).data.payment.status,'INITIATED');
    assert.equal((await request(base+'/submit',sales,{utr:'bad'})).status,400);
    assert.equal((await request(base+'/submit',sales,{utr:'333333333333'})).data.payment.status,'AWAITING_VERIFICATION');
    assert.equal((await request(base+'/verify',sales,{})).status,403);
    const verified=await request(base+'/verify',admin,{});
    assert.equal(verified.status,200,JSON.stringify(verified.data));assert.equal(verified.data.payment.status,'PAID');
    assert.equal((await request(base+'/verify',admin,{})).status,200,'Verification is idempotent');
    for(const item of [a,b]) {
      const detail=await request('/api/cases/'+item.id,sales);
      assert.equal(detail.data.case.payment_state,'paid');
    }
    const local=new DatabaseSync(dbPath);
    assert.equal(local.prepare("SELECT SUM(amount) n FROM payments WHERE status='PAID'").get().n,200);
    assert.equal(local.prepare("SELECT COUNT(*) n FROM verified_upi_refs WHERE utr='333333333333'").get().n,1);
    assert.equal(local.prepare("SELECT COUNT(*) n FROM payments WHERE transaction_id='333333333333' AND status='PAID'").get().n,2);
    local.close();
    const totals=(await request('/api/payments',admin)).data.metrics;
    assert.equal(totals.collected,200);assert.equal(totals.verified,1,'One combined transfer counts as one verified transaction');
    const search=async(searchBy,q)=>request('/api/payments?'+new URLSearchParams({searchBy,q}),admin);
    assert.equal((await search('utr','333333333333')).data.payments.length,2);
    assert.equal((await search('order',p.id)).data.payments.length,2);
    assert.equal((await search('status','paid')).data.payments.length,2);
    assert.ok((await search('customer','bAtCh cLiEnT')).data.payments.length>=2);
    assert.ok((await search('service','PF')).data.payments.length>=2);
    assert.equal((await search('from','2099-01-01')).data.payments.length,0);
    assert.equal((await search('to','2000-01-01')).data.payments.length,0);
    assert.equal((await search('from','invalid')).status,400);

    assert.equal((await request(base+'/receipt',sales)).data.items.length,2);
    assert.equal((await request('/api/payments/'+c.payment.id+'/submit',sales,{utr:'333333333333'})).status,409);
    assert.equal((await request(base+'/refund',admin,{refundReceived:true,notes:'Full combined refund fixture'})).data.payment.status,'REFUNDED');
    assert.equal((await request('/api/payments',admin)).data.metrics.collected,0);
    const [d,e]=await Promise.all([create(),create()]);
    const second=(await request('/api/payments/batch',sales,{caseIds:[d.id,e.id]})).data;
    assert.equal((await request('/api/payments/'+second.id+'/cancel',sales,{})).data.payment.status,'CANCELLED');
    const reopened=await request('/api/payments/'+second.id+'/reopen',sales,{});
    assert.equal(reopened.status,201,JSON.stringify(reopened.data));
    assert.notEqual(reopened.data.payment.id,second.id);assert.equal(reopened.data.payment.amount,200);
  } finally {child.kill();}
});
