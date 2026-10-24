// Synthetic posts in an isolated temporary database; never publishes to live staff.
import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root=mkdtempSync(join(tmpdir(),'announcement-preview-'));
const port=45000+Math.floor(Math.random()*1500),origin=`http://localhost:${port}`;
const child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',PORT:String(port),APP_ORIGIN:origin,DATABASE_PATH:join(root,'test.sqlite'),STORAGE_PATH:join(root,'files'),DRIVE_MODE:'demo',SHEETS_MODE:'demo',SESSION_SECRET:'announcement-browser-isolated-secret'},stdio:['ignore','pipe','pipe']});
let browser,stderr='';child.stderr.on('data',d=>stderr+=d);
const screenshots='deliverables/announcements';mkdirSync(screenshots,{recursive:true});
try {
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(stderr)),15000);child.stdout.on('data',d=>{if(String(d).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',code=>{clearTimeout(timer);reject(Error(`Exited ${code}: ${stderr}`));});});
  const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
  const admin=await browser.newContext({viewport:{width:1280,height:1000}}),sales=await browser.newContext({viewport:{width:390,height:1000}}),office=await browser.newContext({viewport:{width:1280,height:1000}});
  for(const [context,username] of [[admin,'admin01'],[sales,'sales01'],[office,'backoffice01']]) assert.equal((await context.request.post(origin+'/api/login',{data:{username,password:'Demo@12345'}})).status(),200);
  const adminPage=await admin.newPage(),salesPage=await sales.newPage(),officePage=await office.newPage(),errors=[];
  for(const page of [adminPage,salesPage,officePage]) {page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('.profile-button').waitFor();}
  assert.ok((await adminPage.locator('.announcements-section').boundingBox()).y>(await adminPage.locator('#recentUpdates').boundingBox()).y);
  assert.equal(await salesPage.locator('.announcement-composer').count(),0);assert.equal(await officePage.locator('.announcement-composer').count(),0);
  await adminPage.locator('.announcement-composer>summary').click();
  await adminPage.locator('#announcementTitle').fill('Service desk update');
  await adminPage.getByRole('button',{name:'Publish announcement',exact:true}).click();
  assert.match(await adminPage.locator('#announcementError').innerText(),/update or picture/);
  await adminPage.locator('#announcementBody').fill('Please review the latest service instructions before starting new applications.\nThank you, team.');
  await adminPage.getByRole('button',{name:'Publish announcement',exact:true}).click();
  await adminPage.getByRole('heading',{name:'Service desk update',exact:true}).waitFor();
  await adminPage.locator('.announcement-composer>summary').click();
  await adminPage.locator('#announcementTitle').fill('New team resources');
  await adminPage.locator('#announcementBody').fill('Updated forms and guidance are ready for the team.');
  const base64=await adminPage.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=840;canvas.height=340;const c=canvas.getContext('2d');const g=c.createLinearGradient(0,0,840,340);g.addColorStop(0,'#123e49');g.addColorStop(1,'#138362');c.fillStyle=g;c.fillRect(0,0,840,340);c.fillStyle='#9de2cc';c.font='bold 18px Arial';c.fillText('SUCCESS ONLINE · TEAM UPDATE',44,65);c.fillStyle='#ffffff';c.font='bold 44px Arial';c.fillText('New service resources',44,145);c.font='24px Arial';c.fillText('Forms, instructions and useful updates',44,195);c.fillStyle='#bde6d8';c.font='18px Arial';c.fillText('Keep the team informed in one place.',44,275);return canvas.toDataURL('image/png').split(',')[1];});
  const picture={name:'team-update.png',mimeType:'image/png',buffer:Buffer.from(base64,'base64')};
  await adminPage.locator('#announcementPicture').setInputFiles(picture);
  await adminPage.waitForFunction(()=>document.querySelector('.announcement-picture-preview img')?.naturalWidth>0);
  await adminPage.getByRole('button',{name:'Remove picture',exact:true}).click();
  assert.equal(await adminPage.locator('#announcementPicture').evaluate(el=>el.files.length),0);
  await adminPage.locator('#announcementPicture').setInputFiles(picture);
  let failed=false;
  await adminPage.route('**/api/announcements',route=>{if(route.request().method()==='POST'&&!failed){failed=true;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary test failure. Retry your post.'})});}return route.continue();});
  await adminPage.getByRole('button',{name:'Publish announcement',exact:true}).click();
  await adminPage.locator('#announcementError').filter({hasText:'Temporary test failure'}).waitFor();
  assert.equal(await adminPage.locator('#announcementTitle').inputValue(),'New team resources');
  assert.equal(await adminPage.locator('#announcementPicture').evaluate(el=>el.files.length),1);
  await adminPage.getByRole('button',{name:'Publish announcement',exact:true}).click();
  await adminPage.getByRole('heading',{name:'New team resources',exact:true}).waitFor();
  await adminPage.waitForFunction(()=>document.querySelector('.announcement-card img')?.naturalWidth>0);
  for(const width of [1280,390]) {
    await adminPage.setViewportSize({width,height:1000});
    assert.ok(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await adminPage.screenshot({path:join(screenshots,`admin-${width}.png`),fullPage:true});
  }
  for(const [page,role] of [[salesPage,'sales'],[officePage,'backoffice']]) {
    await page.reload();await page.getByRole('heading',{name:'New team resources',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.announcement-card img')?.naturalWidth>0);
    assert.equal(await page.locator('.announcement-remove').count(),0);
    assert.equal(await page.locator('.announcement-composer').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:join(screenshots,`${role}-feed.png`),fullPage:true});
  }
  await adminPage.getByRole('button',{name:'Remove announcement: New team resources',exact:true}).click();
  await adminPage.getByRole('heading',{name:'New team resources',exact:true}).waitFor({state:'detached'});
  await salesPage.reload();await salesPage.locator('.profile-button').waitFor();
  assert.equal(await salesPage.getByRole('heading',{name:'New team resources',exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log('Announcements: admin publishing, text and picture posts, preview/removal, retry preservation, staff visibility, and mobile/desktop layout passed.');
} finally {await browser?.close();child.kill();}
