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
const services=serviceCatalog.map((s,index)=>({...s,id:'svc'+index,variants:[{id:'var'+index,name:'Application',fields:s.fields,documents:s.documents,amounts:index===0?{serviceCharge:20000,officialFee:0,tax:0,total:20000}:amounts}]}));
const employee=role=>({id:role,username:role+'.demo',name:({admin:'Workspace Admin',sales:'Sales Employee',backoffice:'Operations Employee'})[role],role});
const previewPhoto=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSU8AAAAASUVORK5CYII=','base64');
const previewText='BT /F1 18 Tf 30 150 Td (Document preview test) Tj ET';
const previewText2='BT /F1 18 Tf 30 150 Td (Second document page) Tj ET';
const previewObjects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${previewText.length} >>\nstream\n${previewText}\nendstream`,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',`<< /Length ${previewText2.length} >>\nstream\n${previewText2}\nendstream`];
let previewPDF='%PDF-1.4\n';const previewOffsets=[0];
for(const [index,object] of previewObjects.entries()) {previewOffsets.push(Buffer.byteLength(previewPDF));previewPDF+=`${index+1} 0 obj\n${object}\nendobj\n`;}
const previewXref=Buffer.byteLength(previewPDF);
previewPDF+=`xref\n0 ${previewObjects.length+1}\n0000000000 65535 f \n${previewOffsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${previewObjects.length+1} /Root 1 0 R >>\nstartxref\n${previewXref}\n%%EOF`;
const cases=[{id:'case1',ref:'SO-2026-000128',customer:{name:'Aarav Mehta',mobile:'9876543210'},service:{id:'svc0',name:'Income Certificate'},variant:services[0].variants[0],sales:employee('sales'),backoffice:employee('backoffice'),status:'Awaiting Documents',document_state:'missing',payment_state:'unpaid',priority:'Normal',created_at:'2026-10-12T03:30:00Z',updated_at:'2026-10-12T04:30:00Z',amounts,details:{}},{id:'case2',ref:'SO-2026-000127',customer:{name:'Priya Sharma',mobile:'9876543211'},service:{id:'svc1',name:'Age, Nationality & Domicile Certificate'},variant:services[1].variants[0],sales:employee('sales'),backoffice:null,status:'Ready for Assignment',document_state:'complete',payment_state:'paid',priority:'Normal',created_at:'2026-10-11T03:30:00Z',updated_at:'2026-10-12T02:30:00Z',amounts,details:{}}];
try {
  for(const width of (process.env.PREVIEW_WIDTHS||'320,390,430,768,1280').split(',').map(Number)) for(const role of (process.env.PREVIEW_ROLES||'sales,backoffice,admin').split(',')) {
    const context=await browser.newContext({viewport:{width,height:844},isMobile:width<=900,hasTouch:width<=900});
    let signedIn=true;
    const contextCases=structuredClone(cases);
    let contextNotices=[];
    let previewFailure=false;
    const previewDocuments=['backoffice','admin'].includes(role)?[{id:'preview-photo',doc_type:'Photo',file_name:'beneficiary.png',mime_type:'image/png',state:'uploaded',version:1,download_url:'/api/documents/preview-photo/download'},{id:'preview-pdf',doc_type:'Ration Card',file_name:'ration-card.pdf',mime_type:'application/pdf',state:'uploaded',version:1,download_url:'/api/documents/preview-pdf/download'}]:[];
    await context.route('**/*',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/me') return json({user:employee(role)},signedIn?200:401);
      if(path==='/api/login') {signedIn=true;return json({user:employee(role)});}
      if(path==='/api/logout') {signedIn=false;return json({ok:true});}
      if(path==='/api/notifications') return json({notifications:contextNotices});
      if(path==='/api/notifications/read') {const ids=route.request().postDataJSON().ids;contextNotices=contextNotices.filter(notice=>!ids.includes(notice.id));return json({ok:true});}
      if(path==='/api/services') return json({services,demoPayments:true,cloudUploads:false});
      if(path==='/api/cases') return json({cases:contextCases});
      if(path==='/api/cases/case1') return json({case:contextCases[0],documents:previewDocuments,notes:contextCases[0].status==='Correction Required'?[{new_status:'Correction Required',note:'Replace the blurry Ration Card photo',actor:'Operations'}]:[]});
      if(path==='/api/documents/preview-photo/preview' || path==='/api/documents/preview-pdf/preview') {if(previewFailure) return json({error:'Document preview temporarily unavailable'},502);const pdf=path.includes('preview-pdf');return json({url:pdf?'/fixtures/preview.pdf':'/fixtures/preview.png',mimeType:pdf?'application/pdf':'image/png',fileName:pdf?'ration-card.pdf':'beneficiary.png'});}
      if(path==='/fixtures/preview.png') return route.fulfill({contentType:'image/png',body:previewPhoto});
      if(path==='/fixtures/preview.pdf') return route.fulfill({contentType:'application/pdf',headers:{'content-disposition':'inline'},body:previewPDF});
      if(path==='/api/cases/case1/progress') {const body=route.request().postDataJSON();contextCases[0].status=body.status;return json({case:contextCases[0],note:{id:'note1',new_status:body.status,note:body.note,actor:'Operations'}});}
      if(path==='/api/admin/employees') return json({employees:['sales','backoffice'].map(role=>({...employee(role),active:1,cases:12,collected:500000,handled:8,completed:7,activeCases:3,overdue:1,turnaround:2.4}))});
      if(path==='/api/admin/dashboard') return json({metrics:{collected:500000,payments:12,businessRevenue:200000,newCases:15,completed:9,outstanding:150000},operations:{active:12,ready:3,missingDocuments:4,unpaid:5,followUpsDue:1,syncFailures:0},trend:[],statusBreakdown:[],servicePerformance:[],staffPerformance:{sales:[{...employee('sales'),cases:12,completed:7,collected:500000}],backoffice:[{...employee('backoffice'),assigned:8,completed:7,active:3}]},recentPayments:[]});
      if(path.startsWith('/api/google')) return json({configured:false,connected:false,live:false});
      if(path.startsWith('/vendor/pdfjs/') && !path.includes('..')) return route.fulfill({contentType:path.endsWith('.mjs')?'application/javascript':path.endsWith('.wasm')?'application/wasm':'application/octet-stream',body:readFileSync(join('public',path.slice(1)))});
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
    if(role==='sales') {
      contextCases[0].status='Correction Required';
      contextNotices=[{id:'n1',caseId:'case1',status:'Correction Required',title:'Returned to sales for correction'}];
      if(width!==390) await page.evaluate(()=>window.setView('dashboard'));
      const pendingNav=page.locator(width<=900?'.mobile-nav [data-view="pending"]':'.nav [data-view="pending"]');
      await pendingNav.locator('.nav-update-dot').waitFor({timeout:20000});
      await pendingNav.click();
      await page.getByRole('heading',{name:'Pending Cases',exact:true}).waitFor();
      assert.equal(await page.locator('.case-table tbody tr').count(),1);
      assert.match(await page.locator('.case-table').innerText(),/Correction Required/);
      assert.equal(await pendingNav.locator('.nav-update-dot').count(),1);
      await page.screenshot({path:join(root,`sales-pending-${width}.png`)});
      await page.getByRole('button',{name:'Open case SO-2026-000128'}).click();
      await page.locator('.correction-notice').waitFor();
      assert.match(await page.locator('.correction-notice').innerText(),/Replace the blurry/);
      await pendingNav.locator('.nav-update-dot').waitFor({state:'detached'});
      await page.locator('#drawer').getByRole('button',{name:'Close',exact:true}).click();
      contextCases[0].status='Awaiting Documents';
    }
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
    if(['backoffice','admin'].includes(role)) {
      let downloads=0;page.on('download',()=>downloads++);
      const photoButton=page.getByRole('button',{name:'Preview Photo',exact:true});
      await photoButton.click();
      await page.locator('#documentPreview img').waitFor();
      await page.waitForFunction(()=>document.querySelector('#documentPreview img')?.naturalWidth>0);
      assert.ok(await page.locator('#documentPreview').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.top>=0 && r.bottom<=innerHeight && el.scrollWidth<=el.clientWidth+1;}),'Photo preview must fit the viewport');
      assert.equal(await page.locator('#documentPreview').getByRole('link',{name:'Download',exact:true}).count(),1);
      await page.screenshot({path:join(root,`${role}-photo-preview-${width}.png`)});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#documentPreview').count(),0);
      assert.equal(await photoButton.evaluate(el=>el===document.activeElement),true,'Closing preview restores focus');
      await page.getByRole('button',{name:'Preview Ration Card',exact:true}).click();
      await page.locator('#documentPreview canvas[data-rendered="1"]').waitFor();
      assert.match(await page.locator('#previewPageCount').innerText(),/Page 1 of 2/);
      await page.getByRole('button',{name:'Next PDF page',exact:true}).click();
      await page.locator('#documentPreview canvas[data-rendered="2"]').waitFor();
      await page.getByRole('button',{name:'Previous PDF page',exact:true}).click();
      await page.locator('#documentPreview canvas[data-rendered="1"]').waitFor();
      await page.getByRole('button',{name:'Zoom in',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#previewZoomLabel')?.textContent==='125%');
      assert.ok(await page.locator('#documentPreview').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Zoom must scroll within the viewer');
      assert.ok((await page.locator('#documentPreview canvas').boundingBox()).height>100,'PDF viewer has usable height');
      await page.locator('#documentPreview').getByRole('link',{name:'Open full-size preview',exact:true}).waitFor();
      await page.screenshot({path:join(root,`${role}-pdf-preview-${width}.png`)});
      await page.getByRole('button',{name:'Close preview',exact:true}).click();
      previewFailure=true;
      await photoButton.click();
      await page.locator('#documentPreview [role=alert]').waitFor();
      previewFailure=false;
      await page.getByRole('button',{name:'Retry preview',exact:true}).click();
      await page.locator('#documentPreview img').waitFor();
      await page.getByRole('button',{name:'Close preview',exact:true}).click();
      assert.equal(downloads,0,'Preview never triggers a download');
      assert.equal(await page.locator('#drawer').count(),1,'Preview keeps the case open');
    }
    if(role==='backoffice') {
      await page.locator('#note').fill('Replace the blurry Ration Card photo');
      const returnButton=page.getByRole('button',{name:'Return to sales',exact:true});
      assert.ok((await returnButton.boundingBox()).height>=44,'Return to sales must be easy to tap');
      await returnButton.click();
      await page.locator('.correction-notice').waitFor();
      assert.match(await page.locator('.correction-notice').innerText(),/Replace the blurry/);
      assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Correction drawer must fit');
      await page.screenshot({path:join(root,`backoffice-correction-${width}.png`)});
    }
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
      if(width>900) assert.ok((await page.locator('#name').boundingBox()).x < (await page.locator('#mobile').boundingBox()).x);
      await page.locator('#mobile').fill('ddwea');
      assert.equal(await page.locator('#mobile').inputValue(),'');
      await page.locator('#mobile').fill('98ab76-54!');
      assert.equal(await page.locator('#mobile').inputValue(),'987654');
      await page.locator('#mobile').fill('9876543210');await page.locator('#name').fill('Demo Customer');
      await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
      assert.equal(await page.locator('#variant').count(),0);
      await page.locator('#service').selectOption('svc1');
      assert.equal(await page.getByLabel('Applicant birth date',{exact:true}).count(),0);
      assert.equal(await page.getByLabel('Applicant or beneficiary',{exact:true}).count(),0);
      const under18=page.locator('[data-field="Applicant%20under%2018%3F"]');
      const applicant=page.locator('[data-field="Applicant"]');
      assert.equal(await applicant.count(),0);
      await under18.selectOption('Yes');
      assert.deepEqual(await applicant.locator('option').allTextContents(),['Choose…','Father','Mother','Guardian']);
      await applicant.selectOption('Mother');
      await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
      assert.equal(await page.locator('.upload-list .doc strong').nth(1).innerText(),'Father Aadhaar Card');
      assert.match(await page.locator('.doc').filter({has:page.getByText('Photo',{exact:true})}).innerText(),/Photo of the beneficiary/);
      assert.match(await page.locator('.doc').filter({has:page.getByText('School Leaving Certificate',{exact:true})}).innerText(),/School Leaving Certificate of the beneficiary/);
      assert.equal(await page.locator('.doc').first().evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(174, 189, 208)');
      await page.screenshot({path:join(root,`domicile-documents-${width}.png`)});
      await page.locator('#drawer').getByRole('button',{name:'Back',exact:true}).click();
      await under18.selectOption('No');
      assert.equal(await applicant.inputValue(),'Self');
      assert.equal(await applicant.getAttribute('readonly'),'');
      await page.locator('#service').selectOption('svc0');
      const reason=page.locator('[data-field="Reason%20for%20application"]');
      const otherReason=page.getByLabel('Other reason (please specify)',{exact:true});
      await reason.selectOption('Other');
      assert.equal(await otherReason.count(),1);
      await otherReason.fill('Education admission');
      await reason.selectOption('Banking');
      assert.equal(await otherReason.count(),0);
      await reason.selectOption('Other');
      assert.equal(await otherReason.inputValue(),'');
      await otherReason.fill('Education admission');
      await reason.selectOption('Banking');
      const colourOptions=await page.locator('[data-field="Ration%20card%20colour"]').locator('option').allTextContents();
      assert.deepEqual(colourOptions.slice(1),['\u{1F7E1} Yellow','\u{1F7E0} Orange','\u26AA White']);
      assert.deepEqual(await page.locator('[data-field="Ration%20card%20area"]').locator('option').allTextContents(),['Choose…','City','Village']);
      const selectors=page.locator('#serviceFields select');
      for(let index=0;index<await selectors.count();index++) await selectors.nth(index).selectOption({index:1});
      await page.locator('[data-field="Ration%20card%20area"]').selectOption('Village');
      await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
      if(width===390) await page.screenshot({path:join(root,'sales-upload-step.png')});
      assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Upload step overflows');
      assert.equal(await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
      {
        const files=page.locator('#drawer input[type="file"]:not([multiple])');
        for(let index=0;index<await files.count();index++) {
          await files.nth(index).setInputFiles({name:'trial.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\ntrial\n%%EOF')});
          await page.waitForFunction(expected=>[...document.querySelectorAll('#drawer .doc em')].filter(el=>el.textContent==='trial.pdf').length===expected,index+1);
        }
        await page.getByRole('button',{name:'Remove Ration Card',exact:true}).click();
        assert.equal(await page.getByRole('button',{name:'Remove Ration Card',exact:true}).count(),0);
        assert.equal(await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
        const ration=page.locator('.doc').filter({has:page.getByText('Ration Card',{exact:true})});
        await ration.locator('input[type=file]').setInputFiles({name:'trial.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\ntrial\n%%EOF')});
        await page.getByRole('button',{name:'Remove Ration Card',exact:true}).waitFor();
        const report=page.locator('.doc').filter({hasText:'Talathi Report'});
        const pagePhoto=index=>({name:`report-page-${index}.png`,mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aSU8AAAAASUVORK5CYII=','base64')});
        await page.locator('#drawer input[multiple]').setInputFiles([pagePhoto(1),pagePhoto(2),pagePhoto(3)]);
        await report.locator('.selected-pages li').nth(2).waitFor();
        await page.locator('#drawer input[multiple]').setInputFiles([pagePhoto(4)]);
        await report.locator('.selected-pages li').nth(3).waitFor();
        if(width<=900) assert.ok((await page.getByRole('button',{name:'Remove page 4',exact:true}).boundingBox()).height>=44,'Remove controls must be easy to tap');
        await page.getByRole('button',{name:'Remove page 4',exact:true}).click();
        assert.equal(await report.locator('.selected-pages li').count(),3);
        await page.locator('#drawer input[multiple]').setInputFiles([pagePhoto(4)]);
        await report.locator('.selected-pages li').nth(3).waitFor();
        assert.equal(await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).isEnabled(),true);
        await page.locator('#drawer').getByRole('button',{name:'Continue',exact:true}).click();
        await page.locator('#consent').waitFor();
        assert.equal(await page.locator('.toast').count(),0,'Upload messages must not cover the review actions');
        assert.match(await page.locator('.intake-review-total').innerText(),/200/);
        assert.doesNotMatch(await page.locator('.intake-review').innerText(),/Official fee|Tax|test pricing|real money/i);
        assert.ok(await page.locator('.panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Review must fit');
        const buttons=await page.locator('.intake-review-actions button').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
        for(let i=0;i<buttons.length;i++) for(let j=i+1;j<buttons.length;j++) assert.ok(buttons[i].right+8<=buttons[j].x || buttons[j].right+8<=buttons[i].x || buttons[i].bottom+8<=buttons[j].y || buttons[j].bottom+8<=buttons[i].y,'Review buttons need a visible gap');
        await page.screenshot({path:join(root,`sales-case-review-${width}.png`)});
        await page.locator('.intake-review-actions').scrollIntoViewIfNeeded();
        const actionBoxes=await page.locator('.intake-review-actions button').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,left:r.left,right:r.right};}));
        for(const box of actionBoxes) assert.ok(box.height>=44 && box.left>=0 && box.right<=width+1,'Every review action must fit and be easy to tap');
        await page.screenshot({path:join(root,`sales-case-review-actions-${width}.png`)});
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
