// Synthetic fixtures only: no real payments are made or confirmed.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
mkdirSync('deliverables/cash-pending-preview',{recursive:true});
try {
  for(const width of [390,1440]) for(const role of ['sales','admin']) {
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    let recorded=0,settingsReads=0;
    const balance={case_id:'case1',ref:'SO-2026-000052',sales_user_id:'sales',customer_name:'Test Client',customer_mobile:'9876543210',service_name:'Non-Creamy Layer Certificate',employee_name:'Mahalaxmi Online Services',case_status:'Closed',total:50000,confirmed_paid:30000,pending_amount:20000,amount_to_pay:20000,awaiting_verification:0};
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname,json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:{id:role,role,name:role==='sales'?'Mahalaxmi Online Services':'Administrator',username:role==='sales'?'7028405101':'admin',cashPaymentsAllowed:role==='sales'}});
      if(path==='/api/cases') return json({cases:[]});
      if(path==='/api/services') return json({services:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path==='/api/payment-settings') {settingsReads++;return json({});}
      if(path==='/api/payments') return json({payments:[],metrics:{collected:30000,today:30000,verified:1}});
      if(path==='/api/payments/cash-pending') return json({cases:[balance]});
      if(path==='/api/cases/case1/payment-order') return json({id:'upi200',gateway:'balance_upi',cash_account:'case1',case_id:'case1',amount:20000,status:'PENDING',service_name:balance.service_name,customer_name:balance.customer_name,payee_name:'SUCCESS ONLINE SERVICES',gateway_order_id:'TEST-200',upi_id:'test@example',receiverReady:true,attempts:[],cashPaymentAllowed:true,upiIntent:'upi://pay?pa=test@example&am=200.00'});
      if(path==='/api/cases/case1/cash-payment') {const body=route.request().postDataJSON();assert.equal(body.amount,20000);assert.ok(body.requestId);recorded++;balance.amount_to_pay=0;balance.awaiting_verification=20000;return json({ok:true});}
      const file=path==='/'?'index.html':path.slice(1);
      if(!file.includes('..') && existsSync('public/'+file)) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync('public/'+file)});
      return route.abort();
    });
    await page.goto('https://cash-pending.test');await page.getByRole('heading',{name:role==='sales'?'Sales workspace':'Operations workspace'}).waitFor();
    if(width<901) await page.locator('.mobile-more summary').click();
    await page.locator(`${width<901?'.more-menu':'.side'} [data-view="payments"]`).click();
    const pendingCard=page.getByRole('button',{name:'View cash pending amount',exact:true});
    await pendingCard.waitFor();assert.match(await pendingCard.innerText(),/₹200\.00/);
    await pendingCard.click();
    await page.locator('.cash-pending-table').waitFor();
    assert.match(await page.locator('.cash-pending-panel').innerText(),/₹200\.00/);
    assert.equal(await page.getByText(/Receiver & service pricing/).count(),0);
    await page.screenshot({path:`deliverables/cash-pending-preview/${role}-${width}.png`,fullPage:true});
    if(role==='sales') {
      await page.getByRole('button',{name:'Pay ₹200.00 with UPI',exact:true}).click();
      await page.locator('.checkout-amount').waitFor();assert.equal(await page.locator('.checkout-amount').innerText(),'₹200.00');
      await page.locator('.checkout-close').click();
      await page.getByRole('button',{name:'Pay in cash',exact:true}).click();
      await page.getByRole('button',{name:'Record cash payment',exact:true}).click();
      await page.getByText('Waiting for admin confirmation',{exact:true}).waitFor();assert.equal(recorded,1);
    } else assert.equal(await page.getByRole('button',{name:'Pay in cash',exact:true}).count(),0);
    assert.equal(settingsReads,0);assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Cash pending tab passed INR 200 balance visibility, later cash/UPI payment, admin access and removed settings at 390px and 1440px.');
} finally {await browser.close();}
