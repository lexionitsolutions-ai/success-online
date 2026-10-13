// End-to-end browser QA against an isolated local database; no actual transfers.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
const root=mkdtempSync(join(tmpdir(),'upi-browser-')),port=51000+Math.floor(Math.random()*2000),origin=`http://localhost:${port}`;
const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),APP_ORIGIN:origin,NODE_ENV:'test',DATABASE_URL:'',DATABASE_PATH:join(root,'db.sqlite'),STORAGE_PATH:join(root,'docs'),VERCEL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',TEST_PRICING_MODE:'true',DRIVE_MODE:'demo',SHEETS_MODE:'demo'},stdio:['ignore','pipe','pipe']});
let browser,errors='',browserErrors=[];child.stderr.on('data',d=>errors+=d);
const screenshots='deliverables/payments-preview';mkdirSync(screenshots,{recursive:true});
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')) {clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
  const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
  const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message));
  await context.request.post(origin+'/api/login',{data:{username:'admin01',password:'Demo@12345'}});
  const serviceResponse=await context.request.get(origin+'/api/services'),services=(await serviceResponse.json()).services;
  const v=services.find(s=>s.slug==='pf-assistance').variants[0];
  const c=await (await context.request.post(origin+'/api/cases',{data:{variantId:v.id,customer:{name:'Browser Test',mobile:'9876543210'},consent:true}})).json();
  await page.goto(origin);await page.evaluate(()=>window.setView('payments'));
  await page.locator('[name="ownerConfirmed"]').waitFor();
  await page.locator('[name="ownerConfirmed"]').check();await page.getByRole('button',{name:'Enable UPI checkout',exact:true}).click();
  await page.getByText('Checkout enabled',{exact:false}).first().waitFor();
  for(const width of [320,390,768,1280]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(pid=>window.showPayment(pid),c.case.payment.id);
    await page.locator('.checkout-amount').waitFor();
    assert.ok(await page.locator('.checkout-close').evaluate(el=>document.activeElement===el));
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.locator('.payment-checkout').evaluate(el=>el.contains(document.activeElement)),'Keyboard focus stays in checkout');
    assert.equal(await page.locator('.upi-app').count(),5);
    assert.equal(await page.locator('#qrChoice').evaluate(el=>el.open),width>=701);
    assert.equal(await page.locator('#utrForm').isVisible(),false);
    assert.ok(await page.locator('.payment-checkout').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Checkout overflow at '+width);
    await page.screenshot({path:join(screenshots,`checkout-${width}.png`),fullPage:true});
    if(width<701) await page.locator('#qrChoice summary').click();
    await page.locator('.upi-qr img').evaluate(el=>el.scrollIntoView({block:'center'}));
    const qrRendered=await page.locator('.upi-qr img').screenshot();writeFileSync(join(screenshots,`qr-render-${width}.png`),qrRendered);
    const qrPNG=PNG.sync.read(qrRendered);
    const decoded=jsQR(new Uint8ClampedArray(qrPNG.data),qrPNG.width,qrPNG.height);
    const order=await (await context.request.get(origin+'/api/payments/'+c.case.payment.id)).json();
    assert.equal(decoded?.data,order.upiIntent,'Displayed QR remains readable at '+width);
    if(width===390) {
      await page.locator('.upi-qr').scrollIntoViewIfNeeded();await page.screenshot({path:join(screenshots,'qr-mobile.png')});
      await page.getByRole('button',{name:'I have paid',exact:true}).click();
      await page.locator('#utrForm').scrollIntoViewIfNeeded();await page.screenshot({path:join(screenshots,'utr-mobile.png')});
    }
    await page.locator('#drawer').getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('payment-open')),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Payments table overflow at '+width);
  }
  await page.evaluate(pid=>window.showPayment(pid),c.case.payment.id);
  const originalURL=page.url();
  await page.locator('.checkout-help summary').click();
  await page.getByRole('button',{name:'Pay directly in my UPI app',exact:true}).click();
  await page.locator('#manualUPI').waitFor({state:'visible'});
  assert.equal(page.url(),originalURL,'Manual fallback keeps the checkout open');
  assert.ok((await page.locator('#manualUPI').textContent()).includes('0791934A0195602.bqr@kotak'));
  assert.ok((await page.locator('#manualUPI').textContent()).includes('₹1.00'));
  const pending=await (await context.request.get(origin+'/api/payments/'+c.case.payment.id)).json();
  assert.equal(pending.status,'INITIATED');assert.equal(pending.payment_method,'Manual UPI');assert.equal(pending.verified_at,null);
  assert.equal(pending.receiverAccountType,'merchant');
  assert.ok(pending.attempts.some(e=>e.method==='Manual UPI'));
  await page.screenshot({path:join(screenshots,'manual-upi.png'),fullPage:true});
  await page.getByRole('button',{name:'I have paid',exact:true}).click();
  await page.locator('#utrForm input').fill('123456789012');await page.getByRole('button',{name:'Submit payment details',exact:true}).click();
  await page.locator('#verifyForm').waitFor();
  assert.ok(await page.getByText('Your payment is awaiting verification.',{exact:false}).first().isVisible());
  await page.locator('#verifyForm input').evaluateAll(inputs=>inputs.forEach(el=>el.checked=true));
  await page.locator('#verifyForm textarea').fill('Synthetic verified bank record for browser QA');
  await page.getByRole('button',{name:'Verify received payment',exact:true}).click();await page.getByRole('heading',{name:'Verified payment receipt'}).waitFor();
  await page.screenshot({path:join(screenshots,'verified-receipt.png'),fullPage:true});
  assert.deepEqual(browserErrors,[]);console.log('Browser checkout and admin verification passed at 320, 390, 768 and 1280px; no runtime errors.');
} finally {await browser?.close();child.kill();}
