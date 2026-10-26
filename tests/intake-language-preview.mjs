import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { serviceCatalog } from '../service-catalog.js';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://intake.test/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="app"></main>' }));
  await page.goto('https://intake.test/');
  for (const file of ['styles.css', 'mobile.css', 'dashboard.css']) await page.addStyleTag({ content: readFileSync(`public/${file}`, 'utf8') });
  await page.addScriptTag({ content: readFileSync('public/intake-rules.js', 'utf8') });
  await page.addScriptTag({ type: 'module', content: readFileSync('public/app.js', 'utf8').replace(/boot\(\);\s*$/, '') + `
    window.setupIntake=(catalog,slug,step=2)=>{
      closeDrawer(); services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{serviceCharge:100,officialFee:0,tax:0,total:100}}]}));
      draft={step,serviceId:slug,variantId:slug,customer:{name:'Test Customer',mobile:'9876543210'},details:{},docs:{}};drawWizard();
    };
    window.languageState=()=>({details:structuredClone(draft.details),docs:structuredClone(draft.docs)});
    window.selectLanguage=setIntakeLanguage;
    window.showUploads=()=>{draft.step=3;rerenderWizard();};
    window.showReview=()=>{draft.step=4;rerenderWizard();};
    window.stageApplicable=()=>{const variant=services.find(s=>s.id===draft.serviceId).variants[0];for(const doc of applicableDocuments(variant.documents,draft.details).filter(doc=>doc.required))draft.docs[doc.label]={fileName:'proof.pdf',mimeType:'application/pdf',size:100};rerenderWizard();};
  ` });
  await page.waitForFunction(() => !!window.setupIntake);
  const field = name => page.locator(`[data-field="${encodeURIComponent(name)}"]`);
  mkdirSync('deliverables/language-toggle', { recursive: true });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const service of serviceCatalog) {
      await page.evaluate(({ catalog, slug }) => window.setupIntake(catalog, slug), { catalog: serviceCatalog, slug: service.slug });
      await page.locator('.intake-notices').evaluateAll(nodes => nodes.forEach(node => { node.open = true; }));
      for (const language of ['mr', 'en']) {
        await page.locator(`[data-intake-language="${language}"]`).click();
        assert.equal(await page.locator('#drawer').getAttribute('lang'), language);
        assert.equal(await page.locator(`[data-intake-language="${language}"]`).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, service.slug);
        if (language === 'en') assert.doesNotMatch(await page.locator('#wizard').innerText(), /[\u0900-\u097f]/u, service.slug);
        if (process.env.LANGUAGE_AUDIT) {
          console.log(service.slug, language, await page.locator('#wizard').evaluate((root, language) => {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), result = [];
            while (walker.nextNode()) {
              const node = walker.currentNode;
              if (!node.parentElement.checkVisibility() || node.parentElement.closest('select')) continue;
              const text = node.textContent.trim();
              if (language === 'en' ? /[\u0900-\u097f]/u.test(text) : /^[A-Za-z][A-Za-z ,?.-]{8,}$/.test(text)) result.push(text);
            }
            return result;
          }, language));
        }
      }
    }
    await page.evaluate(catalog => window.setupIntake(catalog, 'passport'), serviceCatalog);
    await field('Mobile').fill('9876543210');
    await field('Email').fill('test@example.com');
    await field('Passport application type').selectOption('Renew');
    await field('Applicant under 18?').selectOption('No');
    await field('Name change or correction?').selectOption('Yes');
    const state = await page.evaluate(() => window.languageState());
    for (const language of ['mr', 'en']) {
      await page.locator(`[data-intake-language="${language}"]`).click();
      assert.deepEqual(await page.evaluate(() => window.languageState()), state);
      assert.equal(await field('Email').inputValue(), 'test@example.com');
      assert.equal(await field('Passport application type').inputValue(), 'Renew');
      if (language === 'en') assert.doesNotMatch(await page.locator('#serviceFields').innerText(), /[\u0900-\u097f]/u);
      else assert.match(await page.locator('.intake-field-note').innerText(), /राजपत्र/u);
      await page.screenshot({ path: `deliverables/language-toggle/passport-${language}-${width}.png` });
    }
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.doc input[type=file]').first().setInputFiles({ name: 'identity.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nproof') });
    await page.waitForFunction(() => Object.keys(window.languageState().docs).length === 1);
    const uploaded = await page.evaluate(() => window.languageState());
    for (const language of ['mr', 'en']) {
      await page.locator(`[data-intake-language="${language}"]`).click();
      assert.deepEqual(await page.evaluate(() => window.languageState()), uploaded);
      assert.equal(await page.locator('.doc input[type=file]').count(), 4);
    }
    await page.evaluate(() => window.showReview());
    await page.locator('#consent').check();
    await page.locator('[data-intake-language="mr"]').click();
    assert.equal(await page.locator('#consent').isChecked(), true);
    assert.match(await page.locator('.intake-review-details').innerText(), /Test Customer/);
    await page.evaluate(catalog => window.setupIntake(catalog, 'passport'), serviceCatalog);
    assert.equal(await page.locator('#drawer').getAttribute('lang'), 'mr', 'Preference persists when reopening');
    assert.equal(await page.evaluate(() => localStorage.getItem('success-online.intake-language')), 'mr');
    for (const scenario of [{change:'No',home:'Owned',white:'No',reason:null,count:7},{change:'Yes',home:'Rented',white:'Yes',reason:'Death',count:17},{change:'Yes',home:'Rented',white:'Yes',reason:'Separation',count:17}]) {
      await page.evaluate(catalog => window.setupIntake(catalog, 'ration-card'), serviceCatalog);
      await page.locator('[data-intake-language="en"]').click();
      const questions = ['Add a member?', 'Add a member due to marriage?', 'Remove a member?', 'Remove a member due to marriage?', 'Change ration card address?'];
      for (const question of questions) await field(question).selectOption(scenario.change);
      await field('Ration card residence').selectOption(scenario.home);
      await field('Is the ration card white?').selectOption(scenario.white);
      await page.getByRole('button', {name:'Continue',exact:true}).click();
      assert.equal(await page.locator('.doc input[type=file]').count(), scenario.count);
      assert.equal(await page.getByRole('button', {name:'Continue',exact:true}).isDisabled(), true);
      const titles = await page.locator('.doc>span:first-child>strong').allTextContents();
      assert.equal(titles.some(title=>title==='Death Certificate / Separation Application'), scenario.change==='Yes');
      assert.equal(titles.some(title=>title==='Address Change Proof'), scenario.change==='Yes');
      assert.equal(titles.some(title=>title==='Electricity Bill'), scenario.change==='No');
      await page.locator('[data-intake-language="mr"]').click();
      assert.equal(await page.locator('.doc input[type=file]').count(), scenario.count);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.evaluate(()=>window.stageApplicable());
      assert.equal(await page.locator('.form-actions .primary').isDisabled(), false);
    }
    await page.evaluate(catalog => window.setupIntake(catalog, 'ration-card'), serviceCatalog);
    await page.locator('[data-intake-language="en"]').click();
    await field('Add a member?').selectOption('Yes');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.doc input[type=file]').count(),9,'One Ration Card answer proceeds without requiring unanswered questions');
    for (const updated of ['No','Yes']) {
      await page.evaluate(catalog => window.setupIntake(catalog, 'pf-assistance'), serviceCatalog);
      await page.locator('[data-intake-language="en"]').click();
      await field('UAN No').fill('123456789012');
      assert.equal(await field('UAN No').inputValue(),'123456789012');
      await field('Password').fill('SyntheticPF!23');
      assert.equal(await field('Password').getAttribute('type'),'password');
      await field('PF work required').fill('Transfer my PF account');
      await field('PF profile updated?').selectOption(updated);
      assert.equal(await field('PF email').count(),updated==='Yes'?1:0);
      if (updated==='Yes') {
        await page.getByRole('button',{name:'Continue',exact:true}).click();
        assert.equal(await field('PF email').getAttribute('aria-invalid'),'true');
        await field('PF email').fill('pf@example.com');
      }
      await page.locator('[data-intake-language="mr"]').click();
      assert.equal(await field('Password').inputValue(),'SyntheticPF!23');
      await page.locator('[data-intake-language="en"]').click();
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      assert.equal(await page.locator('.doc input[type=file]').count(),5);
      await page.evaluate(()=>window.stageApplicable());
      assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),false,'Other PF documents must remain optional');
      await page.getByRole('button',{name:'Continue',exact:true}).click();
      assert.ok(!(await page.locator('#wizard').innerText()).includes('SyntheticPF!23'),'Review masks the PF password');
    }
  }
  assert.deepEqual(errors, []);
  console.log('Intake languages: all services on desktop/mobile; translated Passport questions; preserved values, choices, uploaded files and consent; persistent preference and no horizontal overflow passed.');
} finally {
  await browser.close();
}
