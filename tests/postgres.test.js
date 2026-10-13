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
  const child = spawn(process.execPath,['tests/postgres-server.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),APP_ORIGIN:origin,VERCEL:'1',DATABASE_URL:'postgresql://test:test@localhost/test',INITIAL_ADMIN_USERNAME:'admin',INITIAL_ADMIN_PASSWORD:'AdminPassword123',SESSION_SECRET:'cloud-test-private-session-secret-12345',DRIVE_MODE:'live',SHEETS_MODE:'demo',PAYMENT_MODE:'demo',TEST_GOOGLE_REVOKED:'1',GOOGLE_OAUTH_CLIENT_ID:'mock',GOOGLE_OAUTH_CLIENT_SECRET:'mock',GOOGLE_OAUTH_REFRESH_TOKEN:'mock',GOOGLE_ROOT_FOLDER_ID:'root'},stdio:['ignore','pipe','pipe']});
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
    const payload = {variantId:variant.id,customer:{name:'Cloud Trial',mobile:'9876543210'},details:{'Certificate duration':'1 year','Ration card colour':'Other','Ration card area rural?':'No'},consent:true};
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
      const result = await request(path+'/documents',{cookie,body:{uploadId:authorization.data.uploadId}});
      return {result,uploadId:authorization.data.uploadId};
    }
    const first = await upload('Aadhaar Card');assert.equal(first.result.status,201,JSON.stringify(first.result.data));
    assert.equal(first.result.data.googleSyncPending,true,'An expired optional Google mirror must not fail the Supabase upload');
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
    for (const status of ['Ready to Submit','Submitted to Official Portal','Document Received']) assert.equal((await request(path+'/progress',{cookie:accounts.backoffice,body:{status}})).status,200);
    assert.equal((await upload('Received Document',pdf,accounts.backoffice)).result.status,201);
    assert.equal((await request(path+'/submit-received-document',{cookie:accounts.backoffice,method:'POST'})).status,200);
    for (const period of ['week','month','quarter','year','all']) {
      const dashboard = await request('/api/admin/dashboard?period='+period,{cookie:admin});
      assert.equal(dashboard.status,200,JSON.stringify(dashboard.data)+' '+output);
      assert.equal(typeof dashboard.data.metrics.collected,'number');
    }
    assert.equal((await request('/api/admin/employees?period=all',{cookie:admin})).status,200);
    assert.equal((await request('/api/admin/employees',{cookie:accounts.sales})).status,403);
  } finally {child.kill();}
});
test('cloud payments commit before delayed Sheets work and preserve retryable jobs', {timeout:60000}, async()=>{
  const root=mkdtempSync(join(tmpdir(),'payment-cloud-sync-'));
  const port=34000+Math.floor(Math.random()*4000)*2, origin=`http://localhost:${port}`;
  const failure=join(root,'google-failure'), workbookFile=join(root,'sheets.json');
  const child=spawn(process.execPath,['--import','./tests/google-mock.mjs','tests/postgres-server.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:String(port),APP_ORIGIN:origin,VERCEL:'1',DATABASE_URL:'postgresql://test:test@localhost/test',INITIAL_ADMIN_USERNAME:'admin',INITIAL_ADMIN_PASSWORD:'AdminPassword123',SESSION_SECRET:'cloud-payment-test-private-session-secret',DRIVE_MODE:'demo',SHEETS_MODE:'live',TEST_GOOGLE_REVOKED:'0',GOOGLE_OAUTH_CLIENT_ID:'mock',GOOGLE_OAUTH_CLIENT_SECRET:'mock',GOOGLE_OAUTH_REFRESH_TOKEN:'mock',GOOGLE_OPERATIONS_SPREADSHEET_ID:'workbook',GOOGLE_MOCK_FAILURE_FILE:failure,GOOGLE_MOCK_SHEETS_FILE:workbookFile},stdio:['ignore','pipe','pipe']});
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
    assert.ok(!errors.includes('Deferred Sheets sync failed'),errors);
  } finally {child.kill();}
});
