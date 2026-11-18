import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testPort} from './test-port.js';

test('unique checkout SMS confirms without a submitted UTR and isolates simultaneous checkouts',{timeout:45000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'sms-auto-')),port=await testPort(),origin=`http://localhost:${port}`,path=join(root,'test.sqlite'),key='ab'.repeat(32);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:path,STORAGE_PATH:join(root,'files'),SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'isolated-auto-confirm-test-secret',APP_ORIGIN:origin,SMS_AUTO_CONFIRM:'true',SMS_UNIQUE_AMOUNT:'true',SMS_OBSERVER_ENABLED:'false',SMS_OBSERVER_KEYS:JSON.stringify({'auto-phone':key}),SMS_OBSERVER_TERMINAL:'2695306A'},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',d=>errors+=d);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
    const request=async(route,{cookie,body,headers={},raw,method=body || raw?'POST':'GET'}={})=>{
      const r=await fetch(origin+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:raw ?? (body?JSON.stringify(body):undefined)});return {status:r.status,data:await r.json()};
    };
    const login=async name=>{const r=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:name,password:'Demo@12345'})});return r.headers.get('set-cookie').split(';')[0];};
    const admin=await login('admin01'),sales=await login('sales01'),other=await login('sales02');
    await request('/api/payment-settings',{cookie:admin,body:{action:'enable-receiver',ownerConfirmed:true}});
    const variant=(await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='pan').variants[0];
    const create=async({documents=true}={})=>{
      const result=await request('/api/cases',{cookie:sales,body:{variantId:variant.id,details:{},customer:{name:'Synthetic Automatic Client',mobile:'9876543210'},consent:true}});assert.equal(result.status,201,JSON.stringify(result.data));
      const c=result.data.case;
      if(documents)for(const doc of variant.documents.filter(d=>d.required)) {
        const pdf=Buffer.from('%PDF-1.4\nsynthetic-automatic-proof\n%%EOF');
        const upload=await request('/api/cases/'+c.id+'/documents',{cookie:sales,body:{docType:doc.label,fileName:'proof.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});assert.equal(upload.status,201,JSON.stringify(upload.data));
      }
      return c;
    };
    const claim=async(id,rrn)=>request('/api/payments/'+id+'/submit',{cookie:sales,body:{utr:rrn}});
    const payment=async id=>(await request('/api/payments/'+id,{cookie:sales})).data;
    const sms=async(rrn,{amount='1.00',time=Date.now(),tamper=false,reference='2695306A',vpa='7558548187@axl'}={})=>{
      const india=new Date(time+330*60000).toISOString(),date=india.slice(8,10)+'-'+india.slice(5,7)+'-'+india.slice(0,4)+' '+india.slice(11,19);
      const body=JSON.stringify({sender:'JD-WLITXS-S',text:`Rs. ${amount} received on ${date} for BQR-UPI/${reference}/${vpa}. RRN#${rrn} - Worldline India`,receivedAt:new Date(time).toISOString()});
      const timestamp=String(Date.now()),signature=createHmac('sha256',Buffer.from(key,'hex')).update(timestamp+'.'+body).digest('hex');
      return request('/api/sms-observer/events',{raw:tamper?body+' ':body,headers:{'x-sms-device':'auto-phone','x-sms-timestamp':timestamp,'x-sms-signature':signature}});
    };

    const first=await create(),second=await create();
    const a=await payment(first.payment.id),b=await payment(second.payment.id);
    assert.equal(a.amount,100);assert.equal(a.payableAmount,117);assert.equal(b.payableAmount,118);
    assert.equal(a.automaticReference,true);assert.equal(a.transaction_id,null);
    assert.equal(new URL(a.upiIntent).searchParams.get('am'),'1.17');
    assert.equal((await payment(a.id)).payableAmount,117,'Reopening preserves the payable amount');
    await sms('400000000001',{amount:'1.00'});
    assert.equal((await payment(a.id)).status,'PENDING','Base price alone cannot claim a tagged checkout');
    await sms('400000000002',{amount:'1.17',time:Date.now()-3600000});
    assert.equal((await payment(a.id)).status,'PENDING','Older credit cannot claim a new checkout');
    await sms('400000000003',{amount:'1.17',reference:'T2611171631153817279676',vpa:'7558548187-4@axl'});
    assert.equal((await payment(a.id)).status,'PAID');
    assert.equal((await payment(a.id)).transaction_id,'400000000003');
    assert.equal((await payment(b.id)).status,'PENDING');
    assert.equal((await request('/api/cases/'+first.id,{cookie:sales})).data.case.status,'Ready for Assignment');
    await sms('400000000003',{amount:'1.17',reference:'T2611171631153817279676',vpa:'7558548187-4@axl'});
    const db=new DatabaseSync(path);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_attempts WHERE payment_id=? AND action='auto_verify_sms'").get(a.id).n,1);
    assert.equal(db.prepare('SELECT amount FROM payments WHERE id=?').get(a.id).amount,100,'Service accounting retains its base price');
    db.close();
    await request('/api/payments/'+b.id+'/initiate',{cookie:sales,body:{method:'PhonePe'}});
    assert.equal((await sms('400000000004',{amount:'1.18',reference:'T2611171628050335728295',vpa:'7558548187-4@ybl'})).status,200);
    assert.equal((await request('/api/payments/'+b.id+'/check',{cookie:sales,body:{}})).data.payment.status,'PAID');
    const batchA=await create(),batchB=await create();
    const batch=(await request('/api/payments/batch',{cookie:sales,body:{caseIds:[batchA.id,batchB.id]}})).data;
    assert.equal(batch.amount,200);assert.equal(batch.payableAmount,217);
    await sms('400000000005',{amount:'2.17'});
    const paidBatch=await payment(batch.id);
    assert.equal(paidBatch.status,'PAID');assert.ok(paidBatch.items.every(p=>p.status==='PAID'));
    assert.equal(paidBatch.transaction_id,'400000000005');
    const cancelled=await create();const cp=await payment(cancelled.payment.id);
    await request('/api/payments/'+cp.id+'/cancel',{cookie:sales,body:{}});
    await sms('400000000006',{amount:(cp.payableAmount/100).toFixed(2)});
    assert.equal((await payment(cp.id)).status,'CANCELLED');
    const legacy=await create();
    const legacyDb=new DatabaseSync(path);
    legacyDb.prepare('DELETE FROM sms_checkouts WHERE checkout_id=?').run(legacy.payment.id);
    legacyDb.prepare("UPDATE payments SET status='INITIATED' WHERE id=?").run(legacy.payment.id);legacyDb.close();
    const old=await payment(legacy.payment.id);
    assert.equal(old.payableAmount,old.amount);assert.equal(old.automaticReference,false,'An initiated legacy checkout retains its shown price');
    assert.equal((await claim(old.id,'400000000007')).status,200);await sms('400000000007');
    assert.equal((await payment(old.id)).status,'PAID');
  } finally {child.kill();}
});
