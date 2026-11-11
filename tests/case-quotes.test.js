import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {confirmTestReceiver,verifyTestOrder} from './payment-fixture.js';
import {pfDetails} from './pf-fixture.js';
import {updateMainBranch} from '../branch-account.js';
import {cashAccount,CASH_SALES_ID} from '../cash-payments.js';
import '../public/intake-rules.js';

test('review before payment, exact quotes, independent option pricing, and one-time branch rename',{timeout:60000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'case-quotes-')),path=join(root,'test.sqlite'),port=34000+Math.floor(Math.random()*8000),origin=`http://localhost:${port}`;
  const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),DATABASE_PATH:path,STORAGE_PATH:join(root,'files'),SHEETS_MODE:'demo',TEST_PRICING_MODE:'true',SESSION_SECRET:'case-quote-test-secret-32-characters',APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',d=>errors+=d);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
    async function request(route,{cookie,body,method=body?'POST':'GET'}={}) {const r=await fetch(origin+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),response:r};}
    async function login(username,password='Demo@12345') {const r=await request('/api/login',{body:{username,password}});assert.equal(r.status,200);return r.response.headers.get('set-cookie').split(';')[0];}
    const sales=await login('sales01'),other=await login('sales02'),office=await login('backoffice01'),admin=await login('admin01');
    await confirmTestReceiver(request,admin);
    const services=(await request('/api/services',{cookie:sales})).data.services;
    const pdf=Buffer.from('%PDF-1.4\nquote fixture\n%%EOF');
    const pan=services.find(s=>s.slug==='pan').variants[0];
    for(const role of ['sales','backoffice']) {
      const made=await request('/api/admin/employees',{cookie:admin,body:{name:'Managed Employee',username:'managed.'+role,role,password:'SyntheticStaff!23'}});
      assert.equal(made.status,201);const staff=made.data.employee,route='/api/admin/employees/'+staff.id;
      let staffCookie=await login(staff.username,'SyntheticStaff!23');
      for(const cookie of [sales,office]) {
        assert.equal((await request(route,{cookie,method:'PATCH',body:{name:'Tampered'}})).status,403);
        assert.equal((await request(route,{cookie,method:'DELETE'})).status,403);
      }
      assert.equal((await request(route,{cookie:admin,method:'PATCH',body:{username:'sales01'}})).status,409);
      assert.equal((await request(route,{cookie:admin,method:'PATCH',body:{password:'short'}})).status,400);
      const updated=await request(route,{cookie:admin,method:'PATCH',body:{name:'Renamed Employee',username:'updated.'+role,password:'UpdatedStaff!23'}});
      assert.equal(updated.status,200);assert.equal(updated.data.employee.password_hash,undefined);
      assert.equal((await request('/api/me',{cookie:staffCookie})).status,401,'Existing staff session revoked');
      staffCookie=await login('updated.'+role,'UpdatedStaff!23');
      assert.equal((await request(route,{cookie:admin,method:'PATCH',body:{active:0,password:''}})).status,200);
      assert.equal((await request('/api/me',{cookie:staffCookie})).status,401);
      assert.equal((await request(route,{cookie:admin,method:'PATCH',body:{active:1}})).status,200);
      staffCookie=await login('updated.'+role,'UpdatedStaff!23');
      let retainedCase;
      if(role==='sales') retainedCase=(await request('/api/cases',{cookie:staffCookie,body:{variantId:pan.id,details:{},customer:{name:'Retained Client',mobile:'9876543210'},consent:true}})).data.case;
      assert.equal((await request(route,{cookie:admin,method:'DELETE'})).status,200);
      assert.equal((await request('/api/me',{cookie:staffCookie})).status,401);
      assert.equal((await request('/api/admin/employees',{cookie:admin})).data.employees.some(e=>e.id===staff.id),false);
      assert.equal((await request(route,{cookie:admin,method:'PATCH',body:{active:1}})).status,410);
      if(retainedCase) {const check=new DatabaseSync(path);assert.equal(check.prepare('SELECT sales_user_id FROM cases WHERE id=?').get(retainedCase.id).sales_user_id,staff.id);check.close();}
    }
    const adminId=(await request('/api/me',{cookie:admin})).data.user.id;
    assert.equal((await request('/api/admin/employees/'+adminId,{cookie:admin,method:'DELETE'})).status,404);
    const ordinary=(await request('/api/cases',{cookie:sales,body:{variantId:pan.id,details:{},customer:{name:'Ordinary Client',mobile:'9876543210'},consent:true}})).data.case;
    assert.equal(ordinary.quote,null);assert.ok(ordinary.payment);
    assert.equal((await request('/api/cases/'+ordinary.id,{cookie:office})).status,403);
    assert.equal((await request('/api/cases/'+ordinary.id+'/submit-review',{cookie:sales,body:{}})).status,409);
    for(const d of pan.documents.filter(d=>d.required)) assert.equal((await request('/api/cases/'+ordinary.id+'/documents',{cookie:sales,body:{docType:d.label,fileName:'proof.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}})).status,201);
    const ordinaryDoc=(await request('/api/cases/'+ordinary.id,{cookie:sales})).data.documents[0];
    assert.equal((await request(ordinaryDoc.download_url.replace('/download','/preview'),{cookie:office})).status,403);
    assert.equal((await request('/api/cases',{cookie:office})).data.cases.some(c=>c.id===ordinary.id),false);
    await verifyTestOrder(request,admin,sales,ordinary.payment.id,'345678901220');
    assert.equal((await request('/api/cases',{cookie:office})).data.cases.some(c=>c.id===ordinary.id),true);
    assert.equal((await request('/api/cases/'+ordinary.id,{cookie:office})).status,200);
    const releasedEmployee=(await request('/api/admin/employees',{cookie:admin,body:{name:'Temporary Work Owner',username:'release.office',role:'backoffice',password:'SyntheticStaff!23'}})).data.employee;
    const handoffDb=new DatabaseSync(path);
    handoffDb.prepare("UPDATE cases SET backoffice_user_id=?,status='Under Government Review' WHERE id=?").run(releasedEmployee.id,ordinary.id);handoffDb.close();
    assert.equal((await request('/api/admin/employees/'+releasedEmployee.id,{cookie:admin,method:'DELETE'})).status,200);
    const released=(await request('/api/cases/'+ordinary.id,{cookie:office})).data.case;
    assert.equal(released.backoffice,undefined);assert.equal(released.status,'Under Government Review');
    const reclaimed=await request('/api/cases/'+ordinary.id+'/claim',{cookie:office,body:{}});
    assert.equal(reclaimed.status,200);assert.equal(reclaimed.data.case.status,'Under Government Review');
    const pf=services.find(s=>s.slug==='pf-assistance').variants[0];
    const manifest=pf.documents.filter(d=>d.required).map((d,i)=>({key:'test-slot-'+i,docType:d.label,fileName:'proof.pdf',mimeType:'application/pdf',size:pdf.length}));
    const recovering=(await request('/api/cases',{cookie:sales,body:{variantId:pf.id,details:pfDetails,customer:{name:'Recover Client',mobile:'9876543210'},consent:true,uploadManifest:manifest}})).data.case;
    assert.equal(recovering.pendingUploads.length,manifest.length);
    assert.ok((await request('/api/cases',{cookie:sales})).data.cases.some(c=>c.id===recovering.id));
    for(const file of manifest) {
      const slot=await request('/api/cases/'+recovering.id+'/resume-upload',{cookie:sales,body:{key:file.key,fileName:'replacement.pdf',mimeType:file.mimeType,size:file.size}});
      assert.equal(slot.status,200,JSON.stringify(slot.data));
      assert.equal((await request('/api/cases/'+recovering.id+'/documents',{cookie:sales,body:{docType:file.docType,fileName:'replacement.pdf',mimeType:file.mimeType,size:file.size,uploadKey:slot.data.file.key,content:pdf.toString('base64')}})).status,201);
    }
    assert.equal((await request('/api/cases/'+recovering.id+'/finish-uploads',{cookie:sales,body:{}})).status,200);
    assert.equal((await request('/api/cases/'+recovering.id+'/submit-review',{cookie:sales,body:{}})).status,200);
    let utr=345678901230;
    for(const slug of ['passport','pf-assistance','ration-card']) {
      const service=services.find(s=>s.slug===slug),v=service.variants[0];
      assert.equal(v.amounts.total,0);
      const details=Object.fromEntries(v.fields.filter(f=>f.type==='select').map(f=>[f.label,f.options[0]]));
      if(slug==='pf-assistance') Object.assign(details,pfDetails);
      if(slug==='passport') Object.assign(details,{Mobile:'9876543210',Email:'passport@example.com','Birth place':'Kolhapur','Police station':'Shahupuri','Emergency number':'9876543211','Mother name':'Test Mother','Father name':'Test Father',Education:'Graduate','Name change or correction?':'No'});
      const created=await request('/api/cases',{cookie:sales,body:{variantId:v.id,details,customer:{name:'Quote Client',mobile:'9876543210'},consent:true}});
      assert.equal(created.status,201,JSON.stringify(created.data));const c=created.data.case,base='/api/cases/'+c.id;
      assert.equal(c.payment,undefined);assert.equal(c.amounts.total,0);
      assert.equal((await request(base+'/payment-order',{cookie:sales,method:'POST'})).status,409);
      assert.equal((await request(base+'/submit-review',{cookie:sales,body:{}})).status,409);
      assert.ok(!(await request('/api/cases',{cookie:office})).data.cases.some(row=>row.id===c.id));
      for(const d of v.documents.filter(d=>d.required && IntakeRules.matches(d.when,details,true))) {
        assert.equal((await request(base+'/documents',{cookie:sales,body:{docType:d.label,fileName:'proof.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}})).status,201,d.label);
      }
      assert.equal((await request(base+'/set-quote',{cookie:office,body:{amount:140000,reason:'Reviewed'}})).status,409);
      assert.equal((await request(base+'/submit-review',{cookie:other,body:{}})).status,403);
      assert.equal((await request(base+'/submit-review',{cookie:sales,body:{}})).data.case.status,'Awaiting Back Office Review');
      for(const cookie of [office,admin]) {
        assert.ok((await request('/api/cases',{cookie})).data.cases.some(row=>row.id===c.id));
        assert.equal((await request(base,{cookie})).status,200);
      }
      assert.equal((await request(base+'/remark',{cookie:sales,body:{remark:'Tampered'}})).status,403);
      assert.equal((await request(base+'/remark',{cookie:office,body:{remark:'Urgent processing and correction charges will be included.'}})).status,200);
      const remarks=(await request(base,{cookie:sales})).data.notes.filter(n=>n.next_action.includes('backoffice_remark'));
      assert.equal(remarks.length,1);assert.match(remarks[0].note,/Urgent processing/);
      assert.equal((await request(base+'/claim',{cookie:office,body:{}})).status,409);
      if(slug==='ration-card') {
        const doc=v.documents.find(d=>d.required && IntakeRules.matches(d.when,details,true));
        assert.equal((await request(base+'/request-reupload',{cookie:office,body:{documentTypes:[doc.label],reason:'Please upload a clearer copy.'}})).status,200);
        assert.equal((await request(base+'/set-quote',{cookie:office,body:{amount:140000,reason:'Premature'}})).status,409);
        assert.equal((await request(base+'/documents',{cookie:sales,body:{docType:doc.label,fileName:'clear.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')}})).status,201);
        assert.equal((await request(base+'/submit-reupload',{cookie:sales,body:{}})).data.case.status,'Awaiting Back Office Review');
      }
      assert.equal((await request(base+'/set-quote',{cookie:sales,body:{amount:1,reason:'Tampered'}})).status,403);
      for(const amount of [0,-1,1.5,'140000']) assert.equal((await request(base+'/set-quote',{cookie:office,body:{amount,reason:'Reviewed'}})).status,400);
      const quoted=await request(base+'/set-quote',{cookie:office,body:{amount:140000,reason:'Documents reviewed; total including the requested changes.'}});
      assert.equal(quoted.status,200,JSON.stringify(quoted.data));assert.equal(quoted.data.case.amounts.total,140000);assert.equal(quoted.data.case.payment.amount,140000);
      assert.equal((await request(base+'/set-quote',{cookie:admin,body:{amount:150000,reason:'Replace'}})).status,409);
      const order=(await request(base+'/payment-order',{cookie:sales,body:{}})).data;
      assert.equal(order.id,quoted.data.case.payment.id);assert.equal(new URL(order.upiIntent).searchParams.get('am'),'1400.00');
      const db=new DatabaseSync(path);
      db.prepare('UPDATE upi_orders SET expires_at=? WHERE payment_id=?').run('2000-01-01',order.id);db.close();
      const reopened=(await request(base+'/payment-order',{cookie:sales,body:{}})).data;
      assert.equal(reopened.amount,140000);assert.notEqual(reopened.id,order.id);
      assert.ok((await request('/api/cases',{cookie:office})).data.cases.some(row=>row.id===c.id));
      await verifyTestOrder(request,admin,sales,reopened.id,String(utr++));
      assert.equal((await request(base,{cookie:sales})).data.case.status,'Ready for Assignment');
      assert.equal((await request(base+'/claim',{cookie:office,body:{}})).status,200);
    }
    for(const [slug,names] of [['food-license',['1 year','2 years','3 years','4 years','5 years']],['caste-validity',['Job','Education','Election']]]) {
      const service=services.find(s=>s.slug===slug);assert.deepEqual(service.variants.map(v=>v.name).sort(),names.sort());
      let price=15000;
      for(const v of service.variants) {
        const db=new DatabaseSync(path),salesId=db.prepare("SELECT id FROM users WHERE username='sales01'").get().id;db.close();
        assert.equal((await request('/api/admin/pricing',{cookie:admin,body:{salesUserId:salesId,variantId:v.id,price}})).status,200);
        const details=Object.fromEntries(v.fields.filter(f=>f.type==='select').map(f=>[f.label,f.options[0]]));
        if(slug==='food-license') Object.assign(details,{'Shop name':'Food Shop','Business email':'food@example.com','Shop address':'Kolhapur','Business type':'Restaurant','Business mobile number':'9876543210','Owner / partner names':'Asha Patil','Business investment':'100000','GST registered?':'No'});
        const r=await request('/api/cases',{cookie:sales,body:{variantId:v.id,details,customer:{name:'Option Client',mobile:'9876543210'},consent:true}});
        assert.equal(r.status,201,JSON.stringify(r.data));assert.equal(r.data.case.payment.amount,price);price+=10000;
        const fixed=v.fields.find(f=>f.options?.length===1);
        assert.equal((await request('/api/cases',{cookie:sales,body:{variantId:v.id,details:{...details,[fixed.label]:'Wrong option'},customer:{name:'Option Client',mobile:'9876543210'},consent:true}})).status,400);
      }
    }
    const sqlite=new DatabaseSync(path);
    sqlite.prepare("UPDATE users SET id=?,name='Mahalaxmi Online Services',username='7028405101' WHERE username='sales02'").run(CASH_SALES_ID);
    const db={one:async(sql,p)=>sqlite.prepare(sql).get(p),all:async(sql,p)=>sqlite.prepare(sql).all(p),run:async(sql,p)=>sqlite.prepare(sql).run(p)};
    assert.equal(await updateMainBranch(db,'SyntheticBranch!23'),true);
    assert.equal(await updateMainBranch(db,'DifferentPassword!23'),false);
    const branch=sqlite.prepare('SELECT * FROM users WHERE id=?').get(CASH_SALES_ID);assert.equal(branch.name,'Success Online Main Branch');assert.ok(cashAccount(branch));sqlite.close();
    await login('7447707277','SyntheticBranch!23');
    assert.equal((await request('/api/login',{body:{username:'7028405101',password:'Demo@12345'}})).status,401);
  } finally {child.kill();}
});
