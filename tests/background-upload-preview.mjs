import {chromium} from 'playwright';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';

const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
try {
  const page=await browser.newPage({viewport:{width:390,height:900}});
  await page.route('https://uploads.test/**',route=>route.fulfill({contentType:'text/html',body:'<main id="app"></main>'}));
  const requests=[],confirmed=new Set();let allowLast=false,creates=0,finalizations=0;
  await page.exposeFunction('testServerUpload',async(key,bytes)=>{
    requests.push(key);
    assert.match(Buffer.from(bytes).toString(),/^%PDF-/);
    if(key==='second'&&!allowLast)throw Error('Connection interrupted');
    await new Promise(resolve=>setTimeout(resolve,30));
    confirmed.add(key);return {documentId:'doc-'+key};
  });
  await page.exposeFunction('testServerAPI',async(path)=>{
    if(path==='/api/cases'){creates++;return {case:{id:'case1',ref:'SO1'}};}
    if(path.endsWith('finish-uploads')){assert.equal(confirmed.size,2);finalizations++;return {case:{uploads:{complete:true}}};}
    return {};
  });
  const install=async()=>{
    for(const file of ['styles.css','mobile.css','dashboard.css'])await page.addStyleTag({content:readFileSync(`public/${file}`,'utf8')});
    await page.addScriptTag({content:readFileSync('public/intake-rules.js','utf8')});
    await page.addScriptTag({type:'module',content:readFileSync('public/app.js','utf8').replace(/boot\(\);\s*$/,'')+`
      me={id:'test-sales',role:'sales'};cloudUploads=true;draftMissing=()=>[];api=window.testServerAPI;
      refreshCaseUpdates=async()=>{};waitForUploadRetry=async()=>{};
      startCase=()=>{window.nextCaseOpened=true;draft={customer:{},details:{},docs:{}};};
      uploadDocument=async(id,type,document)=>window.testServerUpload(type,Array.from(new Uint8Array(await document.file.arrayBuffer())));
      window.startTest=async()=>{
        services=[{id:'svc',variants:[{id:'v',documents:[{label:'first',required:true},{label:'second',required:false}]}]}];
        const file=new File(['%PDF-1.4\\nfixture'],'proof.pdf',{type:'application/pdf'});
        draft={step:4,serviceId:'svc',variantId:'v',customer:{name:'Test Customer'},details:{},docs:Object.fromEntries(['first','second'].map(type=>[type,{file,fileName:file.name,mimeType:file.type,size:file.size}]))};
        document.body.insertAdjacentHTML('beforeend','<input id="consent" type="checkbox" checked>');
        await submitCase('another');return window.nextCaseOpened;
      };
      window.queueState=()=>({running:runningUploadJobs.size,jobs:[...uploadJobs.values()].map(job=>({id:job.id,state:job.state,complete:job.files.filter(file=>file.documentId).length}))});
      window.resumeUploads=restoreUploadJobs;
    `});
    await page.waitForFunction(()=>!!window.startTest);
  };
  await page.goto('https://uploads.test/');await install();
  assert.equal(await page.evaluate(()=>window.startTest()),true,'The user can start the next case without waiting for uploads');
  await page.waitForFunction(()=>window.queueState().jobs[0]?.state==='error');
  assert.equal(creates,1);assert.equal(finalizations,0);
  assert.equal(requests.filter(key=>key==='first').length,1);
  assert.equal(requests.filter(key=>key==='second').length,3);
  assert.match(await page.locator('#backgroundUploads').innerText(),/1 \/ 2 files uploaded/);
  mkdirSync('deliverables/background-uploads',{recursive:true});
  await page.screenshot({path:'deliverables/background-uploads/retry-mobile.png'});
  allowLast=true;
  await page.reload();await install();
  await page.evaluate(()=>window.resumeUploads());
  await page.waitForFunction(()=>window.queueState().jobs.length===0&&window.queueState().running===0);
  assert.equal(requests.filter(key=>key==='first').length,1,'Completed file is not resent after refresh');
  assert.equal(creates,1,'Refresh resumes the existing case');assert.equal(finalizations,1);
  assert.equal(await page.locator('#backgroundUploads').count(),0);
  const saved=await page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('success-online-document-uploads',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});return new Promise(resolve=>{const request=db.transaction('jobs').objectStore('jobs').getAll();request.onsuccess=()=>resolve(request.result);});});
  assert.equal(saved.length,0,'Durable files are deleted only after server finalization');
  console.log('Browser queue verified: immediate next case, three retries, visible failure, real File persistence across reload, no duplicate completed uploads and storage cleanup after confirmation.');
}finally{await browser.close();}
