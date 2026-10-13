import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function client() {
  const context = vm.createContext({
    document: { querySelector: selector => selector === '#consent' ? { checked: true } : null,addEventListener() {} },
    window: {}, URL, URLSearchParams, console, setTimeout, clearTimeout
  });
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

test('UPI app buttons preserve server-prefilled recipient and amount without verifying payment',async()=>{
  const {context,run}=client();
  context.location={href:'https://example.test/'};
  context.navigator={userAgent:'iPhone'};
  context.setTimeout=()=>0;
  run(`
    const paymentCalls=[];
    checkout={id:'pay1',receiverAccountType:'personal',amount:100,status:'PENDING',expires_at:new Date(Date.now()+60000).toISOString(),upiIntent:'upi://pay?pa=7558548187-3%40ybl&pn=SUCCESS%20ONLINE%20SERVICES&am=1.00&cu=INR&tn=PAN%20Card%20SO1'};
    api=async(path,options)=>{paymentCalls.push({path,options});return {};};
  `);
  for(const platform of ['iPhone','Android']) {
    context.navigator.userAgent=platform;
    for(const method of ['Google Pay','PhonePe','Paytm','BHIM','Other UPI App']) {
      await run(`launchUPI(${JSON.stringify(method)})`);
      const uri=new URL(context.location.href);
      assert.equal(uri.protocol,method==='Google Pay' ? 'gpay:' : 'upi:');
      assert.equal(uri.searchParams.get('pa'),'7558548187-3@ybl');assert.equal(uri.searchParams.get('am'),'1.00');assert.equal(uri.searchParams.get('cu'),'INR');
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

test('case creation waits for all uploads and retries without duplicating the case', async () => {
  const { run } = client();
  run(`
    draftMissing = () => [];
    draft.docs = { Aadhaar: {content:'first'}, Photo: {content:'second'} };
    let creates = 0, uploads = [], failed = false;
    api = async (path, options) => {
      if (path === '/api/cases') { creates++; return {case:{id:'case1',ref:'SO1'}}; }
      uploads.push(options.body.docType);
      if (options.body.docType === 'Photo' && !failed) { failed = true; throw new Error('Upload interrupted'); }
      return {};
    };
  `);
  await run('submitCase()');
  assert.equal(run('creates'), 1);
  assert.equal(run('draft.uploaded.Aadhaar'), 'first');
  assert.equal(run('draft.uploaded.Photo'), undefined);
  assert.equal(run('drawerBusy'), false);
  await run('submitCase()');
  assert.equal(run('creates'), 1);
  assert.equal(run('uploads.join(",")'), 'Aadhaar,Photo,Photo');
  assert.equal(run('draft.uploaded.Photo'), 'second');
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

test('sign-out clears admin caches and returns to the overview', async () => {
  const {run}=client();
  run("me={role:'admin'};view='admin';adminAnalytics={private:'cached'};employeeData={private:'cached'};api=async()=>({});renderLogin=()=>{};");
  await run('logout()');
  assert.equal(run('me'),null);
  assert.equal(run('view'),'dashboard');
  assert.equal(run('adminAnalytics'),null);
  assert.equal(run('employeeData'),null);
});
