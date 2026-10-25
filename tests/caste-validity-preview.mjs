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
    window.setupValidity=catalog=>{
      closeDrawer();services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{serviceCharge:100,officialFee:0,tax:0,total:100}}]}));
      draft={step:2,serviceId:'caste-validity',variantId:'caste-validity',customer:{name:'Test Customer',mobile:'9876543210'},details:{},docs:{}};drawWizard();
    };
    window.stageRequired=()=>{for(const doc of services.find(s=>s.id==='caste-validity').variants[0].documents.filter(d=>d.required)) draft.docs[doc.label]={fileName:'proof.pdf',mimeType:'application/pdf',size:100};rerenderWizard();};
    window.checkSavedGrouping=()=>{me={role:'sales'};const variant=services.find(s=>s.id==='caste-validity').variants[0];return documentChecklist({id:'test-case',status:'Draft',variant,details:draft.details},[]);};
  `});
  await page.waitForFunction(()=>!!window.setupValidity);
  const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  mkdirSync('deliverables/caste-validity',{recursive:true});
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    for(const reason of ['Job','Education','Election']) {
      await page.evaluate(catalog=>window.setupValidity(catalog),serviceCatalog);
      assert.equal(await page.locator('#serviceFields select').count(),2);
      assert.equal(await page.locator('#serviceFields input').count(),0);
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      assert.equal(await page.locator('.field-invalid').count(),2);
      await field('Caste Validity Certificate required for').selectOption(reason);
      await field('Applicant under 18?').selectOption(reason==='Education'?'Yes':'No');
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      assert.equal(await page.locator('.caste-document-section').count(),5);
      assert.deepEqual(await page.locator('.caste-document-section').evaluateAll(sections=>sections.map(section=>section.querySelectorAll('input[type=file]').length)),[5,4,1,1,1]);
      assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
      const titles=await page.locator('.caste-document-section h3').allTextContents();
      assert.ok(titles[0].startsWith('Applicant'));
      assert.ok(titles[1].startsWith('Father'));
      assert.ok(titles[4].includes('if available'));
      const savedMarkup=await page.evaluate(()=>window.checkSavedGrouping());
      assert.equal((savedMarkup.match(/class="caste-document-section"/g)||[]).length,5);
      if(reason==='Education') {
        await page.evaluate(()=>{const p=document.querySelector('.panel');p.scrollTop=0;p.style.height='auto';p.style.overflow='visible';document.querySelector('.drawer').style.position='absolute';});
        await page.screenshot({path:`deliverables/caste-validity/uploads-${width}.png`,fullPage:true});
      }
      await page.evaluate(()=>window.stageRequired());
      assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),false,'Optional family certificate must not block submission');
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Caste Validity desktop/mobile: two mandatory questions, all purposes, five upload sections, saved checklist grouping and optional family proof passed.');
} finally {await browser.close();}
