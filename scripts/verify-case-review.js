// Explicit hosted acceptance test. Uses synthetic data and never sends money.
import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
if(existsSync('.env')) loadEnvFile('.env');
const origin=process.argv[2];
if(!origin || new URL(origin).protocol!=='https:' || !process.argv.includes('--create-test')) throw Error('Pass the hosted HTTPS origin and --create-test to authorize synthetic case creation.');
const created=[];
async function request(route,cookie,body,method=body?'POST':'GET') {
  const response=await fetch(origin+route,{method,headers:{'content-type':'application/json',origin,...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
  const data=await response.json().catch(()=>({}));return {response,status:response.status,data};
}
async function ok(route,cookie,body,method) {
  const r=await request(route,cookie,body,method);
  if(!r.response.ok) throw Error(`${route}: HTTP ${r.status}: ${r.data.error || 'Request failed'}`);
  return r.data;
}
async function login(role) {
  const username=process.env[`LIVE_TEST_${role}_USERNAME`] || process.env[`INITIAL_${role}_USERNAME`];
  const password=process.env[`LIVE_TEST_${role}_PASSWORD`] || process.env[`INITIAL_${role}_PASSWORD`];
  if(!username || !password) throw Error(`Configure private ${role} test credentials.`);
  const r=await request('/api/login',null,{username,password});
  if(!r.response.ok) throw Error(`${role} login failed: HTTP ${r.status}`);
  assert.equal(r.data.user.role,role.toLowerCase());return r.response.headers.get('set-cookie').split(';')[0];
}
function testPDF() {
  const text='Synthetic PF verification. No real customer data.';
  const stream=`BT /F1 12 Tf 40 740 Td (${text}) Tj ET`;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let content='%PDF-1.4\n',offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(content));content+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const start=Buffer.byteLength(content);
  content+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content);
}
let sales,admin,qaStaff;
try {
  await login('SALES');const office=await login('BACKOFFICE');admin=await login('ADMIN');
  const username='qa.preflight.'+randomUUID().slice(0,8),password=randomUUID()+'Aa!';
  qaStaff=(await ok('/api/admin/employees',admin,{name:'Synthetic Preflight Sales',username,password,role:'sales'})).employee;
  const signed=await request('/api/login',null,{username,password});assert.equal(signed.status,200);sales=signed.response.headers.get('set-cookie').split(';')[0];
  const initial=(await ok('/api/services',sales)).services;
  await ok('/api/admin/pricing',admin,{salesUserId:qaStaff.id,variantId:initial.find(s=>s.slug==='caste-validity').variants[0].id,price:15000});
  const {services}=await ok('/api/services',sales),pf=services.find(s=>s.slug==='pf-assistance').variants[0],pan=services.find(s=>s.slug==='caste-validity').variants[0];
  const pdf=testPDF(),manifest=pf.documents.filter(d=>d.required).map(doc=>({key:randomUUID(),docType:doc.label,fileName:'synthetic-verification.pdf',mimeType:'application/pdf',size:pdf.length}));
  const details={'UAN No':'123456789012',Password:'SyntheticPF!23','PF work required':'Update PF account details','PF profile updated?':'No'};
  const {case:c}=await ok('/api/cases',sales,{clientRequestId:randomUUID(),variantId:pf.id,customer:{name:'Synthetic Verification Client',mobile:'9876543210'},details,consent:true,uploadManifest:manifest});created.push(c.id);
  assert.equal(c.payment,undefined);assert.equal(c.amounts.total,0);
  assert.ok((await ok('/api/cases',sales)).cases.some(row=>row.id===c.id));
  for(const file of manifest) {
    const auth=await ok(`/api/cases/${c.id}/upload-url`,sales,file);
    const upload=await fetch(auth.uploadUrl,{method:'PUT',headers:{'content-type':'application/pdf'},body:pdf,signal:AbortSignal.timeout(45000)});
    assert.ok(upload.ok,'Signed cloud upload succeeds');
    await ok(`/api/cases/${c.id}/documents`,sales,{uploadId:auth.uploadId,uploadKey:file.key,deferMirrors:true});
  }
  await ok(`/api/cases/${c.id}/finish-uploads`,sales,{});
  await ok(`/api/cases/${c.id}/submit-review`,sales,{});
  assert.ok((await ok('/api/cases',office)).cases.some(row=>row.id===c.id));
  await ok(`/api/cases/${c.id}/remark`,office,{remark:'Synthetic test: the total covers the requested PF correction work. No actual service or transfer is being requested.'});
  const quote=await ok(`/api/cases/${c.id}/set-quote`,office,{amount:140000,reason:'Synthetic acceptance test only: PF correction assistance, total ₹1,400. No transfer required.'});
  assert.equal(quote.case.amounts.total,140000);
  const salesView=await ok(`/api/cases/${c.id}`,sales);
  assert.ok(salesView.notes.some(n=>n.next_action.includes('backoffice_remark')));
  const checkout=await ok(`/api/cases/${c.id}/payment-order`,sales,{});
  assert.equal(checkout.amount,140000);assert.equal(new URL(checkout.upiIntent).searchParams.get('am'),'1400.00');
  assert.equal((await request(`/api/cases/${c.id}/claim`,office,{})).status,409);
  const normalDetails=Object.fromEntries(pan.fields.filter(f=>f.type==='select').map(f=>[f.label,f.options[0]]));
  const {case:normal}=await ok('/api/cases',sales,{clientRequestId:randomUUID(),variantId:pan.id,customer:{name:'Synthetic Standard Client',mobile:'9876543210'},details:normalDetails,consent:true});created.push(normal.id);
  for(const doc of pan.documents.filter(d=>d.required)) {
    const auth=await ok(`/api/cases/${normal.id}/upload-url`,sales,{docType:doc.label,fileName:'synthetic-validity.pdf',mimeType:'application/pdf',size:pdf.length});
    assert.ok((await fetch(auth.uploadUrl,{method:'PUT',headers:{'content-type':'application/pdf'},body:pdf,signal:AbortSignal.timeout(45000)})).ok);
    await ok(`/api/cases/${normal.id}/documents`,sales,{uploadId:auth.uploadId,deferMirrors:true});
  }
  assert.equal((await ok(`/api/cases/${normal.id}`,sales)).case.document_state,'complete');
  const standardOrder=await ok(`/api/cases/${normal.id}/payment-order`,sales,{});
  assert.equal(standardOrder.amount,pan.amounts.total);
  assert.ok(normal.payment);assert.equal(normal.quote,null);
  assert.equal((await request(`/api/cases/${normal.id}`,office)).status,403);
  assert.equal((await ok('/api/cases',office)).cases.some(row=>row.id===normal.id),false);
  console.log(`PASS: ${c.ref} uploaded, visible to back office after submission, remarked, quoted, and payable at exactly ₹1,400. Caste Validity documents uploaded, standard checkout amount confirmed, and unpaid case hidden. No payment submitted or transferred.`);
} catch(error) {console.error(error.message);process.exitCode=1;}
finally {
  for(const caseId of created) {
    try {await ok('/api/cases/'+caseId,sales,undefined,'DELETE');console.log('Removed synthetic case from active lists.');}
    catch(error) {console.error('Synthetic case cleanup needs attention:',caseId,error.message);process.exitCode=1;}
  }
  if(qaStaff) {try {await ok('/api/admin/employees/'+qaStaff.id,admin,undefined,'DELETE');console.log('Removed temporary QA sales account.');} catch(error) {console.error('QA staff cleanup needs attention:',error.message);process.exitCode=1;}}
}
