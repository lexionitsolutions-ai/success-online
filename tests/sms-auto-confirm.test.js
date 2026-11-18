import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testPort} from './test-port.js';

test('automatic SMS confirmation advances only exact claims and handles duplicates, timing, documents and batch totals',{timeout:45000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'sms-auto-')),port=await testPort(),origin=`http://localhost:${port}`,path=join(root,'test.sqlite'),key='ab'.repeat(32);
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:path,STORAGE_PATH:join(root,'files'),SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'isolated-auto-confirm-test-secret',APP_ORIGIN:origin,SMS_AUTO_CONFIRM:'true',SMS_OBSERVER_ENABLED:'false',SMS_OBSERVER_KEYS:JSON.stringify({'auto-phone':key}),SMS_OBSERVER_TERMINAL:'2695306A'},stdio:['ignore','pipe','pipe']});
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
    const first=await create(),firstId=first.payment.id;
    assert.equal((await claim(firstId,'300000000001')).data.payment.status,'AWAITING_VERIFICATION');
    assert.equal((await request('/api/payments/'+firstId+'/check',{cookie:sales,body:{status:'PAID',utr:'300000000001'}})).data.payment.status,'AWAITING_VERIFICATION','Browser claims alone cannot approve a payment');
    assert.equal((await sms('300000000001',{tamper:true})).status,401);
    assert.equal((await payment(firstId)).status,'AWAITING_VERIFICATION');
    assert.equal((await sms('300000000001')).status,200);
    assert.equal((await payment(firstId)).status,'PAID');
    assert.equal((await request('/api/cases/'+first.id,{cookie:sales})).data.case.status,'Ready for Assignment');
    assert.equal((await request('/api/payments/'+firstId+'/receipt',{cookie:sales})).status,200);
    await sms('300000000001');
    const db=new DatabaseSync(path);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM verified_upi_refs WHERE utr=?').get('300000000001').n,1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM payment_attempts WHERE payment_id=? AND action='auto_verify_sms'").get(firstId).n,1);
    db.close();
    const second=await create();await sms('300000000002',{reference:'ICI2fe38efec2ac4b47bacced15fffb1ab4'});
    assert.equal((await payment(second.payment.id)).status,'PENDING','An amount-only SMS never approves an unclaimed checkout');
    assert.equal((await claim(second.payment.id,'300000000002')).data.payment.status,'PAID','Previously received exact SMS confirms on reference submission');
    const missing=await create({documents:false});await claim(missing.payment.id,'300000000003');await sms('300000000003');
    const missingCase=(await request('/api/cases/'+missing.id,{cookie:sales})).data.case;
    assert.equal(missingCase.payment_state,'paid');assert.equal(missingCase.status,'Awaiting Documents');
    const wrong=await create();await claim(wrong.payment.id,'300000000004');await sms('300000000004',{amount:'2.00'});assert.equal((await payment(wrong.payment.id)).status,'AWAITING_VERIFICATION');
    const a=await create(),b=await create();await claim(a.payment.id,'300000000005');await claim(b.payment.id,'300000000005');await sms('300000000005');
    assert.equal((await payment(a.payment.id)).status,'AWAITING_VERIFICATION');assert.equal((await payment(b.payment.id)).status,'AWAITING_VERIFICATION');
    const old=await create();await claim(old.payment.id,'300000000006');await sms('300000000006',{time:Date.now()-3600000});assert.equal((await payment(old.payment.id)).status,'AWAITING_VERIFICATION');
    const cancelled=await create();await claim(cancelled.payment.id,'300000000007');
    const cancelDb=new DatabaseSync(path);cancelDb.prepare("UPDATE cases SET status='Cancelled' WHERE id=?").run(cancelled.id);cancelDb.close();await sms('300000000007');assert.equal((await payment(cancelled.payment.id)).status,'AWAITING_VERIFICATION');
    const batchA=await create(),batchB=await create();
    const batch=(await request('/api/payments/batch',{cookie:sales,body:{caseIds:[batchA.id,batchB.id]}})).data;
    assert.equal((await claim(batch.id,'300000000008')).status,200);await sms('300000000008',{amount:'2.00'});
    const grouped=await payment(batch.id);assert.equal(grouped.status,'PAID');assert.ok(grouped.items.every(item=>item.status==='PAID'));
    assert.equal((await request('/api/cases/'+batchA.id,{cookie:sales})).data.case.status,'Ready for Assignment');
    // The selected app and payer handle never substitute for signed credit evidence.
    for(const [index,method] of ['QR','PhonePe','Google Pay','Paytm','BHIM','Other UPI App','Manual UPI'].entries()) {
      const c=await create(),id=c.payment.id,rrn=String(310000000000+index);
      assert.equal((await request('/api/payments/'+id+'/initiate',{cookie:sales,body:{method}})).status,200);
      await claim(id,rrn);
      assert.equal((await payment(id)).status,'AWAITING_VERIFICATION');
      assert.equal((await sms(rrn,{reference:index%2?'T2611171628050335728295':'T2611171631153817279676',vpa:`payer-4@${['axl','ybl','okicici','paytm','upi','apl','newbank'][index]}`})).status,200);
      assert.equal((await payment(id)).status,'PAID',method);
      await sms(String(320000000000+index),{reference:'T2611171628050335728295'});
      assert.equal((await payment(id)).transaction_id,rrn,'A second transfer cannot credit the same checkout twice');
    }
    assert.equal((await request('/api/payments/'+firstId,{cookie:other})).status,404);
  } finally {child.kill();}
});
