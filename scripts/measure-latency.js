import {loadEnvFile} from 'node:process';
loadEnvFile('.env');
const origin=process.argv[2]||'https://success-online.vercel.app';
const rounds=Number(process.argv[3]||2);
for(let round=1;round<=rounds;round++) {
  const started=performance.now();
  const response=await fetch(origin+'/api/login',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({username:process.env.INITIAL_ADMIN_USERNAME,password:process.env.INITIAL_ADMIN_PASSWORD}),signal:AbortSignal.timeout(60000)});
  if(!response.ok) throw new Error('Login returned '+response.status);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  console.log(JSON.stringify({round,path:'/api/login',milliseconds:Math.round(performance.now()-started)}));
  await response.arrayBuffer();
  await Promise.all(['/api/services','/api/cases','/api/admin/dashboard?period=month','/api/admin/employees'].map(async path=>{
    const start=performance.now();
    const result=await fetch(origin+path,{headers:{cookie},signal:AbortSignal.timeout(60000)});
    const data=await result.json();
    console.log(JSON.stringify({round,path,status:result.status,milliseconds:Math.round(performance.now()-start),...(path==='/api/cases'?{caseCount:data.cases?.length}:{})}));
  }));
}
