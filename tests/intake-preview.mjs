// Isolated intake checks; no server, accounts, or database writes.
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { serviceCatalog } from '../service-catalog.js';

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  await page.setContent('<main id="app"></main>');
  await page.addStyleTag({ content: readFileSync('public/styles.css', 'utf8') });
  await page.addStyleTag({ content: readFileSync('public/mobile.css', 'utf8') });
  await page.addScriptTag({ type: 'module', content: readFileSync('public/app.js', 'utf8').replace(/boot\(\);\s*$/, '') + `
    window.setupIntake = catalog => {
      services = catalog.map(service => ({ ...service, id: service.slug, variants: [{ ...service, id: service.slug }] }));
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
  assert.ok((await page.locator('#svcInfo').textContent()).includes('Form 16 / ITR'));
  await page.locator('#service').selectOption('domicile-certificate');
  assert.equal(await page.locator('#service option:checked').textContent(), 'Age Nationality & Domicile Certificate');
  assert.equal(await field('Applicant birth place').count(), 0);
  await page.locator('#service').selectOption('passport');
  await field('Father name').fill('Father123');
  assert.equal(await field('Father name').inputValue(), 'Father');
  console.log('All 15 services passed, including annual income fields, duration switching, domicile name and birth-place removal.');
} finally {
  await browser.close();
}
