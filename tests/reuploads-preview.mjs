// Full browser workflow against an isolated database; never uses live cases.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const root=mkdtempSync(join(tmpdir(),'reupload-browser-'));
const port=46000+Math.floor(Math.random()*2000), origin=`http://localhost:${port}`;
const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),APP_ORIGIN:origin,DATABASE_PATH:join(root,'test.sqlite'),STORAGE_PATH:join(root,'files'),DRIVE_MODE:'demo',SHEETS_MODE:'demo',SESSION_SECRET:'reupload-test-only-session-secret'},stdio:['ignore','pipe','pipe']});
let serverErrors='',browser;
child.stderr.on('data',data=>serverErrors+=data);
const screenshots='deliverables/reuploads-preview';mkdirSync(screenshots,{recursive:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSU8AAAAASUVORK5CYII=','base64');
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(serverErrors)),15000);child.stdout.on('data',data=>{if(String(data).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',code=>{clearTimeout(timer);reject(Error(`Server exited ${code}: ${serverErrors}`));});});
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const admin=await browser.newContext();
  await admin.request.post(origin+'/api/login',{data:{username:'admin01',password:'Demo@12345'}});
  const services=await (await admin.request.get(origin+'/api/services')).json();
  const variant=services.services.find(service=>service.slug==='pf-assistance').variants[0];
  for(const width of [390,1280]) {
    const sales=await browser.newContext({viewport:{width,height:900}}),office=await browser.newContext({viewport:{width,height:900}});
    await sales.request.post(origin+'/api/login',{data:{username:'sales01',password:'Demo@12345'}});
    await office.request.post(origin+'/api/login',{data:{username:'backoffice01',password:'Demo@12345'}});
    const created=await (await sales.request.post(origin+'/api/cases',{data:{variantId:variant.id,customer:{name:'Reupload Test',mobile:'9876543210'},consent:true}})).json();
    const id=created.case.id, path=origin+'/api/cases/'+id;
    assert.equal((await sales.request.post(path+'/documents',{data:{docType:'Bank Passbook',fileName:'original.png',mimeType:'image/png',size:png.length,content:png.toString('base64')}})).status(),201);
    assert.equal((await admin.request.post(path+'/payment-exception',{data:{reason:'Isolated browser test exception'}})).status(),200);
    assert.equal((await office.request.post(path+'/claim',{data:{}})).status(),200);
    const officePage=await office.newPage(),salesPage=await sales.newPage(),errors=[];
    officePage.on('pageerror',error=>errors.push(error.message));salesPage.on('pageerror',error=>errors.push(error.message));
    await officePage.goto(origin);await officePage.locator('.profile-button').waitFor();
    await officePage.evaluate(id=>window.openCase(id),id);
    await officePage.getByRole('button',{name:'Request reupload',exact:true}).click();
    await officePage.locator('.reupload-request-form textarea').fill('Please upload a clear passbook scan with the account details visible.');
    await officePage.getByRole('button',{name:'Send reupload request',exact:true}).click();
    await officePage.locator('.doc-reupload-requested').waitFor();
    assert.equal(await officePage.getByRole('button',{name:'Submit reupload',exact:true}).count(),0);
    await salesPage.goto(origin);await salesPage.locator('.profile-button').waitFor();
    await salesPage.evaluate(id=>window.openCase(id),id);
    await salesPage.locator('.doc-reupload-requested').waitFor();
    assert.equal(await salesPage.getByRole('button',{name:'Submit reupload',exact:true}).isDisabled(),true);
    await salesPage.locator('#drawer input[type=file]').setInputFiles({name:'corrected-passbook.png',mimeType:'image/png',buffer:png});
    await salesPage.locator('.doc-reuploaded-pending').waitFor();
    assert.match(await salesPage.locator('.doc-reuploaded-pending .reupload-tag').innerText(),/not submitted/);
    assert.equal((await (await sales.request.get(path)).json()).case.status,'Correction Required');
    await salesPage.getByRole('button',{name:'Preview Bank Passbook',exact:true}).click();
    await salesPage.waitForFunction(()=>document.querySelector('#documentPreview img')?.naturalWidth>0);
    await salesPage.getByRole('button',{name:'Close preview',exact:true}).click();
    await salesPage.screenshot({path:`${screenshots}/sales-ready-${width}.png`,fullPage:true});
    await salesPage.getByRole('button',{name:'Submit reupload',exact:true}).click();
    await salesPage.locator('.reupload-submission.is-submitted').waitFor();
    assert.equal((await (await sales.request.get(path)).json()).case.status,'Document Review');
    await officePage.evaluate(async id=>{window.closeDrawer();await window.openCase(id);},id);
    await officePage.locator('.doc-reuploaded-submitted').waitFor();
    assert.match(await officePage.locator('.doc-reuploaded-submitted .reupload-tag').innerText(),/submitted for review/);
    for(const page of [salesPage,officePage]) assert.ok(await page.locator('.case-panel').evaluate(panel=>panel.scrollWidth<=panel.clientWidth+1),'Document actions fit the case panel');
    await officePage.screenshot({path:`${screenshots}/backoffice-review-${width}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(`Reupload request, upload, preview, explicit submission, and both-role highlights passed at ${width}px.`);
    await sales.close();await office.close();
  }
  await admin.close();
} finally {
  if(browser) await browser.close();
  child.kill();
}
