import {chromium} from 'playwright';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<main id="app"></main>');
  for(const file of ['styles.css','mobile.css','dashboard.css'])await page.addStyleTag({content:readFileSync(`public/${file}`,'utf8')});
  await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
  await page.addScriptTag({type:'module',content:readFileSync('public/script.js','utf8').replace(/boot\(\);\s*$/,'')+`
    window.setupIntake=catalog=>{
      services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{}}]}));
      draft={step:1,customer:{},details:{},docs:{}};drawWizard();
    };
    window.savedCustomer=()=>draft.customer;
  `});
  await page.waitForFunction(()=>!!window.setupIntake);
  await page.evaluate(catalog=>window.setupIntake(catalog),serviceCatalog);
  await page.locator('#name').fill('Original Customer');
  await page.locator('#mobile').fill('9876543210');
  await page.locator('#address').fill('Customer address');
  const continueButton=()=>page.getByRole('button',{name:'Continue',exact:true});
  const backButton=()=>page.getByRole('button',{name:'Back',exact:true});
  await continueButton().click();
  assert.equal(await page.locator('#service').inputValue(),'');
  await backButton().click();
  assert.equal(await page.locator('#name').inputValue(),'Original Customer');
  await continueButton().click();
  await page.locator('#service').selectOption('caste-validity');
  const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  await field('Caste Validity Certificate required for').selectOption('Job');
  await field('Applicant under 18?').selectOption('No');
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    await backButton().click();
    assert.equal(await page.locator('#mobile').inputValue(),width===390?'9876543210':'9876543211');
    await page.locator('#name').fill('Updated Customer');
    await page.locator('#mobile').fill('9876543211');
    assert.equal(await page.locator('#address').inputValue(),'Customer address');
    await continueButton().click();
    assert.equal(await page.locator('#service').inputValue(),'caste-validity');
    assert.equal(await field('Caste Validity Certificate required for').inputValue(),'Job');
    assert.equal(await field('Applicant under 18?').inputValue(),'No');
    assert.equal(await backButton().isVisible(),true);
    assert.deepEqual(await page.evaluate(()=>window.savedCustomer()),{name:'Updated Customer',mobile:'9876543211',address:'Customer address'});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: Service Back edits customer details and preserves service/answers at mobile and desktop widths.');
} finally {await browser.close();}
