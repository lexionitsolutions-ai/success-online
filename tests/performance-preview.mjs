// Local UI fixtures only; never connects to a live database.
import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {staffPerformance} from '../staff-performance.js';
const executable=process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
const employees=role=>[{id:role,name:role==='sales'?'Asha Patil':'Rohan Deshmukh',username:role+'01',role,active:1},{id:role+'2',name:'New Employee',username:role+'02',role,active:1}];
const cases=Array.from({length:8},(_,i)=>({id:'case'+i,ref:'SORO-2026-'+(100+i),customer_id:'cus'+i,customer_name:['Anita Patil','Vijay Shah','Pooja Desai'][i%3],sales_user_id:'sales',backoffice_user_id:'backoffice',service_name:i%2?'Income Certificate':'PAN Card',variant_name:'New Application',variant_id:'variant'+i%2,status:i<5?'Closed':'Assigned',created_at:'2026-11-01T06:00:00.000Z',completed_at:i<5?'2026-11-03T06:00:00.000Z':null,due_date:'2026-11-05',follow_up_date:'2026-11-03'}));
const payments=cases.map(c=>({case_id:c.id,status:'PAID',gateway:'direct_upi',amount:35000,service_charge:30000,tax:2000,official_fee:3000,verified_at:'2026-11-02T00:00:00.000Z'}));
const notes=cases.map(c=>({case_id:c.id,actor_id:'backoffice',new_status:'Assigned',created_at:'2026-11-01T12:00:00.000Z'}));
mkdirSync('deliverables/performance-preview',{recursive:true});
try {
  for(const width of [390,1440]) {
    const context=await browser.newContext({viewport:{width,height:1000}});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()),path=url.pathname;
      const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:{id:'admin',name:'Workspace Admin',username:'admin01',role:'admin'}});
      if(path==='/api/cases') return json({cases:[]});
      if(path==='/api/services') return json({services:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path==='/api/admin/performance') {
        const role=url.searchParams.get('role'),list=employees(role),employee=list.find(e=>e.id===url.searchParams.get('employee')) || list[0];
        return json({employees:list,report:staffPerformance({employee,cases,payments,notes,period:{start:'2026-11-01T00:00:00.000Z',end:'2026-12-01T00:00:00.000Z'},now:'2026-11-10T00:00:00.000Z'})});
      }
      if(path.startsWith('/api/')) return json({});
      const file=path==='/'?'index.html':path.slice(1);
      if(!file.includes('..') && existsSync('public/'+file)) return route.fulfill({body:readFileSync('public/'+file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'});
      return route.abort();
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('http://performance.test');
    await page.getByRole('heading',{name:'Operations workspace'}).waitFor();
    for(const role of ['sales','backoffice']) {
      if(width<901) await page.locator('.mobile-more summary').click();
      await page.locator(`${width<901?'.more-menu':'.side'} [data-view="${role}Performance"]`).click();
      await page.getByRole('heading',{name:employees(role)[0].name,exact:true}).waitFor();
      assert.equal(await page.locator('select[name="employee"] option').count(),2);
      assert.equal(await page.locator('input[name="from"]').isVisible(),false,'Preset periods hide custom dates');
      assert.ok(await page.getByRole('heading',{name:'Service and application breakdown'}).isVisible());
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Page must fit viewport');
      await page.screenshot({path:`deliverables/performance-preview/${role}-${width}.png`,fullPage:true});
      await page.locator('select[name="employee"]').selectOption(role+'2');
      await page.getByRole('heading',{name:'New Employee',exact:true}).waitFor();
      assert.ok(await page.getByText('No cases or collections for this employee in this period.',{exact:true}).isVisible());
      await page.locator('select[name="period"]').selectOption('custom');
      assert.ok(await page.locator('input[name="from"]').isVisible());
      await page.locator('input[name="from"]').fill('2026-11-01');
      await page.locator('input[name="to"]').fill('2026-11-10');
      await page.getByRole('button',{name:'Review performance',exact:true}).click();
      await page.getByRole('heading',{name:'New Employee',exact:true}).waitFor();
    }
    assert.deepEqual(errors,[]);await context.close();
  }
  console.log('Sales and backoffice tabs passed employee selection, custom dates, empty states and responsive layout at 390px and 1440px.');
} finally {await browser.close();}
