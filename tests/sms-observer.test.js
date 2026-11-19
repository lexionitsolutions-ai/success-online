import {testPort} from './test-port.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseWorldlineSms,ingestSmsObservation} from '../sms-observer.js';

const sender='JD-WLITXS-S',terminal='2695306A';
const sample='Rs. 1.00 received on 16-11-2026 18:27:23 for BQR-UPI/2695306A/7558548187@axl. RRN#538819093376 - Worldline India';
test('unconfigured SMS intake is disabled before reading a request or touching the database',async()=>{
  const previous=process.env.SMS_OBSERVER_KEYS;
  const enabled=process.env.SMS_OBSERVER_ENABLED;
  try {delete process.env.SMS_OBSERVER_KEYS;delete process.env.SMS_OBSERVER_ENABLED;await assert.rejects(ingestSmsObservation({},null,{}),error=>error.status===503);}
  finally {if(previous===undefined) delete process.env.SMS_OBSERVER_KEYS;else process.env.SMS_OBSERVER_KEYS=previous;if(enabled===undefined)delete process.env.SMS_OBSERVER_ENABLED;else process.env.SMS_OBSERVER_ENABLED=enabled;}
});
test('owner-supplied Worldline sender and RRN format parse without guessing a VPA role',()=>{
  const p=parseWorldlineSms(sender,sample,terminal);
  assert.equal(p.amount,100);assert.equal(p.rrn,'538819093376');
  assert.equal(p.transactionAt,'2026-11-16T12:57:23.000Z');assert.equal(p.vpa,'7558548187@axl');
  for(const text of [sample.replace('received','debited'),sample.replace('1.00','0.00'),sample.replace('16-11','31-02'),sample.replace('538819093376','53881909337'),sample+' Pay now']) assert.equal(parseWorldlineSms(sender,text,terminal),null);
  assert.equal(parseWorldlineSms('JD-WLITXS',sample,terminal),null);
  assert.equal(parseWorldlineSms(sender,sample,'OTHER'),null);
});
test('new owner-supplied ICI reference and carrier header variations parse without treating token as merchant identity',()=>{
  const text='Rs. 100.00 received on 17-11-2026 14:37:32 for BQR-UPI/ICI2fe38efec2ac4b47bacced15fffb1ab4/rajvardhanpatil411-2@okicici. RRN#632149985208 - Worldline India';
  const parsed=parseWorldlineSms(sender,text,terminal);
  assert.equal(parsed.amount,10000);assert.equal(parsed.rrn,'632149985208');
  assert.equal(parsed.transactionAt,'2026-11-17T09:07:32.000Z');
  assert.equal(parsed.terminalId,'ICI2fe38efec2ac4b47bacced15fffb1ab4');
  assert.deepEqual(parseWorldlineSms('VK-WLITXS-S',text,terminal),parsed);
  assert.equal(parseWorldlineSms('VK-OTHER-S',text,terminal),null);
  assert.equal(parseWorldlineSms(sender,text.replace('ICI2fe38efec2ac4b47bacced15fffb1ab4','UNKNOWN'),terminal),null);
  assert.equal(parseWorldlineSms(sender,text.replace('100.00','100.5').replace('received on','received\n on'),terminal).amount,10050);
});

test('QR and PhonePe owner alerts and app-independent VPA handles parse exact paise and RRN',()=>{
  const alerts=[
    ['T2611171631153817279676','7558548187-4@axl','437047702379','16:31:19'],
    ['T2611171628050335728295','7558548187-4@ybl','655189709258','16:28:09']
  ];
  for(const [reference,vpa,rrn,time] of alerts) {
    const text=`Rs. 100.18 received on 17-11-2026 ${time} for BQR-UPI/${reference}/${vpa}. RRN#${rrn} - Worldline India`;
    const parsed=parseWorldlineSms(sender,text,terminal);
    assert.equal(parsed.amount,10018);assert.equal(parsed.rrn,rrn);assert.equal(parsed.vpa,vpa);
    assert.equal(parsed.terminalId,reference);
    for(const suffix of [' ','\u00a0','&#x20;','&#32;','&nbsp;'])assert.deepEqual(parseWorldlineSms(sender,text+suffix,terminal),parsed);
    // Handles are metadata. Different apps/banks and new valid handles use the same credit rules.
    for(const handle of ['axl','ybl','ibl','okicici','oksbi','okaxis','okhdfcbank','paytm','ptyes','apl','upi','newbank']) {
      assert.equal(parseWorldlineSms(sender,text.replace(vpa,`payer-4@${handle}`),terminal).amount,10018);
    }
    for(const bad of [reference.slice(0,-1),reference+'0',reference.replace('T','X'),reference.replace(/.$/,'A')]) {
      assert.equal(parseWorldlineSms(sender,text.replace(reference,bad),terminal),null);
    }
    for(const bad of [text.replace('received','debited'),text.replace('received','pending'),text.replace('received','failed'),text.replace('100.18','100.181'),text.replace('100.18','0.00'),text.replace(rrn,rrn.slice(1)),text+' refund']) {
      assert.equal(parseWorldlineSms(sender,bad,terminal),null);
    }
    assert.equal(parseWorldlineSms('PERSONAL',text,terminal),null);
  }
});

test('signed SMS pilot detects submitted references but never verifies or releases a payment',{timeout:30000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'sms-pilot-')),port=await testPort(),origin=`http://localhost:${port}`,key='a1'.repeat(32);
  const token='c3'.repeat(32),enrollment={tokenHash:createHash('sha256').update(token).digest('hex'),deviceId:'merchant-phone',expiresAt:new Date(Date.now()+3600000).toISOString()};
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:join(root,'pilot.sqlite'),STORAGE_PATH:join(root,'files'),SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'isolated-sms-pilot-test-secret',APP_ORIGIN:origin,SMS_AUTO_CONFIRM:'false',SMS_OBSERVER_ENABLED:'true',SMS_OBSERVER_ENROLLMENT:JSON.stringify(enrollment),SMS_OBSERVER_KEYS:JSON.stringify({'test-phone':key}),SMS_OBSERVER_TERMINAL:terminal},stdio:['ignore','pipe','pipe']});
  let output='';child.stderr.on('data',d=>output+=d);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(output)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(output));});});
    async function request(path,{cookie,body,headers={},raw,method=body || raw?'POST':'GET'}={}){
      const r=await fetch(origin+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{}),...headers},body:raw ?? (body?JSON.stringify(body):undefined)});
      return {status:r.status,data:await r.json(),response:r};
    }
    const login=async username=>(await request('/api/login',{body:{username,password:'Demo@12345'}})).response.headers.get('set-cookie').split(';')[0];
    const admin=await login('admin01'),sales=await login('sales01'),other=await login('sales02');
    const v=(await request('/api/services',{cookie:sales})).data.services.find(s=>s.slug==='pan').variants[0];
    const create=async()=>(await request('/api/cases',{cookie:sales,body:{variantId:v.id,details:{},customer:{name:'Synthetic Sms Client',mobile:'9876543210'},consent:true}})).data.case;
    const c=await create(),payment='/api/payments/'+c.payment.id,rrn='123456789012';
    assert.equal((await request(payment+'/submit',{cookie:sales,body:{utr:rrn}})).status,200);
    const now=new Date(),india=new Date(now.getTime()+330*60000).toISOString(),date=india.slice(8,10)+'-'+india.slice(5,7)+'-'+india.slice(0,4)+' '+india.slice(11,19);
    const payload={sender,text:`Rs. 1.00 received on ${date} for BQR-UPI/${terminal}/7558548187@axl. RRN#${rrn} - Worldline India`,receivedAt:now.toISOString()};
    async function ingest(input=payload,{time=Date.now(),overrideKey=key,device='test-phone',tamper=false}={}){
      const raw=JSON.stringify(input),timestamp=String(time),signature=createHmac('sha256',Buffer.from(overrideKey,'hex')).update(timestamp+'.'+raw).digest('hex');
      return request('/api/sms-observer/events',{raw:tamper?raw+' ':raw,headers:{'x-sms-device':device,'x-sms-timestamp':timestamp,'x-sms-signature':signature}});
    }
    const pairing={token,deviceId:'merchant-phone',installationId:'d4'.repeat(16)};
    assert.equal((await request('/api/sms-observer/pair',{body:{...pairing,token:'0'.repeat(64)}})).status,401);
    assert.equal((await request('/api/sms-observer/pair',{body:{...pairing,deviceId:'other-phone'}})).status,401);
    const paired=await request('/api/sms-observer/pair',{body:pairing});
    assert.equal(paired.status,200);assert.match(paired.data.signingKey,/^[a-f0-9]{64}$/);
    assert.equal(paired.response.headers.get('cache-control'),'no-store');
    const again=await request('/api/sms-observer/pair',{body:pairing});
    assert.equal(again.data.signingKey,paired.data.signingKey,'Same installation can safely retry a lost pairing response');
    assert.equal((await request('/api/sms-observer/pair',{body:{...pairing,installationId:'e5'.repeat(16)}})).status,409);
    assert.equal((await ingest({action:'health_check'},{device:'merchant-phone',overrideKey:paired.data.signingKey})).status,200);
    const database=new DatabaseSync(join(root,'pilot.sqlite'));
    const device=database.prepare('SELECT * FROM sms_observer_devices WHERE device_id=?').get('merchant-phone');
    assert.ok(!device.key_ciphertext.includes(paired.data.signingKey),'Signing keys are encrypted at rest');
    database.prepare('UPDATE sms_observer_devices SET active=0 WHERE device_id=?').run('merchant-phone');database.close();
    assert.equal((await ingest({action:'health_check'},{device:'merchant-phone',overrideKey:paired.data.signingKey})).status,401);
    assert.equal((await request('/api/sms-observer/pair',{body:pairing})).status,409,'Revocation cannot be undone with the consumed pairing file');
    assert.equal((await request('/api/sms-observer/events',{body:payload,cookie:admin})).status,401,'Staff session cannot replace a device signature');
    assert.equal((await ingest(payload,{overrideKey:'b2'.repeat(32)})).status,401);
    assert.equal((await ingest(payload,{device:'unknown'})).status,401);
    assert.equal((await ingest(payload,{time:Date.now()-600000})).status,401);
    assert.equal((await ingest(payload,{tamper:true})).status,401);
    assert.equal((await ingest({...payload,sender:'PERSONAL'})).status,400);
    assert.equal((await ingest({...payload,text:payload.text.replace(terminal,'BADTERM')})).status,400);
    assert.equal((await ingest({...payload,receivedAt:'invalid'})).status,400);
    const connection=await ingest({action:'health_check'});
    assert.equal(connection.status,200);
    assert.equal(connection.data.deviceAuthorized,true);
    assert.equal(connection.data.mode,'detection_only');
    assert.equal(connection.data.adminVerificationRequired,true);
    assert.equal(connection.data.observationId,undefined,'Connection checks never insert payment observations');
    assert.equal((await ingest({action:'health_check',text:payload.text})).status,400);
    const first=await ingest();assert.equal(first.status,200);assert.equal(first.data.duplicate,false);
    const duplicate=await ingest();assert.equal(duplicate.status,200);assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.observationId,first.data.observationId);
    assert.equal((await ingest({...payload,text:payload.text.replace('1.00','2.00')})).status,409);
    let p=(await request(payment,{cookie:sales})).data;
    assert.equal(p.smsEvidence.status,'matched');assert.equal(p.smsEvidence.settlementState,'NOT_RECONCILED');assert.equal(p.status,'AWAITING_VERIFICATION');
    assert.equal((await request(payment+'/receipt',{cookie:sales})).status,409);
    assert.equal((await request(payment,{cookie:other})).status,404);
    assert.notEqual((await request('/api/cases/'+c.id,{cookie:sales})).data.case.payment_state,'paid');
    const second=await create();await request('/api/payments/'+second.payment.id+'/submit',{cookie:sales,body:{utr:rrn}});
    p=(await request(payment,{cookie:sales})).data;assert.equal(p.smsEvidence.status,'manual_review','Duplicate pending references cannot be auto-attributed');
  } finally {child.kill();}
});
