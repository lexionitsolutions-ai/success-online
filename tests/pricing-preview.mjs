import {chromium} from 'playwright';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<main id="app"></main>');
  for(const file of ['styles.css','mobile.css','dashboard.css']) await page.addStyleTag({content:readFileSync(`public/${file}`,'utf8')});
  await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
  await page.addScriptTag({type:'module',content:readFileSync('public/script.js','utf8').replace(/boot\(\);\s*$/,'')+`
    window.setupPricing=()=>{
      me={id:'admin',name:'Admin',role:'admin'};view='pricing';
      pricingData={testPricingMode:true,salespeople:[{id:'one',name:'Sales One',username:'sales01',active:1},{id:'two',name:'Sales Two',username:'sales02',active:1},{id:'three',name:'Sales Three',username:'sales03',active:1}],prices:[{variant_id:'ews',service_name:'EWS Certificate',variant_name:'Standard',price:30000},{variant_id:'caste',service_name:'Caste Certificate',variant_name:'Standard',price:40000}],overrides:[{sales_user_id:'one',variant_id:'ews',price:20000},{sales_user_id:'two',variant_id:'ews',price:25000},{sales_user_id:'three',variant_id:'ews',price:17000}]};
      render=()=>{app.innerHTML=renderPricing();};render();
      window.pricingFixture=structuredClone(pricingData);
      window.saves=[];api=async(path,options)=>{window.saves.push(options.body);if(window.failSave) throw Error('Could not save price');return {ok:true};};
    };
    window.pricingNavigation=role=>{me.role=role;return shell('').includes('data-view="pricing"');};
    window.testPricingLoad=async mode=>{
      me.role='admin';pricingData=null;pricingError='';
      refreshCaseUpdates=async()=>{};
      api=async()=>{
        if(mode==='failure') throw Error('Server request failed');
        if(mode==='timeout') throw new DOMException('Request timed out','TimeoutError');
        if(mode==='incomplete') return {};
        return structuredClone(window.pricingFixture);
      };
      await setView('pricing');
    };
    window.recoverPricing=()=>{api=async()=>structuredClone(window.pricingFixture);};
  `});
  await page.waitForFunction(()=>!!window.setupPricing);
  await page.evaluate(()=>window.setupPricing());
  assert.equal(await page.locator('.pricing-card').count(),0);
  assert.equal(await page.getByText('Services use the default price', {exact:false}).count(),0);
  assert.equal(await page.getByText('Test pricing is enabled', {exact:false}).count(),0);
  for(const [id,price] of [['one','200.00'],['two','250.00'],['three','170.00']]) {
    await page.locator('#pricingSalesperson').selectOption(id);
    assert.equal(await page.getByRole('spinbutton',{name:'EWS Certificate price',exact:true}).inputValue(),price);
  }
  await page.locator('#pricingSalesperson').selectOption('one');
  const ews=()=>page.locator('.pricing-card').filter({has:page.getByRole('heading',{name:'EWS Certificate',exact:true})});
  await page.getByRole('spinbutton',{name:'Caste Certificate price',exact:true}).fill('555');
  await page.getByRole('spinbutton',{name:'EWS Certificate price',exact:true}).fill('210.50');
  await ews().getByRole('button',{name:'Update price',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.pricing-result').textContent==='Price updated.');
  assert.deepEqual(await page.evaluate(()=>window.saves.at(-1)),{salesUserId:'one',variantId:'ews',price:21050});
  assert.equal(await page.getByRole('spinbutton',{name:'EWS Certificate price',exact:true}).inputValue(),'210.50');
  assert.equal(await ews().getByText(/Default:|Individual price|Default price/).count(),0);
  assert.equal(await ews().getByRole('button',{name:'Use default',exact:true}).count(),0);
  assert.equal(await page.getByRole('spinbutton',{name:'Caste Certificate price',exact:true}).inputValue(),'555');
  await page.locator('#pricingSalesperson').selectOption('two');
  assert.equal(await page.getByRole('spinbutton',{name:'EWS Certificate price',exact:true}).inputValue(),'250.00');
  await page.locator('#pricingSalesperson').selectOption('one');
  assert.equal(await page.getByRole('spinbutton',{name:'EWS Certificate price',exact:true}).inputValue(),'210.50');
  await page.evaluate(()=>window.failSave=true);
  await page.getByRole('spinbutton',{name:'EWS Certificate price',exact:true}).fill('220');
  await ews().getByRole('button',{name:'Update price',exact:true}).click();
  assert.equal(await ews().getByRole('status').textContent(),'Could not save price');
  assert.equal(await ews().getByRole('button',{name:'Update price',exact:true}).isEnabled(),true);
  for(const width of [390,1280]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`No horizontal overflow at ${width}`);
  }
  assert.equal(await page.evaluate(()=>window.pricingNavigation('admin')),true);
  assert.equal(await page.evaluate(()=>window.pricingNavigation('sales')),false);
  assert.equal(await page.evaluate(()=>window.pricingNavigation('backoffice')),false);
  for(const mode of ['failure','timeout','incomplete']) {
    await page.evaluate(mode=>window.testPricingLoad(mode),mode);
    assert.match(await page.getByRole('alert').textContent(),/Could not load pricing/);
    assert.equal(await page.getByText('Loading pricing...', {exact:true}).count(),0);
    await page.evaluate(()=>window.recoverPricing());
    await page.getByRole('button',{name:'Retry',exact:true}).click();
    await page.locator('#pricingSalesperson').waitFor();
    assert.equal(await page.getByRole('alert').count(),0);
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: pricing navigation, failure/timeout/incomplete response recovery, salesperson prices, price updates, unsaved edits, role navigation, and mobile/desktop layout.');
} finally {await browser.close();}
