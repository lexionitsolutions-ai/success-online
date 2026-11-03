// Browser checks use synthetic API responses; real cases are never deleted.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
mkdirSync('deliverables/case-deletion-preview',{recursive:true});
try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base={customer:{name:'Test Client',mobile:'9876543210'},service:{name:'Income Certificate'},variant:{name:'Application'},sales:{id:'sales'},amounts:{total:60000},document_state:'complete',updated_at:'2026-11-03T00:00:00Z'};
    let cases=[{...base,id:'unpaid',ref:'SO-UNPAID',status:'Awaiting Payment',payment_state:'unpaid',deletionAllowed:true},{...base,id:'paid',ref:'SO-PAID',status:'Assigned',payment_state:'paid',deletionAllowed:false}];
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname,json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:{id:'sales',role:'sales',name:'Sales Employee',username:'sales01'}});
      if(path==='/api/cases/unpaid' && route.request().method()==='DELETE') {cases=cases.filter(c=>c.id!=='unpaid');return json({ok:true});}
      if(path==='/api/cases') return json({cases});
      if(path==='/api/services') return json({services:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path.startsWith('/api/')) return json({});
      const file=path==='/'?'index.html':path.slice(1);
      if(!file.includes('..') && existsSync('public/'+file)) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync('public/'+file)});
      return route.abort();
    });
    await page.goto('https://case-delete-preview.test');await page.getByRole('heading',{name:'Sales workspace'}).waitFor();
    await page.locator('#recentUpdates summary').click();
    const unpaid=page.getByRole('button',{name:'Delete case SO-UNPAID',exact:true}),paid=page.getByRole('button',{name:'Delete case SO-PAID',exact:true});
    assert.equal(await unpaid.isEnabled(),true);assert.equal(await paid.isDisabled(),true);
    assert.equal(await page.locator('.case-table th').last().textContent(),'Delete case');
    await page.screenshot({path:`deliverables/case-deletion-preview/sales-${width}.png`,fullPage:true});
    page.once('dialog',dialog=>dialog.dismiss());await unpaid.click();assert.equal(cases.length,2);
    page.once('dialog',dialog=>dialog.accept());await unpaid.click();await unpaid.waitFor({state:'detached'});
    assert.equal(cases.length,1);assert.equal(await page.locator('#drawer').count(),0);
    assert.equal(await paid.isDisabled(),true);assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('Sales Delete column passed desktop/mobile layout, paid protection, confirmation cancellation and unpaid deletion.');
} finally {await browser.close();}
