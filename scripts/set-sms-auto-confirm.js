import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const enabled=process.argv[2];
if(!['true','false'].includes(enabled))throw Error('Pass true or false.');
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(project.projectName!=='success-online' || !/^team_\w+$/.test(project.orgId))throw Error('Expected the linked Success Online project.');
const args=['env','add','SMS_AUTO_CONFIRM','production','--no-sensitive','--yes','--force','--scope',project.orgId];
await new Promise((resolve,reject)=>{
  const child=process.platform==='win32'?spawn('cmd.exe',['/d','/s','/c','vercel.cmd '+args.join(' ')],{stdio:['pipe','ignore','ignore'],windowsHide:true}):spawn('vercel',args,{stdio:['pipe','ignore','ignore']});
  child.stdin.on('error',()=>{});child.stdin.end(enabled+'\n');
  child.on('error',()=>reject(Error('Could not start Vercel CLI.')));
  child.on('close',code=>code?reject(Error('Could not configure SMS_AUTO_CONFIRM')):resolve());
});
console.log('Configured SMS_AUTO_CONFIRM='+enabled+' for the next production deployment.');
