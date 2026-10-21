// Browser checks use only synthetic fixtures and never access a live account.
import {chromium} from 'playwright';
import {existsSync,readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const root='deliverables/payment-batches';mkdirSync(root,{recursive:true});
try {
  for(const width of [320,390,768,1024,1280,1536]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    const payments=['Aarav Mehta','Priya Sharma'].map((customer_name,index)=>({id:'pay'+index,case_id:'case'+index,case_ref:'SO-2026-00000'+index,case_status:'Awaiting Payment',status:'PENDING',customer_name,customer_mobile:'9876543210',service_name:'Income Certificate',amount:100,gateway_order_id:'SO-P-fixture-'+index,employee_name:'Sales Employee',created_by:'sales',created_at:new Date().toISOString()}));
    const batch={id:'batch_fixture',batch:true,batch_id:'batch_fixture',case_id:'case0',gateway_order_id:'batch_fixture',customer_name:'Aarav Mehta, Priya Sharma',service_name:'2 work orders',status:'PENDING',amount:200,receiverReady:true,payee_name:'SUCCESS ONLINE SERVICES',upi_id:'merchant@upi',expires_at:new Date(Date.now()+60000).toISOString(),upiIntent:'upi://pay?am=2.00',qrDataUrl:await QRCode.toDataURL('upi://pay?am=2.00'),items:payments.map(p=>({...p,ref:p.case_ref})),attempts:[]};
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname,json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:{id:'sales',name:'Sales Employee',role:'sales'}});
      if(path==='/api/services') return json({services:[],cloudUploads:true});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/cases') return json({cases:[]});
      if(path==='/api/payments') {const q=new URL(route.request().url()).searchParams.get('q') || '';return json({payments:payments.filter(p=>p.customer_name.toLowerCase().includes(q.toLowerCase())),metrics:{}});}
      if(path==='/api/payment-settings') return json({receiverReady:true});
      if(path==='/api/payments/batch') {
        assert.deepEqual(route.request().postDataJSON().caseIds,['case0','case1']);
        for(const p of payments) Object.assign(p,{status:'PENDING',batch_id:batch.id,batch_status:'PENDING'});
        return json(batch);
      }
      if(path==='/api/payments/'+batch.id+'/cancel') {
        for(const p of payments) Object.assign(p,{status:'CANCELLED',batch_status:'CANCELLED'});
        return json({payment:{...batch,status:'CANCELLED',upiIntent:null,qrDataUrl:null}});
      }
      if(path==='/api/cases/case0/payment-order') return json({...payments[0],batch_id:null,batch:false,status:'PENDING',receiverReady:true,payee_name:batch.payee_name,upi_id:batch.upi_id,expires_at:batch.expires_at,upiIntent:'upi://pay?am=1.00',qrDataUrl:batch.qrDataUrl,attempts:[]});
      if(path.startsWith('/assets/payments/')) return route.fulfill({contentType:path.endsWith('.svg')?'image/svg+xml':'image/png',body:readFileSync('public'+path)});
      const file=path==='/'?'index.html':path.slice(1);
      if(['index.html','script.js','styles.css','mobile.css','payments.css','dashboard.css'].includes(file)) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync('public/'+file,'utf8')});
      return route.abort();
    });
    await page.goto('https://combined-checkout.test');
    await page.locator('.profile-button').waitFor();
    await page.evaluate(()=>window.setView('payments'));
    assert.equal(await page.getByRole('button',{name:'Pay selected cases',exact:true}).isDisabled(),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Payment dashboard must fit the screen');
    for(const actions of await page.locator('.payment-row-actions').all()) {
      const boxes=await actions.locator('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};}));
      assert.ok(boxes[1].left>=boxes[0].right+7 && Math.abs(boxes[1].top-boxes[0].top)<2,'View and Pay must be aligned with a clear gap');
    }
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`${root}/dashboard-${width}.png`,fullPage:true});
    await page.locator('#paymentFilters select').selectOption('customer');
    await page.getByRole('searchbox',{name:'Search value'}).fill('Priya');
    await page.getByRole('button',{name:'Search payments',exact:true}).click();
    await page.getByRole('button',{name:'Clear search'}).waitFor();
    assert.equal(await page.getByRole('checkbox').count(),1);
    assert.equal(await page.getByRole('searchbox',{name:'Search value'}).inputValue(),'Priya');
    assert.ok((await page.locator('#paymentFilters').boundingBox()).height<80,'Search toolbar stays compact');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:`${root}/search-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Clear search'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('input[type=checkbox]').length===2);
    await page.getByRole('checkbox').nth(0).check();await page.getByRole('checkbox').nth(1).check();
    assert.match(await page.locator('#combinedPaymentTotal').textContent(),/2 cases selected/);
    await page.getByRole('button',{name:'Pay selected cases'}).click();
    await page.locator('.checkout-amount').waitFor();
    assert.match(await page.locator('.checkout-amount').textContent(),/2/);
    assert.match(await page.locator('.checkout-summary').textContent(),/Included work orders/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:`${root}/combined-${width}.png`,fullPage:true});
    for(let attempt=0;attempt<2;attempt++) {
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      await page.getByRole('button',{name:'Reopen checkout',exact:true}).waitFor();
      await page.locator('.checkout-close').click();
      await page.waitForFunction(()=>document.querySelectorAll('input[type=checkbox]').length===2);
      await page.getByRole('checkbox').nth(0).check();
      if(attempt===0) await page.getByRole('checkbox').nth(1).check();
      await page.getByRole('button',{name:'Pay selected cases',exact:true}).click();
      await page.locator('.checkout-amount').waitFor();
      assert.match(await page.locator('.checkout-amount').textContent(),attempt===0 ? /2/ : /1/);
    }
    assert.doesNotMatch(await page.locator('.checkout-summary').textContent(),/Included work orders/);
    assert.deepEqual(errors,[]);
    console.log(`Combined selection and checkout passed at ${width}px.`);
    await context.close();
  }
} finally {await browser.close();}
