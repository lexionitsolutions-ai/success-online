import {confirmTestReceiver,verifyTestOrder,confirmations} from './payment-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createZip } from '../archive.js';

test('real API: access, document gates, uploads, bundle and completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'success-online-test-'));
  const port = 32000 + Math.floor(Math.random() * 10000), origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, NODE_ENV:'test', VERCEL:'', DATABASE_URL:'', SUPABASE_URL:'', SUPABASE_SECRET_KEY:'', PORT: String(port), DATABASE_PATH: join(root, 'test.sqlite'), STORAGE_PATH: join(root, 'docs'), DRIVE_MODE:'demo', SHEETS_MODE:'demo', PAYMENT_MODE:'demo', SESSION_SECRET:'integration-test-secret-with-32-characters', APP_ORIGIN:origin }, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  child.stderr.on('data', d => output += d);
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timed out: ' + output)), 15000);
      child.stdout.on('data', d => { if (String(d).includes('running')) { clearTimeout(timeout); resolve(); } });
      child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${output}`)); });
    });
    async function request(path, { cookie, body, method = body ? 'POST' : 'GET' } = {}) {
      const response = await fetch(origin + path, { method, headers: { ...(cookie ? {cookie} : {}), 'content-type':'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { response, status:response.status, data: await response.json().catch(() => ({})) };
    }
    async function login(username) {
      const r = await request('/api/login', { body: { username, password:'Demo@12345' } });
      assert.equal(r.status, 200); return r.response.headers.get('set-cookie').split(';')[0];
    }
    assert.equal((await request('/api/health')).status, 200);
    assert.equal((await request('/api/cases')).status, 401);
    const sales = await login('sales01'), otherSales = await login('sales02'), admin = await login('admin01'), office = await login('backoffice01');
    await confirmTestReceiver(request,admin);
    assert.equal((await request('/api/admin/dashboard', { cookie:sales })).status, 403);
    const employeeBody = { name:'New Employee', username:'new.sales', role:'sales', password:'StaffPassword123' };
    assert.equal((await request('/api/admin/employees', { cookie:sales })).status, 403);
    assert.equal((await request('/api/admin/employees', { cookie:office, body:employeeBody })).status, 403);
    assert.equal((await request('/api/admin/employees', { cookie:admin, body:{...employeeBody, role:'admin'} })).status, 400);
    assert.equal((await request('/api/admin/employees', { cookie:admin, body:{...employeeBody, password:'short'} })).status, 400);
    for (const role of ['sales','backoffice']) {
      const employee = await request('/api/admin/employees', { cookie:admin, body:{...employeeBody, username:`new.${role}`, role} });
      assert.equal(employee.status, 201);
      assert.equal(employee.data.employee.password_hash, undefined);
      const signedIn = await request('/api/login', { body:{username:`new.${role}`, password:employeeBody.password} });
      assert.equal(signedIn.status, 200);
      assert.equal(signedIn.data.user.role, role);
    }
    assert.equal((await request('/api/admin/employees', { cookie:admin, body:{...employeeBody, username:'NEW.SALES'} })).status, 409);
    for (const dates of ['from=2026-02-30&to=2026-03-01','from=2026-10-12&to=2026-10-01','from=&to=']) assert.equal((await request('/api/admin/employees?period=custom&' + dates, {cookie:admin})).status, 400);
    for (const path of ['/api/me','/api/google/status','/api/google/sheets/status','/api/admin/dashboard?period=week','/api/customers?q=test','/api/cases']) assert.equal((await request(path, { cookie:admin })).status, 200, path);
    const services = (await request('/api/services', { cookie:sales })).data.services;
    assert.equal(services.length, 15);
    // Exercise checklist enforcement for every service using its conditional selectors.
    for (const service of services) {
      const v = service.variants[0];
      const details = Object.fromEntries(v.fields.filter(f => f.type === 'select').map(f => [f.label, f.options[0]]));
      const r = await request('/api/cases', { cookie:sales, body:{ variantId:v.id, customer:{ name:'Checklist Trial', mobile:'9876543210' }, details, consent:true } });
      assert.equal(r.status, 201, service.name);
      const order=await request(`/api/cases/${r.data.case.id}/payment-order`,{cookie:sales,method:'POST'});
      const expected = ['income-certificate','domicile-certificate'].includes(service.slug) ? 20000 : 100;
      assert.equal(order.status,201,service.name);assert.equal(order.data.amount,expected);assert.equal(new URL(order.data.upiIntent).searchParams.get('am'),(expected/100).toFixed(2));
    }
    const variant = services.find(s => s.slug === 'income-certificate').variants[0];
    const domicile = services.find(s => s.slug === 'domicile-certificate').variants[0];
    assert.equal(domicile.documents[1].label,'Father Aadhaar Card');
    assert.match(domicile.documents.find(doc=>doc.label==='Photo').note,/Photo of the beneficiary/);
    assert.match(domicile.documents.find(doc=>doc.label==='School Leaving Certificate').note,/School Leaving Certificate of the beneficiary/);
    assert.equal(domicile.amounts.total,20000);
    const domicilePayload = {variantId:domicile.id,customer:{name:'Applicant Trial',mobile:'9876543210'},consent:true};
    assert.equal((await request('/api/cases',{cookie:sales,body:{...domicilePayload,details:{'Applicant under 18?':'Yes'}}})).status,400);
    for (const applicant of ['Father','Mother','Guardian']) {
      const result = await request('/api/cases',{cookie:sales,body:{...domicilePayload,details:{'Applicant under 18?':'Yes',Applicant:applicant}}});
      assert.equal(result.status,201);
      assert.equal(result.data.case.details.Applicant,applicant);
    }
    const adult = await request('/api/cases',{cookie:sales,body:{...domicilePayload,details:{'Applicant under 18?':'No',Applicant:'Father','Applicant birth date':'2000-01-01','Applicant or beneficiary':'Old field'}}});
    assert.equal(adult.status,201);
    assert.equal(adult.data.case.details.Applicant,'Self');
    assert.equal(adult.data.case.details['Applicant birth date'],undefined);
    assert.equal(adult.data.case.details['Applicant or beneficiary'],undefined);
    const payload = { variantId:variant.id, customer:{ name:'Trial Customer', mobile:'9876543210' }, details:{ 'Years of Certificate Required':'1 year','Reason for application':'Banking', 'Income amount required on certificate (₹)':'150000', 'Ration card colour':'Yellow', 'Ration card area':'City' }, consent:true };
    for (const amount of ['-1','not a number']) assert.equal((await request('/api/cases',{cookie:sales,body:{...payload,details:{...payload.details,'Income amount required on certificate (₹)':amount}}})).status,400);
    assert.equal((await request('/api/cases', { cookie:sales, body:{ ...payload, consent:false } })).status, 400);
    assert.equal((await request('/api/cases', { cookie:sales, body:{ ...payload, details:{} } })).status, 400);
    const otherDetails = { ...payload.details, 'Reason for application':'Other' };
    assert.equal((await request('/api/cases', { cookie:sales, body:{ ...payload, details:otherDetails } })).status, 400);
    const other = await request('/api/cases', { cookie:sales, body:{ ...payload, details:{ ...otherDetails, 'Other reason (please specify)':'Education admission' } } });
    assert.equal(other.status, 201);
    assert.equal(other.data.case.details['Other reason (please specify)'], 'Education admission');
    for (let page=1;page<=4;page++) {
      const photo = Buffer.from([255,216,255,224,page]);
      const uploaded = await request(`/api/cases/${other.data.case.id}/documents`, {cookie:sales,body:{docType:'Talathi Report',fileName:`page-${page}.jpg`,mimeType:'image/jpeg',size:photo.length,content:photo.toString('base64')}});
      assert.equal(uploaded.status,201);
    }
    const report = await request(`/api/cases/${other.data.case.id}`, {cookie:sales});
    const reportPages = report.data.documents.filter(doc => doc.doc_type === 'Talathi Report' && doc.state === 'uploaded');
    assert.equal(reportPages.length,4);
    assert.equal(new Set(reportPages.map(doc => doc.file_name)).size,4);
    const reportPath = `/api/cases/${other.data.case.id}`;
    assert.equal((await request(reportPath+'/remove-document',{cookie:otherSales,body:{documentId:reportPages[0].id}})).status,403);
    assert.equal((await request(reportPath+'/remove-document',{cookie:sales,body:{documentId:reportPages[0].id}})).status,200);
    assert.equal((await request(reportPath+'/remove-document',{cookie:sales,body:{documentId:reportPages[0].id}})).status,200);
    assert.equal((await request(reportPages[0].download_url,{cookie:sales})).status,404);
    assert.equal((await request(reportPages[0].download_url.replace('/download','/preview'),{cookie:office})).status,404);
    assert.equal((await request(reportPath,{cookie:sales})).data.documents.filter(doc=>doc.doc_type==='Talathi Report' && doc.state==='uploaded').length,3);
    const created = await request('/api/cases', { cookie:sales, body:payload });
    assert.equal(created.status, 201);
    assert.equal(created.data.case.details['Income amount required on certificate (₹)'],'150000');
    assert.equal(created.data.case.amounts.serviceCharge,20000);
    const caseId = created.data.case.id, path = `/api/cases/${caseId}`;
    assert.equal((await request(path, { cookie:otherSales })).status, 403);
    const forged = 'so_session=' + Buffer.from(`${created.data.case.sales.id}|invalid`).toString('base64url');
    assert.equal((await request('/api/me', { cookie:forged })).status, 401);
    assert.equal((await request(path + '/progress', { cookie:admin, body:{status:'Awaiting Payment'} })).status, 409);
    assert.equal((await request(path + '/payment-order', { cookie:sales, method:'POST' })).status, 201);
    const pdf = Buffer.from('%PDF-1.4\ntrial-document\n%%EOF');
    const upload = type => ({ docType:type, fileName:'test.pdf', mimeType:'application/pdf', size:pdf.length, content:pdf.toString('base64') });
    assert.equal((await request(path + '/documents', { cookie:sales, body:{...upload('Photo'), content:Buffer.from('fake').toString('base64')} })).status, 400);
    for (const type of ['Aadhaar Card','Photo','Ration Card']) assert.equal((await request(path + '/documents', { cookie:sales, body:upload(type) })).status, 201);
    let item = (await request(path, { cookie:sales })).data;
    assert.equal(item.case.document_state, 'complete');
    assert.equal(item.case.status, 'Awaiting Payment');
    const photo = item.documents.find(doc=>doc.doc_type==='Photo');
    assert.equal((await request(path+'/remove-document',{cookie:sales,body:{documentId:reportPages[1].id}})).status,404);
    const removed = await request(path+'/remove-document',{cookie:sales,body:{documentId:photo.id}});
    assert.equal(removed.status,200);
    assert.equal(removed.data.case.document_state,'missing');
    assert.equal(removed.data.case.status,'Awaiting Documents');
    assert.equal((await request(path+'/documents',{cookie:sales,body:upload('Photo')})).status,201);
    assert.equal((await request(path + '/progress', { cookie:admin, body:{status:'Ready for Assignment'} })).status, 409);
    const firstDoc = item.documents[0];
    const previewPath=firstDoc.download_url.replace('/download','/preview');
    assert.equal((await request(previewPath,{cookie:sales})).status,403);
    assert.equal((await request(previewPath,{cookie:otherSales})).status,403);
    const preview=await request(previewPath,{cookie:office});
    assert.equal(preview.status,200);
    assert.equal(preview.data.mimeType,'application/pdf');
    const inline=await fetch(origin+preview.data.url,{headers:{cookie:office}});
    assert.equal(inline.status,200);
    assert.match(inline.headers.get('content-disposition'),/^inline;/);
    assert.deepEqual(Buffer.from(await inline.arrayBuffer()),pdf);
    assert.equal((await request(preview.data.url,{cookie:sales})).status,403);
    assert.equal((await request(previewPath,{cookie:admin})).status,200);
    const download = await fetch(origin + firstDoc.download_url, { headers:{cookie:office} });
    assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
    assert.equal((await request(firstDoc.download_url, { cookie:otherSales })).status, 403);
    assert.equal((await request(path + '/download-all', { cookie:sales })).status, 403);
    const zip = await fetch(origin + path + '/download-all?folder=Trial%20Work', { headers:{cookie:office} });
    assert.equal(zip.status, 200);
    const bytes = Buffer.from(await zip.arrayBuffer());
    assert.equal(bytes.readUInt32LE(), 0x04034b50); assert.ok(bytes.includes(Buffer.from('Trial Work/Aadhaar Card/')));
    assert.equal(bytes.readUInt16LE(bytes.length - 12), 3);
    const order = (await request(path + '/payment-order', { cookie:sales, method:'POST' })).data;
    assert.equal((await request(path + '/verify-payment', { cookie:sales, body:{orderId:order.orderId} })).status, 403);
    await verifyTestOrder(request,admin,sales,order.id);
    assert.equal((await request(path + '/claim', { cookie:office, method:'POST' })).status, 200);
    assert.equal((await request(path + '/claim', { cookie:office, method:'POST' })).status, 409);
    assert.equal((await request(path+'/progress',{cookie:office,body:{status:'Correction Required',note:'   '}})).status,400);
    const correction = await request(path+'/progress',{cookie:office,body:{status:'Correction Required',note:'Replace the blurry Ration Card photo'}});
    assert.equal(correction.status,200);
    assert.equal(correction.data.case.status,'Correction Required');
    const correctionNotice = (await request('/api/notifications',{cookie:sales})).data.notifications.find(notice=>notice.caseId===caseId && notice.status==='Correction Required');
    assert.ok(correctionNotice);
    assert.match(correctionNotice.title,/Returned to sales/);
    assert.equal((await request('/api/notifications',{cookie:otherSales})).data.notifications.some(notice=>notice.caseId===caseId),false);
    assert.equal((await request('/api/notifications',{cookie:office})).data.notifications.some(notice=>notice.id===correctionNotice.id),false);
    assert.equal((await request('/api/notifications/read',{cookie:otherSales,body:{ids:[correctionNotice.id]}})).status,200);
    assert.ok((await request('/api/notifications',{cookie:sales})).data.notifications.some(notice=>notice.id===correctionNotice.id));
    assert.equal((await request('/api/notifications/read',{cookie:sales,body:{ids:[correctionNotice.id]}})).status,200);
    assert.equal((await request('/api/notifications',{cookie:sales})).data.notifications.some(notice=>notice.id===correctionNotice.id),false);
    assert.equal((await request(path,{cookie:sales})).data.notes.at(-1).note,'Replace the blurry Ration Card photo');
    for (const status of ['Document Review','Ready to Submit','Submitted to Official Portal','Document Received']) assert.equal((await request(path + '/progress', { cookie:office, body:{status} })).status, 200, status);
    assert.equal((await request(path + '/submit-received-document', { cookie:office, method:'POST' })).status, 400);
    assert.equal((await request(path + '/documents', { cookie:office, body:upload('Received Document') })).status, 201);
    item = (await request(path, { cookie:office })).data;
    const received = item.documents.find(d => d.doc_type === 'Received Document');
    assert.equal((await request(path+'/remove-document',{cookie:sales,body:{documentId:received.id}})).status,403);
    assert.equal((await request(received.download_url, { cookie:sales })).status, 403);
    assert.equal((await request(path + '/submit-received-document', { cookie:office, method:'POST' })).status, 200);
    assert.equal((await request(received.download_url, { cookie:sales })).status, 200);
    assert.equal((await request(path + '/documents', { cookie:office, body:upload('Photo') })).status, 409);
    assert.equal((await request(path+'/remove-document',{cookie:office,body:{documentId:received.id}})).status,409);
    assert.equal((await request('/api/not-found', { cookie:admin })).status, 404);
    const mirror = JSON.parse(readFileSync(join(root, 'docs', 'Success Online Operations.json')));
    assert.equal(mirror.allCases[created.data.case.ref].status, 'Closed');
    assert.deepEqual(mirror.allCases[created.data.case.ref].missingDocuments, []);
    assert.equal(mirror.documents[created.data.case.ref].length, 5);
    // Force an incomplete already-assigned legacy record: API must still prevent progression.
    const db = new DatabaseSync(join(root, 'test.sqlite'));
    // Completion/collection events count even when the case was opened earlier.
    db.prepare("UPDATE cases SET created_at='2026-01-01T00:00:00.000Z',completed_at='2026-09-30T18:30:00.000Z' WHERE id=?").run(caseId);
    db.prepare("UPDATE payments SET verified_at='2026-10-01T18:29:59.000Z' WHERE case_id=?").run(caseId);
    const review = await request('/api/admin/employees?period=custom&from=2026-10-01&to=2026-10-01', {cookie:admin});
    assert.equal(review.status, 200);
    assert.equal(review.data.period.start, '2026-09-30T18:30:00.000Z');
    assert.equal(review.data.period.end, '2026-10-01T18:30:00.000Z');
    const salesReview = review.data.employees.find(e => e.username === 'sales01');
    assert.equal(salesReview.cases, 0);
    assert.equal(salesReview.completed, 1);
    assert.equal(salesReview.collected, created.data.case.amounts.total);
    assert.equal(review.data.employees.find(e => e.username === 'backoffice01').completed, 1);
    db.prepare("UPDATE payments SET verified_at='2026-10-01T18:30:00.000Z' WHERE case_id=?").run(caseId);
    const afterEnd = await request('/api/admin/employees?period=custom&from=2026-10-01&to=2026-10-01', {cookie:admin});
    assert.equal(afterEnd.data.employees.find(e => e.username === 'sales01').collected, 0);
    db.prepare("UPDATE cases SET status='Assigned' WHERE id=?").run(caseId);
    db.prepare("UPDATE documents SET state='replaced' WHERE id=?").run(firstDoc.id);
    db.close();
    assert.equal((await request(path + '/progress', { cookie:office, body:{status:'Ready to Submit'} })).status, 409);
  } finally { child.kill(); }
});

test('ZIP preserves Unicode names and valid central-directory count', () => {
  const zip = createZip([{ name:'काम/Photo/test.png', data:Buffer.from('bytes') }]);
  assert.ok(zip.includes(Buffer.from('काम/Photo/test.png')));
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 12), 1);
});

test('live Google adapter: workbook sync, Drive upload and private downloads (mock Google)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'success-google-test-'));
  const port = 42000 + Math.floor(Math.random() * 10000), origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['--import','./tests/google-mock.mjs','server.js'], { env:{ ...process.env, NODE_ENV:'test', VERCEL:'', DATABASE_URL:'', SUPABASE_URL:'', SUPABASE_SECRET_KEY:'', PORT:String(port), APP_ORIGIN:origin, DATABASE_PATH:join(root,'test.sqlite'), STORAGE_PATH:join(root,'files'), DRIVE_MODE:'live', SHEETS_MODE:'live', PAYMENT_MODE:'demo', SESSION_SECRET:'google-test-secret-with-at-least-32-characters', GOOGLE_OAUTH_CLIENT_ID:'mock', GOOGLE_OAUTH_CLIENT_SECRET:'mock', GOOGLE_OAUTH_REFRESH_TOKEN:'mock', GOOGLE_ROOT_FOLDER_ID:'root', GOOGLE_OPERATIONS_SPREADSHEET_ID:'workbook', GOOGLE_MOCK_FAILURE_FILE:join(root,'revoked'), GOOGLE_MOCK_SHEETS_FILE:join(root,'sheets.json') }, stdio:['ignore','pipe','pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Google test server timeout')), 15000);
      child.stdout.on('data', d => { if (String(d).includes('running')) { clearTimeout(timeout); resolve(); } });
      child.on('exit', code => { clearTimeout(timeout); reject(new Error('Google test server exited ' + code)); });
    });
    const login = await fetch(origin + '/api/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin01',password:'Demo@12345'})});
    const cookie = login.headers.get('set-cookie').split(';')[0];
    async function api(path, body, method = body ? 'POST' : 'GET') {
      const r = await fetch(origin + path, {method,headers:{cookie,'content-type':'application/json'},body:body ? JSON.stringify(body) : undefined});
      assert.ok(r.ok, path + ' returned ' + r.status); return r.json();
    }
    const oauth = await api('/api/google/oauth/start');
    assert.ok(new URL(oauth.authorizationUrl).searchParams.get('scope').includes('auth/spreadsheets'));
    const services = (await api('/api/services')).services;
    const variant = services.find(s => s.slug === 'pf-assistance').variants[0];
    const c = (await api('/api/cases',{variantId:variant.id,customer:{name:'Drive Trial',mobile:'9876543210'},consent:true})).case;
    const pdf = Buffer.from('%PDF-1.4\nmock-drive-file\n%%EOF');
    await api(`/api/cases/${c.id}/documents`, {docType:'Bank Passbook',fileName:'test.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')});
    const documents = (await api(`/api/cases/${c.id}`)).documents;
    assert.equal(documents[0].storage_path, undefined);
    const download = await fetch(origin + documents[0].download_url,{headers:{cookie}});
    assert.equal(download.status,200); assert.deepEqual(Buffer.from(await download.arrayBuffer()),pdf);
    const zip = await fetch(origin + `/api/cases/${c.id}/download-all`,{headers:{cookie}});
    assert.equal(zip.status,200); assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(),0x04034b50);
    const sync = await api('/api/google/sheets/activate', undefined, 'POST');
    assert.equal(sync.syncedCases,1); assert.equal(sync.workbook.tabs.length,23);
    assert.ok(sync.workbook.tabs.includes('Documents'));
    assert.ok(sync.workbook.tabs.includes('Income Certificate'));
    await api('/api/payment-settings',{action:'confirm-receiver',utr:'100000000001',amount:1,received:true,correctRecipient:true,notes:'Synthetic fixture, not a real transfer'});
    await api(`/api/payments/${c.payment.id}/submit`,{utr:'333333333333'});
    writeFileSync(join(root,'revoked'),'sheets-slow-fail');
    const started=performance.now();
    const verified=await api(`/api/payments/${c.payment.id}/verify`,confirmations);
    assert.ok(performance.now()-started<1500,'Payment verification must return before a slow Sheets request');
    assert.equal(verified.payment.status,'PAID','Sheets outage must not lose database verification');
    assert.equal((await api(`/api/payments/${c.payment.id}`)).status,'PAID','The committed payment remains readable while Google is still waiting');
    const inspect=new DatabaseSync(join(root,'test.sqlite'));
    const deadline=Date.now()+6000;
    while(inspect.prepare("SELECT status FROM sync_jobs WHERE type='sheets' AND entity_id=?").get(c.id).status!=='failed' && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(inspect.prepare("SELECT status FROM sync_jobs WHERE type='sheets' AND entity_id=?").get(c.id).status,'failed');inspect.close();
    unlinkSync(join(root,'revoked'));
    await api('/api/payments-sync',undefined,'POST');
    await api('/api/google/sheets/activate',undefined,'POST');
    const workbook=JSON.parse(readFileSync(join(root,'sheets.json'),'utf8'));
    assert.equal(Object.values(workbook.Payments).length,1);
    assert.equal(Object.values(workbook.Payments)[0][9],'PAID');
    assert.equal(Object.values(workbook.Cashflow).length,1,'Retries upsert the same cashflow ID');
    assert.equal(Object.values(workbook.Cashflow)[0][3],c.payment.id);
    assert.equal(Object.values(workbook.Cashflow)[0][7],1);

    writeFileSync(join(root,'revoked'), 'mock revoked token');
    const failedCase = await fetch(origin + '/api/cases', {method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({variantId:variant.id,customer:{name:'Retry Trial',mobile:'9876543210'},consent:true})});
    assert.equal(failedCase.status,409);
    assert.equal((await failedCase.json()).code,'GOOGLE_RECONNECT_REQUIRED');
    assert.equal((await api('/api/cases')).cases.length,1, 'Expired authorization must not save another case');
    const state = await api('/api/google/status');
    assert.equal(state.reconnectRequired,true); assert.equal(state.connected,false);
    const failedUpload = await fetch(origin + `/api/cases/${c.id}/documents`, {method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({docType:'Bank Passbook',fileName:'test.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')})});
    assert.equal(failedUpload.status,409);
    assert.equal((await api(`/api/cases/${c.id}`)).documents.length,1, 'Failed replacement must preserve existing document');
    unlinkSync(join(root,'revoked')); // Simulate successful Google reconnection.
    await api(`/api/cases/${c.id}/documents`, {docType:'Bank Passbook',fileName:'test.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')});
    assert.equal((await api('/api/google/status')).reconnectRequired,false);
    assert.equal((await api('/api/cases')).cases.length,1);
    writeFileSync(join(root,'revoked'),'missing-root');
    const missingRoot = await fetch(origin + '/api/cases',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({variantId:variant.id,customer:{name:'Root Trial',mobile:'9876543210'},consent:true})});
    assert.equal(missingRoot.status,409);
    assert.equal((await missingRoot.json()).code,'GOOGLE_ROOT_FOLDER_INVALID');
    assert.equal((await api('/api/cases')).cases.length,1,'Missing root must not save a new case');
    assert.equal((await api('/api/google/status')).folderInvalid,true);
    for (const folder of ['missing-folder','read-only-folder']) {
      const invalid = await fetch(origin + '/api/google/root-folder',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({folder})});
      assert.equal(invalid.status,409);
      assert.equal((await api('/api/google/status')).rootFolderId,'root','Invalid root must not replace configured root');
    }
    const saved = await api('/api/google/root-folder',{folder:'https://drive.google.com/drive/u/0/folders/new-root'});
    assert.equal(saved.folder.id,'new-root');
    assert.equal((await api('/api/google/status')).folderInvalid,false);
    assert.equal((await api('/api/google/status')).rootFolderId,'new-root');
    await api(`/api/cases/${c.id}/documents`, {docType:'Bank Passbook',fileName:'test.pdf',mimeType:'application/pdf',size:pdf.length,content:pdf.toString('base64')});
    const salesLogin = await fetch(origin + '/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'sales01',password:'Demo@12345'})});
    const salesCookie = salesLogin.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(origin + '/api/google/root-folder',{method:'POST',headers:{cookie:salesCookie,'content-type':'application/json'},body:JSON.stringify({folder:'new-root'})})).status,403);
    unlinkSync(join(root,'revoked'));
  } finally { child.kill(); }
});
