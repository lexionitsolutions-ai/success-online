import {chromium} from 'playwright';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('https://automatic-preview.test/',r=>r.fulfill({contentType:'text/html',body:'<html><body><div id="app"></div></body></html>'}));
    await page.goto('https://automatic-preview.test/');
    for(const file of ['styles.css','mobile.css','payments.css','dashboard.css'])await page.addStyleTag({content:readFileSync('public/'+file,'utf8')});
    await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
    await page.addScriptTag({content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')});
    const pending={id:'pay-auto',case_id:'case-auto',amount:100,payableAmount:117,matchingAdjustment:17,automaticReference:true,upiIntent:'upi://pay?am=1.17',qrDataUrl:'data:image/png;base64,',gateway:'direct_upi',status:'PENDING',transaction_id:null,smsAutoConfirmEnabled:true,smsObserverEnabled:true,smsEvidence:null,customer_name:'Synthetic Client',service_name:'PAN Card',upi_id:'0791934A0195602.bqr@kotak',gateway_order_id:'SO-AUTO',receiverReady:true,attempts:[],expires_at:'2099-01-01T00:00:00Z'};
    let checks=0;
    await page.route('**/api/payments/pay-auto/check',route=>{
      checks++;assert.equal(route.request().method(),'POST');
      return route.fulfill({contentType:'application/json',body:JSON.stringify({payment:checks===1?pending:{...pending,status:'PAID',transaction_id:'300000000001',verified_at:new Date().toISOString(),verified_by:'system:worldline-sms'}})});
    });
    await page.evaluate(async p=>{
      me={id:'admin',name:'Synthetic Admin',role:'admin'};
      refreshCaseUpdates=async()=>{};render=()=>{};
      await showPayment(p.id,p);
    },pending);
    assert.equal(await page.getByRole('button',{name:'Verify received payment',exact:true}).count(),0);
    await page.getByRole('heading',{name:'Waiting for payment confirmation',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/I have paid/}).count(),0);
    assert.equal(await page.locator('.payment-wait-spinner').isVisible(),true);
    assert.equal(await page.locator('.checkout-amount').innerText(),'\u20b91.17');
    await page.getByRole('heading',{name:'Payment successful',exact:true}).waitFor({timeout:12000});
    assert.equal(await page.locator('.checkout-success .checkout-result-icon svg').count(),1);
    assert.equal(await page.locator('.payment-wait-spinner').count(),0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.ok(await page.getByRole('button',{name:'Download receipt',exact:true}).isVisible());
    assert.equal(checks,2);
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>closeDrawer());
    assert.equal(await page.locator('#drawer').count(),0);
    await page.close();
  }
  console.log('Automatic payment browser checks passed: mobile/desktop polling, success tick and no admin-confirm step.');
} finally {await browser.close();}
