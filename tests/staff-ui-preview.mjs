import {chromium} from 'playwright';
import {readFileSync,existsSync} from 'node:fs';
import assert from 'node:assert/strict';

const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
try {
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.fulfill({contentType:'application/json',body:'{"notifications":[],"announcements":[]}'}));
  await page.route('https://staff-preview.test/',route=>route.fulfill({contentType:'text/html',body:'<html><body></body></html>'}));
  await page.goto('https://staff-preview.test/');
  await page.setContent('<html><head></head><body><div id="app"></div></body></html>');
  for(const file of ['styles.css','mobile.css','dashboard.css']) await page.addStyleTag({content:readFileSync('public/'+file,'utf8')});
  await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
  await page.addScriptTag({content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')});
  await page.evaluate(()=>{
    me={id:'admin',role:'admin',name:'Admin',username:'admin'};
    pricingSalesId='sales';view='pricing';
    pricingData={salespeople:[{id:'sales',name:'Sales',username:'sales',active:true}],overrides:[],prices:[...[1,2,3,4,5].map(n=>({variant_id:'food-'+n,service_name:'Food License',variant_name:n===1?'1 year':n+' years',price:n*10000})),...['Job','Education','Election'].map(name=>({variant_id:name,service_name:'Caste Validity Certificate',variant_name:name,price:90000}))]};
    render();
  });
  assert.equal(await page.locator('.pricing-card').count(),2);
  await page.locator('.pricing-card').first().locator('select').selectOption('food-4');
  assert.equal(await page.locator('.pricing-card').first().locator('input').inputValue(),'400.00');
  await page.locator('.top-actions [data-intake-language="mr"]').click();
  await page.getByRole('heading',{name:'अन्न परवाना',exact:true}).waitFor();
  assert.equal(await page.locator('.pricing-card').first().locator('select').inputValue(),'food-4');
  await page.locator('.pricing-card').first().locator('select').selectOption('food-2');
  assert.equal(await page.locator('.pricing-card').first().locator('input').inputValue(),'200.00');
  await page.locator('.profile-button').click();
  assert.equal(await page.locator('.profile[open]').count(),1);
  await page.locator('.top-actions [data-intake-language="en"]').click();
  await page.getByRole('heading',{name:'Food License',exact:true}).waitFor();
  await page.evaluate(()=>{
    me={id:'sales',role:'sales',name:'Sales',username:'sales'};
    selectedCase={case:{id:'case',status:'Closed',quote:{submittedAt:'2026-11-16'}},notes:[{id:'first',actor_id:'office',actor:'Office',note:'Please confirm '+ 'LongMessage'.repeat(100),next_action:'{"type":"backoffice_remark"}',created_at:'2026-11-16'},{id:'second',actor_id:'sales',actor:'Sales',note:'Confirmed',next_action:'{"type":"case_message"}',created_at:'2026-11-17'}]};
    document.body.insertAdjacentHTML('beforeend',`<div id="drawer" class="drawer"><div class="panel">${backofficeRemarks(selectedCase.case,selectedCase.notes)}</div></div>`);
  });
  const incoming=await page.locator('.chat-incoming').boundingBox();
  const outgoing=await page.locator('.chat-outgoing').boundingBox();
  assert.ok(outgoing.x>incoming.x,'Own messages align on the right');
  assert.ok(await page.getByRole('button',{name:'Send message',exact:true}).isVisible());
  for(const width of [390,1024]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.locator('.case-chat').evaluate(log=>log.scrollWidth<=log.clientWidth),'Chat has no horizontal overflow');
    for(const bubble of await page.locator('.chat-message').all()) {
      assert.ok(await bubble.evaluate(el=>{
        const p=el.querySelector('p'),outer=el.getBoundingClientRect(),inner=p.getBoundingClientRect();
        return inner.left>=outer.left+12 && inner.right<=outer.right-12 && el.scrollWidth<=el.clientWidth;
      }),'Message text stays inside padded bubbles');
    }
  }
  let sentBody;
  await page.route('**/api/cases/case/remark',async route=>{
    sentBody=route.request().postDataJSON();
    await route.fulfill({contentType:'application/json',body:JSON.stringify({note:{id:'new',actor_id:'sales',actor:'Sales',note:sentBody.remark,next_action:'{"type":"case_message"}',created_at:'2026-11-18'}})});
  });
  await page.locator('.chat-compose textarea').fill('New reply');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.locator('.chat-compose-result').filter({hasText:'Message sent.'}).waitFor();
  assert.equal(sentBody.chatOnly,true);
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'');
  assert.equal(await page.locator('.chat-message-text').last().innerText(),'New reply');
  assert.equal(await page.locator('.case-chat').evaluate(log=>Math.abs(log.scrollHeight-log.scrollTop-log.clientHeight)<2),true);
  const notes=await page.evaluate(()=>selectedCase.notes);
  const reply={id:'remote',actor_id:'office',actor:'Office',note:'New office reply',next_action:'{"type":"backoffice_remark"}',created_at:'2026-11-19'};
  await page.route('**/api/cases/case/messages',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({notes:[...notes,reply],quote:{submittedAt:'2026-11-16'},status:'Closed'})}));
  await page.locator('.chat-compose textarea').fill('Keep my draft');
  await page.evaluate(()=>startChatPolling());
  await page.getByText('New office reply',{exact:true}).waitFor({timeout:7000});
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'Keep my draft');
  await page.route('**/api/cases/case/remark',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Please retry"}'}));
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await page.getByText('Please retry',{exact:true}).waitFor();
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'Keep my draft');
  assert.equal(await page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),true);
  assert.deepEqual(errors,[]);
  console.log('Staff UI: pricing, language, padded bubbles, sending, live replies and failed-send draft recovery passed.');
} finally {await browser.close();}
