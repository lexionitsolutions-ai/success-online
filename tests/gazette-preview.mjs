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
    assert.deepEqual(await page.locator('legend').allTextContents(),['From Name','To Name']);
    assert.equal(await page.locator('#serviceFields input').count(),6);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.field-invalid').count(),6);
    for(const input of await page.locator('#serviceFields input').all()) await input.fill('Old Name');
    await screenshot(`deliverables/gazette/english-${width}.png`);
    await field('Gazette language').selectOption('Marathi');
    assert.deepEqual(await page.locator('legend').allTextContents(),['जुने नाव','नवीन नाव']);
    assert.equal(await page.locator('[data-marathi-input]').count(),6);
    assert.equal(await field('Old first name (English)').count(),0);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.field-invalid').count(),6);
    await field('Old first name (Marathi)').pressSequentially('raahul');
    assert.match(await page.locator('.marathi-preview').first().textContent(),/राहुल/);
    await field('Old first name (Marathi)').press('Space');
    assert.equal((await field('Old first name (Marathi)').inputValue()).trim(),'राहुल');
    for(const kind of ['Old','New']) {
      await field(`${kind} first name (Marathi)`).fill('राम');
      await field(`${kind} father name (Marathi)`).fill('suresh');
      await field(`${kind} last name (Marathi)`).pressSequentially('paaTiila');
      await field(`${kind} last name (Marathi)`).press('Tab');
      assert.equal(await field(`${kind} last name (Marathi)`).inputValue(),'पाटील');
    }
    assert.equal(await page.locator('.field-invalid').count(),0,'Converted Marathi names clear validation warnings');
    assert.equal(await page.locator('.panel').evaluate(el=>el.scrollWidth>el.clientWidth),false);
    await screenshot(`deliverables/gazette/marathi-${width}.png`);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.steps .on').textContent(),'3Documents');
    await page.getByRole('button',{name:'Back',exact:true}).click();
    assert.equal(await field('New father name (Marathi)').inputValue(),'सुरेश');
    await field('Gazette language').selectOption('English');
    assert.equal(await field('Old first name (English)').inputValue(),'');
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
    assert.match(await other.textContent(),/Income Certificate/);
    assert.equal(await page.locator('.doc').count(),9);
  }
  assert.deepEqual(errors,[]);
  console.log('Gazette language switching, required names, phonetic/native Marathi input, persistence, and Caste Certificate document groups passed at 390px and 1280px.');
} finally {await browser.close();}
