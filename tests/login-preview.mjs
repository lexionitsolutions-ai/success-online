// Isolated browser fixtures: no live accounts or database writes.
import {chromium} from 'playwright';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executable?{executablePath:executable}:{})});
const screenshots='deliverables/login-preview';mkdirSync(screenshots,{recursive:true});
try {
  for(const width of [320,390,768,1280]) {
    const context=await browser.newContext({viewport:{width,height:width<701?740:900}});
    let allowLogin=false, submissions=0;
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({error:'Sign in required'},401);
      if(path==='/api/login') {
        submissions++;
        assert.deepEqual(route.request().postDataJSON(),{username:'staff.demo',password:'TestOnly12345'});
        return allowLogin ? json({user:{id:'test',name:'Staff Demo',username:'staff.demo',role:'sales'}}) : json({error:'Incorrect username or password'},401);
      }
      if(path==='/api/services') return json({services:[]});
      if(path==='/api/notifications') return json({notifications:[]});
      if(path==='/api/announcements') return json({announcements:[]});
      if(path==='/api/cases') return json({cases:[]});
      const file={'/':'index.html','/script.js':'script.js','/styles.css':'styles.css','/mobile.css':'mobile.css','/payments.css':'payments.css','/dashboard.css':'dashboard.css','/login.css':'login.css'}[path];
      if(file) return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync(file==='script.js' && process.env.LOGIN_PREVIEW_SCRIPT ? process.env.LOGIN_PREVIEW_SCRIPT : join('public',file),'utf8')});
      return route.abort();
    });
    const page=await context.newPage(), errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://login-preview.test');await page.locator('#login').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow at '+width);
    assert.equal(await page.getByText('Success Online is a private assistance business and is not a government portal.').count(),0);
    assert.ok(await page.locator('#login button.primary').isVisible());
    await page.screenshot({path:join(screenshots,`login-${width}.png`),fullPage:true});
    await page.getByLabel('Phone number or username',{exact:true}).fill('staff.demo');
    const password=page.getByLabel('Password',{exact:true});await password.fill('TestOnly12345');
    await page.getByRole('button',{name:'Show password',exact:true}).click();
    assert.equal(await password.getAttribute('type'),'text');assert.equal(await password.inputValue(),'TestOnly12345');
    await page.getByRole('button',{name:'Hide password',exact:true}).click();assert.equal(await password.getAttribute('type'),'password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.locator('.auth-error').waitFor({state:'visible'});
    assert.equal(await page.locator('.auth-error').textContent(),'Incorrect username or password');
    assert.equal(await page.getByRole('button',{name:'Sign in',exact:true}).isEnabled(),true);
    await page.screenshot({path:join(screenshots,`error-${width}.png`),fullPage:true});
    allowLogin=true;await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.locator('.profile-button').waitFor();assert.equal(submissions,2);assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('Login passed at 320, 390, 768 and 1280px: layout, logos, password visibility, invalid-login recovery and sign-in.');
} finally {await browser.close();}
