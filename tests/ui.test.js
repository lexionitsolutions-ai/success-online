import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {serviceCatalog} from '../service-catalog.js';

function client() {
  const context = vm.createContext({
    document: { querySelector: selector => selector === '#consent' ? { checked: true } : null,addEventListener() {} },
    window: {}, crypto, URL, URLSearchParams, console, setTimeout, clearTimeout
  });
  vm.runInContext(readFileSync('public/intake-rules.js', 'utf8'), context);
  vm.runInContext(readFileSync('public/app.js', 'utf8').replace(/boot\(\);\s*$/, ''), context);
  vm.runInContext(`
    const messages = [];
    toast = message => messages.push(message);
    rerenderWizard = () => {};
    load = async () => {};
    openCase = async () => {};
  `, context);
  return { context, run: source => vm.runInContext(source, context) };
}

test('all services render Marathi document checklists and separate bilingual notes',()=>{
  const {context,run}=client();
  for (const service of serviceCatalog) {
    assert.ok(service.documents.every(doc=>doc.marathiLabel && /[\u0900-\u097f]/u.test(doc.marathiLabel)),service.name);
    context.guidanceService=service;
    context.guidanceVariant={documents:service.documents,instructions:service.instructions};
    const markup=run('serviceGuidance(guidanceService,guidanceVariant,{})');
    assert.match(markup,/<details class="intake-notices"/);
    assert.match(markup,/<strong>Important Notices<\/strong>/);
    assert.doesNotMatch(markup,/<details[^>]*\sopen(?:\s|>)/);
    assert.match(markup,/आवश्यक कागदपत्रे/);
    assert.match(markup,/income-checklist/);
    assert.match(markup,/महत्त्वाच्या सूचना \/ Important notes/);
    assert.doesNotMatch(markup,/Fees to confirm before payment/i);
    if(service.slug!=='income-certificate') assert.ok(service.instructions.includes(' / '),service.name);
  }
});

test('caste validity form is downloadable in guidance and upload views and is required to continue',()=>{
  const {context,run}=client();
  context.service=serviceCatalog.find(service=>service.slug==='caste-validity');
  context.form=context.service.documents.find(doc=>doc.templateUrl);
  assert.equal(readFileSync(`public${context.form.templateUrl}`).subarray(0,5).toString(),'%PDF-');
  run("draft={step:3,details:{},docs:{}};me={role:'sales'}");
  assert.match(run('serviceGuidance(service,service,{})').split('<details')[0],/href="\/downloads\/caste-validity-information-form.pdf" download/);
  for(const markup of [
    run('serviceGuidance(service,service,{})'),
    run('wizardDocumentUploads(service,service.documents)'),
    run("documentChecklist({id:'case-1',status:'Draft',variant:service,details:{}},[])")
  ]) {
    assert.match(markup,/href="\/downloads\/caste-validity-information-form.pdf" download/);
  }
  run("for(const doc of service.documents.filter(doc=>doc.required && doc!==form)) draft.docs[doc.label]={fileName:'proof.pdf'}");
  assert.match(run('wizardBody(service,service)'),/onclick="saveStep3\(\)" disabled/);
  run("draft.docs[form.label]={fileName:'completed-form.pdf'}");
  assert.doesNotMatch(run('wizardBody(service,service)'),/onclick="saveStep3\(\)" disabled/);
});

test('EWS preserves saved ancestor uploads, explains the area limit and allows omitting other documents',()=>{
  const {context,run}=client();
  context.location={origin:'https://example.test'};
  context.service=serviceCatalog.find(service=>service.slug==='ews-certificate');
  run("draft={step:3,details:{},docs:{}};me={role:'sales'}");
  const saved=run("documentChecklist({id:'case-1',ref:'SO-TEST',customer:{name:'Test Applicant',mobile:'9876543210'},status:'Draft',variant:service,details:{}},[{id:'doc-1',doc_type:'Relative School Leaving Certificate (pre-1967)',file_name:'ancestor-proof.pdf',version:1,download_url:'/proof.pdf'}])");
  assert.match(saved,/Grandfather \/ Great-grandfather School Leaving Certificate/);
  assert.match(saved,/ancestor-proof.pdf/);
  assert.doesNotMatch(saved,/aunt, or uncle/);
  assert.match(saved,/less than 1,000 square feet/);
  assert.match(saved,/ॲसेसमेंट उताऱ्यात दिलेले क्षेत्रफळ/);
  assert.match(saved,/Optional supporting document/);
  run("for(const doc of service.documents.filter(doc=>doc.required)) draft.docs[doc.label]={fileName:'proof.pdf'}");
  assert.equal(run("draft.docs['Other Document']"),undefined);
  assert.doesNotMatch(run('wizardBody(service,service)'),/onclick="saveStep3\(\)" disabled/);
});

test('ration ABC and police forms have download instructions and matching upload slots',()=>{
  const {context,run}=client();
  run("draft={step:3,details:{},docs:{}};me={role:'sales'}");
  for(const [slug,label,path,note] of [
    ['ration-card','Ration Shop A.B.C. Certificate','/downloads/ration-card-abc-dakhla.pdf',/signature and stamp from the ration retail store/],
    ['police-clearance','Office Letter / NOC','/downloads/police-clearance-form.pdf',/fill in the supplied police clearance form/]
  ]) {
    context.service=serviceCatalog.find(s=>s.slug===slug);
    const requirement=context.service.documents.find(doc=>doc.label===label);
    assert.equal(requirement.templateUrl,path);
    assert.match(requirement.note,note);
    assert.equal(readFileSync(`public${path}`).subarray(0,5).toString(),'%PDF-');
    assert.match(run('serviceGuidance(service,service,{})').split('<details')[0],new RegExp(path));
    assert.match(run('wizardDocumentUploads(service,service.documents)'),new RegExp(path));
    assert.match(run("documentChecklist({id:'test',status:'Draft',variant:service,details:{}},[])"),new RegExp(path));
    assert.equal(requirement.required,true);
  }
});

test('overview has collapsed Recent Updates and a completed-case navigation card',()=>{
  const {context,run}=client();
  context.overviewRows=[
    {id:'old',ref:'OLDER-CASE',updated_at:'2026-10-20',status:'Assigned',payment_state:'paid'},
    {id:'new',ref:'NEWER-CASE',updated_at:'2026-10-24',status:'Awaiting Payment',payment_state:'unpaid'},
    {id:'done',ref:'COMPLETED-CASE',status:'Closed',payment_state:'paid',backoffice:{id:'office'}}
  ].map(row=>({...row,customer:{name:'Client',mobile:'9876543210'},service:{name:'Certificate'},variant:{name:'Application'},amounts:{total:20000}}));
  run("me={id:'admin',role:'admin'};cases=overviewRows;");
  const html=run('renderDashboard()');
  assert.match(html,/<strong>Recent Updates<\/strong>/);
  assert.doesNotMatch(html,/Needs attention/);
  assert.doesNotMatch(html,/<details id="recentUpdates"[^>]*\sopen(?:\s|>)/);
  assert.match(html,/aria-label="View completed cases"><span>Completed cases<\/span><strong>1<\/strong>/);
  assert.ok(html.indexOf('NEWER-CASE')<html.indexOf('OLDER-CASE'),'Recent rows are ordered by update time');
  run("rememberRecentUpdates({isConnected:true,open:true})");
  assert.match(run('renderDashboard()'),/<details id="recentUpdates"[^>]*\sopen\s/);
  run("rememberRecentUpdates({isConnected:true,open:false})");
  assert.doesNotMatch(run('renderDashboard()'),/<details id="recentUpdates"[^>]*\sopen(?:\s|>)/);
});

test('payment report export is hidden and blocked only for sales',()=>{
  const {run}=client();
  run("paymentData={metrics:{},payments:[]};paymentSettings={receiverReady:true,prices:[]};me={role:'sales'};let downloads=0;downloadPaymentAsset=()=>downloads++;");
  assert.doesNotMatch(run('renderPayments()'),/Export report|payment-export-button/);
  run('exportPayments()');
  assert.equal(run('downloads'),0);
  for(const role of ['admin','backoffice']) {
    run(`me.role='${role}'`);
    assert.match(run('renderPayments()'),/Export report/);
  }
});

test('announcements are below Recent Updates, escaped, and admin controls are role limited',()=>{
  const {run}=client();
  run(`me={role:'sales'};cases=[];announcements=[{id:'ann1',title:'<script>alert(1)</script>',body:'First line\\n<script>bad()</script>',author:'Admin',created_at:'2026-10-24T09:00:00Z',image_url:'/api/announcements/ann1/image'}];`);
  const html=run('renderDashboard()');
  assert.ok(html.indexOf('id="recentUpdates"')<html.indexOf('id="announcementsTitle"'));
  assert.doesNotMatch(html,/<script>|announcement-composer|Remove announcement:/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/\/api\/announcements\/ann1\/image/);
  run("me.role='backoffice'");
  assert.doesNotMatch(run('renderAnnouncements()'),/announcement-composer|Remove announcement:/);
  run("me.role='admin'");
  assert.match(run('renderAnnouncements()'),/Post announcement/);
  assert.match(run('renderAnnouncements()'),/Remove announcement:/);
});

test('background announcement updates preserve an open admin composer',async()=>{
  const {context,run}=client();
  const feed={innerHTML:''};
  context.document.querySelector=selector=>selector==='.announcement-composer[open]'?{}:selector==='#announcementFeed'?feed:selector.includes('.announcement-composer[open]')?{}:null;
  run("me={id:'admin',role:'admin'};view='dashboard';cases=[];let redraws=0;render=()=>redraws++;updateCaseIndicators=()=>{};api=async path=>path==='/api/cases'?{cases:[]}:path==='/api/announcements'?{announcements:[{id:'new',title:'New update',body:'Team update'}]}:{notifications:[]};");
  await run('refreshCaseUpdates()');
  assert.equal(run('redraws'),0);
  assert.match(feed.innerHTML,/New update/);
});

test('domicile always requires address proof and never offers the removed affidavit path',()=>{
  const {context,run}=client();
  context.service=serviceCatalog.find(service=>service.slug==='domicile-certificate');
  context.variant={...context.service,amounts:{serviceCharge:20000,total:20000}};
  assert.ok(!context.service.fields.some(field=>field.label==='Do you have proof confirming the entered address?'));
  assert.equal(context.service.documents.find(doc=>doc.label==='Family Member Address Proof (15+ years old)').required,true);
  run("draft={step:4,details:{'Do you have proof confirming the entered address?':'No'},customer:{name:'Test Applicant'},docs:{}}");
  assert.doesNotMatch(run('serviceGuidance(service,variant,draft.details)'),/affidavit-notice/);
  assert.doesNotMatch(run('wizardBody(service,variant)'),/affidavit fee/);
});

test('Non-Creamy Layer cannot continue without the three-year income certificate',()=>{
  const {context,run}=client();
  context.service=serviceCatalog.find(service=>service.slug==='non-creamy-layer');
  run("draft={step:3,details:{'Applicant under 18?':'No'},docs:{}}");
  run("for(const doc of applicableDocuments(service.documents,draft.details).filter(doc=>doc.label!=='3 Years Income Certificate')) draft.docs[doc.label]={fileName:'proof.pdf'}");
  assert.match(run('wizardBody(service,service)'),/onclick="saveStep3\(\)" disabled/);
  run("draft.docs['3 Years Income Certificate']={fileName:'three-year-income.pdf'}");
  assert.doesNotMatch(run('wizardBody(service,service)'),/onclick="saveStep3\(\)" disabled/);
});

test('customer intake omits email and removes numbers from typed or pasted names', () => {
  const { context, run } = client();
  assert.doesNotMatch(run('wizardBody()'), /email/i);
  context.nameInput = { value: "Asha123 Patil\u0967\u0968" };
  run('removeNameNumbers(nameInput)');
  assert.equal(context.nameInput.value, 'Asha Patil');
  const fields = { '#name': { value: 'Asha Patil' }, '#mobile': { value: '9876543210' }, '#address': { value: 'Pune' } };
  for (const [selector, input] of Object.entries(fields)) Object.assign(input, {
    id: selector.slice(1), dataset: {}, closest: () => null,
    classList: { toggle() {} }, setAttribute() {}, removeAttribute() {},
    checkValidity: () => true, focus() {}
  });
  context.document.querySelector = selector => fields[selector];
  run('saveStep1()');
  assert.equal(run('draft.step'), 2);
  assert.equal(run("Object.hasOwn(draft.customer, 'email')"), false);
  fields['#name'].value = 'Asha123';
  run('draft.step = 1; saveStep1()');
  assert.equal(run('draft.step'), 1);
});

test('unpaid payment label preserves existing workflow values and warning styling',()=>{
  const {run}=client();
  assert.match(run("statusBadge('Awaiting Payment')"),/Unpaid Payment/);
  assert.match(run("statusBadge('Awaiting Payment')"),/badge warning/);
  run("me={role:'backoffice'};const paymentItem={id:'c1',status:'Draft',document_state:'complete',payment_state:'unpaid'};");
  assert.equal(run('progressControls(paymentItem)'),'');
  assert.doesNotMatch(run('progressControls(paymentItem)'),/>Awaiting Payment</);
  assert.match(run("horizontalBars([{status:'Awaiting Payment',count:1}],'count')"),/Unpaid Payment/);
});

test('portrait requirements display Live Photo with an immediate capture instruction',()=>{
  for(const service of serviceCatalog) for(const doc of service.documents.filter(doc=>/^(?:(Applicant|Father|Owner) )?(?:Live )?Photo$/.test(doc.label))) {
    assert.match(doc.displayLabel,/Live Photo/);
    assert.match(doc.note,/photo clicked at the moment/);
  }
});

test('completed tables expose only the received document in their last download column',()=>{
  const {context,run}=client();
  context.completedRow={id:'c1',ref:'SO-TEST',customer:{name:'Client',mobile:'9876543210'},service:{name:'Certificate'},variant:{name:'Application'},status:'Closed',payment_state:'paid',amounts:{total:20000},received_document:{download_url:'/api/documents/final-document/download'}};
  const table=run('caseTable([completedRow],true)');
  assert.match(table,/<th>Updated<\/th><th>Download file<\/th>/);
  assert.match(table,/href="\/api\/documents\/final-document\/download"/);
  assert.match(table,/event.stopPropagation\(\)/);
  assert.match(table,/<svg/);
  assert.doesNotMatch(run('caseTable([completedRow])'),/<th>Download file<\/th>/);
  context.completedRow.received_document=null;
  assert.match(run('caseTable([completedRow],true)'),/Not available/);
});

test('pending and active cases follow verified payment, including correction and verification states',()=>{
  const {run}=client();
  run("cases=[{id:'c1',status:'Correction Required',payment_state:'unpaid'},{id:'c2',status:'Closed',payment_state:'paid'},{id:'c3',status:'Assigned',payment_state:'paid'}];caseNotifications=[{id:'n1',caseId:'c1',status:'Assigned'}];");
  assert.equal(run("isPendingCase({status:'Awaiting Documents'})"),true);
  assert.equal(run("isPendingCase({status:'Correction Required'})"),true);
  assert.equal(run("isPendingCase({status:'Assigned',payment_state:'paid',document_state:'complete'})"),false);
  assert.equal(run("isPendingCase({status:'Ready for Assignment',payment:{status:'AWAITING_VERIFICATION'}})"),true);
  assert.equal(run("isActiveCase({status:'Correction Required',payment_state:'paid',document_state:'complete'})"),true);
  assert.equal(run("isActiveCase({status:'Awaiting Documents',payment_state:'paid',document_state:'missing'})"),false);
  assert.equal(run("isActiveCase({status:'Submitted to Official Portal',payment_state:'unpaid'})"),false);
  assert.equal(run("isActiveCase({status:'Ready for Assignment',payment:{status:'paid',gateway:'demo'}})"),false);
  assert.equal(run("isPendingCase({status:'Closed'})"),false);
  assert.equal(run("hasSectionUpdates('pending')"),true);
  assert.equal(run("hasSectionUpdates('cases')"),false);
  run("cases[0].status='Closed'");
  assert.equal(run("hasSectionUpdates('completed')"),true);
});

test('opening one case acknowledges only its displayed notifications',async()=>{
  const {run}=client();
  run("caseNotifications=[{id:'n1',caseId:'c1'},{id:'n2',caseId:'c2'}];updateCaseIndicators=()=>{};let marked;api=async(path,options)=>{marked=options.body.ids;return {};};");
  await run("markCaseUpdatesRead('c1')");
  assert.equal(run('marked.join()'),'n1');
  assert.equal(run('caseNotifications.map(notice=>notice.id).join()'),'n2');
});

test('returning a case to sales requires instructions and uses correction status',async()=>{
  const {context,run}=client();
  const note={value:' ',focus(){this.focused=true;}};
  const status={value:'Ready to Submit'};
  context.document.querySelector=selector=>selector==='#note'?note:selector==='#nextStatus'?status:null;
  run("let returned;progress=async id=>{returned=id;};");
  await run("returnCaseToSales('c1')");
  assert.equal(run('returned'),undefined);
  assert.equal(note.focused,true);
  note.value='Please replace the blurry document';
  await run("returnCaseToSales('c1')");
  assert.equal(status.value,'Correction Required');
  assert.equal(run('returned'),'c1');
});

test('background updates avoid unnecessary redraws and defer changed lists until forms close',async()=>{
  const {context,run}=client();
  let drawerOpen=false;
  context.document.querySelector=selector=>selector.startsWith('#drawer') && drawerOpen ? {} : null;
  run("me={id:'u1'};view='cases';cases=[];let redraws=0;updateCaseIndicators=()=>{};render=()=>{redraws++;caseListNeedsRender=false;};let incoming=[];api=async path=>path==='/api/cases'?{cases:incoming}:{notifications:[]};");
  await run('refreshCaseUpdates()');
  assert.equal(run('redraws'),0);
  drawerOpen=true;
  run("incoming=[{id:'c1',status:'Correction Required'}]");
  await run('refreshCaseUpdates()');
  assert.equal(run('redraws'),0);
  drawerOpen=false;
  await run('refreshCaseUpdates()');
  assert.equal(run('redraws'),1);
  await run('refreshCaseUpdates()');
  assert.equal(run('redraws'),1);
});

test('sales, backoffice and admin get saved document preview actions',()=>{
  const {context,run}=client();
  context.location={origin:'https://example.test'};
  run("me={role:'backoffice'};const previewDoc={id:'d1',doc_type:'Photo',mime_type:'image/png',download_url:'/api/documents/d1/download'};const previewCase={id:'c1',ref:'SO1',status:'Assigned',customer:{name:'Client'}};");
  assert.match(run('documentActions(previewCase,previewDoc)'),/previewDocument\('d1'\)/);
  run("me.role='admin';previewDoc.mime_type='application/pdf'");
  assert.match(run('documentActions(previewCase,previewDoc)'),/Preview/);
  run("me.role='sales'");
  assert.match(run('documentActions(previewCase,previewDoc)'),/previewDocument/);
  assert.match(run('documentActions(previewCase,previewDoc)'),/Download/);
});

test('unsubmitted combined checkouts remain selectable, with one case or several', async () => {
  const { run } = client();
  run(`me={role:'sales'};paymentData={payments:[
    {id:'p1',case_id:'c1',batch_id:'old',batch_status:'CANCELLED',status:'CANCELLED'},
    {id:'p2',case_id:'c2',batch_id:'old',batch_status:'CANCELLED',status:'CANCELLED'}
  ]};`);
  assert.equal(run('paymentData.payments.every(batchEligible)'), true);
  run("paymentData.payments[0].batch_status='PENDING';paymentData.payments[0].status='PENDING'");
  assert.equal(run('batchEligible(paymentData.payments[0])'), true);
  run("paymentData.payments[0].status='INITIATED'");
  assert.equal(run('batchEligible(paymentData.payments[0])'), true);
  run("paymentData.payments[0].case_payment_locked=true");
  assert.equal(run('batchEligible(paymentData.payments[0])'), false);
  run("paymentData.payments[0].case_payment_locked=false");
  run("paymentData.payments[0].batch_status='CANCELLED';paymentData.payments.push({id:'paid',case_id:'c1',status:'PAID'})");
  assert.equal(run('batchEligible(paymentData.payments[0])'), false);
  run("paymentData.payments.pop();selectedPaymentCases.add('c2');let paidCase;pay=async id=>{paidCase=id;}");
  await run('paySelectedCases()');
  assert.equal(run('paidCase'), 'c2');
});

test('opening Payments does not wait for the background case-list refresh', async () => {
  const { run } = client();
  run("me={role:'sales'};closeDrawer=()=>{};render=()=>{};refreshCaseUpdates=()=>new Promise(()=>{});let paymentsLoaded=false;refreshPayments=async()=>{paymentsLoaded=true;}");
  await run("setView('payments')");
  assert.equal(run('paymentsLoaded'), true);
});


test('admin verifies received payment with one button and no checklist or notes',async()=>{
  const {run}=client();
  run(`
    me={role:'admin'};
    const pending={id:'pay1',status:'AWAITING_VERIFICATION',amount:100,receiverReady:true,payee_name:'SUCCESS ONLINE SERVICES',customer_name:'Test Client',service_name:'PAN Card',gateway_order_id:'SO-P-test',upi_id:'merchant@upi',transaction_id:'123456789012',expires_at:new Date().toISOString(),attempts:[]};
    const html=checkoutHTML(pending);
    const calls=[];
    paymentAction=async(action,body)=>calls.push({action,body});
  `);
  assert.match(run('html'),/Verify received payment/);
  assert.doesNotMatch(run('html'),/type="checkbox"|Verification notes|verifyForm|Reject claim/);
  await run('verifyUPIPayment()');
  assert.equal(run('JSON.stringify(calls)'),JSON.stringify([{action:'verify',body:{}}]));
  run("me={role:'sales'}");
  assert.doesNotMatch(run('checkoutHTML(pending)'),/Verify received payment/);
});

test('UPI app buttons preserve server-prefilled recipient and amount without verifying payment',async()=>{
  const {context,run}=client();
  context.location={href:'https://example.test/'};
  context.navigator={userAgent:'iPhone'};
  context.setTimeout=()=>0;
  run(`
    const paymentCalls=[];
    checkout={id:'pay1',receiverAccountType:'merchant',amount:100,status:'PENDING',expires_at:new Date(Date.now()+60000).toISOString(),upiIntent:'upi://pay?pa=0791934A0195602.bqr%40kotak&pn=SUCCESS%20ONLINE%20SERVICES&am=1.00&cu=INR&tn=Raj%20Shah%20-%20PAN%20Card%20-%20SO1'};
    api=async(path,options)=>{paymentCalls.push({path,options});return {};};
  `);
  for(const platform of ['iPhone','Android']) {
    context.navigator.userAgent=platform;
    for(const method of ['Google Pay','PhonePe','Paytm','BHIM','Other UPI App']) {
      await run(`launchUPI(${JSON.stringify(method)})`);
      const uri=new URL(context.location.href);
      assert.equal(uri.protocol,method==='Google Pay' ? 'gpay:' : 'upi:');
      assert.equal(uri.searchParams.get('pa'),'0791934A0195602.bqr@kotak');assert.equal(uri.searchParams.get('am'),'1.00');assert.equal(uri.searchParams.get('cu'),'INR');assert.equal(uri.searchParams.get('tn'),'Raj Shah - PAN Card - SO1');
      assert.equal(run('checkout.status'),'PENDING');
    }
  }
  assert.equal(run('paymentCalls.length'),10);
  assert.ok(run("paymentCalls.every(c=>c.path==='/api/payments/pay1/initiate' && c.options.keepalive===true)"));
  context.location.href='https://example.test/';
  run("checkout.expires_at='2000-01-01';showPayment=async()=>{};");
  await run("launchUPI('Google Pay')");assert.equal(context.location.href,'https://example.test/');assert.equal(run('paymentCalls.length'),10);
});

test('intake cannot continue while a selected file is being read', async () => {
  const { context, run } = client();
  run(`draft.step = 3; fileAsBase64 = () => new Promise(resolve => { window.finishRead = resolve; });`);
  context.file = { name: 'photo.jpg', type: 'image/jpeg', size: 10 };
  const pending = run("pickDoc('Photo', file)");
  assert.equal(run('drawerBusy'), true);
  run('saveStep3()');
  assert.equal(run('draft.step'), 3);
  assert.equal(run('draft.docs.Photo'), undefined);
  run("window.finishRead('encoded')");
  await pending;
  assert.equal(run('drawerBusy'), false);
  assert.equal(run('draft.docs.Photo.content'), 'encoded');
});

function prepareBackgroundUploadTest(run, labels) {
  run(`
    me={id:'sales1',role:'sales'};draftMissing=()=>[];
    openUploadQueueDB=async()=>({});uploadJobStorage=async()=>{};
    renderBackgroundUploads=()=>{};waitForUploadRetry=async()=>{};
    refreshCaseUpdates=async()=>{};pay=async()=>{};
    draft.serviceId='svc';draft.variantId='variant';
    services=[{id:'svc',variants:[{id:'variant',documents:${JSON.stringify(labels.map(label=>({label,multiple:true})))}}]}];
  `);
}
async function finishBackgroundJobs(run) {
  for(let attempt=0;attempt<100 && run('runningUploadJobs.size');attempt++) await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(run('runningUploadJobs.size'),0);
}

test('case creation opens checkout while document uploads are still pending',async()=>{
  const {run}=client();prepareBackgroundUploadTest(run,['A','B']);
  run(`
    draft.docs={A:{content:'a',size:1,fileName:'a.pdf',mimeType:'application/pdf'},B:{content:'b',size:1,fileName:'b.pdf',mimeType:'application/pdf'}};
    let creates=0,checkouts=0,completed=0;const release=[];
    api=async path=>{if(path==='/api/cases'){creates++;return {case:{id:'case1',ref:'SO1'}};}return {case:{uploads:{complete:true}}};};
    uploadDocument=async()=>{await new Promise(resolve=>release.push(resolve));completed++;return {documentId:'d'+completed};};
    pay=async()=>{checkouts++;};
  `);
  await run('submitCase()');
  assert.equal(run('creates'),1);assert.equal(run('checkouts'),1);assert.equal(run('completed'),0);assert.equal(run('drawerBusy'),false);
  run('release.forEach(resolve=>resolve())');await finishBackgroundJobs(run);
  assert.equal(run('completed'),2);assert.equal(run('uploadJobs.size'),0);
});

test('background transfers retry failed files without duplicating the case or successful pages',async()=>{
  const {run}=client();prepareBackgroundUploadTest(run,['Report']);
  run(`
    draft.docs={Report:{pages:[{content:'page1'},{content:'page2'},{content:'page3'}]}};
    let creates=0;const pages=[];let fail=true;
    api=async path=>{if(path==='/api/cases'){creates++;return {case:{id:'case1',ref:'SO1'}};}return {case:{uploads:{complete:true}}};};
    uploadDocument=async(id,type,doc)=>{pages.push(doc.content);if(doc.content==='page2'&&fail)throw Error('Network interrupted');return {documentId:doc.content};};
  `);
  await run('submitCase()');await finishBackgroundJobs(run);
  assert.equal(run('uploadJobs.get("case1").state'),'error');
  assert.equal(run("pages.filter(page=>page==='page1').length"),1);
  run('fail=false');await run('runUploadJob("case1")');
  assert.equal(run('creates'),1);
  assert.equal(run("pages.filter(page=>page==='page1').length"),1);
  assert.equal(run("pages.filter(page=>page==='page3').length"),1);
  assert.equal(run('uploadJobs.size'),0);
});

test('background intake overlaps at most three transfers and opens another case immediately',async()=>{
  const {run}=client();prepareBackgroundUploadTest(run,['A','B','C','D','E','F']);
  run(`
    draft.docs=Object.fromEntries(['A','B','C','D','E','F'].map(key=>[key,{content:key}]));
    let active=0,peak=0,completed=0,nextCases=0,checkouts=0;
    api=async path=>path==='/api/cases'?{case:{id:'case1',ref:'SO1'}}:{case:{uploads:{complete:true}}};
    uploadDocument=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,15));active--;completed++;return {documentId:'d'+completed};};
    startCase=()=>{nextCases++;draft={customer:{},details:{},docs:{}};};pay=async()=>{checkouts++;};
  `);
  await run("submitCase('another')");
  assert.equal(run('nextCases'),1);assert.equal(run('completed'),0);
  await finishBackgroundJobs(run);
  assert.equal(run('peak'),3);assert.equal(run('completed'),6);assert.equal(run('checkouts'),0);
});

test('removing a staged file after a partial save removes its saved copy and clears retry state',async()=>{
  const {run}=client();
  run(`
    draft.docs={Photo:{content:'photo'}};
    draft.createdCase={id:'c1'};draft.uploaded={Photo:'photo'};draft.uploadedIds={Photo:'d1'};
    const removalCalls=[];
    api=async(path,options)=>{removalCalls.push({path,body:options.body});return {};};
  `);
  await run("removeDraftDocument('Photo')");
  assert.equal(run('draft.docs.Photo'),undefined);
  assert.equal(run('draft.uploaded.Photo'),undefined);
  assert.equal(run('draft.uploadedIds.Photo'),undefined);
  assert.equal(run('removalCalls[0].path'),'/api/cases/c1/remove-document');
  assert.equal(run('removalCalls[0].body.documentId'),'d1');
});

test('saved document removal controls cover intake and received files before case closure',()=>{
  const {context,run}=client();
  context.location={origin:'https://example.test'};
  run("me={role:'sales'};const doc={id:'d1',doc_type:'Ration Card',download_url:'/file'};const item={id:'c1',ref:'SO1',customer:{name:'Client'},status:'Awaiting Documents'};");
  assert.match(run('documentActions(item,doc)'),/removeSavedDocument/);
  run("doc.doc_type='Received Document';item.status='Document Received'");
  assert.doesNotMatch(run('documentActions(item,doc)'),/removeSavedDocument/);
  run("me.role='backoffice'");
  assert.match(run('documentActions(item,doc)'),/removeSavedDocument/);
  run("item.status='Closed'");
  assert.doesNotMatch(run('documentActions(item,doc)'),/removeSavedDocument/);
});

test('background intake finalizes only after the server confirms every file',async()=>{
  const {run}=client();prepareBackgroundUploadTest(run,['A','B','C']);
  run(`
    cloudUploads=true;draft.docs={A:{file:{},size:1},B:{file:{},size:1},C:{file:{},size:1}};
    const intakeCalls=[];let finished=0;
    api=async path=>{intakeCalls.push(path);if(path.endsWith('finish-uploads')){if(finished!==3)throw Error('Finalized too early');return {case:{uploads:{complete:true}}};}return {case:{id:'case1',ref:'SO1'}};};
    uploadDocument=async(id,type,doc,options)=>{if(!options.deferMirrors||!options.uploadKey)throw Error('Missing upload manifest key');await new Promise(resolve=>setTimeout(resolve,5));finished++;return {documentId:type};};
  `);
  await run('submitCase()');assert.equal(run('finished'),0);
  await finishBackgroundJobs(run);
  assert.equal(run('finished'),3);
  assert.equal(run("intakeCalls.filter(path=>path.endsWith('finish-uploads')).length"),1);
});

test('status update saves once, refreshes the open case in place and skips full reloads',async()=>{
  const {context,run}=client();
  const panel={scrollTop:160,innerHTML:''};
  context.document.querySelector=selector=>({'#nextStatus':{value:'Ready to Submit'},'#note':{value:'Checked documents'},'#drawer .case-panel':panel}[selector] || null);
  run(`
    cases=[{id:'c1',status:'Assigned'}];selectedCase={case:cases[0],documents:[{id:'d1'}],notes:[]};
    let saves=0,reloads=0,renders=0;
    setDrawerBusy=message=>{drawerBusy=!!message;};
    api=async()=>{saves++;await new Promise(resolve=>setTimeout(resolve,10));return {case:{id:'c1',status:'Ready to Submit'},note:{id:'n1',note:'Checked documents'}};};
    load=async()=>{reloads++;};openCase=async()=>{reloads++;};
    render=()=>{renders++;};caseDetail=item=>item.status;
  `);
  const pending=run("progress('c1')");
  await run("progress('c1')");
  assert.equal(run('drawerBusy'),true);
  await pending;
  assert.equal(run('saves'),1);assert.equal(run('reloads'),0);assert.equal(run('renders'),1);
  assert.equal(run('cases[0].status'),'Ready to Submit');assert.equal(run('selectedCase.notes.length'),1);
  assert.equal(run('selectedCase.documents[0].id'),'d1');assert.equal(panel.scrollTop,160);
  assert.equal(panel.innerHTML,'Ready to Submit');assert.equal(run('drawerBusy'),false);
});

test('submitting corrections saves once and refreshes documents and timeline in place',async()=>{
  const {context,run}=client();
  const panel={scrollTop:120,innerHTML:''};
  context.document.querySelector=selector=>selector==='#drawer .case-panel'?panel:null;
  run(`
    cases=[{id:'c1',status:'Correction Required'}];selectedCase={case:cases[0],documents:[{id:'old'}],notes:[]};
    let saves=0;setDrawerBusy=message=>{drawerBusy=!!message;};render=()=>{};caseDetail=item=>item.status;
    api=async path=>{saves++;if(path!=='/api/cases/c1/submit-reupload') throw Error('Wrong endpoint');await new Promise(resolve=>setTimeout(resolve,10));return {case:{id:'c1',status:'Document Review',reupload:{pending:false,submittedDocumentIds:['new']}},documents:[{id:'new'}],notes:[{id:'submitted'}]};};
  `);
  const pending=run("submitReupload('c1')");
  await run("submitReupload('c1')");await pending;
  assert.equal(run('saves'),1);
  assert.equal(run('selectedCase.documents[0].id'),'new');
  assert.equal(run('selectedCase.notes[0].id'),'submitted');
  assert.equal(panel.scrollTop,120);
  assert.equal(run('drawerBusy'),false);
});

test('failed correction submission keeps the documents and shows the error beside Submit',async()=>{
  const {context,run}=client();
  const message={textContent:''};
  context.document.querySelector=selector=>selector==='#reuploadSubmitResult'?message:null;
  run("selectedCase={documents:[{id:'replacement'}]};setDrawerBusy=message=>{drawerBusy=!!message;};api=async()=>{throw Error('Connection lost');};");
  await run("submitReupload('c1')");
  assert.equal(message.textContent,'Connection lost');
  assert.equal(run('selectedCase.documents[0].id'),'replacement');
  assert.equal(run('drawerBusy'),false);
});

test('failed status save keeps the form and saved state unchanged and unlocks retry',async()=>{
  const {context,run}=client();
  context.document.querySelector=selector=>({'#nextStatus':{value:'Ready to Submit'},'#note':{value:'My note'}}[selector] || null);
  run(`cases=[{id:'c1',status:'Assigned'}];setDrawerBusy=message=>{drawerBusy=!!message;};api=async()=>{throw Error('Connection lost');};`);
  await run("progress('c1')");
  assert.equal(run('cases[0].status'),'Assigned');assert.equal(run('drawerBusy'),false);
  assert.ok(run("messages.includes('Connection lost')"));
});

test('a display error after status save does not report that the save failed',async()=>{
  const {context,run}=client();
  context.document.querySelector=selector=>({'#nextStatus':{value:'Ready to Submit'},'#note':{value:''}}[selector] || null);
  run(`setDrawerBusy=message=>{drawerBusy=!!message;};api=async()=>({case:{id:'c1',status:'Ready to Submit'}});renderSavedCase=()=>{throw Error('Display failed');};`);
  await run("progress('c1')");
  assert.ok(run("messages.some(message=>message.startsWith('Status saved.'))"));
  assert.equal(run('drawerBusy'),false);
});

test('drawer controls are locked during work and their disabled state is restored', () => {
  const { context, run } = client();
  const control = disabled => ({ disabled, dataset: {}, hasAttribute() { return 'wasDisabled' in this.dataset; } });
  const controls = [control(false), control(true)];
  let removed = false;
  const drawer = { setAttribute() {}, querySelectorAll: () => controls, querySelector: () => ({ lastElementChild: {}, remove() {} }), remove() { removed = true; } };
  context.document.querySelector = selector => selector === '#drawer' ? drawer : null;
  run("setDrawerBusy('Uploading…'); closeDrawer()");
  assert.deepEqual(controls.map(c => c.disabled), [true, true]);
  assert.equal(removed, false);
  run('setDrawerBusy(); closeDrawer()');
  assert.deepEqual(controls.map(c => c.disabled), [false, true]);
  assert.equal(removed, true);
});

test('save location is picked before fetching the ZIP and cancellation skips download', async () => {
  const { context, run } = client();
  run(`selectedCase = {case:{ref:'SO1',customer:{name:'Test'},service:{name:'Service'}}};`);
  const steps = [];
  context.window.isSecureContext = true;
  context.window.showSaveFilePicker = async () => {
    steps.push('pick');
    return { createWritable: async () => ({ write: async () => steps.push('write'), close: async () => steps.push('close') }) };
  };
  context.fetch = async () => { steps.push('fetch'); return { ok: true, blob: async () => 'ZIP' }; };
  context.button = { disabled: false, textContent: 'Download all files' };
  await run("downloadCaseFiles('case1',button)");
  assert.deepEqual(steps, ['pick','fetch','write','close']);
  assert.equal(context.button.disabled, false);
  context.window.showSaveFilePicker = async () => { throw Object.assign(new Error('Cancelled'), {name:'AbortError'}); };
  steps.length = 0;
  await run("downloadCaseFiles('case1',button)");
  assert.deepEqual(steps, []);
  assert.equal(context.button.disabled, false);
});

test('cloud upload transfers file bytes directly and retries only finalization', async () => {
  const {context,run} = client();
  let transfers = 0;
  context.fetch = async () => {transfers++;return {ok:true};};
  run(`
    cloudUploads = true;
    let authorizations = 0, finalizations = 0;
    const upload = {fileName:'large.pdf',mimeType:'application/pdf',size:5000000,file:{bytes:'file'}};
    api = async (path,options) => {
      if (path.endsWith('/upload-url')) {authorizations++;return {uploadId:'upload1',uploadUrl:'https://storage.example/upload'};}
      if (Object.keys(options.body).join(',') !== 'uploadId') throw new Error('File bytes must not pass through the API');
      finalizations++;
      if (finalizations === 1) throw new Error('Network interrupted');
      return {ok:true};
    };
  `);
  await assert.rejects(run("uploadDocument('case1','Photo',upload)"),/Network interrupted/);
  await run("uploadDocument('case1','Photo',upload)");
  assert.equal(transfers,1);
  assert.equal(run('authorizations'),1);
  assert.equal(run('finalizations'),2);
});

test('admin overview skips unrelated analytics requests and loads them on the requested tab', async () => {
  const {run}=client();
  run("me={role:'admin'}; const requested=[];api=async path=>{requested.push(path);return {};};view='dashboard';");
  await run('loadViewData()');
  assert.equal(run('requested.length'),0);
  run("view='employees'");await run('loadViewData()');
  assert.equal(run('requested.length'),1);
  assert.ok(run('requested[0]').startsWith('/api/admin/employees?'));
  run("view='admin'");await run('loadViewData()');
  assert.equal(run('requested.length'),4);
});

test('a dashboard refresh failure after payment save preserves the saved checkout', async () => {
  const {run}=client();
  run(`
    checkout={id:'pay1',status:'AWAITING_VERIFICATION'};
    const paymentSteps=[];
    setDrawerBusy=message=>{drawerBusy=!!message;};
    api=async()=>({payment:{id:'pay1',status:'PAID'}});
    showPayment=async()=>{paymentSteps.push(checkout.status);if(drawerBusy) throw Error('Checkout still locked');};
    load=async()=>{throw Error('Failed to fetch');};
  `);
  await run("paymentAction('verify',{})");
  assert.equal(run('checkout.status'),'PAID');
  assert.equal(run('paymentSteps[0]'),'PAID');
  assert.equal(run('drawerBusy'),false);
  assert.ok(run("messages.some(m=>m.includes('Payment details saved'))"));
  assert.equal(run("messages.includes('Failed to fetch')"),false);
});

test('a failed payment save unlocks the existing form without reporting success', async () => {
  const {run}=client();
  run(`
    checkout={id:'pay1',status:'AWAITING_VERIFICATION'};
    setDrawerBusy=message=>{drawerBusy=!!message;};
    api=async()=>{throw Error('Failed to fetch');};
    showPayment=async()=>{throw Error('Should preserve the current form');};
  `);
  await run("paymentAction('verify',{})");
  assert.equal(run('checkout.status'),'AWAITING_VERIFICATION');
  assert.equal(run('drawerBusy'),false);
  assert.equal(run('messages[0]'),'Failed to fetch');
});

test('sign-out clears admin caches and returns to the overview', async () => {
  const {run}=client();
  run("me={role:'admin'};view='admin';adminAnalytics={private:'cached'};employeeData={private:'cached'};api=async()=>({});renderLogin=()=>{};");
  await run('logout()');
  assert.equal(run('me'),null);
  assert.equal(run('view'),'dashboard');
  assert.equal(run('adminAnalytics'),null);
  assert.equal(run('employeeData'),null);
});


test('cancelled and expired history stays selectable without charging a case twice',async()=>{
  const {run}=client();
  run(`me={role:'sales'};paymentData={payments:[
    {id:'new1',case_id:'c1',status:'PENDING',amount:20000},
    {id:'old1',case_id:'c1',status:'CANCELLED',amount:20000},
    {id:'old2',case_id:'c1',status:'EXPIRED',amount:20000},
    {id:'old3',case_id:'c2',status:'EXPIRED',amount:20000}
  ]};selectedPaymentCases.add('c1');selectedPaymentCases.add('c2');`);
  assert.equal(run('paymentData.payments.every(batchEligible)'),true);
  assert.equal(run('selectablePaymentCases().length'),2);
  assert.match(run('combinedPaymentSummary()'),/2 cases selected/);
  assert.match(run('paymentTableRow(paymentData.payments[1])'),/type="checkbox"/);
  assert.match(run('paymentTableRow(paymentData.payments[2])'),/type="checkbox"/);
  run(`let sent;api=async(path,options)=>{sent=options.body.caseIds;return {id:'batch'};};showPayment=async()=>{};`);
  await run('paySelectedCases()');
  assert.equal(run('JSON.stringify(sent)'),JSON.stringify(['c1','c2']));
  run(`paymentData.payments.push({id:'review',case_id:'c1',status:'AWAITING_VERIFICATION'});`);
  assert.equal(run('batchEligible(paymentData.payments[1])'),false);
  assert.equal(run('batchEligible(paymentData.payments[2])'),false);
});


test('payment dashboard shows one row per case across checkout retries and keeps unpaid cases payable',()=>{
  const {run}=client();
  run(`me={role:'sales'};paymentData={metrics:{},payments:[
    {id:'p1',case_id:'c1',case_ref:'CASE-1',status:'PENDING',amount:20000},
    {id:'p2',case_id:'c2',case_ref:'CASE-2',status:'CANCELLED',amount:20000},
    {id:'p3',case_id:'c3',case_ref:'CASE-3',status:'EXPIRED',amount:20000},
    {id:'old1',case_id:'c1',case_ref:'CASE-1',status:'CANCELLED',amount:20000},
    {id:'old2',case_id:'c2',case_ref:'CASE-2',status:'EXPIRED',amount:20000},
    {id:'old3',case_id:'c3',case_ref:'CASE-3',status:'CANCELLED',amount:20000}
  ]};`);
  assert.equal(run('paymentCaseRows().length'),3);
  assert.equal(run('selectablePaymentCases().length'),3);
  const html=run('renderPayments()');
  assert.equal((html.match(/class="payment-customer-cell"/g)||[]).length,3);
  assert.equal((html.match(/data-payment-case=/g)||[]).length,3);
  assert.match(html,/3 cases<\/span>/);
  run(`paymentData.payments.push({id:'review',case_id:'c2',status:'AWAITING_VERIFICATION'}, {id:'paid',case_id:'c3',status:'PAID'});`);
  assert.equal(run("paymentCaseRows().find(p=>p.case_id==='c2').id"),'review');
  assert.equal(run("paymentCaseRows().find(p=>p.case_id==='c3').id"),'paid');
  assert.equal(run('selectablePaymentCases().length'),1);
});
