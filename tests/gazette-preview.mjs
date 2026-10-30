// Browser checks use source and synthetic cases, without live account or database access.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<main id="app"></main>');
  for(const file of ['styles.css','mobile.css','dashboard.css']) await page.addStyleTag({content:readFileSync(`public/${file}`,'utf8')});
  for(const file of ['intake-rules.js','vendor/sanscript.js','marathi-input.js']) await page.addScriptTag({content:readFileSync(`public/${file}`,'utf8')});
  await page.addScriptTag({type:'module',content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')+`
    window.setupGazette=(catalog,slug,step=2)=>{
      closeDrawer();services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{serviceCharge:s.serviceCharge||100,officialFee:0,tax:0,total:s.serviceCharge||100}}]}));
      draft={step,serviceId:slug,variantId:slug,customer:{name:'Test Customer',mobile:'9876543210'},details:{'Applicant under 18?':'Yes'},docs:{}};drawWizard();
    };
  `});
  await page.waitForFunction(()=>!!window.setupGazette);
  const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  mkdirSync('deliverables/gazette',{recursive:true});
  async function screenshot(path) {
    await page.evaluate(()=>{const panel=document.querySelector('.panel');panel.scrollTop=0;panel.style.height='auto';panel.style.overflow='visible';document.querySelector('.drawer').style.position='absolute';});
    await page.screenshot({path,fullPage:true});
    await page.evaluate(()=>{const panel=document.querySelector('.panel');panel.style.height='';panel.style.overflow='';document.querySelector('.drawer').style.position='';});
  }
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(catalog=>window.setupGazette(catalog,'gazette'),serviceCatalog);
    assert.equal(await page.locator('#service option:checked').textContent(),'Gazette');
    assert.equal(await page.locator('.intake-field-section').count(),0);
    await field('Gazette language').selectOption('English');
    await field('Reason for name change').selectOption('Marriage');
    assert.deepEqual(await page.locator('legend').allTextContents(),['Old name','New name']);
    assert.equal(await page.locator('#serviceFields input').count(),2);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.field-invalid').count(),2);
    for(const input of await page.locator('#serviceFields input').all()) await input.fill('Old Name');
    await screenshot(`deliverables/gazette/english-${width}.png`);
    await field('Gazette language').selectOption('Marathi');
    assert.deepEqual(await page.locator('legend').allTextContents(),['Old name','New name']);
    await page.evaluate(()=>window.setIntakeLanguage('mr'));
    assert.deepEqual(await page.locator('legend').allTextContents(),['जुने नाव','नवीन नाव']);
    await page.evaluate(()=>window.setIntakeLanguage('en'));
    assert.equal(await page.locator('[data-marathi-input]').count(),2);
    for (const input of await page.locator('[data-marathi-input]').all()) assert.equal(await input.isVisible(),true,'Marathi name fields must stay visible when the interface language is English');
    assert.equal(await field('Old full name (English)').count(),0);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.field-invalid').count(),2);
    const oldName=field('Old full name (Marathi)');
    for(const key of 'raahul suresh paaTiila') {
      await oldName.pressSequentially(key);
      assert.doesNotMatch(await oldName.inputValue(),/[A-Za-z]/,'Latin letters never appear while typing');
    }
    assert.equal(await oldName.inputValue(),'\u0930\u093e\u0939\u0941\u0932 \u0938\u0941\u0930\u0947\u0936 \u092a\u093e\u091f\u0940\u0932');
    const newName=field('New full name (Marathi)');
    await newName.fill('raama suresh paaTiila 123 \u0391\u03bb\u03c6\u03b1');
    assert.doesNotMatch(await newName.inputValue(),/[A-Za-z0-9\u0370-\u03ff]/);
    await newName.fill('\u0930\u093e\u092e \u0938\u0941\u0930\u0947\u0936 \u092a\u093e\u091f\u0940\u0932');
    assert.equal(await page.locator('.field-invalid').count(),0,'Converted Marathi names clear validation warnings');
    assert.equal(await page.locator('.panel').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await screenshot(`deliverables/gazette/marathi-${width}.png`);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.steps .on').textContent(),'3Documents');
    await page.getByRole('button',{name:'Back',exact:true}).click();
    assert.equal(await field('New full name (Marathi)').inputValue(),'\u0930\u093e\u092e \u0938\u0941\u0930\u0947\u0936 \u092a\u093e\u091f\u0940\u0932');
    await field('Gazette language').selectOption('English');
    assert.equal(await field('Old full name (English)').inputValue(),'');
    for(const input of await page.locator('#serviceFields input').all()) await input.fill('Test');
    for(const [reason,count] of [['Marriage',6],['Correction of incorrect name',5],['Other name change',4]]) {
      await field('Reason for name change').selectOption(reason);
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      assert.equal(await page.locator('.doc').count(),count);
      const documents=await page.locator('.doc strong').allTextContents();
      assert.ok(documents.includes('School Leaving Certificate'));
      assert.ok(documents.includes('Live Photo'));
      assert.equal(documents.includes('Husband Aadhaar Card'),reason==='Marriage');
      assert.equal(documents.includes('Wedding Invitation / Marriage Registration Certificate'),reason==='Marriage');
      assert.equal(documents.includes('Correct Name Proof / Affidavit'),reason==='Correction of incorrect name');
      assert.equal(documents.includes('Ration Card'),false);
      assert.equal(await page.locator('.form-actions .primary').isDisabled(),true);
      await page.getByRole('button',{name:'Back',exact:true}).click();
    }
    await page.evaluate(catalog=>window.setupGazette(catalog,'caste-certificate',3),serviceCatalog);
    const other=page.locator('.caste-document-section').last();
    assert.doesNotMatch(await other.textContent(),/Income Certificate/);
    assert.equal(await page.locator('.doc').count(),8);
  }
  assert.deepEqual(errors,[]);
  console.log('Gazette language switching, required names, phonetic/native Marathi input, persistence, and Caste Certificate document groups passed at 390px and 1280px.');
} finally {await browser.close();}
