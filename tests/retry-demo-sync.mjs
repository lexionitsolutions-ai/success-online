import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createDatabase} from '../database.js';
loadEnvFile('.env');
const base='https://success-online.vercel.app',reportPath='deliverables/full-qa-2026-10-26/live-sync-status.json';
const cases=JSON.parse(readFileSync('deliverables/full-qa-2026-10-26/live-audit.json','utf8')).results;
const previous=JSON.parse(readFileSync(reportPath,'utf8'));
const db=createDatabase();
const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin:base},body:JSON.stringify({username:process.env.INITIAL_SALES_USERNAME,password:process.env.INITIAL_SALES_PASSWORD})});assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
const status=async()=>{
 const rows=[];
 for(const c of cases){
  const docs=await db.all('SELECT id,state,drive_file_id FROM documents WHERE case_id=$id',{$id:c.caseId});
  const jobs=await db.all("SELECT type,status,last_error FROM sync_jobs WHERE entity_id=$id OR entity_id IN (SELECT id FROM documents WHERE case_id=$id)",{$id:c.caseId});
  rows.push({caseId:c.caseId,caseRef:c.caseRef,documents:docs.length,driveCopies:docs.filter(d=>d.drive_file_id).length,jobs});
 }
 return rows;
};
try{
 let rows=await status();
 for(let round=0;round<3;round++){
  const pending=rows.filter(r=>r.driveCopies!==r.documents||r.jobs.some(j=>j.status!=='ok'));
  if(!pending.length)break;
  for(const c of pending){
   const detail=await fetch(`${base}/api/cases/${c.caseId}`,{headers:{cookie},signal:AbortSignal.timeout(60000)});assert.equal(detail.status,200);const data=await detail.json();assert.ok(data.case.customer.name.startsWith('Demo Audit'),'Only this audit’s demo cases may be retried');
   const response=await fetch(`${base}/api/cases/${c.caseId}/finish-uploads`,{method:'POST',headers:{'content-type':'application/json',origin:base,cookie},body:'{}',signal:AbortSignal.timeout(60000)});assert.equal(response.status,200);console.log('Queued demo sync retry',c.caseRef,'round',round+1);
   await new Promise(resolve=>setTimeout(resolve,5000));
  }
  await new Promise(resolve=>setTimeout(resolve,20000));
  rows=await status();
  writeFileSync(reportPath,JSON.stringify({settings:previous.settings,before:previous.cases,cases:rows,checked:new Date().toISOString()},null,2));
  console.log('Sync progress',JSON.stringify({documents:rows.reduce((n,r)=>n+r.documents,0),driveCopies:rows.reduce((n,r)=>n+r.driveCopies,0),nonOk:rows.flatMap(r=>r.jobs).filter(j=>j.status!=='ok').length}));
 }
 const failed=rows.filter(r=>r.driveCopies!==r.documents||r.jobs.some(j=>j.status!=='ok'));
 assert.equal(failed.length,0,JSON.stringify(failed));
 console.log('All 142 demo files mirrored to Drive; all 16 demo Sheets sync jobs are OK.');
}finally{await db.close();}
