// Synthetic browser fixtures only: no real payments are confirmed or messages sent.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
mkdirSync('deliverables/payment-review-preview',{recursive:true});
try {
  for(const width of [390,1440]) for(const role of ['admin','backoffice']) {
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const payment={id:'cash1',gateway:'cash',cash_account:'case1',case_id:'case1',case_ref:'SO-2026-001',gateway_order_id:'TEST-CASH',amount:30000,customer_name:'Test Client',customer_mobile:'9876543210',service_name:'Income Certificate',employee_name:'Mahalaxmi Online Services',payment_method:'Cash',status:'AWAITING_VERIFICATION',created_at:'2026-11-03T08:00:00Z',attempts:[]};
    let confirms=0,reuploads=0;
    let c={id:'case1',ref:'SO-2026-001',customer:{name:'Test Client',mobile:'9876543210'},service:{id:'svc',name:'Income Certificate'},variant:{name:'Application',fields:[],documents:[{label:'Aadhaar Card',required:true}]},sales:{id:'sales',name:'Mahalaxmi'},backoffice:{id:'backoffice',name:'Backoffice Employee'},status:'Assigned',document_state:'complete',payment_state:'paid',amounts:{total:60000},details:{},updated_at:'2026-11-03T08:00:00Z'};
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname,json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:{id:role,role,name:role==='admin'?'Administrator':'Backoffice Employee',username:role+'01'}});
      if(path==='/api/cases') return json({cases:role==='backoffice'?[c]:[]});
      if(path==='/api/cases/case1/request-reupload') {reuploads++;assert.deepEqual(route.request().postDataJSON().documentTypes,['Aadhaar Card']);c={...c,status:'Correction Required',reupload:{pending:true,requestedTypes:['Aadhaar Card'],missingTypes:['Aadhaar Card'],pendingDocumentIds:[],submittedDocumentIds:[]}};return json({case:c,documents:[],notes:[{new_status:'Correction Required',actor:'Backoffice Employee',note:'Upload a clearer copy'}]});}
      if(path==='/api/cases/case1') return json({case:c,documents:[],notes:[]});
      if(path==='/api/services') return json({services:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/notifications/read') return json({ok:true});
      if(path==='/api/payments/cash1/verify') {confirms++;payment.status='PAID';payment.verified_at='2026-11-03T09:00:00Z';return json({ok:true,payment});}
      if(path==='/api/payments/cash1') return json(payment);
      if(path==='/api/payments') return json({payments:[payment],metrics:{collected:payment.status==='PAID'?30000:0,today:0,awaiting:payment.status==='PAID'?0:1,verified:payment.status==='PAID'?1:0,failed:0}});
      if(path==='/api/payment-settings') return json({receiverReady:true,prices:[],payeeName:'SUCCESS ONLINE SERVICES',upiId:'test@example',testPricingMode:false});
      const file=path==='/'?'index.html':path.slice(1);
      if(!file.includes('..') && existsSync('public/'+file)) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync('public/'+file)});
      return route.abort();
    });
    await page.goto('https://review-preview.test');await page.getByRole('heading',{name:'Operations workspace'}).waitFor();
    if(role==='admin') {
      if(width<901) await page.locator('.mobile-more summary').click();
      await page.locator(`${width<901?'.more-menu':'.side'} [data-view="payments"]`).click();
      await page.getByRole('button',{name:'Review',exact:true}).click();
      await page.getByRole('button',{name:'Confirm cash received',exact:true}).last().waitFor();
      await page.locator('.cash-receipt-layout').screenshot({path:`deliverables/payment-review-preview/receipt-${width}.png`});
      await page.locator('#drawer').getByRole('button',{name:'Close',exact:true}).click();
      await page.screenshot({path:`deliverables/payment-review-preview/actions-${width}.png`,fullPage:true});
      await page.getByRole('button',{name:'Confirm cash received',exact:true}).click();
      await page.getByRole('button',{name:'Confirm cash received',exact:true}).waitFor({state:'detached'});
      assert.equal(confirms,1);assert.match(await page.locator('.payment-status-cell').innerText(),/Verified/);
    } else {
      await page.locator(`${width<901?'.mobile-nav':'.side'} [data-view="cases"]`).click();
      await page.locator('.case-link').click();
      await page.locator('.document-section-actions').getByRole('button',{name:'Request reupload',exact:true}).click();
      await page.locator('#caseReuploadForm textarea').fill('Upload a clearer copy');
      await page.locator('#caseReuploadForm').screenshot({path:`deliverables/payment-review-preview/reupload-${width}.png`});
      await page.getByRole('button',{name:'Send reupload request',exact:true}).click();
      await page.getByText('Reupload request sent to sales.',{exact:true}).waitFor();assert.equal(reuploads,1);
    }
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Payments Review/Confirm and backoffice reupload requests passed at 390px and 1440px.');
} finally {await browser.close();}
