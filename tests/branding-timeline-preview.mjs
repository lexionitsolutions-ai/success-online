// Browser QA with synthetic accounts and service data; no production writes.
import {chromium} from 'playwright';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';

const services=serviceCatalog.map((s,i)=>({...s,id:'service-'+i,variants:[{id:'variant-'+i,name:'Application',fields:s.fields||[],documents:s.documents||[],amounts:{serviceCharge:30000,officialFee:0,tax:0,total:30000}}]}));
const expected={'caste-validity':'30–45 days','ews-certificate':'30–45 days','food-license':'Around 45 days','pf-assistance':'5–10 days','income-certificate':'10–15 days','domicile-certificate':'10–15 days','non-creamy-layer':'30–45 days',passport:'22–30 days','voting-card':'2–3 months',pan:'22–30 days','ration-card':'2–3 months','caste-certificate':'30–45 days',gazette:'15–20 days','police-clearance':'15–20 days','shop-act':'4–5 days','udyam-aadhaar':'4–5 days'};
const root='deliverables/branding-timelines';mkdirSync(root,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
try {
  for(const width of [390,1280]) {
    const context=await browser.newContext({viewport:{width,height:900}});let signedIn=false;
    const user={id:'sales-preview',name:'Preview Sales',username:'sales-preview',role:'sales'};
    await context.route('**/*',route=>{
      const path=new URL(route.request().url()).pathname;
      const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(path==='/api/me') return json({user:signedIn?user:null},signedIn?200:401);
      if(path==='/api/login') {signedIn=true;return json({user});}
      if(path==='/api/services') return json({services});
      if(path==='/api/cases') return json({cases:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path.startsWith('/api/')) return json({});
      const file=join('public',path==='/'?'index.html':path.slice(1));
      if(!existsSync(file)) return route.fulfill({status:404,body:'Missing fixture asset'});
      return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html',body:readFileSync(file)});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('https://brand-preview.test');
    await page.locator('#login').waitFor();
    await page.locator('.login-logo-card img').evaluate(img=>img.decode());
    assert.equal(await page.locator('.login-logo-card img').evaluate(img=>img.naturalWidth>0),true);
    await page.screenshot({path:join(root,`login-${width}.png`),fullPage:true});
    await page.locator('#login [name="username"]').fill('sales-preview');
    await page.locator('#login [name="password"]').fill('Demo@12345');
    await page.locator('#login button[type="submit"]').click();
    await page.locator('.new-case-button').waitFor();
    const mark=page.locator(width<900?'.mobile-brand img':'.side-brand img');
    await mark.evaluate(img=>img.decode());assert.equal(await mark.evaluate(img=>img.naturalWidth>0),true);
    await page.locator('.new-case-button').click();
    await page.locator('#name').fill('Timeline Preview');await page.locator('#mobile').fill('9876543210');
    await page.locator('#wizard').getByRole('button',{name:'Continue',exact:true}).click();
    for(const service of services) {
      await page.locator('#service').selectOption(service.id);
      const notice=page.locator('#serviceTimeline .service-timeline');
      assert.equal(await notice.count(),1);
      assert.ok((await notice.innerText()).includes(expected[service.slug]),service.slug);
    }
    await page.locator('#service').selectOption(services.find(s=>s.slug==='passport').id);
    assert.match(await page.locator('#serviceTimeline').innerText(),/After the appointment/);
    const bg=await page.locator('#serviceTimeline .service-timeline').evaluate(el=>getComputedStyle(el).backgroundImage);
    assert.match(bg,/gradient/);
    await page.screenshot({path:join(root,`passport-${width}.png`),fullPage:true});
    await page.locator('#service').selectOption(services.find(s=>s.slug==='ews-certificate').id);
    await page.locator('#drawer [data-intake-language="mr"]').click();
    assert.match(await page.locator('#serviceTimeline').innerText(),/३०–४५ दिवस/);
    assert.doesNotMatch(await page.locator('#serviceTimeline').innerText(),/Average processing time/);
    assert.equal(await page.locator('#service').inputValue(),services.find(s=>s.slug==='ews-certificate').id);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(root,`ews-marathi-${width}.png`),fullPage:true});
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Passed: logo assets, login and navigation at mobile/desktop sizes, all 16 timelines, qualifiers, Marathi and overflow checks.');
} finally {await browser.close();}
