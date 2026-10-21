import {confirmTestReceiver,verifyTestOrder,confirmations} from './payment-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {rootCertificates} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import pg from 'pg';
import {postgresQuery,postgresConnectionOptions} from '../database.js';
import {downloadFileLimit,writeStorage} from '../storage.js';

test('cloud ZIP size limit defaults to 50 MB and rejects oversized output before uploading', async () => {
  const previous=process.env.SUPABASE_DOWNLOAD_MAX_BYTES;
  try {
    delete process.env.SUPABASE_DOWNLOAD_MAX_BYTES;
    assert.equal(downloadFileLimit(),50000000);
    await assert.rejects(writeStorage('downloads/test/case.zip',{length:50000001},'application/zip'),error=>error.status===413);
    process.env.SUPABASE_DOWNLOAD_MAX_BYTES='invalid';
    assert.throws(downloadFileLimit,/integer/);
  } finally {if(previous===undefined) delete process.env.SUPABASE_DOWNLOAD_MAX_BYTES;else process.env.SUPABASE_DOWNLOAD_MAX_BYTES=previous;}
});

test('PostgreSQL retains the trusted CA and verification despite URL SSL parameters', () => {
  const ca = rootCertificates[0];
  const options = postgresConnectionOptions({DATABASE_URL:'postgresql://test:test@db.example.com/postgres?sslmode=require',DATABASE_CA_CERT:ca.replace(/\n/g,'\\n')});
  const parsed = new pg.Client(options).connectionParameters;
  assert.equal(parsed.ssl.rejectUnauthorized,true);
  assert.equal(parsed.ssl.ca,ca);
  assert.ok(!options.connectionString.includes('sslmode'));
  assert.throws(()=>postgresConnectionOptions({DATABASE_URL:'postgresql://test:test@db.example.com/postgres',DATABASE_SSL:'disable'}),/local PostgreSQL/);
});

test('PostgreSQL accepts downloaded PEM or DER CA files and reports missing certificates clearly', () => {
  const root = mkdtempSync(join(tmpdir(),'success-online-ca-'));
  const ca = new X509Certificate(rootCertificates[0]);
  for (const [name,content] of [['root.crt',ca.toString()],['root.cer',ca.raw]]) {
    const path = join(root,name);writeFileSync(path,content);
    const options = postgresConnectionOptions({DATABASE_URL:'postgresql://test:test@db.example.com/postgres',DATABASE_CA_CERT_PATH:path});
    assert.equal(new X509Certificate(options.ssl.ca).fingerprint256,ca.fingerprint256);
  }
  assert.throws(()=>postgresConnectionOptions({DATABASE_URL:'postgresql://test:test@db.example.com/postgres',DATABASE_CA_CERT_PATH:join(root,'missing.crt')}),/file not found/);
});

test('PostgreSQL bindings preserve literals and reuse named parameter positions', () => {
  const compiled = postgresQuery("SELECT '$value',username FROM users WHERE username=$value OR name=$value",{$value:'test'});
  assert.equal(compiled.text,"SELECT '$value',username FROM users WHERE username=$1 OR name=$1");
  assert.deepEqual(compiled.values,['test']);
});

test('PostgreSQL API and signed cloud uploads: access, large files, retries, analytics and completion', {timeout:60000}, async () => {
  const port = 22000 + Math.floor(Math.random()*5000)*2, origin = `http://localhost:${port}`;
  const child = spawn(process.execPath,['tests/postgres-server.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),APP_ORIGIN:origin,VERCEL:'1',DATABASE_URL:'postgresql://test:test@localhost/test',INITIAL_ADMIN_USERNAME:'admin',INITIAL_ADMIN_PASSWORD:'AdminPassword123',SESSION_SECRET:'cloud-test-private-session-secret-12345',DRIVE_MODE:'live',SHEETS_MODE:'demo',PAYMENT_MODE:'demo',TEST_GOOGLE_REVOKED:'1',TEST_GOOGLE_DELAY_MS:'2000',GOOGLE_OAUTH_CLIENT_ID:'mock',GOOGLE_OAUTH_CLIENT_SECRET:'mock',GOOGLE_OAUTH_REFRESH_TOKEN:'mock',GOOGLE_ROOT_FOLDER_ID:'root'},stdio:['ignore','pipe','pipe']});
  let output = '';
  child.stderr.on('data',chunk => output += chunk);
  try {
    await new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Postgres startup timed out: '+output)),20000);
      child.stdout.on('data',data => {if (String(data).includes('running')) {clearTimeout(timer);resolve();}});
      child.on('exit',code => {clearTimeout(timer);reject(new Error(`Postgres server exited ${code}: ${output}`));});
    });
    async function request(path,{cookie,body,method=body?'POST':'GET'}={}) {
      const response = await fetch(origin+path,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined,redirect:'manual'});
      return {status:response.status,data:await response.json().catch(()=>({})),response};
    }
    const login = await request('/api/login',{body:{username:'admin',password:'AdminPassword123'}});
    assert.equal(login.status,200);
    const admin = login.response.headers.get('set-cookie').split(';')[0];
    await confirmTestReceiver(request,admin);
    const accounts = {};
    for (const role of ['sales','backoffice']) {
      const created = await request('/api/admin/employees',{cookie:admin,body:{name:role,username:role,role,password:'EmployeePassword123'}});
      assert.equal(created.status,201,JSON.stringify(created.data));
      const signed = await request('/api/login',{body:{username:role,password:'EmployeePassword123'}});
      accounts[role] = signed.response.headers.get('set-cookie').split(';')[0];
    }
    const {services,cloudUploads} = (await request('/api/services',{cookie:accounts.sales})).data;
    assert.equal(cloudUploads,true);
    const variant = services.find(s=>s.slug==='income-certificate').variants[0];
    const payload = {variantId:variant.id,customer:{name:'Cloud Trial',mobile:'9876543210'},details:{'Years of Certificate Required':'1 year','Reason for application':'Banking','Ration card colour':'Yellow','Ration card area':'City'},consent:true};
    const created = await request('/api/cases',{cookie:accounts.sales,body:payload});
    assert.equal(created.status,201,JSON.stringify(created.data));
    const path = '/api/cases/'+created.data.case.id;
    const concurrent = await Promise.all(Array.from({length:3},()=>request('/api/cases',{cookie:accounts.sales,body:payload})));
    assert.equal(new Set([created,...concurrent].map(r=>r.data.case.ref)).size,4);
    const pdf = Buffer.alloc(5000000,32);pdf.write('%PDF-1.4\n');
    async function upload(type,content=pdf,cookie=accounts.sales) {
      const authorization = await request(path+'/upload-url',{cookie,body:{docType:type,fileName:'large.pdf',mimeType:'application/pdf',size:content.length}});
      assert.equal(authorization.status,201,JSON.stringify(authorization.data));
      const transferred = await fetch(authorization.data.uploadUrl,{method:'PUT',headers:{'content-type':'application/pdf'},body:content});
      assert.equal(transferred.status,200);
      const started=performance.now();
      const result = await request(path+'/documents',{cookie,body:{uploadId:authorization.data.uploadId}});
      return {result,uploadId:authorization.data.uploadId,elapsed:performance.now()-started};
    }
    const first = await upload('Aadhaar Card');assert.equal(first.result.status,201,JSON.stringify(first.result.data));
    assert.ok(first.elapsed<1500,`Upload must return before the delayed Google mirror (${first.elapsed} ms)`);
    const stats=await (await fetch(`http://localhost:${port+1}/test/storage-stats`)).json();
    assert.equal(stats.uploadWrites,1);assert.equal(stats.copyWrites,0,'The signed upload must not be copied into storage a second time');
    const storedDocument=(await request(path,{cookie:accounts.backoffice})).data.documents[0];
    const preview=await request(`/api/documents/${storedDocument.id}/preview`,{cookie:accounts.backoffice});
    assert.equal(preview.status,200);
    assert.equal(preview.data.mimeType,'application/pdf');
    assert.equal(new URL(preview.data.url).searchParams.has('download'),false,'Preview uses an inline signed URL');
    const previewContent=await fetch(preview.data.url);
    assert.equal(previewContent.status,200);
    assert.deepEqual(Buffer.from(await previewContent.arrayBuffer()),pdf);
    assert.equal((await request(`/api/documents/${storedDocument.id}/preview`,{cookie:accounts.sales})).status,200);
    const checkoutStarted=performance.now();
    assert.equal((await request(path+'/payment-order',{cookie:accounts.sales,method:'POST'})).status,201);
    assert.ok(performance.now()-checkoutStarted<1500,'Checkout must not wait on the in-flight Google mirror');
    assert.equal(first.result.data.googleSyncPending,true,'An expired optional Google mirror must not fail the Supabase upload');
    const reconnectDeadline=Date.now()+5000;
    while(!(await request('/api/google/status',{cookie:admin})).data.reconnectRequired && Date.now()<reconnectDeadline) await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal((await request('/api/google/status',{cookie:admin})).data.reconnectRequired,true);
    const retry = await request(path+'/documents',{cookie:accounts.sales,body:{uploadId:first.uploadId}});assert.equal(retry.status,200);
    const bad = await upload('Photo',Buffer.from('not a pdf'));
    assert.equal(bad.result.status,400);
    // A new valid upload supersedes a failed intent of the same type.
    for (const type of ['Photo','Ration Card']) assert.equal((await upload(type)).result.status,201);
    const detail = await request(path,{cookie:accounts.sales});
    assert.equal(detail.data.documents.length,3);
    const doc = detail.data.documents[0];
    const download = await request(doc.download_url,{cookie:accounts.backoffice});
    assert.equal(download.status,302);
    assert.ok(download.response.headers.get('location').includes('token=download-token'));
    const zip = await request(path+'/download-all',{cookie:accounts.backoffice});assert.equal(zip.status,302);
    const zipped = await fetch(zip.response.headers.get('location'));assert.equal(Buffer.from(await zipped.arrayBuffer()).readUInt32LE(),0x04034b50);
    const order = await request(path+'/payment-order',{cookie:accounts.sales,method:'POST'});
    assert.equal(order.status,201,JSON.stringify(order.data));
    assert.equal((await request(path+'/verify-payment',{cookie:accounts.sales,body:{orderId:order.data.orderId}})).status,403);
    await verifyTestOrder(request,admin,accounts.sales,order.data.id);
    const repeated=await Promise.all(Array.from({length:2},()=>request('/api/payments/'+order.data.id+'/verify',{cookie:admin,body:confirmations})));
    assert.deepEqual(repeated.map(r=>r.status),[200,200]);
    const duplicates=concurrent.slice(1).map(r=>r.data.case.payment.id);
    for(const pid of duplicates) assert.equal((await request('/api/payments/'+pid+'/submit',{cookie:accounts.sales,body:{utr:'222222222222'}})).status,200);
    const duplicateResults=await Promise.all(duplicates.map(pid=>request('/api/payments/'+pid+'/verify',{cookie:admin,body:confirmations})));
    assert.deepEqual(duplicateResults.map(r=>r.status).sort(),[200,409],'Database uniqueness arbitrates competing UTR verification');
    assert.equal((await request(path+'/claim',{cookie:accounts.backoffice,method:'POST'})).status,200);
    const reuploadRequest=await request(path+'/request-reupload',{cookie:accounts.backoffice,body:{documentTypes:['Ration Card'],reason:'Replace the unclear card scan'}});
    assert.equal(reuploadRequest.status,200);
    assert.deepEqual(reuploadRequest.data.case.reupload.missingTypes,['Ration Card']);
    assert.equal((await request(path+'/submit-reupload',{cookie:accounts.sales,body:{}})).status,400);
    assert.equal((await upload('Ration Card')).result.status,201);
    const corrected=await request(path+'/submit-reupload',{cookie:accounts.sales,body:{}});
    assert.equal(corrected.status,200,JSON.stringify(corrected.data));
    assert.equal(corrected.data.case.status,'Document Review');
    assert.equal(corrected.data.case.reupload.submittedDocumentIds.length,1);
    assert.deepEqual((await request(path,{cookie:accounts.backoffice})).data.case.reupload.submittedDocumentIds,corrected.data.case.reupload.submittedDocumentIds);
    for (const status of ['Ready to Submit','Submitted to Official Portal','Document Received']) assert.equal((await request(path+'/progress',{cookie:accounts.backoffice,body:{status}})).status,200);
    assert.equal((await upload('Received Document',pdf,accounts.backoffice)).result.status,201);
    assert.equal((await request(path+'/submit-received-document',{cookie:accounts.backoffice,method:'POST'})).status,200);
    const completedNotice = (await request('/api/notifications',{cookie:accounts.sales})).data.notifications.find(notice=>notice.caseId===created.data.case.id && notice.status==='Closed');
    assert.ok(completedNotice,'Sales receives the back-office completion update');
    assert.equal((await request('/api/notifications/read',{cookie:accounts.sales,body:{ids:[completedNotice.id]}})).status,200);
    assert.equal((await request('/api/notifications',{cookie:accounts.sales})).data.notifications.some(notice=>notice.id===completedNotice.id),false);
    for (const period of ['week','month','quarter','year','all']) {
      const dashboard = await request('/api/admin/dashboard?period='+period,{cookie:admin});
      assert.equal(dashboard.status,200,JSON.stringify(dashboard.data)+' '+output);
      assert.equal(typeof dashboard.data.metrics.collected,'number');
    }
    assert.equal((await request('/api/admin/employees?period=all',{cookie:admin})).status,200);
    assert.equal((await request('/api/admin/employees',{cookie:accounts.sales})).status,403);
    const batchCases=await Promise.all(Array.from({length:2},()=>request('/api/cases',{cookie:accounts.sales,body:payload})));
    const combined=await request('/api/payments/batch',{cookie:accounts.sales,body:{caseIds:batchCases.map(r=>r.data.case.id)}});
    assert.equal(combined.status,201,JSON.stringify(combined.data));
    assert.equal(combined.data.amount,40000);
    const batchPath='/api/payments/'+combined.data.id;
    assert.equal((await request(batchPath+'/submit',{cookie:accounts.sales,body:{utr:'444444444444'}})).status,200);
    const batchConfirmations=await Promise.all(Array.from({length:2},()=>request(batchPath+'/verify',{cookie:admin,body:{}})));
    assert.deepEqual(batchConfirmations.map(r=>r.status),[200,200],'Concurrent combined verification is idempotent in PostgreSQL');
    assert.equal((await request(batchPath+'/receipt',{cookie:admin})).data.items.length,2);
    const reportPath='/api/cases/'+concurrent[0].data.case.id;
    const photo=Buffer.from([255,216,255,224,1]);
    const pageUploads=await Promise.all(Array.from({length:4},(_,index)=>request(reportPath+'/upload-url',{cookie:accounts.sales,body:{docType:'Talathi Report',fileName:`page-${index+1}.jpg`,mimeType:'image/jpeg',size:photo.length}})));
    for(const authorization of pageUploads) {
      assert.equal(authorization.status,201);
      assert.equal((await fetch(authorization.data.uploadUrl,{method:'PUT',headers:{'content-type':'image/jpeg'},body:photo})).status,200);
      const finalized=await request(reportPath+'/documents',{cookie:accounts.sales,body:{uploadId:authorization.data.uploadId,deferMirrors:true}});
      assert.equal(finalized.status,201,JSON.stringify(finalized.data));
    }
    const reportPages=(await request(reportPath,{cookie:accounts.sales})).data.documents.filter(doc=>doc.doc_type==='Talathi Report' && doc.state==='uploaded');
    assert.equal(reportPages.length,4,'Every signed report-page upload stays active');
    assert.equal(new Set(reportPages.map(doc=>doc.file_name)).size,4);

  } finally {child.kill();}
});
test('cloud payments commit before delayed Sheets work and preserve retryable jobs', {timeout:60000}, async()=>{
  const root=mkdtempSync(join(tmpdir(),'payment-cloud-sync-'));
  const port=34000+Math.floor(Math.random()*4000)*2, origin=`http://localhost:${port}`;
  const failure=join(root,'google-failure'), workbookFile=join(root,'sheets.json');
  const child=spawn(process.execPath,['--import','./tests/google-mock.mjs','tests/postgres-server.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),APP_ORIGIN:origin,VERCEL:'1',DATABASE_URL:'postgresql://test:test@localhost/test',INITIAL_ADMIN_USERNAME:'admin',INITIAL_ADMIN_PASSWORD:'AdminPassword123',SESSION_SECRET:'cloud-payment-test-private-session-secret',DRIVE_MODE:'live',GOOGLE_ROOT_FOLDER_ID:'root',SHEETS_MODE:'live',TEST_GOOGLE_REVOKED:'0',GOOGLE_OAUTH_CLIENT_ID:'mock',GOOGLE_OAUTH_CLIENT_SECRET:'mock',GOOGLE_OAUTH_REFRESH_TOKEN:'mock',GOOGLE_OPERATIONS_SPREADSHEET_ID:'workbook',GOOGLE_MOCK_FAILURE_FILE:failure,GOOGLE_MOCK_SHEETS_FILE:workbookFile},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',chunk=>errors+=chunk);
  try {
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),20000);child.stdout.on('data',chunk=>{if(String(chunk).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',code=>{clearTimeout(timer);reject(Error('Cloud fixture exited '+code+': '+errors));});});
    const login=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:'AdminPassword123'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    async function api(path,body,method=body?'POST':'GET') {
      const r=await fetch(origin+path,{method,headers:{cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,path+': '+JSON.stringify(data));return data;
    }
    await api('/api/payment-settings',{action:'enable-receiver',ownerConfirmed:true});
    const services=(await api('/api/services')).services;
    const variant=services.find(s=>s.slug==='pf-assistance').variants[0];
    const c=(await api('/api/cases',{variantId:variant.id,customer:{name:'Synthetic Cloud Payment',mobile:'9876543210'},consent:true})).case;
    const pdf=Buffer.from('%PDF-1.4\nmirror fixture\n%%EOF');
    const auth=await api('/api/cases/'+c.id+'/upload-url',{docType:'Bank Passbook',fileName:'mirror.pdf',mimeType:'application/pdf',size:pdf.length});
    assert.equal((await fetch(auth.uploadUrl,{method:'PUT',body:pdf})).status,200);
    await api('/api/cases/'+c.id+'/documents',{uploadId:auth.uploadId,deferMirrors:true});
    await api('/api/cases/'+c.id+'/finish-uploads',{});
    const mirrorDeadline=Date.now()+5000;
    let mirrored=false;
    while(Date.now()<mirrorDeadline && !mirrored) {
      if(existsSync(workbookFile)) {
        try { mirrored=Object.values(JSON.parse(readFileSync(workbookFile,'utf8')).Documents || {}).some(row=>row[9]==='https://drive.google.com/file/d/mock-file/view'); }
        catch(error) { if(!(error instanceof SyntaxError)) throw error; } // The mock writer may still be replacing the JSON contents.
      }
      if(!mirrored) await new Promise(resolve=>setTimeout(resolve,30));
    }
    assert.ok(mirrored,'A deferred document mirror must eventually populate the Drive link in Sheets');
    await api('/api/payments/'+c.payment.id+'/submit',{utr:'444444444444'});
    await api('/api/payments-sync',undefined,'POST');
    writeFileSync(failure,'sheets-slow-fail');
    const started=performance.now();
    const result=await api('/api/payments/'+c.payment.id+'/verify',confirmations);
    assert.equal(result.payment.status,'PAID');
    assert.ok(performance.now()-started<1500,'Cloud verification returns before the 2-second Google response');
    // The fixture has one physical connection, so allow its background worker to finish.
    await new Promise(resolve=>setTimeout(resolve,2500));
    assert.equal((await api('/api/payments/'+c.payment.id)).status,'PAID');
    unlinkSync(failure);
    await api('/api/payments-sync',undefined,'POST');
    assert.ok(existsSync(workbookFile));
    const workbook=JSON.parse(readFileSync(workbookFile,'utf8'));
    assert.equal(Object.values(workbook.Cashflow).length,1);
    assert.equal(Object.values(workbook.Cashflow)[0][3],c.payment.id);
    await api('/api/admin/employees',{name:'Status Test Office',username:'statusoffice',role:'backoffice',password:'OfficeTestPassword123'});
    const officeLogin=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'statusoffice',password:'OfficeTestPassword123'})});
    const officeCookie=officeLogin.headers.get('set-cookie').split(';')[0];
    const officeAction=async(action,body)=>{
      const response=await fetch(origin+'/api/cases/'+c.id+'/'+action,{method:'POST',headers:{cookie:officeCookie,'content-type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
    };
    await officeAction('claim',{});
    await api('/api/payments-sync',undefined,'POST');
    writeFileSync(failure,'sheets-slow-fail');
    const statusStarted=performance.now();
    const progressed=await officeAction('progress',{status:'Ready to Submit',note:'Validated status update fixture',visibility:'sales'});
    assert.ok(performance.now()-statusStarted<1500,'Back-office status save must return before the 2-second Sheets response');
    assert.equal(progressed.case.status,'Ready to Submit');assert.equal(progressed.note.note,'Validated status update fixture');
    await new Promise(resolve=>setTimeout(resolve,2500));
    const saved=await api('/api/cases/'+c.id);
    assert.equal(saved.case.status,'Ready to Submit');
    assert.equal(saved.notes.filter(n=>n.note==='Validated status update fixture').length,1);
    unlinkSync(failure);
    await api('/api/payments-sync',undefined,'POST');
    const mirroredStatus=Object.values(JSON.parse(readFileSync(workbookFile,'utf8'))['All Cases']).find(row=>row[0]===c.ref);
    assert.equal(mirroredStatus[9],'Ready to Submit','Retry eventually mirrors the saved back-office status');
    assert.ok(!errors.includes('Deferred Sheets sync failed'),errors);
  } finally {child.kill();}
});
