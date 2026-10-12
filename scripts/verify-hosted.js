import {loadEnvFile} from 'node:process';
import {existsSync} from 'node:fs';
if(existsSync('.env')) loadEnvFile('.env');
const origin=process.argv[2];
if(!origin || new URL(origin).protocol!=='https:') throw new Error('Pass the hosted HTTPS origin.');
async function request(path,options={}) {
  const response=await fetch(origin+path,{...options,signal:AbortSignal.timeout(45000)});
  if(!response.ok) throw new Error(path+' returned HTTP '+response.status);
  return response;
}
try {
  await request('/');console.log('Website reachable.');
  const health=await (await request('/api/health')).json();
  if(!health.ok) throw new Error('API health check failed.');
  console.log('Hosted API and database health verified.');
  for(const [prefix,role] of [['ADMIN','admin'],['SALES','sales'],['BACKOFFICE','backoffice']]) {
    const username=process.env[`INITIAL_${prefix}_USERNAME`],password=process.env[`INITIAL_${prefix}_PASSWORD`];
    if(!username || !password) continue;
    const signedIn=await request('/api/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({username,password})});
    const cookie=signedIn.headers.get('set-cookie')?.split(';')[0];
    if(!cookie) throw new Error('Login cookie missing.');
    const user=await (await request('/api/me',{headers:{cookie}})).json();
    if(user.user?.role!==role) throw new Error('Unexpected role for '+prefix);
    const services=await (await request('/api/services',{headers:{cookie}})).json();
    if(!services.cloudUploads || services.services?.length!==15) throw new Error('Cloud upload/catalog configuration is incomplete.');
    await request('/api/cases',{headers:{cookie}});
    if(role==='admin') await request('/api/admin/employees',{headers:{cookie}});
    console.log(role+' login, access and cloud configuration verified.');
  }
} catch(error) {console.error(error.message);process.exitCode=1;}
