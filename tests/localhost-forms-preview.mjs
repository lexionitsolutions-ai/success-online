import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';

loadEnvFile('.env');
const base='http://localhost:3000';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  const context=await browser.newContext();
  const login=await context.request.post(base+'/api/login',{data:{username:process.env.INITIAL_ADMIN_USERNAME,password:process.env.INITIAL_ADMIN_PASSWORD}});
  assert.equal(login.status(),200);
  const response=await context.request.get(base+'/api/services');
  assert.equal(response.status(),200);
  const {services}=await response.json();
  console.log('Authenticated localhost API and loaded current service definitions.');
  assert.equal(services.find(s=>s.slug==='shop-act').name,'Shop Act Registration');
  const page=await context.newPage();
  await page.goto(base);
  await page.waitForSelector('.new-case-button');
  const field=label=>page.locator(`[data-field="${encodeURIComponent(label)}"]`);
  const next=()=>page.locator('#wizard').getByRole('button',{name:'Continue',exact:true}).click();
  const open=async slug=>{
    await page.evaluate(()=>window.closeDrawer());
    await page.locator('.new-case-button').click();
    await page.locator('[data-intake-language="en"]').click();
    await page.locator('#name').fill('Form Verification');
    await page.locator('#mobile').fill('9876543210');
    await next();
    await page.locator('#service').selectOption(services.find(s=>s.slug===slug).id);
    await page.locator('[data-intake-language="en"]').click();
    console.log(`Opened ${slug} from the running app.`);
  };
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    await open('police-clearance');
    await field('Reason for clearance').selectOption('Job');
    for(const person of [1,2]) {
      await field(`Reference ${person} name`).fill('Known Person');
      const contact=field(`Reference ${person} contact number`);
      await contact.fill('abc');assert.equal(await contact.inputValue(),'');
      await contact.fill('987654321012345');assert.equal(await contact.inputValue(),'9876543210');
      await contact.fill('123');
    }
    await next();
    assert.equal(await page.locator('.field-invalid').count(),2);
    for(const person of [1,2]) await field(`Reference ${person} contact number`).fill('9876543210');
    await next();assert.ok(await page.locator('.doc').count()>0);
    await open('passport');
    await field('Occupation').selectOption('Government Employee');
    await page.locator('[data-intake-language="mr"]').click();
    assert.match(await field('Occupation').locator('option:checked').textContent(),/शासकीय कर्मचारी/);
    for(const slug of ['shop-act','udyam-aadhaar']) {
      await open(slug);
      const values={'Shop name':'Verification Shop','Business email':'verify@example.com','Business start date':'2026-10-01','Shop address':'Kolhapur','Male workers':'2','Female workers':'3','Business type':'Retail','Business mobile number':'9876543210','Owner / partner names':'Test Owner','Business investment':'100000',...(slug==='shop-act'?{'Years at Aadhaar address':'5','Shop size (sq. ft.)':'250'}:{})};
      for(const [label,value] of Object.entries(values)) await field(label).fill(value);
      assert.equal(await field('Number of workers').inputValue(),'5');
      assert.ok((await field('Shop name').locator('..').innerText()).startsWith('Shop name'));
      assert.ok((await field('Business type').locator('..').innerText()).startsWith('Nature of business'));
      await field('GST registered?').selectOption('No');
      for(const premises of ['Owned','Rented']) for(const ownership of ['Individual','Partnership']) {
        await field('Owned or rented').selectOption(premises);
        await field('Ownership type').selectOption(ownership);
        await next();
        const labels=await page.locator('.doc strong').allTextContents();
        assert.equal(labels.includes('Business Address Proof'),slug==='udyam-aadhaar');
        assert.equal(labels.includes('Light Bill'),premises==='Owned');
        assert.equal(labels.includes('Rent Agreement'),premises==='Rented');
        assert.equal(labels.includes('Partnership Deed'),ownership==='Partnership');
        await page.evaluate(()=>window.wizardBack(2));
      }
    }
    console.log(`Localhost ${width}px: PCC, passport, Shop Act Registration and Udyam verified.`);
  }
  console.log('Verified the running localhost app. No cases created or files uploaded.');
} finally {await browser.close();}
