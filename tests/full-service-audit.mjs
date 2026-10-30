import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {loadEnvFile} from 'node:process';
import {chromium} from 'playwright';
import '../public/intake-rules.js';
import {confirmTestReceiver,verifyTestOrder} from './payment-fixture.js';

const live=process.argv.includes('--live');
const browserRetest=process.argv.includes('--browser-retest'),rolesOnly=process.argv.includes('--roles-only');
const out='deliverables/full-qa-2026-10-26';mkdirSync(out,{recursive:true});
const imagePath=process.env.QA_IMAGE || 'C:/Users/Raj/Downloads/images.jpg';
const image=readFileSync(imagePath),imageHash=createHash('sha256').update(image).digest('hex');
const report={environment:live?'live':'isolated',started:new Date().toISOString(),image:{file:imagePath,bytes:image.length,sha256:imageHash},results:[],browser:[],notes:live?['Demo cases are intentionally unpaid. No bank receipt was fabricated, no real payment was verified, and no government portal submission was made.']:['All payment attestations and workflow transitions are synthetic and confined to the isolated database.']};
const reportPath=`${out}/${live?'live':'isolated'}-audit.json`;
const previous=(browserRetest||rolesOnly)?JSON.parse(readFileSync(reportPath,'utf8')):null;
const retestServices=new Set(previous?.browser.filter(row=>row.status==='failed').map(row=>row.service)||[]);
if(previous){Object.assign(report,previous);report.browser=previous.browser.filter(row=>row.status!=='failed');delete report.finished;}
const save=()=>writeFileSync(reportPath,JSON.stringify(report,null,2));
let child,browser,base;
const cookies={};
function scenarios(service){
 const rows=[],add=(name,details={})=>rows.push({name,details});
 const yesNo=['Yes','No'];
 switch(service.slug){
  case 'income-certificate':
   for(const year of ['1 year','3 years'])for(const colour of ['Yellow','Orange','White'])for(const area of ['City','Village'])add(`${year}-${colour}-${area}`,{'Years of Certificate Required':year,'Ration card colour':colour,'Ration card area':area});
   for(const reason of ['Banking','Ration Card','Government Schemes','Education','Hospital','Other'])add(`reason-${reason}`,{'Reason for application':reason});
   for(const willing of yesNo)add(`report-unavailable-${willing}`,{'Ration card area':'City','Is Talathi Report available?':'No','Will you bring a signed Talathi Report?':willing});
   add('income-below-threshold',{'Income amount required on certificate (₹)':'99999'});break;
  case 'domicile-certificate':
   for(const adult of yesNo)for(const born of yesNo)add(`minor-${adult}-born-${born}`,{'Applicant under 18?':adult,'Is beneficiary birth place in Maharashtra?':born});break;
  case 'caste-certificate':case 'non-creamy-layer':
   for(const category of service.variants[0].fields.find(f=>f.label==='Caste category').options)for(const minor of yesNo)add(`${category}-minor-${minor}`,{'Caste category':category,'Applicant under 18?':minor});break;
  case 'gazette':
   for(const language of ['English','Marathi'])for(const reason of ['Marriage','Correction of incorrect name','Other name change'])add(`${language}-${reason}`,{'Gazette language':language,'Reason for name change':reason});break;
  case 'police-clearance':
   for(const reason of ['Job','Tour','Education','Visa / Immigration','Business'])add(reason,{'Reason for clearance':reason});break;
  case 'shop-act':case 'food-license':
   for(const ownership of ['Individual','Partnership'])for(const premises of ['Owned','Rented'])for(const gst of yesNo)add(`${ownership}-${premises}-gst-${gst}`,{'Ownership type':ownership,'Owned or rented':premises,'GST registered?':gst});break;
  case 'udyam-aadhaar':
   for(const ownership of ['Individual','Partnership'])for(const gst of yesNo)add(`${ownership}-gst-${gst}`,{'Ownership type':ownership,'GST registered?':gst});break;
  case 'caste-validity':
   for(const purpose of ['Job','Education','Election'])for(const minor of yesNo)add(`${purpose}-minor-${minor}`,{'Caste Validity Certificate required for':purpose,'Applicant under 18?':minor});break;
  case 'ews-certificate':
   for(const type of ['Central','State'])for(const minor of yesNo)add(`${type}-minor-${minor}`,{'EWS certificate type':type,'Applicant under 18?':minor});break;
  case 'passport':
   for(const type of ['New','Renew'])for(const minor of yesNo)for(const change of yesNo)add(`${type}-minor-${minor}-name-${change}`,{'Passport application type':type,'Applicant under 18?':minor,'Name change or correction?':change});break;
  case 'voting-card':
   add('new',{'Voting card application type':'New'});
   for(const correction of service.variants[0].fields.find(f=>f.label==='Voting card field to correct').options)add(`correct-${correction}`,{'Voting card application type':'Correction','Voting card field to correct':correction});break;
  case 'ration-card':
   for(const question of ['Add a member?','Add a member due to marriage?','Remove a member?','Remove a member due to marriage?','Change ration card address?'])for(const answer of yesNo)add(`${question}-${answer}`,{[question]:answer});
   add('all-changes-rented-white',Object.fromEntries(service.variants[0].fields.map(f=>[f.label,f.label==='Ration card residence'?'Rented':'Yes'])));break;
  case 'pf-assistance':for(const updated of yesNo)add(`profile-update-${updated}`,{'PF profile updated?':updated});break;
  default:add('standard');
 }
 return rows;
}
function detailsFor(variant,overrides){
 const details={...overrides};
 for(let pass=0;pass<3;pass++)for(const f of variant.fields||[]){
  if(!IntakeRules.matches(f.when,details))continue;
  if(f.defaultWhen&&details[f.defaultWhen.field]===f.defaultWhen.equals){details[f.label]=f.defaultWhen.value;continue;}
  if(details[f.label]!==undefined||f.computedSum||f.optional)continue;
  let value='Demo Audit Details';
  if(f.type==='select')value=f.options[0];
  else if(f.type==='password')value='DemoOnlyPF!23';
  else if(f.marathiInput)value='चाचणी';
  else if(f.type==='email'||/email/i.test(f.label))value='demo-audit@example.invalid';
  else if(f.digitsOnly)value=f.maxLength===12?'123456789012':'9000000000';
  else if(f.type==='tel')value='9000000000';
  else if(f.type==='date')value='2020-01-01';
  else if(f.type==='number')value=f.step==='1'?'2':/income|investment/i.test(f.label)?'150000':'250';
  else if(/name|surname/i.test(f.label))value='Demo Audit Person';
  else if(/GST number/.test(f.label))value='27ABCDE1234F1Z5';
  else if(f.label==='Corrected gender')value='Female';
  else if(/date of birth or age/i.test(f.label))value='01/01/2000';
  else if(/relationship type/i.test(f.label))value='Father';
  details[f.label]=value;
 }
 IntakeRules.applyComputed(variant.fields||[],details);
 return Object.fromEntries(Object.entries(details).filter(([label])=>{const f=(variant.fields||[]).find(f=>f.label===label);return f&&(IntakeRules.matches(f.when,details)||f.defaultWhen&&details[f.defaultWhen.field]===f.defaultWhen.equals);}));
}
async function request(path,{cookie,role='sales',body,method=body?'POST':'GET',expected}={}){
 const response=await fetch(base+path,{method,signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json',origin:base,...((cookie||cookies[role])?{cookie:cookie||cookies[role]}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json().catch(()=>({}));
 if(expected!==undefined)assert.equal(response.status,expected,`${path}: ${JSON.stringify(data).slice(0,400)}`);
 return {response,status:response.status,data};
}
async function upload(c,entry,role='sales'){
 const metadata={docType:entry.docType,fileName:entry.fileName,mimeType:'image/jpeg',size:image.length};
 if(live){
  const auth=(await request(`/api/cases/${c.id}/upload-url`,{role,body:metadata,expected:201})).data;
  const put=await fetch(auth.uploadUrl,{method:'PUT',signal:AbortSignal.timeout(60000),headers:{'content-type':'image/jpeg'},body:image});assert.ok(put.ok,`Signed upload: ${put.status}`);
  return (await request(`/api/cases/${c.id}/documents`,{role,body:{uploadId:auth.uploadId,uploadKey:entry.key,deferMirrors:!!entry.key},expected:201})).data;
 }
 return (await request(`/api/cases/${c.id}/documents`,{role,body:{...metadata,uploadKey:entry.key,content:image.toString('base64'),deferMirrors:!!entry.key},expected:201})).data;
}
async function auditScenario(service,scenario,index,includeOptional=false){
 const variant=service.variants[0],details=detailsFor(variant,scenario.details);
 const requirements=variant.documents.filter(doc=>IntakeRules.matches(doc.when,details));
 const selected=requirements.filter(doc=>doc.required||includeOptional);
 const manifest=selected.flatMap((doc,i)=>Array.from({length:includeOptional&&doc.multiple?2:1},(_,page)=>({key:randomUUID(),docType:doc.label,fileName:`DEMO-${index}-${i}-${page}.jpg`,mimeType:'image/jpeg',size:image.length})));
 const record={service:service.name,slug:service.slug,scenario:scenario.name,selectedFiles:manifest.length,requiredTypes:requirements.filter(doc=>doc.required).length,checks:[]};
 report.results.push(record);save();
 try{
  const payload={clientRequestId:randomUUID(),variantId:variant.id,customer:{name:`Demo Audit ${service.name.replace(/[0-9]/g,'')}`,mobile:'9000000000'},details,consent:true,uploadManifest:manifest};
  const c=(await request('/api/cases',{body:payload,expected:201})).data.case;record.caseId=c.id;record.caseRef=c.ref;save();
  assert.equal((await request('/api/cases',{body:payload,expected:200})).data.case.id,c.id);record.checks.push('idempotent case creation');
  const absent=async()=>{for(const role of ['admin','backoffice'])assert.ok(!(await request('/api/cases',{role,expected:200})).data.cases.some(item=>item.id===c.id),`${role} exposed an incomplete/unpaid case`);};
  await absent();record.checks.push('hidden from admin/backoffice before completion');
  for(const entry of manifest)await upload(c,entry);
  let data=(await request(`/api/cases/${c.id}`,{expected:200})).data;
  assert.equal(data.documents.filter(doc=>doc.state==='uploaded').length,manifest.length);
  assert.equal(data.case.uploads.completed,manifest.length);assert.equal(data.case.uploads.complete,false);
  await absent();record.checks.push('every selected image received; publication waits for final acknowledgement');
  const finalized=(await request(`/api/cases/${c.id}/finish-uploads`,{body:{},expected:200})).data.case;
  assert.equal(finalized.uploads.complete,true);assert.equal(finalized.document_state,'complete');await absent();
  record.checks.push('unpaid completed case remains hidden');
  const first=data.documents.find(doc=>doc.state==='uploaded');
  const downloaded=await fetch(base+first.download_url,{headers:{cookie:cookies.sales},signal:AbortSignal.timeout(60000)});
  assert.equal(downloaded.status,200);assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),imageHash);record.checks.push('download byte-for-byte matches supplied JPEG');
  const preview=await request(first.download_url.replace('/download','/preview'),{expected:200});assert.equal(preview.data.mimeType,'image/jpeg');record.checks.push('document preview');
  await request(`/api/cases/${c.id}/claim`,{role:'backoffice',method:'POST',expected:409});record.checks.push('unpaid backoffice claim blocked');
  if(!live){
   await verifyTestOrder(request,cookies.admin,cookies.sales,c.payment.id,String(700000000000+index));
   for(const role of ['admin','backoffice'])assert.ok((await request('/api/cases',{role,expected:200})).data.cases.some(item=>item.id===c.id));
   await request(`/api/cases/${c.id}/claim`,{role:'backoffice',method:'POST',expected:200});
   await request(`/api/cases/${c.id}/claim`,{role:'backoffice',method:'POST',expected:409});record.checks.push('verified payment; visibility; claim; duplicate claim prevention');
   if(includeOptional){
    await request(`/api/cases/${c.id}/request-reupload`,{role:'backoffice',body:{documentTypes:[first.doc_type],reason:'DEMO QA: test corrected image upload'},expected:200});
    await request(`/api/cases/${c.id}/submit-reupload`,{body:{},expected:400});
    await upload(c,{docType:first.doc_type,fileName:'DEMO-corrected.jpg'});
    await request(`/api/cases/${c.id}/submit-reupload`,{body:{},expected:200});record.checks.push('correction request; reupload; explicit correction submission');
   }
   for(const status of ['Ready to Submit','Submitted to Official Portal','Under Government Review','Document Received'])await request(`/api/cases/${c.id}/progress`,{role:'backoffice',body:{status,note:'DEMO ONLY: simulated local workflow; no external submission'},expected:200});
   await request(`/api/cases/${c.id}/submit-received-document`,{role:'backoffice',body:{},expected:400});
   await upload(c,{docType:'Received Document',fileName:'DEMO-final-document.jpg'},'backoffice');
   const closed=(await request(`/api/cases/${c.id}/submit-received-document`,{role:'backoffice',body:{},expected:200})).data.case;assert.equal(closed.status,'Closed');assert.ok(closed.received_document);record.checks.push('workflow to receipt; missing final document gate; final upload and closure');
   const zip=await fetch(`${base}/api/cases/${c.id}/download-all`,{headers:{cookie:cookies.backoffice}});assert.equal(zip.status,200);assert.equal(Buffer.from(await zip.arrayBuffer()).readUInt32LE(),0x04034b50);record.checks.push('backoffice ZIP download');
   if(service.slug==='pf-assistance'){await request(`/api/cases/${c.id}/pf-password`,{method:'POST',expected:403});assert.equal((await request(`/api/cases/${c.id}/pf-password`,{role:'admin',method:'POST',expected:200})).data.password,details.Password);record.checks.push('PF password access control');}
  }
  record.status='passed';
 }catch(error){record.status='failed';record.error=error.message;}
 save();console.log(`${live?'LIVE':'LOCAL'} ${index} ${service.slug} ${scenario.name}: ${record.status}${record.error?' — '+record.error:''}`);
}
async function browserAudit(services){
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
 browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('input[name="username"]').fill('sales01');await page.locator('input[name="password"]').fill('Demo@12345');await page.locator('button[type="submit"]').click();await page.waitForSelector('.shell');
  for(const service of services.filter(service=>!browserRetest||retestServices.has(service.name))){
   const row={service:service.name,width,status:'passed'};report.browser.push(row);
   try{
    await page.evaluate(()=>window.startCase());await page.locator('#name').fill('Demo Browser Audit');await page.locator('#mobile').fill('9000000000');await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.evaluate(()=>window.setIntakeLanguage('en'));await page.locator('#service').selectOption(service.id);
    const variant=service.variants[0],scenario=scenarios(service).map(s=>({...s,filled:detailsFor(variant,s.details)})).sort((a,b)=>variant.documents.filter(d=>IntakeRules.matches(d.when,b.filled)).length-variant.documents.filter(d=>IntakeRules.matches(d.when,a.filled)).length)[0];
    for(const f of variant.fields||[]){const input=page.locator(`[data-field="${encodeURIComponent(f.label)}"]`);if(!await input.count()||f.computedSum||f.defaultWhen&&scenario.filled[f.defaultWhen.field]===f.defaultWhen.equals)continue;const value=scenario.filled[f.label];if(value===undefined)continue;if(f.type==='select')await input.selectOption(value);else await input.fill(String(value));}
    await page.evaluate(()=>window.setIntakeLanguage('mr'));await page.evaluate(()=>window.setIntakeLanguage('en'));
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForSelector('.doc input[type=file]');
    const docs=variant.documents.filter(d=>IntakeRules.matches(d.when,scenario.filled));assert.equal(await page.locator('.doc input[type=file]').count(),docs.length);
    for(const doc of docs){const input=page.locator(`input[type=file][onchange*="'${encodeURIComponent(doc.label)}',"]`);await input.setInputFiles(imagePath);await page.waitForFunction(()=>document.querySelector('#drawer')?.getAttribute('aria-busy')!=='true');}
    await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('#consent').check();
    assert.ok(!(await page.locator('#wizard').innerText()).includes('DemoOnlyPF!23'));
    await page.getByRole('button',{name:'Save & create another',exact:true}).click();await page.waitForSelector('#name');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:`${out}/browser-${service.slug}-${width}.png`});await page.evaluate(()=>window.closeDrawer());
   }catch(error){row.status='failed';row.error=error.message;await page.evaluate(()=>window.closeDrawer()).catch(()=>{});}
   save();console.log(`BROWSER ${width} ${service.slug}: ${row.status}${row.error?' — '+row.error:''}`);
  }
  if(errors.length)report.browser.push({width,status:'failed',error:errors.join('; ')});
  await page.waitForSelector('#backgroundUploads',{state:'detached',timeout:60000});
  await page.close();
 }
}
async function roleBrowserAudit(){
 const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
 browser ||= await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 report.roleBrowser ||= [];
 for(const width of [390,1280])for(const role of ['admin','backoffice']){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('input[name="username"]').fill(role==='admin'?'admin01':'backoffice01');await page.locator('input[name="password"]').fill('Demo@12345');await page.locator('button[type="submit"]').click();await page.waitForSelector('.shell');
  const views=await page.locator('[data-view]').evaluateAll(nodes=>[...new Set(nodes.map(node=>node.dataset.view))]);
  for(const view of views){
   const row={role,width,view,status:'passed'};report.roleBrowser.push(row);
   try{await page.evaluate(view=>window.setView(view),view);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:`${out}/role-${role}-${view}-${width}.png`});}
   catch(error){row.status='failed';row.error=error.message;}
   save();console.log(`ROLE UI ${role} ${width} ${view}: ${row.status}`);
  }
  const completed=report.results.find(row=>row.status==='passed');
  if(completed){await page.evaluate(id=>window.openCase(id),completed.caseId);await page.waitForSelector('.case-panel');assert.match(await page.locator('.case-panel').innerText(),/Demo Audit/);await page.evaluate(()=>window.closeDrawer());}
  if(errors.length)report.roleBrowser.push({role,width,status:'failed',error:errors.join('; ')});
  await page.close();
 }
}
try{
 if(live){loadEnvFile('.env');base='https://success-online.vercel.app';}
 else{
  const root=previous?join(previous.database,'..'):mkdtempSync(join(tmpdir(),'full-service-qa-')),port=34000+Math.floor(Math.random()*5000);base=`http://localhost:${port}`;report.database=previous?.database||join(root,'test.sqlite');
  child=spawn(process.execPath,['server.js'],{env:{...process.env,NODE_ENV:'test',VERCEL:'',DATABASE_URL:'',SUPABASE_URL:'',SUPABASE_SECRET_KEY:'',DATABASE_PATH:report.database,STORAGE_PATH:join(root,'docs'),PORT:String(port),APP_ORIGIN:base,DRIVE_MODE:'demo',SHEETS_MODE:'demo',SESSION_SECRET:'full-audit-isolated-secret-32-characters'},stdio:['ignore','pipe','pipe']});
  let errors='';child.stderr.on('data',data=>errors+=data);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(errors||'Server startup timeout')),15000);child.stdout.on('data',data=>{if(String(data).includes('running')){clearTimeout(timer);resolve();}});child.on('exit',()=>{clearTimeout(timer);reject(Error(errors));});});
 }
 report.base=base;
 for(const [role,prefix,name]of [['sales','SALES','sales01'],['admin','ADMIN','admin01'],['backoffice','BACKOFFICE','backoffice01']]){
  const signed=await request('/api/login',{body:{username:live?process.env[`INITIAL_${prefix}_USERNAME`]:name,password:live?process.env[`INITIAL_${prefix}_PASSWORD`]:'Demo@12345'},expected:200});cookies[role]=signed.response.headers.get('set-cookie').split(';')[0];assert.equal(signed.data.user.role,role);
 }
 const services=(await request('/api/services',{expected:200})).data.services;
 if(!live)await confirmTestReceiver(request,cookies.admin);
 let index=0;
 for(const service of (previous?[]:services)){
  let rows=scenarios(service);
  if(live)rows=rows.sort((a,b)=>service.variants[0].documents.filter(d=>IntakeRules.matches(d.when,detailsFor(service.variants[0],b.details))).length-service.variants[0].documents.filter(d=>IntakeRules.matches(d.when,detailsFor(service.variants[0],a.details))).length).slice(0,1);
  for(const [row,scenario]of rows.entries())await auditScenario(service,scenario,++index,row===0);
 }
 if(!live&&!rolesOnly)await browserAudit(services);
 if(!live)await roleBrowserAudit();
 report.finished=new Date().toISOString();report.passed=report.results.filter(r=>r.status==='passed').length;report.failed=report.results.filter(r=>r.status==='failed').length+report.browser.filter(r=>r.status==='failed').length+(report.roleBrowser||[]).filter(r=>r.status==='failed').length;save();
 console.log(JSON.stringify({environment:report.environment,scenarios:report.results.length,passed:report.passed,browserChecks:report.browser.length,failed:report.failed,report:reportPath}));
 if(report.failed)process.exitCode=1;
}catch(error){report.fatal=error.message;save();console.error(error.message);process.exitCode=1;}
finally{await browser?.close();child?.kill();}
