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
  await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
  await page.addScriptTag({type:'module',content:readFileSync('public/script.js','utf8').replace(/boot\(\);\s*$/,'')+`
    window.backToShop=()=>{draft.step=2;rerenderWizard();};
    window.setupShop=catalog=>{
      closeDrawer();services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{serviceCharge:100,officialFee:0,tax:0,total:100}}]}));
      draft={step:2,serviceId:'shop-act',variantId:'shop-act',customer:{name:'Test Customer',mobile:'9876543210'},details:{},docs:{}};drawWizard();
    };
  `});
  await page.waitForFunction(()=>!!window.setupShop);
  const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  mkdirSync('deliverables/shop-act',{recursive:true});
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(catalog=>window.setupShop(catalog),serviceCatalog);
    assert.equal(await page.locator('#service option[value="shop-act"]').textContent(),'Shop Act Registration');
    assert.equal(await page.locator('#service option[value="udyam-aadhaar"]').textContent(),'Udyam Aadhaar Certificate');
    assert.equal(await page.locator('#service option[value="shop-act-udyam"]').count(),0);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.ok(await page.locator('.field-invalid').count()>10);
    const values={'Shop name':'Shop 123','Business email':'shop@example.com','Business start date':'2026-10-01','Shop address':'Rajarampuri, Kolhapur','Business type':'Grocery shop','Business mobile number':'9876543210','Owner / partner names':'Asha Patil, Ram Patil','Years at Aadhaar address':'5','Shop size (sq. ft.)':'250.50','Business investment':'100000'};
    for(const [label,value] of Object.entries(values)) await field(label).fill(value);
    await field('Male workers').fill('2');await field('Female workers').fill('3');
    assert.equal(await field('Number of workers').inputValue(),'5');
    assert.equal(await field('Number of workers').getAttribute('readonly'),'');
    await field('Owned or rented').selectOption('Rented');
    await field('Ownership type').selectOption('Partnership');
    await field('GST registered?').selectOption('Yes');
    assert.equal(await field('GST number').count(),1);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.field-invalid').count(),1);
    await field('GST number').fill('27ABCDE1234F1Z5');
    await page.evaluate(()=>{const p=document.querySelector('.panel');p.scrollTop=0;p.style.height='auto';p.style.overflow='visible';document.querySelector('.drawer').style.position='absolute';});
    await page.screenshot({path:`deliverables/shop-act/form-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.doc input[type=file]').count(),9);
    assert.equal(await page.locator('.doc input[multiple]').count(),5);
    assert.ok((await page.locator('.doc strong').allTextContents()).includes('Firm PAN Card'));
    assert.ok((await page.locator('.doc strong').allTextContents()).includes('Partnership Deed'));
    assert.ok((await page.locator('.doc strong').allTextContents()).includes('Rent Agreement'));
    assert.ok(!(await page.locator('.doc strong').allTextContents()).includes('Light Bill'));
    await page.evaluate(()=>window.backToShop());
    await field('Ownership type').selectOption('Individual');
    await field('Owned or rented').selectOption('Owned');
    await field('GST registered?').selectOption('No');
    assert.equal(await field('GST number').count(),0);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.doc input[type=file]').count(),7);
    assert.ok((await page.locator('.doc strong').allTextContents()).includes('Light Bill'));
    assert.ok(!(await page.locator('.doc strong').allTextContents()).includes('Rent Agreement'));
    assert.ok(!(await page.locator('.doc strong').allTextContents()).includes('Partnership Deed'));
    await page.evaluate(()=>window.backToShop());
    await page.locator('#service').selectOption('udyam-aadhaar');
    assert.equal(await field('Business email').count(),1);
    for (const label of ['Years at Aadhaar address','Shop size (sq. ft.)']) assert.equal(await field(label).count(),0);
    for(const [label,value] of Object.entries(values).filter(([label])=>!['Years at Aadhaar address','Shop size (sq. ft.)'].includes(label))) await field(label).fill(value);
    await field('Male workers').fill('1');
    await field('Female workers').fill('3');
    assert.equal(await field('Number of workers').inputValue(),'4');
    await field('Owned or rented').selectOption('Rented');
    await field('Ownership type').selectOption('Partnership');
    await field('GST registered?').selectOption('Yes');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.field-invalid').count(),1);
    await field('GST number').fill('27ABCDE1234F1Z5');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.doc input[type=file]').count(),9);
    assert.equal(await page.locator('.doc input[multiple]').count(),6);
    const udyamDocs=await page.locator('.doc strong').allTextContents();
    assert.ok(udyamDocs.includes('Firm PAN Card'));
    assert.ok(udyamDocs.includes('Business Address Proof'));
    assert.ok(udyamDocs.includes('Partnership Deed'));
    assert.ok(udyamDocs.includes('Rent Agreement'));
    assert.ok(!udyamDocs.includes('Light Bill'));
    assert.ok(udyamDocs.some(label=>label.includes('Bank Passbook / Cheque')));
    assert.ok(!udyamDocs.includes('Shop Board Photo'));
    await page.evaluate(()=>window.backToShop());
    await field('Ownership type').selectOption('Individual');
    await field('Owned or rented').selectOption('Owned');
    await field('GST registered?').selectOption('No');
    assert.equal(await field('GST number').count(),0);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.doc input[type=file]').count(),7);
    const individualDocs=await page.locator('.doc strong').allTextContents();
    assert.ok(individualDocs.includes('Light Bill'));
    assert.ok(!individualDocs.includes('Rent Agreement'));
    assert.ok(!individualDocs.includes('Partnership Deed'));
    for(const slug of ['shop-act','udyam-aadhaar']) {
      await page.evaluate(catalog=>window.setupShop(catalog),serviceCatalog);
      if(slug!=='shop-act') await page.locator('#service').selectOption(slug);
      const expectedHeadings={'Shop name':'Shop name','Business email':'Email address','Business start date':'Business start date','Shop address':'Shop address','Business type':'Nature of business','Male workers':slug==='shop-act'?'Male workers':'No of male workers','Female workers':slug==='shop-act'?'Female workers':'No of female workers'};
      for(const [label,heading] of Object.entries(expectedHeadings)) assert.ok((await field(label).locator('..').innerText()).startsWith(heading),`${slug}: ${heading}`);
      for(const [label,value] of Object.entries(values).filter(([label])=>slug==='shop-act'||!['Years at Aadhaar address','Shop size (sq. ft.)'].includes(label))) await field(label).fill(value);
      await field('Male workers').fill('0');
      await field('Female workers').fill('0');
      assert.equal(await field('Number of workers').inputValue(),'0');
      await field('GST registered?').selectOption('No');
      for(const premises of ['Owned','Rented']) for(const ownership of ['Individual','Partnership']) {
        await field('Owned or rented').selectOption(premises);
        await field('Ownership type').selectOption(ownership);
        for(const language of ['mr','en']) {
          await page.locator(`[data-intake-language="${language}"]`).click();
          assert.equal(await field('Owned or rented').inputValue(),premises);
          assert.equal(await field('Ownership type').inputValue(),ownership);
        }
        await page.getByRole('button',{name:'Continue',exact:true}).click();
        const labels=await page.locator('.doc strong').allTextContents();
        assert.equal(labels.includes('Light Bill'),premises==='Owned',`${slug} ${premises}`);
        assert.equal(labels.includes('Rent Agreement'),premises==='Rented',`${slug} ${premises}`);
        assert.equal(labels.includes('Partnership Deed'),ownership==='Partnership',`${slug} ${ownership}`);
        assert.equal(labels.includes('Firm PAN Card'),ownership==='Partnership');
        assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
        await page.evaluate(()=>window.backToShop());
      }
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Shop Act desktop/mobile: separate services, required fields, computed worker total, GST branches and partnership uploads passed.');
} finally {await browser.close();}
