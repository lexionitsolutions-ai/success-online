import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';

// Use a real ES module: VM tests do not reproduce inline-handler scope errors.
const fixture = `
const fixtureOpenCase=openCase;
window.prepareDiscount = () => {
  me={id:'branch',role:'sales',discountsAllowed:true,cashPaymentsAllowed:true};
  services=[{id:'pan',name:'PAN Card',slug:'pan',variants:[{id:'variant',fields:[],documents:[],amounts:{serviceCharge:30000,officialFee:0,tax:0,total:30000}}]}];
  draft={step:4,serviceId:'pan',variantId:'variant',customer:{name:'Test Customer',mobile:'9876543210'},details:{},docs:{}};
  runUploadJob=async()=>{};
  refreshCaseUpdates=async()=>{};pay=async()=>{};
  api=async(path,options)=>{window.savedRequest={path,...options};return {case:{id:'saved',ref:'SO-TEST'}};};
  drawWizard();
};
window.prepareLanguage = () => {
  closeDrawer();
  document.body.insertAdjacentHTML('beforeend','<section id="languageFixture"><p>Services</p><p>Under Review</p><p>Requests being checked or processed</p><p>Ready to Assign</p><p>Ready for back office staff</p><p>Do you have any evidence of the new name?</p><p>Enter your full old name as shown on your documents.</p><p>Enter your full new name for the Gazette.</p><p>Accept Case</p><p>Admin Approved Payment Pending</p><input placeholder="Approval reason"><span data-language-preserve>Test Customer</span></section>');
};
window.prepareDetailDiscount = () => {
  closeDrawer();window.savedRequest=null;
  openCase=async()=>{};
  document.body.insertAdjacentHTML('beforeend','<div id="drawer">'+caseDiscountForm({id:'detail-case',sales:{id:'branch'},deletionAllowed:true,amounts:{serviceCharge:30000,total:30000}})+'</div>');
};
window.prepareAdminApproval = () => {
  closeDrawer();me={id:'admin',role:'admin'};view='pending';openCase=fixtureOpenCase;
  const item={id:'pending-case',ref:'SO-PENDING',customer:{name:'Pending Customer',mobile:'9876543210'},service:{name:'PAN Card',slug:'pan'},variant:{name:'Application',documents:[]},sales:{id:'sales'},details:{},status:'Awaiting Payment',payment_state:'PENDING',document_state:'complete',amounts:{total:30000}};
  cases=[item];window.savedApproval=null;
  api=async(path,options)=>{
    if(path.endsWith('/payment-exception')) {window.savedApproval=options.body;item.adminPaymentApproval={by:'admin',reason:options.body.reason};item.status='Admin Approved Payment Pending';}
    return {case:item,documents:[],notes:[]};
  };
  document.querySelector('#app').innerHTML=renderPendingCases();
};
`;
const source=readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')+fixture;
const server=createServer((req,res)=>{
  res.setHeader('content-type',req.url==='/app.js'||req.url==='/rules.js'?'text/javascript':'text/html');
  res.end(req.url==='/app.js'?source:req.url==='/rules.js'?readFileSync('public/intake-rules.js'): '<div id="app"></div><script src="/rules.js"></script><script type="module" src="/app.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>typeof window.prepareDiscount==='function');
  await page.evaluate(()=>window.prepareDiscount());
  await page.locator('#consent').check();
  await page.locator('#reviewDiscount').pressSequentially('50');
  assert.match(await page.locator('.intake-review-total').innerText(),/250\.00/);
  assert.equal(await page.locator('#reviewDiscount').inputValue(),'50');
  assert.equal(await page.locator('#consent').isChecked(),true);
  await page.getByRole('button',{name:'Create & pay',exact:true}).click();
  await page.waitForFunction(()=>window.savedRequest);
  assert.equal(await page.evaluate(()=>window.savedRequest.body.discount),5000);
  assert.equal(await page.evaluate(()=>typeof window.saveCaseDiscount),'function');
  await page.evaluate(()=>window.prepareDetailDiscount());
  await page.locator('input[name="discount"]').fill('50');
  await page.getByRole('button',{name:'Apply discount',exact:true}).click();
  await page.waitForFunction(()=>window.savedRequest?.path==='/api/cases/detail-case/discount');
  assert.equal(await page.evaluate(()=>window.savedRequest.body.discount),5000);
  await page.evaluate(()=>window.prepareLanguage());
  await page.evaluate(()=>window.setIntakeLanguage('mr'));
  const marathi=await page.locator('#languageFixture').innerText();
  for(const english of ['Services','Under Review','Ready to Assign','Do you have any evidence','Enter your full','Accept Case','Admin Approved']) assert.ok(!marathi.includes(english),english);
  assert.match(marathi,/नवीन नावाचा काही पुरावा आहे का/);
  assert.match(marathi,/Test Customer/);
  assert.equal(await page.locator('#languageFixture input').getAttribute('placeholder'),'मंजुरीचे कारण');
  await page.evaluate(()=>window.setIntakeLanguage('en'));
  assert.match(await page.locator('#languageFixture').innerText(),/Do you have any evidence of the new name/);
  await page.evaluate(()=>window.prepareAdminApproval());
  await page.getByRole('button',{name:'Approve Case',exact:true}).click();
  await page.locator('#adminPaymentApproval textarea').fill('Payment confirmation delayed');
  await page.locator('#adminPaymentApproval').getByRole('button',{name:'Approve Case',exact:true}).click();
  await page.waitForFunction(()=>window.savedApproval);
  assert.equal(await page.evaluate(()=>window.savedApproval.reason),'Payment confirmation delayed');
  await page.locator('#drawer .correction-notice').filter({hasText:'Admin Approved Payment Pending'}).waitFor();
  assert.match(await page.locator('#drawer .case-summary').innerText(),/PENDING/);
  assert.match(await page.locator('#drawer .workflow-box').innerText(),/Move case forward/);
  assert.deepEqual(errors,[]);
  console.log('Passed: real module discount entry, consent preservation, submitted amount, exported detail handler, Marathi labels and English restoration.');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}

