// Focused browser QA using local source and synthetic data; no live customer data.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
const source=serviceCatalog.find(s=>s.slug==='income-certificate');
const service={...source,id:'income',variants:[{id:'income-variant',fields:source.fields,documents:source.documents,amounts:{serviceCharge:20000,officialFee:0,tax:0,total:20000}}]};
mkdirSync('deliverables/income-preview',{recursive:true});
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://income-preview.test/**',route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/') return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/mobile.css"><link rel="stylesheet" href="/dashboard.css"></head><body><main id="app"></main></body></html>'});
      return route.fulfill({contentType:path.endsWith('.pdf')?'application/pdf':path.endsWith('.css')?'text/css':'text/javascript',body:readFileSync(join('public',path.slice(1)))});
    });
    await page.goto('https://income-preview.test/');
    await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
    await page.addScriptTag({content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')+`\nwindow.prepareIncome = data => {services=[data];draft={step:2,serviceId:data.id,variantId:data.variants[0].id,customer:{name:'Test Applicant',mobile:'9876543210'},details:{},docs:{}};drawWizard();};`});
    await page.evaluate(data=>window.prepareIncome(data),service);
    const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
    await field('Years of Certificate Required').selectOption('1 year');
    await field('Income amount required on certificate (₹)').fill('100000');
    await field('Reason for application').selectOption('Hospital');
    await field('Ration card colour').selectOption('Yellow');
    await field('Ration card area').selectOption('City');
    await field('Is Talathi Report available?').selectOption('No');
    await field('Will you bring a signed Talathi Report?').selectOption('Yes');
    assert.equal(await page.locator('.intake-notices').evaluate(el=>el.open),false);
    await page.locator('.intake-notices>summary').click();
    assert.equal(await page.locator('.income-download').count(),1);
    assert.match(await page.locator('.income-notes').innerText(),/₹1 lakh/);
    assert.doesNotMatch(await page.locator('#svcInfo').innerText(),/Fees to confirm/i);
    assert.equal(await page.locator('.income-checklist li').count(),5);
    await field('Income amount required on certificate (₹)').fill('100001');
    await field('Income amount required on certificate (₹)').blur();
    assert.equal(await page.locator('.intake-notices').evaluate(el=>el.open),true,'Open notices stay open when the form updates');
    assert.equal(await page.locator('.income-checklist li').count(),6);
    const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('link',{name:/Download application form/}).click()]);
    assert.equal(download.suggestedFilename(),'income-certificate-form.pdf');
    await page.screenshot({path:`deliverables/income-preview/download-${width}.png`,fullPage:true});
    await field('Will you bring a signed Talathi Report?').selectOption('No');
    assert.equal(await page.locator('.income-download').count(),0);
    assert.match(await page.locator('.income-fee-notice').innerText(),/400/);
    await page.screenshot({path:`deliverables/income-preview/surcharge-${width}.png`,fullPage:true});
    await field('Is Talathi Report available?').selectOption('Yes');
    assert.equal(await field('Will you bring a signed Talathi Report?').count(),0);
    assert.equal(await page.locator('.income-fee-notice').count(),0);
    await field('Is Talathi Report available?').selectOption('No');
    assert.equal(await field('Will you bring a signed Talathi Report?').inputValue(),'');
    await field('Ration card area').selectOption('Village');
    assert.equal(await field('Is Talathi Report available?').count(),0);
    await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
    assert.match(await page.locator('.upload-list').innerText(),/Hospital Letter.*वैद्यकीय दाखला.*चिकित्सा प्रमाण पत्र/);
    assert.equal(await page.locator('.doc').count(),6);
    assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
    await page.screenshot({path:`deliverables/income-preview/uploads-${width}.png`,fullPage:true});
    assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'No horizontal overflow');
    assert.deepEqual(errors,[]);
    await page.close();
    console.log(`Income certificate browser checks passed at ${width}px`);
  }
} finally {await browser.close();}
