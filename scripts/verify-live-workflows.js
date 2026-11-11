// Maintainer-only acceptance test. There is no HTTP payment-bypass endpoint.
// Synthetic receipts are temporary, excluded from finance, and never use a UTR.
import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createDatabase} from '../database.js';
import {acceptanceToken,isAcceptanceCase} from '../acceptance-tests.js';
import '../public/intake-rules.js';
if(existsSync('.env')) loadEnvFile('.env');
const origin=process.argv[2];
if(!origin || new URL(origin).protocol!=='https:' || !process.argv.includes('--create-test') || !process.argv.includes('--simulate-payments')) throw Error('Pass an HTTPS origin, --create-test and --simulate-payments to authorize this synthetic maintenance test.');
if(!process.env.SESSION_SECRET || !process.env.DATABASE_URL) throw Error('Private target database and server secret are required.');
const db=createDatabase(),created=[],staff=[],report={origin,started:new Date().toISOString(),flows:[],staff:[],cleanup:[],realMoneyTransferred:false};
let sales,admin,office,adminUser;
async function request(path,cookie,body,method=body?'POST':'GET') {
  const response=await fetch(origin+path,{method,headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  return {response,status:response.status,data:await response.json().catch(()=>({}))};
}
async function ok(path,cookie,body,method) {const r=await request(path,cookie,body,method);if(!r.response.ok) throw Error(`${path}: HTTP ${r.status}: ${r.data.error || 'Request failed'}`);return r.data;}
async function signIn(username,password) {const r=await request('/api/login',null,{username,password});assert.equal(r.status,200,'Configured verification login succeeds');return {cookie:r.response.headers.get('set-cookie').split(';')[0],user:r.data.user};}
async function roleLogin(role) {const prefix='LIVE_TEST_'+role;return signIn(process.env[prefix+'_USERNAME'] || process.env['INITIAL_'+role+'_USERNAME'],process.env[prefix+'_PASSWORD'] || process.env['INITIAL_'+role+'_PASSWORD']);}
function pdf() {
  const stream='BT /F1 12 Tf 40 740 Td (SYNTHETIC QA ONLY - no real customer or money) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content='%PDF-1.4\n',offsets=[];objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(content));content+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const start=Buffer.byteLength(content);return Buffer.from(content+`xref\n0 6\n0000000000 65535 f \n${offsets.map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
const document=pdf();
async function upload(caseId,docType,cookie,key) {
  const auth=await ok(`/api/cases/${caseId}/upload-url`,cookie,{docType,fileName:'synthetic-qa-only.pdf',mimeType:'application/pdf',size:document.length});
  assert.ok((await fetch(auth.uploadUrl,{method:'PUT',headers:{'content-type':'application/pdf'},body:document,signal:AbortSignal.timeout(45000)})).ok);
  await ok(`/api/cases/${caseId}/documents`,cookie,{uploadId:auth.uploadId,...(key?{uploadKey:key}:{}),deferMirrors:true});
}
async function simulatePayment(c) {
  assert.ok(created.includes(c.id));
  await db.transaction(async()=>{
    const row=await db.one('SELECT * FROM cases WHERE id=$id FOR UPDATE',{$id:c.id});
    assert.ok(isAcceptanceCase(row,process.env.SESSION_SECRET),'Only a signed synthetic case can receive a test receipt');
    const customer=await db.one('SELECT name FROM customers WHERE id=$id',{$id:row.customer_id});
    assert.equal(customer.name,'Synthetic Workflow Verification');
    const payment=await db.one("SELECT * FROM payments WHERE case_id=$id AND gateway='direct_upi' AND status='PENDING'",{$id:c.id});
    assert.ok(payment);assert.ok(payment.amount>0);
    const stamp=new Date().toISOString(),receipt='qa_'+randomUUID();
    await db.run("INSERT INTO payments VALUES ($id,$case,'acceptance_test',$order,NULL,$amount,$service,$fee,$tax,'PAID',$at,$at)",{$id:receipt,$case:c.id,$order:'SYNTHETIC-'+randomUUID(),$amount:payment.amount,$service:payment.service_charge,$fee:payment.official_fee,$tax:payment.tax,$at:stamp});
    await db.run("UPDATE cases SET payment_state='paid',status='Ready for Assignment',updated_at=$at WHERE id=$id",{$id:c.id,$at:stamp});
    await db.run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:'aud_'+randomUUID(),$actor:adminUser.id,$action:'acceptance.simulated_payment',$type:'case',$entity:c.id,$reason:'Explicit synthetic acceptance test. No transfer, cash receipt or bank reference. Temporary receipt excluded from finance and removed after verification.',$at:stamp});
  });
}
async function checkStaff(role) {
  const suffix=randomUUID().slice(0,8),password=randomUUID()+'Aa!',username='qa.'+role+'.'+suffix;
  const {employee}=await ok('/api/admin/employees',admin,{name:'Synthetic Staff Verification',username,password,role});staff.push(employee.id);
  const signed=await signIn(username,password),nextPassword=randomUUID()+'Bb!';
  const changed=await ok('/api/admin/employees/'+employee.id,admin,{name:'Updated Synthetic Staff',username:username+'.new',password:nextPassword},'PATCH');
  assert.equal(changed.employee.password_hash,undefined);
  assert.equal((await request('/api/me',signed.cookie)).status,401);
  const next=await signIn(username+'.new',nextPassword);
  await ok('/api/admin/employees/'+employee.id,admin,{active:0,password:''},'PATCH');
  assert.equal((await request('/api/me',next.cookie)).status,401);
  await ok('/api/admin/employees/'+employee.id,admin,{active:1},'PATCH');
  await signIn(username+'.new',nextPassword);
  await ok('/api/admin/employees/'+employee.id,admin,undefined,'DELETE');staff.splice(staff.indexOf(employee.id),1);
  assert.equal((await ok('/api/admin/employees',admin)).employees.some(e=>e.id===employee.id),false);
  report.staff.push({role,status:'passed',checks:['create','rename','change login','reset password','revoke session','deactivate','reactivate','delete']});
}
try {
  const a=await roleLogin('ADMIN');admin=a.cookie;adminUser=a.user;
  const configuredSales=await roleLogin('SALES');office=(await roleLogin('BACKOFFICE')).cookie;
  if(configuredSales.user.username==='7447707277') assert.equal(configuredSales.user.name,'Success Online Main Branch');
  const qaUsername='qa.workflows.'+randomUUID().slice(0,8),qaPassword=randomUUID()+'Aa!';
  const qaSales=(await ok('/api/admin/employees',admin,{name:'Synthetic Workflow Sales',username:qaUsername,password:qaPassword,role:'sales'})).employee;staff.push(qaSales.id);
  sales=(await signIn(qaUsername,qaPassword)).cookie;
  const initialServices=(await ok('/api/services',sales)).services;
  let configuredPrice=15000;
  for(const service of initialServices.filter(s=>['food-license','caste-validity'].includes(s.slug))) for(const variant of service.variants) {await ok('/api/admin/pricing',admin,{salesUserId:qaSales.id,variantId:variant.id,price:configuredPrice});configuredPrice+=10000;}
  report.pricingScope='Temporary QA sales account only; real service and staff prices unchanged';
  assert.equal(adminUser.role,'admin');
  const services=(await ok('/api/services',sales)).services;
  assert.equal(services.length,16);
  assert.deepEqual(services.find(s=>s.slug==='food-license').variants.map(v=>v.name).sort(),['1 year','2 years','3 years','4 years','5 years']);
  assert.deepEqual(services.find(s=>s.slug==='caste-validity').variants.map(v=>v.name).sort(),['Education','Election','Job']);
  await checkStaff('sales');await checkStaff('backoffice');
  for(const slug of ['caste-validity','pf-assistance','ration-card']) {
    const service=services.find(s=>s.slug===slug),variant=service.variants.find(v=>v.name==='Job') || service.variants[0];
    const quoted=slug!=='caste-validity',details=Object.fromEntries(variant.fields.filter(f=>f.type==='select' && (!f.optional || f.answerGroup)).map(f=>[f.label,f.options[0]]));
    if(slug==='pf-assistance') Object.assign(details,{'UAN No':'123456789012',Password:'SyntheticOnlyPF!23','PF work required':'Update PF account details','PF profile updated?':'No'});
    if(slug==='ration-card') Object.assign(details,{'Ration card request':'Changes to existing card','Add a member?':'Yes','Change ration card address?':'Yes','Ration card residence':'Rented','Is the ration card white?':'Yes'});
    const manifest=variant.documents.filter(d=>d.required && IntakeRules.matches(d.when,details,true)).map(d=>({key:randomUUID(),docType:d.label,fileName:'synthetic-qa-only.pdf',mimeType:'application/pdf',size:document.length}));
    const clientRequestId=randomUUID(),caseId='case_'+clientRequestId;
    const c=(await ok('/api/cases',sales,{clientRequestId,acceptanceTestToken:acceptanceToken(caseId,process.env.SESSION_SECRET),variantId:variant.id,details,customer:{name:'Synthetic Workflow Verification',mobile:'9876543210'},consent:true,uploadManifest:manifest})).case;created.push(c.id);
    const base='/api/cases/'+c.id,checks=[];
    assert.equal(c.syntheticTest,true);assert.equal((await request(base,office)).status,403);
    assert.ok((await ok('/api/cases',sales)).cases.some(row=>row.id===c.id));
    for(const file of manifest) await upload(c.id,file.docType,sales,file.key);
    await ok(base+'/finish-uploads',sales,{});
    assert.equal((await request(base,office)).status,403);checks.push('complete uploads; unpaid case hidden');
    if(quoted) {
      assert.equal(c.payment,undefined);
      await ok(base+'/submit-review',sales,{});
      assert.ok((await ok('/api/cases',office)).cases.some(row=>row.id===c.id));
      await ok(base+'/remark',office,{remark:'SYNTHETIC QA: pricing includes the requested correction and urgency. No actual service or payment.'});
      await ok(base+'/set-quote',office,{amount:140000,reason:'SYNTHETIC QA ONLY: test total is ₹1,400; no payment required.'});
      assert.ok((await ok(base,sales)).notes.some(n=>n.next_action.includes('backoffice_remark')));checks.push('review; remarks; quote delivered to sales');
    } else {assert.equal(c.quote,null);assert.ok(c.payment);assert.equal((await request(base+'/submit-review',sales,{})).status,409);}
    const checkout=await ok(base+'/payment-order',sales,{});
    assert.equal(checkout.amount,quoted?140000:variant.amounts.total);
    assert.equal(new URL(checkout.upiIntent).searchParams.get('am'),(checkout.amount/100).toFixed(2));checks.push('exact checkout amount');
    assert.equal((await request(base+'/claim',office,{})).status,409);
    await simulatePayment(c);
    assert.ok((await ok('/api/cases',office)).cases.some(row=>row.id===c.id));
    await ok(base+'/claim',office,{});
    const first=manifest[0];
    await ok(base+'/request-reupload',office,{documentTypes:[first.docType],reason:'SYNTHETIC QA: replace this test document.'});
    await upload(c.id,first.docType,sales);await ok(base+'/submit-reupload',sales,{});
    for(const status of ['Ready to Submit','Submitted to Official Portal','Under Government Review','Document Received']) await ok(base+'/progress',office,{status,note:'SYNTHETIC QA ONLY. No government submission, transfer or real customer.'});
    assert.equal((await request(base+'/submit-received-document',office,{})).status,400);
    await upload(c.id,'Received Document',office);
    const closed=(await ok(base+'/submit-received-document',office,{})).case;
    assert.equal(closed.status,'Closed');assert.ok(closed.received_document);
    const downloaded=await fetch(origin+closed.received_document.download_url,{headers:{cookie:sales},signal:AbortSignal.timeout(45000)});
    assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),document);
    const archive=await fetch(origin+base+'/download-all',{headers:{cookie:office},signal:AbortSignal.timeout(45000)});assert.equal(archive.status,200);assert.equal(Buffer.from(await archive.arrayBuffer()).readUInt32LE(),0x04034b50);
    checks.push('simulated payment; claim; correction; processing; final document; closure; sales download; ZIP');
    assert.equal((await db.one('SELECT COUNT(*) n FROM sync_jobs WHERE entity_id=$id',{$id:c.id})).n,0);
    assert.equal((await db.one('SELECT COUNT(*) n FROM verified_upi_refs WHERE payment_id IN (SELECT id FROM payments WHERE case_id=$id)',{$id:c.id})).n,0);
    assert.equal((await ok('/api/payments',admin)).payments.some(p=>p.gateway==='acceptance_test'),false);
    checks.push('no financial/Sheets posting; no bank reference');
    report.flows.push({service:slug,variant:variant.name,ref:c.ref,amount:checkout.amount,status:'passed',checks});
    console.log('PASS:',service.name,variant.name,c.ref,'through closure and document download.');
  }
} catch(error) {report.error=error.message;console.error(error.message);process.exitCode=1;}
finally {
  for(const caseId of created) {
    try {
      await db.transaction(async()=>{
        const c=await db.one('SELECT * FROM cases WHERE id=$id FOR UPDATE',{$id:caseId});
        assert.ok(isAcceptanceCase(c,process.env.SESSION_SECRET));
        await db.run("DELETE FROM payments WHERE case_id=$id AND gateway='acceptance_test'",{$id:caseId});
        await db.run("UPDATE cases SET payment_state='unpaid',status='Awaiting Payment',backoffice_user_id=NULL,completed_at=NULL WHERE id=$id",{$id:caseId});
      });
      await ok('/api/cases/'+caseId,sales,undefined,'DELETE');
      report.cleanup.push({caseId,status:'removed from active lists; temporary receipt deleted'});
    } catch(error) {report.cleanup.push({caseId,error:error.message});console.error('Cleanup requires attention:',caseId,error.message);process.exitCode=1;}
  }
  for(const employeeId of staff) try {await ok('/api/admin/employees/'+employeeId,admin,undefined,'DELETE');}catch(error){console.error('Staff cleanup requires attention:',employeeId,error.message);process.exitCode=1;}
  await db.close();report.finished=new Date().toISOString();
  mkdirSync('deliverables',{recursive:true});const file='deliverables/live-workflow-verification-'+Date.now()+'.json';writeFileSync(file,JSON.stringify(report,null,2));console.log('Verification report:',file);
}
