// Browser QA uses synthetic API fixtures; it never connects to the live database.
import {chromium} from 'playwright';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {serviceCatalog} from '../service-catalog.js';
const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
const root='deliverables/mobile-preview';mkdirSync(root,{recursive:true});
const amounts={serviceCharge:0,officialFee:0,tax:0,total:0};
const services=serviceCatalog.map((s,index)=>({...s,id:'svc'+index,variants:[{id:'var'+index,name:'Application',fields:s.fields,documents:s.documents,amounts}]}));
const employee=role=>({id:role,username:role+'.demo',name:({admin:'Workspace Admin',sales:'Sales Employee',backoffice:'Operations Employee'})[role],role});
const cases=[{id:'case1',ref:'SO-2026-000128',customer:{name:'Aarav Mehta',mobile:'9876543210'},service:{id:'svc0',name:'Income Certificate'},variant:services[0].variants[0],sales:employee('sales'),backoffice:employee('backoffice'),status:'Awaiting Documents',document_state:'missing',payment_state:'unpaid',priority:'Normal',created_at:'2026-10-12T03:30:00Z',updated_at:'2026-10-12T04:30:00Z',amounts,details:{}},{id:'case2',ref:'SO-2026-000127',customer:{name:'Priya Sharma',mobile:'9876543211'},service:{id:'svc1',name:'Age, Nationality & Domicile Certificate'},variant:services[1].variants[0],sales:employee('sales'),backoffice:null,status:'Ready for Assignment',document_state:'complete',payment_state:'paid',priority:'Normal',created_at:'2026-10-11T03:30:00Z',updated_at:'2026-10-12T02:30:00Z',amounts,details:{}}];
try {
  for(const width of (process.env.PREVIEW_WIDTHS||'320,390,430,768,1280').split(',').map(Number)) for(const role of (process.env.PREVIEW_ROLES||'sales,backoffice,admin').split(',')) {
    const context=await browser.newContext({viewport:{width,height:844},isMobile:width<=900,hasTouch:width<=900});
    let signedIn=true;
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:employee(role)},signedIn?200:401);
      if(path==='/api/login') {signedIn=true;return json({user:employee(role)});}
      if(path==='/api/logout') {signedIn=false;return json({ok:true});}
      if(path==='/api/services') return json({services,demoPayments:true,cloudUploads:false});
      if(path==='/api/cases') return json({cases});
      if(path==='/api/cases/case1') return json({case:cases[0],documents:[],notes:[]});
      if(path==='/api/admin/employees') return json({employees:['sales','backoffice'].map(role=>({...employee(role),active:1,cases:12,collected:500000,handled:8,completed:7,activeCases:3,overdue:1,turnaround:2.4}))});
      if(path==='/api/admin/dashboard') return json({metrics:{collected:500000,payments:12,businessRevenue:200000,newCases:15,completed:9,outstanding:150000},operations:{active:12,ready:3,missingDocuments:4,unpaid:5,followUpsDue:1,syncFailures:0},trend:[],statusBreakdown:[],servicePerformance:[],staffPerformance:{sales:[{...employee('sales'),cases:12,completed:7,collected:500000}],backoffice:[{...employee('backoffice'),assigned:8,completed:7,active:3}]},recentPayments:[]});
      if(path.startsWith('/api/google')) return json({configured:false,connected:false,live:false});
      const file={'/':'index.html','/script.js':'script.js','/styles.css':'styles.css','/mobile.css':'mobile.css'}[path];
      if(file) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync(join('public',file),'utf8')});
      return route.abort();
    });
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://mobile-preview.test');
    await page.locator('.profile-button').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Dashboard overflows at '+width);
    const profileBox=await page.locator('.profile-button').boundingBox();
    assert.ok(profileBox.x+profileBox.width>width-40,'Profile must be at the right edge');
    if(width===390) await page.screenshot({path:join(root,role+'-overview.png'),fullPage:true});
    await page.locator('.profile-button').click();
    await page.locator('.profile[open]').waitFor();
    const menuBox=await page.locator('.profile-menu').boundingBox();
    assert.ok(menuBox.x>=0 && menuBox.x+menuBox.width<=width+1,'Profile menu must fit the viewport');
    if(width===390) await page.screenshot({path:join(root,role+'-profile.png')});
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.profile[open]').count(),0);
    await page.evaluate(()=>window.setView('cases'));
    await page.locator('.case-table').waitFor();
    const fits=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
    if(!fits) {
      await page.screenshot({path:join(root,'overflow-'+width+'.png'),fullPage:true});
      console.log(await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(el=>({tag:el.tagName,classes:el.className,right:el.getBoundingClientRect().right}))));
    }
    assert.ok(fits,'Case list overflows at '+width);
    if(width<=900) assert.equal(await page.locator('.case-table tbody tr').first().evaluate(el=>getComputedStyle(el).display),'grid');
    if(width===390) await page.screenshot({path:join(root,role+'-cases.png'),fullPage:true});
    await page.getByRole('button',{name:'Open case SO-2026-000128'}).click();
    await page.locator('#drawer').waitFor();
    if(width===390) await page.screenshot({path:join(root,role+'-documents.png')});
    assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Drawer overflows');
    await page.locator('#drawer').getByRole('button',{name:'Close',exact:true}).click();
    if(role==='admin') {
      if(width<=900) {
        await page.locator('.mobile-more>summary').click();
        await page.locator('.more-menu').getByRole('button',{name:'Employees',exact:true}).click();
      } else await page.locator('.nav').getByRole('button',{name:'Employees',exact:true}).click();
      await page.locator('#employeePeriod').waitFor();
      if(width===390) await page.screenshot({path:join(root,'admin-employees.png'),fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Employee page overflows');
      if(width===390) {
        await page.locator('.mobile-more>summary').click();
        await page.locator('.more-menu').getByRole('button',{name:'Business analytics',exact:true}).click();
        await page.locator('.mini-row:not(.mini-head)').first().waitFor();
        assert.ok(await page.locator('.mini-row:not(.mini-head)').first().evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Performance metrics overflow');
        await page.screenshot({path:join(root,'admin-analytics.png'),fullPage:true});
      }
    }
    if(role==='sales') {
      await page.locator('.top-actions').getByRole('button',{name:'New case',exact:true}).click();
      await page.locator('#mobile').fill('9876543210');await page.locator('#name').fill('Demo Customer');
      await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
      const selectors=page.locator('#serviceFields select');
      for(let index=0;index<await selectors.count();index++) await selectors.nth(index).selectOption({index:1});
      await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
      if(width===390) await page.screenshot({path:join(root,'sales-upload-step.png')});
      assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Upload step overflows');
      assert.equal(await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
      if(width===390) {
        const count=await page.locator('#drawer input[type="file"]').count();
        for(let index=0;index<count;index++) {
          await page.locator('#drawer input[type="file"]').nth(index).setInputFiles({name:'trial.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\ntrial\n%%EOF')});
          await page.waitForFunction(expected=>[...document.querySelectorAll('#drawer .doc em')].filter(el=>el.textContent==='trial.pdf').length===expected,index+1);
        }
        assert.equal(await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).isEnabled(),true);
        await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
        await page.locator('#consent').waitFor();
        await page.screenshot({path:join(root,'sales-case-review.png')});
      }
      await page.locator('#drawer').getByRole('button',{name:'Close',exact:true}).click();
    }
    await page.locator('.profile-button').click();
    await page.locator('.profile-menu').getByRole('button',{name:'Switch account',exact:true}).click();
    await page.locator('#login').waitFor();
    assert.equal(await page.locator('#login [name="username"]').evaluate(el=>el===document.activeElement),true);
    if(width===390) await page.screenshot({path:join(root,role+'-signin.png'),fullPage:true});
    await page.locator('#login [name="username"]').fill(role+'.demo');
    await page.locator('#login [name="password"]').fill('TestOnly12345');
    await page.locator('#login button.primary').click();
    await page.locator('.profile-button').waitFor();
    await page.locator('.profile-button').click();
    await page.locator('.profile-menu').getByRole('button',{name:'Sign out',exact:true}).click();
    await page.locator('#login').waitFor();
    assert.deepEqual(errors,[],role+' browser errors');
    console.log(role+' at '+width+'px: navigation, profile, sign-in/out and layout passed.');
    await context.close();
  }
} finally {await browser.close();}
