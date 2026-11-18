// Builds a pilot APK using an already-installed Android SDK/JDK; no dependency downloads.
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readdirSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const sdk=process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android','Sdk');
const jdk=process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr';
const tools=join(sdk,'build-tools','35.0.0'),androidSource=join(sdk,'platforms','android-36','android.jar');
const root=resolve('deliverables/android-sms-observer');
for(const path of ['classes','dex'])mkdirSync(join(root,path),{recursive:true});
function run(file,args){execFileSync(file,args,{stdio:'inherit',windowsHide:true});}
const bin=name=>join(jdk,'bin',name+'.exe');
if(!existsSync(androidSource) || !existsSync(bin('javac')) || !existsSync(join(tools,'aapt2.exe')))throw Error('Set ANDROID_HOME/JAVA_HOME to an installed SDK/JDK (build tools 35.0.0, platform 36).');
const android=join(root,'android.jar');copyFileSync(androidSource,android);
const source=resolve('android-sms-observer/src/in/successonline/smsobserver');
run(bin('javac'),['--release','8','-encoding','UTF-8','-classpath',android,'-d',join(root,'classes'),...readdirSync(source).filter(f=>f.endsWith('.java')).map(f=>join(source,f))]);
const classes=readdirSync(join(root,'classes','in','successonline','smsobserver')).filter(f=>f.endsWith('.class')).map(f=>join(root,'classes','in','successonline','smsobserver',f));
run(bin('java'),['-cp',join(tools,'lib','d8.jar'),'com.android.tools.r8.D8','--lib',android,'--min-api','26','--output',join(root,'dex'),...classes]);
const unsigned=join(root,'unsigned.apk'),resourceArgs=[];
const pairingIndex=process.argv.indexOf('--pairing');
if(pairingIndex!==-1) {
  const pairing=JSON.parse(readFileSync(process.argv[pairingIndex+1],'utf8'));
  if(pairing.url!=='https://success-online.vercel.app' || pairing.deviceId!=='success-kotak-phone' || !/^[a-f0-9]{64}$/.test(pairing.token || '') || Date.parse(pairing.expiresAt)<=Date.now())throw Error('Invalid merchant pairing file.');
  const resources=join(root,'pairing-res');mkdirSync(join(resources,'raw'),{recursive:true});
  writeFileSync(join(resources,'raw','pairing.json'),JSON.stringify(pairing),{mode:0o600});
  const resourceZip=join(root,'pairing-res.zip');
  run(join(tools,'aapt2.exe'),['compile','--dir',resources,'-o',resourceZip]);resourceArgs.push('-R',resourceZip);
}
run(join(tools,'aapt2.exe'),['link','-I',android,'--manifest',resolve('android-sms-observer/AndroidManifest.xml'),'-o',unsigned,...resourceArgs]);
run(bin('jar'),['uf',unsigned,'-C',join(root,'dex'),'classes.dex']);
const aligned=join(root,'aligned.apk'),apk=join(root,'Success-Online-SMS-Pilot.apk');
run(join(tools,'zipalign.exe'),['-f','4',unsigned,aligned]);
const key=join(root,'pilot-signing.p12'),password=join(root,'pilot-signing-password.txt');
if(!existsSync(key)) {
  writeFileSync(password,randomBytes(32).toString('hex'),{mode:0o600});
  run(bin('keytool'),['-genkeypair','-keystore',key,'-storetype','PKCS12','-storepass:file',password,'-alias','pilot','-keyalg','RSA','-keysize','2048','-validity','3650','-dname','CN=Success Online SMS Pilot','-noprompt']);
}
run(bin('java'),['-jar',join(tools,'lib','apksigner.jar'),'sign','--ks',key,'--ks-pass','file:'+password,'--out',apk,aligned]);
run(bin('java'),['-jar',join(tools,'lib','apksigner.jar'),'verify','--verbose',apk]);
writeFileSync(apk+'.sha256',createHash('sha256').update(readFileSync(apk)).digest('hex')+'\n');
console.log('Built pilot APK: '+apk+' (device testing and server configuration still required).');
