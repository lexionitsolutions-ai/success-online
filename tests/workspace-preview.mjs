import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
mkdirSync('deliverables/workspace',{recursive:true});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<main id="app"></main>');
  for(const file of ['styles.css','mobile.css','payments.css','dashboard.css','workspace.css']) await page.addStyleTag({content:readFileSync('public/'+file,'utf8')});
  await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
  await page.addScriptTag({type:'module',content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')+`
    window.workspaceFixture=catalog=>{
      me={id:'admin',role:'admin',name:'Success Online Admin',username:'admin01'};
      services=catalog.map(s=>({...s,id:s.slug,variants:[{id:'v-'+s.slug,name:'Application',revision:0,documents:s.documents}]}));
      serviceCatalogData={services:structuredClone(services)};
      cases=services.slice(0,8).map((s,i)=>({id:'c-'+i,ref:'SO-2026-0000'+i,service:s,variant:s.variants[0],customer:{id:'customer-'+(i%4),name:['Asha Patil','Nikita Sawant','Aniket Deshmukh','Sandesh Patil'][i%4],mobile:'9876543210'},sales:{id:'sales',username:'mainbranch'},backoffice:{name:'Operations team'},status:i===1?'Closed':'Document Review',payment_state:'paid',document_state:'complete',amounts:{total:50000},updated_at:new Date(Date.now()-i*3600000).toISOString(),priority:'Normal'}));
      caseNotifications=[{id:'n-1',caseId:'c-1',ref:'SO-2026-00001',title:'Completed document received',status:'Closed',createdAt:new Date().toISOString()},{id:'n-2',caseId:'c-0',ref:'SO-2026-00000',title:'Document review started',status:'Document Review',createdAt:new Date(Date.now()-3600000).toISOString()}];
      documentLibrary={summary:{bytes:3482160,files:18,cases:8},types:[{kind:'PDF',bytes:2482160,files:12},{kind:'Images',bytes:1000000,files:6}],total:2,page:1,documents:[{id:'doc1',case_id:'c-0',ref:'SO-2026-00000',customer_name:'Asha Patil',service_name:'Income Certificate',doc_type:'Aadhaar Card',file_name:'aadhaar-front.pdf',mime_type:'application/pdf',size:182160,version:1,created_at:new Date().toISOString(),download_url:'/api/documents/doc1/download'},{id:'doc2',case_id:'c-0',ref:'SO-2026-00000',customer_name:'Asha Patil',service_name:'Income Certificate',doc_type:'Photo',file_name:'customer-photo.jpg',mime_type:'image/jpeg',size:1000000,version:1,created_at:new Date().toISOString(),download_url:'/api/documents/doc2/download'}]};
      window.saves=[];window.testOpens=[];openCase=async id=>window.testOpens.push(id);window.openCase=openCase;
      api=async(path,options)=>{
        if(options?.method==='PUT') {if(window.failChecklist) throw Error('Could not save checklist. Try again.');window.saves.push(options.body);const service=serviceCatalogData.services.find(s=>s.variants.some(v=>path.includes(v.id)));service.variants[0].documents=options.body.documents.map(({originalLabel,...d})=>d);service.variants[0].revision++;return {ok:true};}
        if(path==='/api/admin/services') return structuredClone(serviceCatalogData);
        if(path==='/api/services') return {services:structuredClone(serviceCatalogData.services)};
        if(path.startsWith('/api/workspace/documents')) return structuredClone(documentLibrary);
        if(path==='/api/notifications/read') return {ok:true};
        throw Error('Unexpected request '+path);
      };
    };
    window.workspaceView=next=>{closeDrawer();view=next;render();};
    window.workspaceRole=role=>{me.role=role;render();};
    window.workspaceCashTest=enabled=>{me={id:enabled?'mainbranch':'other',role:'sales',name:'Sales Staff',username:'sales',cashPaymentsAllowed:enabled};paymentData={metrics:{},payments:[]};cashPendingData={cases:[]};paymentTab='activity';view='payments';render();};
  `});
  await page.evaluate(catalog=>window.workspaceFixture(catalog),serviceCatalog);
  await page.evaluate(()=>window.workspaceView('services'));
  assert.equal(await page.locator('.service-card').count(),16);
  await page.getByRole('searchbox',{name:'Search services',exact:true}).fill('Gazette');assert.equal(await page.locator('.service-card').count(),1);
  await page.getByRole('searchbox',{name:'Search services',exact:true}).fill('');
  await page.locator('.service-card').filter({has:page.getByRole('heading',{name:'Income Certificate',exact:true})}).getByRole('button',{name:'Edit checklist'}).click();
  const before=await page.locator('.checklist-document').count();
  await page.getByRole('button',{name:'Add document',exact:true}).click();assert.equal(await page.locator('.checklist-document').count(),before+1);
  await page.locator('.checklist-document:last-child input[data-checklist="label"]').fill('Additional Evidence');
  await page.locator('.checklist-document:last-child textarea').fill('Upload a clear copy.');
  await page.locator('.checklist-document:last-child input[data-checklist="multiple"]').check();
  await page.locator('.checklist-document').first().getByRole('button',{name:/Remove/}).click();assert.equal(await page.locator('.checklist-document').count(),before);
  await page.locator('.checklist-document:last-child').getByRole('button',{name:'Move Additional Evidence up',exact:true}).click();
  assert.equal(await page.locator('.checklist-document').nth(before-2).locator('input[data-checklist="label"]').inputValue(),'Additional Evidence');
  await page.getByRole('button',{name:'Save checklist',exact:true}).click();
  await page.locator('#drawer').waitFor({state:'detached'});
  const saved=await page.evaluate(()=>window.saves.at(-1));assert.equal(saved.documents.at(-2).label,'Additional Evidence');assert.equal(saved.documents.at(-2).multiple,true);
  await page.locator('.service-card').filter({has:page.getByRole('heading',{name:'Income Certificate',exact:true})}).getByRole('button',{name:'Edit checklist'}).click();
  assert.equal(await page.locator('.checklist-document').nth(before-2).locator('input[data-checklist="label"]').inputValue(),'Additional Evidence');
  await page.evaluate(()=>window.failChecklist=true);await page.getByRole('button',{name:'Save checklist',exact:true}).click();assert.match(await page.locator('#checklistSaveError').textContent(),/Could not save/);assert.equal(await page.getByRole('button',{name:'Save checklist',exact:true}).isEnabled(),true);
  await page.evaluate(()=>window.failChecklist=false);
  for(const width of [1280,390]) {
    await page.evaluate(()=>document.querySelectorAll('.toast').forEach(t=>t.remove()));
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:'deliverables/workspace/checklist-'+width+'.png',fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No checklist overflow at '+width);
    for(const view of ['dashboard','services','documents','storage','notifications']) {
      await page.evaluate(view=>window.workspaceView(view),view);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No '+view+' overflow at '+width);
      await page.screenshot({path:'deliverables/workspace/'+view+'-'+width+'.png',fullPage:true});
    }
    if(width===1280) {
      await page.evaluate(()=>window.workspaceView('services'));
      await page.locator('.service-card').first().getByRole('button',{name:'Edit checklist'}).click();
    }
  }
  await page.evaluate(()=>window.workspaceView('documents'));await page.getByRole('button',{name:'Open Request',exact:true}).first().click();assert.equal((await page.evaluate(()=>window.testOpens)).at(-1),'c-0');
  await page.evaluate(()=>window.workspaceView('notifications'));await page.getByRole('button',{name:'Mark all as read',exact:true}).click();assert.match(await page.locator('.notification-center').textContent(),/all caught up/);
  for(const role of ['sales','admin']) {
    await page.evaluate(role=>{window.workspaceRole(role);window.workspaceView('dashboard');},role);
    assert.equal(await page.getByRole('heading',{name:'Live Dashboard',exact:true}).count(),1);
    assert.equal(await page.locator('.overview-metrics [data-metric-icon]').count(),8);
    await page.evaluate(()=>document.querySelectorAll('.toast').forEach(t=>t.remove()));
    for(const width of [1280,390]) {await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Dashboard fits '+role+' at '+width);await page.screenshot({path:'deliverables/workspace/live-dashboard-'+role+'-'+width+'.png',fullPage:true});}
  }
  await page.evaluate(()=>window.workspaceRole('sales'));assert.equal(await page.locator('.side [data-view="services"]').count(),0);assert.equal(await page.locator('.side [data-view="documents"]').count(),1);assert.equal(await page.locator('[data-view="storage"]').count(),0);assert.equal(await page.getByRole('button',{name:'New Case',exact:true}).count(),1);
  for(const enabled of [false,true]) {await page.evaluate(enabled=>window.workspaceCashTest(enabled),enabled);assert.equal(await page.locator('.cash-pending-metric').count(),enabled?1:0);assert.equal(await page.getByRole('tab',{name:'Cash pending payments',exact:true}).count(),enabled?1:0);}
  assert.deepEqual(errors,[]);console.log('PASS: service search, document add/remove/save/reload, save failure recovery, file links, notifications, role navigation and responsive workspace views.');
} finally {await browser.close();}
