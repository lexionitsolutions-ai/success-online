// Isolated intake checks; no server, accounts, or database writes.
import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { serviceCatalog } from '../service-catalog.js';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent('<main id="app"></main>');
  await page.addStyleTag({ content: readFileSync('public/styles.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('public/mobile.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('public/dashboard.css', 'utf8') });
  await page.addScriptTag({ content: readFileSync('public/intake-rules.js', 'utf8') });
  await page.addScriptTag({ type: 'module', content: readFileSync('public/app.js', 'utf8').replace(/boot\(\);\s*$/, '') + `
    window.setupIntake = catalog => {
      services = catalog.map(service => ({ ...service, id: service.slug, variants: [{ ...service, id: service.slug, amounts: {serviceCharge:service.serviceCharge || 0,officialFee:0,tax:0,total:service.serviceCharge || 0} }] }));
      startCase();
    };
  ` });
  await page.waitForFunction(() => !!window.setupIntake);
  await page.evaluate(catalog => window.setupIntake(catalog), serviceCatalog);
  assert.equal(await page.locator('input[type="email"]').count(), 0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await page.locator('.field-invalid').count(), 2);
  assert.equal(await page.locator('.field-warning').count(), 2);
  assert.equal(await page.locator('#name').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#name').evaluate(input => getComputedStyle(input).backgroundColor), 'rgb(255, 241, 242)');
  await page.locator('#name').pressSequentially('DASD4544');
  assert.equal(await page.locator('#name').inputValue(), 'DASD');
  await page.locator('#name').fill('Asha123 Patil');
  assert.equal(await page.locator('#name').inputValue(), 'Asha Patil');
  await page.locator('#mobile').fill('9876543210');
  assert.equal(await page.locator('.field-warning').count(), 0);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const service of serviceCatalog) {
    await page.locator('#service').selectOption(service.slug);
    assert.equal(await page.locator('input[type="email"]').count(), 0, service.name);
    for (const select of await page.locator('#serviceFields select').all()) {
      const placeholder = select.locator('option[value=""]');
      assert.equal(await placeholder.evaluate(option => option.disabled), true, service.name);
      assert.equal(await placeholder.getAttribute('hidden'), '', service.name);
      const value = await select.locator('option').nth(1).getAttribute('value');
      await select.selectOption(value);
      assert.equal(await select.inputValue(), value);
    }
  }
  await page.locator('#service').selectOption('income-certificate');
  const field = label => page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.equal(await page.locator('.field-invalid').count(), 4);
  assert.equal(await field('Reason for application').getAttribute('aria-invalid'), 'true');
  assert.ok((await page.locator('.field-warning').allTextContents()).includes('Please choose Reason for application.'));
  const annualFields = serviceCatalog.find(service => service.slug === 'income-certificate').fields.filter(field => field.when?.equals === '3 years');
  assert.deepEqual(annualFields.map(field=>field.label.slice(0,9)),['2021-2022','2022-2023','2023-2024']);
  await field('Years of Certificate Required').selectOption('1 year');
  assert.equal(await field('Income amount required on certificate (₹)').count(), 1);
  const singleYear = serviceCatalog.find(service => service.slug === 'income-certificate').fields.find(field => field.displayLabel);
  assert.equal(await page.getByLabel(singleYear.displayLabel, { exact: true }).count(), 1);
  await field('Years of Certificate Required').selectOption('3 years');
  assert.equal(await field('Income amount required on certificate (₹)').count(), 0);
  assert.equal(await page.locator('.income-year-field .field-warning').count(), 3);
  for (const [index, definition] of annualFields.entries()) {
    assert.equal(await field(definition.label).getAttribute('required'), '');
    await field(definition.label).fill(String(100000 + index * 50000));
  }
  for (const reason of ['Education', 'Hospital']) {
    await field('Reason for application').selectOption(reason);
    assert.equal(await field('Reason for application').inputValue(), reason);
  }
  await field('Reason for application').selectOption('Other');
  assert.equal(await field('Other reason (please specify)').getAttribute('aria-invalid'), 'true');
  await field('Other reason (please specify)').fill('Application assistance');
  assert.equal(await field('Other reason (please specify)').getAttribute('aria-invalid'), null);
  await field('Reason for application').selectOption('Hospital');
  for (const [index, definition] of annualFields.entries()) {
    assert.equal(await field(definition.label).inputValue(), String(100000 + index * 50000));
  }
  await field('Years of Certificate Required').selectOption('1 year');
  for (const definition of annualFields) assert.equal(await field(definition.label).count(), 0);
  assert.equal(await field('Income amount required on certificate (₹)').count(), 1);
  assert.equal(await page.getByLabel(singleYear.displayLabel, { exact: true }).count(), 1);
  const colours = field('Ration card colour');
  for (const label of ['Yellow (PHH)', 'Orange (PHH/NPH)', 'White (APL)']) {
    assert.ok((await colours.textContent()).includes(label));
  }
  await colours.selectOption('White');
  assert.ok((await page.locator('#svcInfo').textContent()).includes('फॉर्म १६ / आयकर विवरणपत्र'));
  await page.locator('#service').selectOption('domicile-certificate');
  assert.equal(await page.locator('#service option:checked').textContent(), 'Age Nationality & Domicile Certificate');
  assert.equal(await field('Applicant birth place').count(), 0);
  const birthplace=field('Is beneficiary birth place in Maharashtra?');
  await birthplace.selectOption('No');
  assert.equal(await field('Birth certificate address').count(),1);
  assert.equal(await field('Birth certificate city').count(),0);
  assert.equal(await field('Birth certificate state').count(),0);
  await field('Applicant under 18?').selectOption('No');
  await field('Do you have proof confirming the entered address?').selectOption('Yes');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  const addressFields=['Birth certificate address'];
  for(const label of addressFields) assert.equal(await field(label).getAttribute('aria-invalid'),'true');
  for(const [label,value] of addressFields.map(label=>[label,'House 10, Market Road, Belagavi, Karnataka'])) {
    await field(label).fill(value);
    await field(label).blur();
    assert.equal(await field(label).inputValue(),value);
  }
  await birthplace.selectOption('Yes');
  assert.equal(await field('Birth certificate address').count(),0);
  await birthplace.selectOption('No');
  for(const label of addressFields) assert.equal(await field(label).inputValue(),'');
  mkdirSync('deliverables/service-intake',{recursive:true});
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    for(const service of serviceCatalog) {
      await page.locator('#service').selectOption(service.slug);
      const disclosure=page.locator('.intake-notices');
      const summary=page.locator('.intake-notices>summary');
      assert.match(await summary.innerText(),/Important Notices/);
      if(await disclosure.evaluate(el=>el.open)) await summary.click();
      assert.equal(await page.locator('.income-checklist').isVisible(),false);
      await summary.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.income-checklist').isVisible(),true);
      await summary.click();
      assert.equal(await page.locator('.income-notes').isVisible(),false);
      if(service.slug==='domicile-certificate') await page.screenshot({path:`deliverables/service-intake/notices-closed-${width}.png`});
      await summary.click();
      if(service.slug==='domicile-certificate') {
        await birthplace.selectOption('No');
        const proof=field('Do you have proof confirming the entered address?');
        await proof.selectOption('No');
        assert.equal(await page.locator('.affidavit-notice').isVisible(),true);
        assert.match(await page.locator('.affidavit-notice').innerText(),/additional ₹200/);
        assert.match(await page.locator('.affidavit-notice').innerText(),/400/);
        await proof.selectOption('Yes');
        assert.equal(await page.locator('.affidavit-notice').count(),0);
        await proof.selectOption('No');
      }
      assert.equal(await disclosure.evaluate(el=>el.open),true,'Notices remain open after conditional fields change');
      assert.equal(await page.locator('.income-guidance').count(),1,service.name);
      assert.equal(await page.locator('.income-notes').count(),1,service.name);
      assert.equal(await page.locator('.income-checklist li').count(),service.documents.length-(service.slug==='income-certificate'?1:0),service.name);
      assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),`${service.name} fits ${width}px`);
      await page.evaluate(()=>{document.querySelector('.drawer').style.position='absolute';const panel=document.querySelector('.panel');panel.style.height='auto';panel.style.overflow='visible';panel.scrollTop=0;});
      await page.screenshot({path:`deliverables/service-intake/${service.slug}-${width}.png`,fullPage:true});
      await page.evaluate(()=>{document.querySelector('.drawer').style.position='';const panel=document.querySelector('.panel');panel.style.height='';panel.style.overflow='';});
    }
  }
  await page.locator('#service').selectOption('passport');
  await field('Father name').fill('Father123');
  assert.equal(await field('Father name').inputValue(), 'Father');
  console.log('All 15 services passed at 390px and 1280px: Marathi checklists, notes and layout; fixed income years and conditional birthplace address validation also passed.');
} finally {
  await browser.close();
}
