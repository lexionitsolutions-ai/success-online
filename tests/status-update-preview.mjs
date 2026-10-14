// Isolated browser fixture; never changes live case records.
import {chromium} from 'playwright';
import {existsSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  for(const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const employee={id:'office',name:'Test Office',username:'office',role:'backoffice'};
    const item={id:'case1',ref:'SO-2026-000001',customer:{name:'Test Customer',mobile:'9876543210'},service:{id:'s1',name:'PF Assistance'},variant:{id:'v1',name:'Application',documents:[],fields:[]},sales:{id:'sales',name:'Test Sales'},backoffice:employee,status:'Assigned',document_state:'complete',payment_state:'paid',priority:'Normal',details:{},amounts:{total:100},created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    let reads=0,saves=0;
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:employee});
      if(path==='/api/services') {reads++;return json({services:[],cloudUploads:true});}
      if(path==='/api/cases') {reads++;return json({cases:[item]});}
      if(path==='/api/cases/case1') {reads++;return json({case:item,documents:[],notes:[]});}
      if(path==='/api/cases/case1/progress') {
        saves++;const body=route.request().postDataJSON();
        await new Promise(resolve=>setTimeout(resolve,200));
        return json({case:{...item,status:body.status},note:{id:'note1',actor:'Test Office',new_status:body.status,note:body.note,created_at:new Date().toISOString()}});
      }
      const file=path==='/'?'index.html':path.slice(1);
      if(['index.html','script.js','styles.css','mobile.css','payments.css'].includes(file)) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync('public/'+file,'utf8')});
      return route.abort();
    });
    await page.goto('https://status-preview.test');
    await page.locator('.profile-button').waitFor();
    await page.evaluate(()=>window.openCase('case1'));
    await page.locator('#note').fill('Documents checked and ready');
    await page.locator('#nextStatus').selectOption('Ready to Submit');
    const baseline=reads;
    await page.getByRole('button',{name:'Update status',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#drawer')?.textContent.includes('Documents checked and ready') && document.querySelector('#nextStatus')?.value==='Submitted to Official Portal');
    assert.equal(reads,baseline,'Saving must not reload all services/cases or refetch the drawer');
    assert.equal(saves,1);assert.equal(await page.locator('#drawer').count(),1);
    assert.equal(await page.getByRole('button',{name:'Update status',exact:true}).isEnabled(),true);
    assert.ok(await page.locator('.case-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.deepEqual(errors,[]);
    console.log(`In-place back-office status update passed at ${width}px, with no reload requests.`);
    await context.close();
  }
} finally {await browser.close();}
