// Transfer server-only settings through CLI stdin; never print values.
import {loadEnvFile} from 'node:process';
import {readFileSync,existsSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {spawn} from 'node:child_process';
if(existsSync('.env')) loadEnvFile('.env');
const origin = process.argv[2];
if(!origin || new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) throw new Error('Pass the exact HTTPS production origin as the argument.');
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(!/^prj_\w+$/.test(project.projectId) || !/^team_\w+$/.test(project.orgId)) throw new Error('Link this folder to your Vercel project first.');
const values={APP_ORIGIN:origin};
for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SECRET_KEY','SESSION_SECRET','SUPABASE_STORAGE_BUCKET','SUPABASE_DOWNLOAD_BUCKET','SUPABASE_DOWNLOAD_MAX_BYTES','DRIVE_MODE','SHEETS_MODE','PAYMENT_MODE','GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REFRESH_TOKEN','GOOGLE_ROOT_FOLDER_ID','GOOGLE_OPERATIONS_SPREADSHEET_ID']) if(process.env[key]) values[key]=process.env[key];
for(const key of ['DATABASE_URL','SUPABASE_URL','SUPABASE_SECRET_KEY','SESSION_SECRET']) if(!values[key]) throw new Error('Missing server setting: '+key);
if(process.env.DATABASE_CA_CERT) values.DATABASE_CA_CERT=process.env.DATABASE_CA_CERT.replace(/\\n/g,'\n');
else if(process.env.DATABASE_CA_CERT_PATH) values.DATABASE_CA_CERT=new X509Certificate(readFileSync(process.env.DATABASE_CA_CERT_PATH)).toString();
const sensitive=new Set(['DATABASE_URL','SUPABASE_SECRET_KEY','SESSION_SECRET','DATABASE_CA_CERT','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_OAUTH_REFRESH_TOKEN']);
try {
  for(const [key,value] of Object.entries(values)) {
    const args=['env','add',key,'production',sensitive.has(key)?'--sensitive':'--no-sensitive','--yes','--force','--scope',project.orgId];
    await new Promise((resolve,reject)=>{
      const child=process.platform==='win32'?spawn('cmd.exe',['/d','/s','/c','vercel.cmd '+args.join(' ')],{stdio:['pipe','pipe','pipe']}):spawn('vercel',args,{stdio:['pipe','pipe','pipe']});
      let error='';
      child.stdout.on('data',()=>{});
      child.stderr.on('data',chunk=>{error+=chunk;});
      child.stdin.on('error',()=>{});
      child.stdin.end(value+'\n');
      child.on('error',()=>reject(new Error('Vercel CLI could not be started.')));
      child.on('close',code=>{
        if(!code) return resolve();
        for(const value of Object.values(values)) error=error.split(value).join('[redacted]');
        reject(new Error('Vercel configuration failed for '+key+': '+error));
      });
    });
    console.log('Configured '+key+' for production.');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
