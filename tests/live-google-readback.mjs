import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createDatabase} from '../database.js';
loadEnvFile('.env');
const source=JSON.parse(readFileSync('deliverables/full-qa-2026-10-26/live-audit.json','utf8'));
const db=createDatabase(),documents=[];
const result={driveFiles:0,sheetsDocuments:0,sheetsCases:0,serviceTabs:0,errors:[]};
const sheetsOnly=process.argv.includes('--sheets-only');
if(sheetsOnly)result.driveFiles=JSON.parse(readFileSync('deliverables/full-qa-2026-10-26/google-readback.json','utf8')).driveFiles;
try{
 for(const setting of await db.all('SELECT name,value FROM integration_settings'))process.env[setting.name]=setting.value;
 for(const c of source.results)documents.push(...await db.all('SELECT id,case_id,drive_file_id FROM documents WHERE case_id=$id AND state=$state',{$id:c.caseId,$state:'uploaded'}));
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GOOGLE_OAUTH_REFRESH_TOKEN}),signal:AbortSignal.timeout(30000)});assert.equal(auth.status,200);
 const token=(await auth.json()).access_token,headers={authorization:`Bearer ${token}`};
 const fetchOK=async url=>{let last;for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`Google read-back returned ${r.status}`);return r;}catch(error){last=error;}}throw last;};
 let cursor=0;
 const worker=async()=>{while(cursor<documents.length){const doc=documents[cursor++];try{const r=await fetchOK(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.drive_file_id)}?alt=media&supportsAllDrives=true`);assert.equal(createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),source.image.sha256);result.driveFiles++;}catch(error){result.errors.push({documentId:doc.id,error:error.message});}}};
 if(!sheetsOnly)await Promise.all(Array.from({length:3},worker));console.log('Google Drive bytes checked',result.driveFiles);
 const rows=async tab=>(await (await fetchOK(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.GOOGLE_OPERATIONS_SPREADSHEET_ID)}/values/${encodeURIComponent(`'${tab}'!A:Q`)}`)).json()).values||[];
 const docRows=await rows('Documents'),caseRows=await rows('All Cases');
 for(const doc of documents){const matched=docRows.filter(row=>row[0]===doc.id);assert.equal(matched.length,1,'Each demo document must have one workbook row');assert.equal(matched[0][9],`https://drive.google.com/file/d/${doc.drive_file_id}/view`);result.sheetsDocuments++;}
 for(const c of source.results){const matched=caseRows.filter(row=>row[0]===c.caseRef);assert.equal(matched.length,1);assert.equal(matched[0][7],'complete');assert.ok(['PENDING','unpaid'].includes(matched[0][8]));result.sheetsCases++;const tabRows=await rows(c.service.slice(0,31));assert.equal(tabRows.filter(row=>row[0]===c.caseRef).length,1);result.serviceTabs++;}
 assert.equal(result.errors.length,0,JSON.stringify(result.errors));
 result.status='passed';console.log(JSON.stringify(result));
}catch(error){result.status='failed';result.errors.push({error:error.message});console.error(error.message);process.exitCode=1;}
finally{writeFileSync('deliverables/full-qa-2026-10-26/google-readback.json',JSON.stringify(result,null,2));await db.close();}
