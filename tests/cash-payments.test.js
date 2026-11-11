import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {pfDetails} from './pf-fixture.js';
import {confirmTestReceiver} from './payment-fixture.js';
import {CASH_SALES_ID,cashAccount} from '../cash-payments.js';
import {testPort} from './test-port.js';

test('Mahalaxmi cash instalments forward partial cases but only admin-confirmed full cash or UPI unlocks final files',{timeout:60000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'cash-plan-')),path=join(root,'test.sqlite'),port=await testPort(),origin=`http://localhost:${port}`;
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:path,STORAGE_PATH:join(root,'files'),SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'isolated-cash-test-secret-not-production',APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',data=>errors+=data);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
    const db=new DatabaseSync(path);
    db.prepare("UPDATE users SET id=?,username='7028405101',name='Mahalaxmi Online Services' WHERE username='sales01'").run(CASH_SALES_ID);db.close();
    const request=async(route,{cookie,body,method=body?'POST':'GET'}={})=>{
      const response=await fetch(origin+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});
      const type=response.headers.get('content-type');return {status:response.status,response,data:type?.includes('json')?await response.json():await response.arrayBuffer()};
    };
    const login=async username=>(await request('/api/login',{body:{username,password:'Demo@12345'}})).response.headers.get('set-cookie').split(';')[0];
    const sales=await login('7028405101'),other=await login('sales02'),admin=await login('admin01'),office=await login('backoffice01');
    assert.equal((await request('/api/me',{cookie:sales})).data.user.cashPaymentsAllowed,true);
    assert.equal((await request('/api/me',{cookie:other})).data.user.cashPaymentsAllowed,false);
    assert.equal(cashAccount({id:'different',username:'7028405101',role:'sales'}),false);
    const variant=(await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='pan').variants[0];
    assert.equal((await request('/api/admin/pricing',{cookie:admin,body:{salesUserId:CASH_SALES_ID,variantId:variant.id,price:60000}})).status,200);
    const payload={variantId:variant.id,details:pfDetails,customer:{name:'Cash Trial',mobile:'9876543210'},consent:true};
    for(const cookie of [other,admin]) assert.equal((await request('/api/cases',{cookie,body:{...payload,cashPayment:{amount:10000}}})).status,403);
    for(const amount of [0,-1,60001,1.5,'10000']) assert.equal((await request('/api/cases',{cookie:sales,body:{...payload,cashPayment:{amount}}})).status,400);
    const pdf=Buffer.from('%PDF-1.4\ncash fixture\n%%EOF');
    const upload=(id,docType,cookie=sales)=>request(`/api/cases/${id}/documents`,{cookie,body:{docType,fileName:'fixture.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});
    async function create(initial=10000) {
      const response=await request('/api/cases',{cookie:sales,body:{...payload,cashPayment:{amount:initial}}});assert.equal(response.status,201,JSON.stringify(response.data));
      const c=response.data.case;assert.equal(c.amounts.total,60000);assert.equal(c.cashPayment.amountToPay,60000-initial);assert.equal(c.cashPayment.releaseAllowed,false);
      for(const doc of variant.documents.filter(d=>d.required)) assert.equal((await upload(c.id,doc.label)).status,201);
      for(const cookie of [admin,office]) assert.ok((await request('/api/cases',{cookie})).data.cases.some(row=>row.id===c.id),'Partial cash is forwarded');
      assert.equal((await request('/api/payments/batch',{cookie:sales,body:{caseIds:[c.id,c.id]}})).status,400);
      return (await request(`/api/cases/${c.id}`,{cookie:sales})).data.case;
    }
    async function complete(c) {
      assert.equal((await request(`/api/cases/${c.id}/claim`,{cookie:office,method:'POST'})).status,200);
      for(const status of ['Ready to Submit','Submitted to Official Portal','Document Received']) assert.equal((await request(`/api/cases/${c.id}/progress`,{cookie:office,body:{status}})).status,200,status);
      const uploaded=await upload(c.id,'Received Document',office);assert.equal(uploaded.status,201);
      const detail=(await request(`/api/cases/${c.id}`,{cookie:office})).data;
      const doc=detail.documents.find(d=>d.doc_type==='Received Document');
      assert.equal((await request(`/api/cases/${c.id}/submit-received-document`,{cookie:office,method:'POST'})).status,200);
      return doc;
    }
    async function locked(c,doc) {
      for(const action of ['download','preview','view']) assert.equal((await request(`/api/documents/${doc.id}/${action}`,{cookie:sales})).status,403);
      const detail=(await request(`/api/cases/${c.id}`,{cookie:sales})).data;
      assert.equal(detail.case.received_document,null);assert.ok(!detail.documents.some(d=>d.id===doc.id));
      assert.equal((await request(doc.download_url,{cookie:other})).status,403);
    }
    const c=await create(),initial=c.cashReceipts[0];
    assert.equal(initial.status,'AWAITING_VERIFICATION');
    assert.equal((await request(`/api/payments/${initial.id}/verify`,{cookie:sales,body:{}})).status,403);
    assert.equal((await request(`/api/cases/${c.id}/cash-payment`,{cookie:other,body:{amount:50000,requestId:randomUUID()}})).status,403);
    assert.equal((await request(`/api/payments/${initial.id}/verify`,{cookie:admin,body:{}})).status,200,'Cash does not require a UPI receiver or invented UTR');
    const doc=await complete(c);await locked(c,doc);
    const record={amount:50000,requestId:randomUUID()};
    const deposit=await request(`/api/cases/${c.id}/cash-payment`,{cookie:sales,body:record});assert.equal(deposit.status,201);
    const repeated=await request(`/api/cases/${c.id}/cash-payment`,{cookie:sales,body:record});assert.equal(repeated.data.receipt.id,deposit.data.receipt.id);
    assert.equal((await request(`/api/cases/${c.id}/cash-payment`,{cookie:sales,body:{amount:1,requestId:randomUUID()}})).status,400);
    await locked(c,doc);
    const adminPayments=(await request('/api/payments',{cookie:admin})).data.payments;
    assert.ok(adminPayments.some(p=>p.id===deposit.data.receipt.id));
    assert.equal((await request(`/api/payments/${deposit.data.receipt.id}/verify`,{cookie:admin,body:{}})).status,200);
    assert.equal((await request(doc.download_url,{cookie:sales})).status,200);
    assert.equal((await request(`/api/cases/${c.id}`,{cookie:sales})).data.case.cashPayment.releaseAllowed,true);
    const report=(await request('/api/admin/performance?role=sales&employee='+CASH_SALES_ID+'&period=all',{cookie:admin})).data.report;
    assert.equal(report.metrics.collected,60000);
    assert.equal((await request(`/api/payments/${deposit.data.receipt.id}/refund`,{cookie:admin,body:{refundReceived:true,notes:'Synthetic refund fixture'}})).status,200);await locked(c,doc);
    // Settle a separate case using a prefilled UPI balance payment.
    const c2=await create(),doc2=await complete(c2);await locked(c2,doc2);
    await confirmTestReceiver(request,admin);
    const balance=await request(`/api/cases/${c2.id}/payment-order`,{cookie:sales,body:{individual:true}});
    assert.equal(balance.status,201);assert.equal(balance.data.amount,50000);assert.equal(new URL(balance.data.upiIntent).searchParams.get('am'),'500.00');
    assert.equal((await request(`/api/payments/${balance.data.id}/submit`,{cookie:sales,body:{utr:'333333333333'}})).status,200);
    assert.equal((await request(`/api/cases/${c2.id}/cash-payment`,{cookie:sales,body:{amount:100,requestId:randomUUID()}})).status,409);
    await locked(c2,doc2);
    assert.equal((await request(`/api/payments/${balance.data.id}/verify`,{cookie:admin,body:{}})).status,200);
    await locked(c2,doc2);
    assert.equal((await request(`/api/payments/${c2.cashReceipts[0].id}/verify`,{cookie:admin,body:{}})).status,200);
    assert.equal((await request(doc2.download_url,{cookie:sales})).status,200);
    const c3=await create(),c4=await create();
    assert.equal((await request('/api/payments/batch',{cookie:sales,body:{caseIds:[c3.id,c4.id]}})).status,409,'Instalments cannot be charged again through combined checkout');
    const stale=(await request(`/api/cases/${c3.id}/payment-order`,{cookie:sales,body:{}})).data;
    assert.equal((await request(`/api/cases/${c3.id}/cash-payment`,{cookie:sales,body:{amount:10000,requestId:randomUUID()}})).status,201);
    assert.equal((await request(`/api/payments/${stale.id}/submit`,{cookie:sales,body:{utr:'444444444444'}})).status,409,'An old QR cannot overpay after more cash is recorded');
    assert.equal((await request(`/api/payments/${c4.cashReceipts[0].id}/reject`,{cookie:admin,body:{notes:'Cash not received in test fixture'}})).status,200);
    assert.ok(!(await request('/api/cases',{cookie:office})).data.cases.some(row=>row.id===c4.id));
    assert.equal((await request(`/api/cases/${c4.id}/claim`,{cookie:office,method:'POST'})).status,409,'Rejected cash no longer permits processing');
    // Ordinary accounts retain their full-price UPI flow.
    const normal=(await request('/api/cases',{cookie:other,body:payload})).data.case;
    assert.equal(normal.cashPayment,null);
    assert.equal((await request(`/api/cases/${normal.id}/cash-payment`,{cookie:other,body:{amount:1,requestId:randomUUID()}})).status,403);
    assert.equal((await request(`/api/cases/${normal.id}/payment-order`,{cookie:other,body:{}})).data.cashPaymentAllowed,false);
    const online=(await request('/api/cases',{cookie:sales,body:payload})).data.case;
    const onlineOrder=(await request(`/api/cases/${online.id}/payment-order`,{cookie:sales,body:{individual:true}})).data;
    assert.equal(onlineOrder.cashPaymentAllowed,true,'Cash is available from existing online checkout');
    const cashEntry={amount:10000,requestId:randomUUID(),enroll:true};
    const converted=await request(`/api/cases/${online.id}/cash-payment`,{cookie:sales,body:cashEntry});
    assert.equal(converted.status,201,JSON.stringify(converted.data));
    assert.equal(converted.data.case.cashPayment.amountToPay,50000);
    assert.equal((await request(`/api/cases/${online.id}/cash-payment`,{cookie:sales,body:cashEntry})).data.receipt.id,converted.data.receipt.id,'Retrying cash conversion cannot duplicate the initial cash entry');
    assert.equal((await request(`/api/payments/${onlineOrder.id}/submit`,{cookie:sales,body:{utr:'555555555555'}})).status,409);
    // A completed case remains payable later: INR 600 total, INR 400 confirmed,
    // and INR 200 clearly listed until the final receipt is confirmed.
    const later=await create(40000);
    assert.equal((await request(`/api/payments/${later.cashReceipts[0].id}/verify`,{cookie:admin,body:{}})).status,200);
    const laterDoc=await complete(later);
    const pending=()=>request('/api/payments/cash-pending',{cookie:sales});
    const pendingRow=(await pending()).data.cases.find(row=>row.case_id===later.id);
    assert.equal(pendingRow.case_status,'Closed');assert.equal(pendingRow.pending_amount,20000);assert.equal(pendingRow.amount_to_pay,20000);
    assert.ok(!(await request('/api/payments/cash-pending',{cookie:other})).data.cases.some(row=>row.case_id===later.id));
    assert.equal((await request('/api/payments/cash-pending',{cookie:office})).status,403);
    const upi200=(await request(`/api/cases/${later.id}/payment-order`,{cookie:sales,body:{individual:true}})).data;
    assert.equal(upi200.amount,20000);assert.equal(new URL(upi200.upiIntent).searchParams.get('am'),'200.00');
    const lastCash=(await request(`/api/cases/${later.id}/cash-payment`,{cookie:sales,body:{amount:20000,requestId:randomUUID()}})).data.receipt;
    const awaitingRow=(await pending()).data.cases.find(row=>row.case_id===later.id);
    assert.equal(awaitingRow.amount_to_pay,0);assert.equal(awaitingRow.awaiting_verification,20000);await locked(later,laterDoc);
    assert.equal((await request(`/api/payments/${lastCash.id}/verify`,{cookie:admin,body:{}})).status,200);
    assert.ok(!(await pending()).data.cases.some(row=>row.case_id===later.id));
    assert.equal((await request(laterDoc.download_url,{cookie:sales})).status,200);
  } finally {child.kill();}
});
