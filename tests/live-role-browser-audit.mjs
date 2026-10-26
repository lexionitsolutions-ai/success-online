import {chromium} from 'playwright';
import {loadEnvFile} from 'node:process';
import {existsSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
loadEnvFile('.env');
const base='https://success-online.vercel.app',path='deliverables/full-qa-2026-10-26/live-role-browser.json',results=[];
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try{
 for(const width of [390,1280])for(const role of ['SALES','BACKOFFICE','ADMIN']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('response',response=>{if(response.url().startsWith(base+'/api/')&&response.status()>=500)errors.push(`${new URL(response.url()).pathname}: ${response.status()}`);});
  await page.goto(base);await page.locator('input[name="username"]').fill(process.env[`INITIAL_${role}_USERNAME`]);await page.locator('input[name="password"]').fill(process.env[`INITIAL_${role}_PASSWORD`]);await page.locator('button[type="submit"]').click();await page.waitForSelector('.shell');
  const views=await page.locator('[data-view]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.dataset.view))]);
  for(const view of views){
   const result={role,width,view,status:'passed'};results.push(result);
   try{await page.evaluate(view=>window.setView(view),view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.locator('.shell').count(),1);}
   catch(error){result.status='failed';result.error=error.message;}
   writeFileSync(path,JSON.stringify(results,null,2));console.log(role,width,view,result.status);
  }
  const data=await page.evaluate(async()=>fetch('/api/cases').then(r=>r.json()));
  if(role!=='SALES')assert.ok(data.cases.every(c=>c.payment_state==='paid'&&c.document_state==='complete'));
  if(role==='SALES')assert.ok(data.cases.some(c=>c.customer.name.startsWith('Demo Audit')));
  if(errors.length)results.push({role,width,status:'failed',error:errors.join('; ')});
  await page.evaluate(()=>window.logout());await page.waitForSelector('input[name="username"]');await page.close();
 }
 writeFileSync(path,JSON.stringify(results,null,2));const failures=results.filter(row=>row.status==='failed');console.log(JSON.stringify({checks:results.length,failures:failures.length}));if(failures.length)process.exitCode=1;
}finally{await browser.close();}
