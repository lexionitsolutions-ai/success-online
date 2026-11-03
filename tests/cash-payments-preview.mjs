// Isolated browser fixtures; no real accounts, payments or uploads are modified.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
const injection=`
  window.previewCash=(stage,enabled=true)=>{
    closeDrawer();me={id:'sales',name:'Mahalaxmi Online Services',username:'7028405101',role:'sales',cashPaymentsAllowed:enabled};
    const variant={id:'variant',name:'Application',fields:[],documents:[],amounts:{serviceCharge:60000,officialFee:0,tax:0,total:60000}};
    services=[{id:'service',name:'EWS Certificate',slug:'ews-certificate',variants:[variant]}];
    if(stage==='checkout') {checkout={id:'online',case_id:'case1',case_ref:'SORO-2026-001',cashPaymentAllowed:enabled,amount:60000,status:'PENDING',gateway:'direct_upi',payee_name:'SUCCESS ONLINE SERVICES',customer_name:'Anita Patil',service_name:'EWS Certificate',gateway_order_id:'TEST-CHECKOUT',receiverReady:true,upiIntent:'upi://pay?pa=test@example&am=600.00',attempts:[],qrDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSU8AAAAASUVORK5CYII='};document.body.insertAdjacentHTML('beforeend','<div class="drawer" id="drawer"><div class="panel payment-checkout">'+checkoutHTML(checkout)+'</div></div>');}
    if(stage==='review') {draft={step:4,customer:{name:'Anita Patil',mobile:'9876543210'},serviceId:'service',variantId:'variant',details:{},docs:{},paymentMethod:'cash',cashAmount:'100'};drawWizard();}
    if(stage==='balance') {const item={id:'case1',ref:'SORO-2026-001',status:'Closed',sales:{id:'sales'},cashPayment:{total:60000,confirmedPaid:10000,recordedPaid:10000,awaitingVerification:0,pendingAmount:50000,amountToPay:50000,processingAllowed:true,releaseAllowed:false},cashReceipts:[{id:'receipt',method:'Cash',amount:10000,status:'PAID',created_at:'2026-11-03T00:00:00Z'}]};document.body.insertAdjacentHTML('beforeend','<div class="drawer" id="drawer"><div class="panel"><div class="drawer-head"><h2>'+item.ref+'</h2><button onclick="closeDrawer()">Close</button></div>'+cashCasePanel(item)+'</div></div>');}
    if(stage==='admin') {me.role='admin';me.cashPaymentsAllowed=false;document.body.insertAdjacentHTML('beforeend','<div class="drawer" id="drawer"><div class="panel">'+checkoutHTML({id:'receipt',gateway:'cash',case_id:'case1',case_ref:'SORO-2026-001',customer_name:'Anita Patil',service_name:'EWS Certificate',amount:50000,status:'AWAITING_VERIFICATION',created_at:'2026-11-03T00:00:00Z'})+'</div></div>');}
  };
`;
mkdirSync('deliverables/cash-payments-preview',{recursive:true});
try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname,json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:{id:'sales',name:'Mahalaxmi Online Services',username:'7028405101',role:'sales',cashPaymentsAllowed:true}});
      if(path==='/api/cases') return json({cases:[]});
      if(path==='/api/services') return json({services:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path.startsWith('/api/')) return json({});
      const file=path==='/'?'index.html':path.slice(1);
      if(!file.includes('..') && existsSync('public/'+file)) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:file==='script.js'?readFileSync('public/script.js','utf8')+injection:readFileSync('public/'+file)});
      return route.abort();
    });
    await page.goto('https://cash-preview.test');await page.getByRole('heading',{name:'Sales workspace'}).waitFor();
    await page.evaluate(()=>window.previewCash('checkout'));
    await page.getByRole('button',{name:'Pay in cash',exact:true}).click();
    await page.locator('#checkoutCashForm input').fill('200');
    assert.match(await page.locator('#checkoutCashPending').innerText(),/400\.00/);
    await page.locator('.checkout-cash-choice').screenshot({path:`deliverables/cash-payments-preview/checkout-${width}.png`});
    await page.getByRole('button',{name:'Pay online',exact:true}).click();
    assert.equal(await page.locator('#checkoutCashForm').isVisible(),false);
    await page.evaluate(()=>window.previewCash('review'));
    await page.getByLabel('Cash amount paid (₹)').fill('200');
    assert.match(await page.locator('#reviewCashPending').innerText(),/400\.00/);
    assert.match(await page.locator('.steps').textContent(),/Services/);
    await page.locator('#drawer .panel').screenshot({path:`deliverables/cash-payments-preview/review-${width}.png`});
    await page.getByLabel('Choose payment method').selectOption('online');
    assert.equal(await page.locator('#reviewCashAmount').count(),0);
    await page.evaluate(()=>window.previewCash('review',false));
    assert.equal(await page.getByLabel('Choose payment method').count(),0);
    await page.evaluate(()=>window.previewCash('balance'));
    assert.ok(await page.getByText('Pay the pending amount to receive the document',{exact:true}).isVisible());
    assert.ok(await page.getByRole('button',{name:'Record cash payment',exact:true}).isVisible());
    await page.locator('#drawer .panel').screenshot({path:`deliverables/cash-payments-preview/balance-${width}.png`});
    await page.evaluate(()=>window.previewCash('admin'));
    assert.ok(await page.getByRole('button',{name:'Confirm cash received',exact:true}).isVisible());
    await page.locator('#drawer .panel').screenshot({path:`deliverables/cash-payments-preview/admin-${width}.png`});
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Cash review, remaining balance, account restriction and admin receipt screens passed at 390px and 1440px.');
} finally {await browser.close();}
