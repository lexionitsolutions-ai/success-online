import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
 const page=await browser.newPage();
 await page.setContent('<main id="app"></main>');
 for(const file of ['styles.css','mobile.css','dashboard.css']) await page.addStyleTag({content:readFileSync(`public/${file}`,'utf8')});
 await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
 await page.addScriptTag({type:'module',content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')+`
 window.setupPolice=catalog=>{
  closeDrawer();services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{serviceCharge:s.serviceCharge||100,officialFee:0,tax:0,total:s.serviceCharge||100}}]}));
  draft={step:2,serviceId:'police-clearance',variantId:'police-clearance',customer:{name:'Test Customer',mobile:'9876543210'},details:{},docs:{}};drawWizard();
 };
 `});
 await page.waitForFunction(()=>!!window.setupPolice);
 const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
 mkdirSync('deliverables/police-clearance',{recursive:true});
 for(const width of [390,1280]) {
  await page.setViewportSize({width,height:1000});
  await page.evaluate(catalog=>window.setupPolice(catalog),serviceCatalog);
  assert.deepEqual(await field('Reason for clearance').locator('option:not([disabled])').allTextContents(),['Job','Tour','Education','Visa / Immigration','Business']);
  assert.deepEqual(await page.locator('legend').allTextContents(),['Reference person 1','Reference person 2']);
  await field('Police Station').fill('Rajarampuri');
  await field('Reason for clearance').selectOption('Job');
  await field('Company or organisation name').fill('Example Organisation');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  assert.equal(await page.locator('.field-invalid').count(),4);
  for(const person of [1,2]) {
   await field(`Reference ${person} name`).fill(person===1?'First Person':'Second Person');
   const contact=field(`Reference ${person} contact number`);
   await contact.fill('letters');
   assert.equal(await contact.inputValue(),'');
   await contact.fill('98ab76');
   assert.equal(await contact.inputValue(),'9876');
   await contact.fill('9876543210123');
   assert.equal(await contact.inputValue(),'9876543210');
   await contact.evaluate(input=>{
    input.value='a9876543210123xyz';
    input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
   });
   assert.equal(await contact.inputValue(),'9876543210');
   await field(`Reference ${person} contact number`).fill('123');
  }
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  assert.equal(await page.locator('.field-invalid').count(),2);
  for(const person of [1,2]) await field(`Reference ${person} contact number`).fill('9876543210');
  await page.evaluate(()=>{const p=document.querySelector('.panel');p.scrollTop=0;p.style.height='auto';p.style.overflow='visible';document.querySelector('.drawer').style.position='absolute';});
  await page.screenshot({path:`deliverables/police-clearance/form-${width}.png`,fullPage:true});
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const labels=serviceCatalog.find(s=>s.slug==='police-clearance').documents.map(d=>d.displayLabel||d.label);
  assert.deepEqual(await page.locator('.doc strong').allTextContents(),labels);
  assert.equal(await page.locator('.doc input[type=file]').count(),7);
  assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true,'Missing documents must block continuation');
 }
 console.log('Police form: desktop/mobile required references, contact validation, dropdown and seven upload slots passed.');
} finally {await browser.close();}
