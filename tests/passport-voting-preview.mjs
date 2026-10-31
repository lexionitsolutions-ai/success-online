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
  await page.setContent('<main id="app"></main>');
  for (const file of ['styles.css', 'mobile.css', 'dashboard.css']) await page.addStyleTag({ content: readFileSync(`public/${file}`, 'utf8') });
  await page.addScriptTag({ content: readFileSync('public/intake-rules.js', 'utf8') });
  await page.addScriptTag({ type: 'module', content: readFileSync('public/app.js', 'utf8').replace(/boot\(\);\s*$/, '') + `
    window.setupService=(catalog,slug)=>{
      closeDrawer(); services=catalog.map(s=>({...s,id:s.slug,variants:[{...s,id:s.slug,amounts:{serviceCharge:100,officialFee:0,tax:0,total:100}}]}));
      draft={step:2,serviceId:slug,variantId:slug,customer:{name:'Test Customer',mobile:'9876543210'},details:{},docs:{}};drawWizard();setIntakeLanguage('en');
    };
    window.currentDetails=()=>structuredClone(draft.details);
  ` });
  await page.waitForFunction(() => !!window.setupService);
  const field = label => page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  const voting = serviceCatalog.find(service => service.slug === 'voting-card');
  const choices = voting.fields.find(item => item.label === 'Voting card field to correct').options;
  assert.equal(choices.length, 8);
  mkdirSync('deliverables/voting-card', { recursive: true });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.evaluate(catalog => window.setupService(catalog, 'passport'), serviceCatalog);
    await field('Mobile').fill('letters');
    assert.equal(await field('Mobile').inputValue(), '');
    await field('Mobile').fill('98ab76');
    assert.equal(await field('Mobile').inputValue(), '9876');
    await field('Mobile').fill('9876543210123');
    assert.equal(await field('Mobile').inputValue(), '9876543210');
    await field('Mobile').evaluate(input => {
      input.value = 'a98 b76';
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    });
    assert.equal(await field('Mobile').inputValue(), '9876');
    await field('Mobile').fill('9876543210');
    const passportDetails={Email:'passport@example.com','Birth place':'Kolhapur','Police station':'Shahupuri','Emergency number':'9876543211','Mother name':'Test Mother','Father name':'Test Father',Education:'Graduate'};
    for(const [label,value] of Object.entries(passportDetails)) await field(label).fill(value);
    await field('Occupation').selectOption('Government Employee');
    assert.equal(await field('Occupation').inputValue(),'Government Employee');
    await field('Passport application type').selectOption('New');
    await field('Applicant under 18?').selectOption('No');
    await field('Name change or correction?').selectOption('No');
    assert.equal(await field('Old name').count(),0);
    await field('Name change or correction?').selectOption('Yes');
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await field('Old name').getAttribute('aria-invalid'),'true');
    assert.equal(await field('Wife name').inputValue(),'');
    assert.notEqual(await field('Wife name').getAttribute('aria-invalid'),'true');
    await field('Old name').fill('Previous Name');
    for(const language of ['mr','en']) {
      await page.locator(`[data-intake-language="${language}"]`).click();
      assert.equal(await field('Old name').inputValue(),'Previous Name');
      assert.equal(await field('Occupation').inputValue(),'Government Employee');
    }
    await field('Name change or correction?').selectOption('No');
    assert.equal((await page.evaluate(()=>window.currentDetails()))['Old name'],undefined);
    await field('Name change or correction?').selectOption('Yes');
    await field('Old name').fill('Previous Name');
    await page.locator('.intake-notices').evaluate(details=>details.open=true);
    const notices=await page.locator('.notice-content').innerText();
    for(const term of ['PAN Card','Aadhaar Card','birth place','police station','emergency number','mother name','father name','wife name','education','Employee','Self-employed','Student','Retailer','old name']) assert.ok(notices.toLowerCase().includes(term.toLowerCase()),`${term}: ${notices}`);
    await page.screenshot({path:`deliverables/voting-card/passport-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    assert.equal(await page.locator('.doc input[type=file]').count(),3);
    await page.evaluate(catalog=>window.setupService(catalog,'food-license'),serviceCatalog);
    const foodHeadings=await page.locator('#serviceFields label').evaluateAll(labels=>labels.map(label=>[...label.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent).join('').trim()));
    for(const heading of ['Shop name','Email ID','Shop address','Shop owned or rented','Nature of business','Mobile number','Business type']) assert.ok(foodHeadings.includes(heading),heading);
    assert.ok(foodHeadings.every(heading=>heading.length<30),foodHeadings.join(', '));
    await page.screenshot({path:`deliverables/voting-card/food-license-${width}.png`,fullPage:true});
    for (const choice of choices) {
      await page.evaluate(catalog => window.setupService(catalog, 'voting-card'), serviceCatalog);
      assert.deepEqual(await field('Voting card application type').locator('option').evaluateAll(options=>options.filter(option=>option.value).map(option=>option.value)),['New','Correction']);
      await field('Mobile').fill('9876543210');
      assert.equal(await field('Voting card field to correct').count(), 0);
      await field('Voting card application type').selectOption('Correction');
      await field('Voting card field to correct').selectOption(choice);
      const definition = voting.fields.find(item => item.when?.all?.some(condition => condition.equals === choice));
      const corrected = field(definition.label);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      assert.equal(await corrected.getAttribute('aria-invalid'), 'true', choice);
      const text = choice === 'Mobile number' ? '9876543210' : choice === 'Name' || choice === 'Relative name' ? 'Correct Person' : 'Correct details';
      await corrected.fill(text);
      await page.locator('[data-intake-language="mr"]').click();
      assert.equal(await corrected.inputValue(), text);
      await page.locator('[data-intake-language="en"]').click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      assert.equal(await page.locator('.doc input[type=file]').count(), 3, choice);
      assert.match(await page.locator('#wizard').innerText(), /Old \/ Previous Voting Card/);
    }
    await page.evaluate(catalog => window.setupService(catalog, 'voting-card'), serviceCatalog);
    await field('Mobile').fill('9876543210');
    await field('Voting card application type').selectOption('Correction');
    await field('Voting card field to correct').selectOption('Name');
    await field('Corrected applicant name').fill('Correct Person');
    await field('Voting card application type').selectOption('New');
    assert.equal(await field('Corrected applicant name').count(), 0);
    assert.equal((await page.evaluate(() => window.currentDetails()))['Corrected applicant name'], undefined);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.equal(await page.locator('.doc input[type=file]').count(), 2);
    assert.doesNotMatch(await page.locator('#wizard').innerText(), /Old \/ Previous Voting Card/);
    await page.screenshot({ path: `deliverables/voting-card/new-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  assert.deepEqual(errors, []);
  console.log('Desktop/mobile: Passport rejects typed/pasted letters and caps at 10 digits; eight Voting Card corrections require corrected details; Corrections require old-card upload; New has no old-card upload; passport wife name is optional; switching modes removes stale corrections.');
} finally {
  await browser.close();
}
