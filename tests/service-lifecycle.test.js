import {testPort} from './test-port.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {acceptanceToken} from '../acceptance-tests.js';
import {confirmTestReceiver,verifyTestOrder} from './payment-fixture.js';
import '../public/intake-rules.js';

function detailsFor(variant) {
  const details={};
  for(let pass=0;pass<3;pass++) for(const f of variant.fields || []) {
    if(!IntakeRules.matches(f.when,details)) continue;
    if(f.defaultWhen && details[f.defaultWhen.field]===f.defaultWhen.equals) {details[f.label]=f.defaultWhen.value;continue;}
    if(details[f.label]!==undefined || f.computedSum || f.optional) continue;
    let value='Synthetic application details';
    if(f.type==='select') value=f.options[0];
    else if(f.type==='password') value='SyntheticOnlyPF!23';
    else if(f.marathiInput) value='राम पाटील';
    else if(f.type==='email' || /email/i.test(f.label)) value='test@example.invalid';
    else if(f.digitsOnly) value=f.maxLength===12?'123456789012':'9876543210';
    else if(f.type==='tel') value='9876543210';
    else if(f.type==='date') value='2020-01-01';
    else if(f.type==='number') value=f.step==='1'?'2':/income|investment/i.test(f.label)?'150000':'250';
    else if(/name|surname/i.test(f.label)) value='Synthetic Applicant';
    else if(f.label==='GST number') value='27ABCDE1234F1Z5';
    details[f.label]=value;
  }
  for(const group of IntakeRules.missingAnswerGroups(variant.fields || [],details)) {const field=variant.fields.find(f=>f.answerGroup===group);details[field.label]=field.options[0];}
  IntakeRules.applyComputed(variant.fields || [],details);
  return Object.fromEntries(Object.entries(details).filter(([label])=>IntakeRules.matches(variant.fields.find(f=>f.label===label)?.when,details)));
}

test('all services and pricing variants finish their normal or quoted lifecycle in an isolated database',{timeout:180000},async t=>{
  const root=mkdtempSync(join(tmpdir(),'service-lifecycle-')),port=await testPort(),origin=`http://localhost:${port}`;
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:join(root,'test.sqlite'),STORAGE_PATH:join(root,'files'),SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'isolated-full-lifecycle-secret-32-characters',APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',d=>errors+=d);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors || 'Startup timed out')),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
    async function request(path,{cookie,body,method=body?'POST':'GET'}={}) {const response=await fetch(origin+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {response,status:response.status,data:await response.json().catch(()=>({}))};}
    async function ok(path,options) {const r=await request(path,options);assert.ok(r.response.ok,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data;}
    async function login(username) {const r=await request('/api/login',{body:{username,password:'Demo@12345'}});assert.equal(r.status,200);return {cookie:r.response.headers.get('set-cookie').split(';')[0],user:r.data.user};}
    const {cookie:sales,user:salesUser}=await login('sales01'),{cookie:office}=await login('backoffice01'),{cookie:admin}=await login('admin01');
    await confirmTestReceiver(request,admin);
    const services=(await ok('/api/services',{cookie:sales})).services;
    assert.equal(services.length,16);
    const pdf=Buffer.from('%PDF-1.4\nSynthetic isolated lifecycle document\n%%EOF');
    let index=0;
    for(const service of services) for(const variant of service.variants) {
      await t.test(`${service.name} / ${variant.name}`,async()=>{
        const quoted=['passport','pf-assistance','ration-card'].includes(service.slug),details=detailsFor(variant);
        if(['food-license','caste-validity'].includes(service.slug)) await ok('/api/admin/pricing',{cookie:admin,body:{salesUserId:salesUser.id,variantId:variant.id,price:15000+index*1000}});
        const c=(await ok('/api/cases',{cookie:sales,body:{variantId:variant.id,details,customer:{name:'Synthetic Lifecycle Applicant',mobile:'9876543210'},consent:true}})).case,base='/api/cases/'+c.id;
        assert.equal((await request(base,{cookie:office})).status,403);
        const upload=docType=>ok(base+'/documents',{cookie:sales,body:{docType,fileName:'synthetic.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});
        for(const doc of variant.documents.filter(d=>d.required && IntakeRules.matches(d.when,details,true))) await upload(doc.label);
        assert.equal((await ok(base,{cookie:sales})).case.document_state,'complete');
        assert.equal((await request(base+'/claim',{cookie:office,body:{}})).status,409);
        assert.equal((await ok('/api/cases',{cookie:office})).cases.some(row=>row.id===c.id),false);
        if(quoted) {
          assert.equal(c.payment,undefined);
          await ok(base+'/submit-review',{cookie:sales,body:{}});
          assert.ok((await ok('/api/cases',{cookie:office})).cases.some(row=>row.id===c.id));
          await ok(base+'/remark',{cookie:office,body:{remark:'Synthetic isolated review: document corrections and urgency are included.'}});
          await ok(base+'/set-quote',{cookie:office,body:{amount:140000,reason:'Synthetic isolated quote: total includes the selected changes.'}});
        } else {
          assert.equal(c.quote,null);assert.ok(c.payment);
          assert.equal((await request(base+'/submit-review',{cookie:sales,body:{}})).status,409);
        }
        const order=await ok(base+'/payment-order',{cookie:sales,body:{}});
        if(quoted) assert.equal(order.amount,140000);
        if(['food-license','caste-validity'].includes(service.slug)) assert.equal(order.amount,15000+index*1000);
        await verifyTestOrder(request,admin,sales,order.id,String(810000000000+index++));
        assert.ok((await ok('/api/cases',{cookie:office})).cases.some(row=>row.id===c.id));
        await ok(base+'/claim',{cookie:office,body:{}});
        const first=variant.documents.find(d=>d.required && IntakeRules.matches(d.when,details,true));
        await ok(base+'/request-reupload',{cookie:office,body:{documentTypes:[first.label],reason:'Synthetic test: please replace this document.'}});
        await upload(first.label);await ok(base+'/submit-reupload',{cookie:sales,body:{}});
        for(const status of ['Ready to Submit','Submitted to Official Portal','Under Government Review','Document Received']) await ok(base+'/progress',{cookie:office,body:{status,note:'Synthetic isolated test; no government submission.'}});
        assert.equal((await request(base+'/submit-received-document',{cookie:office,body:{}})).status,400);
        await ok(base+'/documents',{cookie:office,body:{docType:'Received Document',fileName:'synthetic-result.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});
        const closed=(await ok(base+'/submit-received-document',{cookie:office,body:{}})).case;
        assert.equal(closed.status,'Closed');assert.ok(closed.received_document);
        const download=await fetch(origin+closed.received_document.download_url,{headers:{cookie:sales}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
        assert.equal((await fetch(origin+base+'/download-all',{headers:{cookie:office}})).status,200);
      });
    }
    assert.equal(index,22,'16 services plus 4 extra food durations and 2 extra validity purposes');
    await t.test('private payment simulation excludes synthetic cases from finance and Sheets',async()=>{
      const before=(await ok('/api/admin/dashboard?period=all',{cookie:admin})).metrics;
      const variant=services.find(s=>s.slug==='pan').variants[0];
      const clientRequestId=crypto.randomUUID(),caseId='case_'+clientRequestId;
      const payload={clientRequestId,variantId:variant.id,details:{},customer:{name:'Synthetic Acceptance Applicant',mobile:'9876543210'},consent:true};
      assert.equal((await request('/api/cases',{cookie:sales,body:{...payload,acceptanceTestToken:'invalid'}})).status,403);
      const c=(await ok('/api/cases',{cookie:sales,body:{...payload,acceptanceTestToken:acceptanceToken(caseId,'isolated-full-lifecycle-secret-32-characters')}})).case;
      assert.equal(c.syntheticTest,true);assert.equal(c.details._intakeAcceptanceTest,undefined);
      for(const d of variant.documents.filter(d=>d.required)) await ok('/api/cases/'+c.id+'/documents',{cookie:sales,body:{docType:d.label,fileName:'test.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}});
      const local=new DatabaseSync(join(root,'test.sqlite'));
      local.prepare("INSERT INTO payments VALUES (?,?,'acceptance_test',?,NULL,?, ?, ?, ?,'PAID',?,?)").run('test-receipt',c.id,'SYNTHETIC-ONLY',c.payment.amount,c.payment.service_charge,c.payment.official_fee,c.payment.tax,new Date().toISOString(),new Date().toISOString());
      await ok('/api/cases/'+c.id+'/finish-uploads',{cookie:sales,body:{}});
      assert.equal((await ok('/api/cases/'+c.id,{cookie:office})).case.payment_state,'paid');
      await ok('/api/cases/'+c.id+'/claim',{cookie:office,body:{}});
      const after=(await ok('/api/admin/dashboard?period=all',{cookie:admin})).metrics;
      assert.equal(after.collected,before.collected);assert.equal(after.newCases,before.newCases);
      assert.equal((await ok('/api/payments',{cookie:admin})).payments.some(p=>p.gateway==='acceptance_test'),false);
      assert.equal(local.prepare('SELECT COUNT(*) n FROM sync_jobs WHERE entity_id=?').get(c.id).n,0);
      assert.equal(local.prepare("SELECT COUNT(*) n FROM verified_upi_refs WHERE payment_id='test-receipt'").get().n,0);
      local.close();
    });
  } finally {child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));rmSync(root,{recursive:true,force:true});}
});
