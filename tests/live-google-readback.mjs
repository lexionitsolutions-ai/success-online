import assert from 'node:assert/strict';
import {loadEnvFile} from 'node:process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createDatabase} from '../database.js';
import {readStorage} from '../storage.js';
loadEnvFile('.env');
const source=JSON.parse(readFileSync('deliverables/full-qa-2026-10-26/live-audit.json','utf8'));
const db=createDatabase(),documents=[];
const result={storageFiles:0,sheetsCases:0,errors:[]};

try{
 for(const setting of await db.all('SELECT name,value FROM integration_settings'))process.env[setting.name]=setting.value;
 for(const c of source.results)documents.push(...await db.all('SELECT id,case_id,storage_path FROM documents WHERE case_id=$id AND state=$state',{$id:c.caseId,$state:'uploaded'}));
 const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GOOGLE_OAUTH_REFRESH_TOKEN}),signal:AbortSignal.timeout(30000)});assert.equal(auth.status,200);
 const token=(await auth.json()).access_token,headers={authorization:`Bearer ${token}`};
 const fetchOK=async url=>{let last;for(let attempt=0;attempt<3;attempt++){try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});assert.ok(r.ok,`Google read-back returned ${r.status}`);return r;}catch(error){last=error;}}throw last;};
 for(const doc of documents) {
   const content=doc.storage_path.startsWith('supabase://') ? await readStorage(doc.storage_path.slice(11)) : readFileSync(doc.storage_path);
   assert.equal(createHash('sha256').update(content).digest('hex'),source.image.sha256);result.storageFiles++;
 }
 const rows=async tab=>(await (await fetchOK(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(process.env.GOOGLE_OPERATIONS_SPREADSHEET_ID)}/values/${encodeURIComponent(`'${tab}'!A:Q`)}`)).json()).values||[];
 const caseRows=await rows('All Workings');
 for(const c of source.results){const matched=caseRows.filter(row=>row[0]===c.caseRef);assert.equal(matched.length,1);assert.equal(matched[0][6],'complete');result.sheetsCases++;}
 assert.equal(result.errors.length,0,JSON.stringify(result.errors));
 result.status='passed';console.log(JSON.stringify(result));
}catch(error){result.status='failed';result.errors.push({error:error.message});console.error(error.message);process.exitCode=1;}
finally{writeFileSync('deliverables/full-qa-2026-10-26/google-readback.json',JSON.stringify(result,null,2));await db.close();}
