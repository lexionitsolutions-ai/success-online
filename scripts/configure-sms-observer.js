// Provision only the SMS pilot settings. Do not print signing keys or copy them into source.
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
const settings=JSON.parse(readFileSync(process.argv[2] || 'deliverables/android-sms-observer/device-server-settings.json','utf8'));
const keys=JSON.parse(settings.SMS_OBSERVER_KEYS);
const ids=Object.keys(keys);
if(settings.SMS_OBSERVER_TERMINAL!=='2695306A')throw Error('Invalid merchant terminal settings.');
if(settings.SMS_OBSERVER_ENABLED==='true' && ids.length===0) {
  const enrollment=JSON.parse(settings.SMS_OBSERVER_ENROLLMENT || '{}');
  if(!/^[a-f0-9]{64}$/.test(enrollment.tokenHash || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(enrollment.deviceId || '') || Date.parse(enrollment.expiresAt)<=Date.now())throw Error('Invalid enrollment settings.');
} else if(ids.length!==1 || !/^[A-Za-z0-9_-]{1,64}$/.test(ids[0]) || !/^[a-f0-9]{64}$/i.test(keys[ids[0]] || ''))throw Error('Invalid device key settings.');
const project=JSON.parse(readFileSync('.vercel/project.json','utf8'));
if(project.projectName!=='success-online' || !/^team_\w+$/.test(project.orgId))throw Error('Expected the linked Success Online project.');
for(const name of ['SMS_OBSERVER_KEYS','SMS_OBSERVER_TERMINAL','SMS_OBSERVER_ENABLED','SMS_OBSERVER_ENROLLMENT'].filter(name=>Object.hasOwn(settings,name))) {
  const args=['env','add',name,'production','--sensitive','--yes','--force','--scope',project.orgId];
  await new Promise((resolve,reject)=>{
    const child=process.platform==='win32'?spawn('cmd.exe',['/d','/s','/c','vercel.cmd '+args.join(' ')],{stdio:['pipe','ignore','ignore'],windowsHide:true}):spawn('vercel',args,{stdio:['pipe','ignore','ignore']});
    child.stdin.on('error',()=>{});child.stdin.end(settings[name]+'\n');
    child.on('error',()=>reject(Error('Could not start the Vercel CLI.')));
    child.on('close',code=>code?reject(Error('Configuration failed for '+name)):resolve());
  });
  console.log('Configured '+name+' for the linked production project.');
}
