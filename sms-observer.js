import {createHmac,createHash,timingSafeEqual,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

export const smsObserverSchema=`CREATE TABLE IF NOT EXISTS sms_payment_observations (
  id TEXT PRIMARY KEY, rrn TEXT NOT NULL UNIQUE, amount INTEGER NOT NULL,
  transaction_at TEXT NOT NULL, sender TEXT NOT NULL, terminal_id TEXT NOT NULL,
  vpa TEXT NOT NULL, receiver_upi TEXT NOT NULL, device_id TEXT NOT NULL,
  received_at TEXT NOT NULL, recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sms_observer_devices (
  device_id TEXT PRIMARY KEY, enrollment_hash TEXT NOT NULL UNIQUE, installation_hash TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);`;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function observerConfig() {
  let keys={};try {keys=JSON.parse(process.env.SMS_OBSERVER_KEYS || '{}');} catch {}
  const terminal=process.env.SMS_OBSERVER_TERMINAL || '';
  return {terminal,keys,enabled:/^[A-Z0-9]{4,20}$/.test(terminal) && keys && typeof keys==='object' && !Array.isArray(keys) && (process.env.SMS_OBSERVER_ENABLED==='true' || Object.values(keys).some(key=>typeof key==='string' && /^[a-f0-9]{64}$/i.test(key)))};
}

const digest=value=>createHash('sha256').update(value).digest('hex');
function masterKey() {
  if(!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<24)fail(503,'Device key storage is not configured');
  return createHash('sha256').update('success-online:sms-device:v1|'+process.env.SESSION_SECRET).digest();
}
function encryptDeviceKey(key) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',masterKey(),iv);
  const encrypted=Buffer.concat([cipher.update(key,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
function decryptDeviceKey(value) {
  const data=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',masterKey(),data.subarray(0,12));
  cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');
}
async function smallJson(req) {
  let raw=Buffer.alloc(0);
  for await(const chunk of req){raw=Buffer.concat([raw,Buffer.from(chunk)]);if(raw.length>2048)fail(413,'SMS payload too large');}
  return raw;
}
export async function enrollSmsDevice(req,db,now=Date.now()) {
  if(!observerConfig().enabled)fail(503,'SMS observer is not configured');
  let config;try {config=JSON.parse(process.env.SMS_OBSERVER_ENROLLMENT || '{}');} catch {fail(503,'Pairing is not configured');}
  if(!/^[a-f0-9]{64}$/.test(config.tokenHash || '') || !/^[A-Za-z0-9_-]{1,64}$/.test(config.deviceId || ''))fail(503,'Pairing is not configured');
  if(!Number.isFinite(Date.parse(config.expiresAt)) || Date.parse(config.expiresAt)<now)fail(410,'Pairing file expired; ask the administrator for a new one');
  const raw=await smallJson(req);let input;try {input=JSON.parse(raw.toString('utf8'));}catch{fail(400,'Invalid pairing request');}
  if(!input || typeof input.token!=='string' || !/^[a-f0-9]{64}$/.test(input.token) || input.deviceId!==config.deviceId || typeof input.installationId!=='string' || !/^[a-f0-9]{32}$/.test(input.installationId))fail(401,'Invalid pairing request');
  if(!timingSafeEqual(Buffer.from(digest(input.token),'hex'),Buffer.from(config.tokenHash,'hex')))fail(401,'Invalid pairing request');
  if(db.cloud)await db.one('SELECT pg_advisory_xact_lock(73194205)');
  const existing=await db.one('SELECT * FROM sms_observer_devices WHERE device_id=$id OR enrollment_hash=$hash',{$id:config.deviceId,$hash:config.tokenHash});
  if(existing) {
    if(existing.active!==1 || existing.enrollment_hash!==config.tokenHash || existing.installation_hash!==digest(input.installationId))fail(409,'This pairing file has already been used on another installation');
    return {ok:true,deviceId:existing.device_id,signingKey:decryptDeviceKey(existing.key_ciphertext)};
  }
  const key=randomBytes(32).toString('hex');
  await db.run('INSERT INTO sms_observer_devices(device_id,enrollment_hash,installation_hash,key_ciphertext,active,created_at) VALUES ($id,$hash,$installation,$key,1,$at)',{$id:config.deviceId,$hash:config.tokenHash,$installation:digest(input.installationId),$key:encryptDeviceKey(key),$at:new Date(now).toISOString()});
  return {ok:true,deviceId:config.deviceId,signingKey:key};
}

// Carrier/circle prefixes can vary; keep the owner-confirmed Worldline header root and service suffix.
export const isWorldlineSender=sender=>typeof sender==='string' && /^(?:[A-Z]{2}-)?WLITXS-S$/.test(sender.trim().toUpperCase());
// Neither VPA role nor bank settlement is inferred from the alert text.
export function parseWorldlineSms(sender,text,terminal) {
  if(!isWorldlineSender(sender) || typeof text!=='string' || text.length>512) return null;
  const normalized=text.replace(/&(?:#x20|#32|nbsp);/gi,' ').replace(/\s+/g,' ').trim();
  const m=/^Rs\.?\s*(\d{1,7})(?:\.(\d{1,2}))? received on (\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) for BQR-UPI\/([a-zA-Z0-9]+)\/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)\. RRN#(\d{12}) - Worldline India$/.exec(normalized);
  // Observed app/QR references vary: fixed token, ICI + 32 hex, or T + 22 digits.
  // These are metadata; trust comes from the enrolled receiving phone, not the token or VPA.
  if(!m || (m[9]!==terminal && !/^(?:ICI[a-f0-9]{32}|T[0-9]{22})$/.test(m[9]))) return null;
  const amount=Number(m[1])*100+Number((m[2] || '').padEnd(2,'0'));
  if(!Number.isSafeInteger(amount) || amount<1 || amount>100000000) return null;
  const iso=`${m[5]}-${m[4]}-${m[3]}T${m[6]}:${m[7]}:${m[8]}+05:30`;
  const date=new Date(iso);
  // Reject rollover dates (e.g. 31 February) rather than silently normalizing them.
  if(!Number.isFinite(date.getTime())) return null;
  const india=new Date(date.getTime()+330*60000).toISOString().slice(0,19);
  if(india!==iso.slice(0,19)) return null;
  return {amount,transactionAt:date.toISOString(),terminalId:m[9],vpa:m[10],rrn:m[11]};
}

export async function ingestSmsObservation(req,db,receiver,now=Date.now()) {
  const config=observerConfig();
  if(!config.enabled) fail(503,'SMS observer is not configured');
  const deviceId=req.headers['x-sms-device'];
  let key=typeof deviceId==='string' && Object.hasOwn(config.keys,deviceId)?config.keys[deviceId]:null;
  if(process.env.SMS_OBSERVER_ENABLED==='true' && typeof deviceId==='string' && /^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) {
    const device=await db.one('SELECT * FROM sms_observer_devices WHERE device_id=$id',{$id:deviceId});
    if(device)key=device.active===1?decryptDeviceKey(device.key_ciphertext):null;
  }
  const timestamp=req.headers['x-sms-timestamp'],signature=req.headers['x-sms-signature'];
  if(typeof key!=='string' || !/^[a-f0-9]{64}$/i.test(key) || typeof timestamp!=='string' || !/^\d{13}$/.test(timestamp) || Math.abs(now-Number(timestamp))>300000 || typeof signature!=='string' || !/^[a-f0-9]{64}$/i.test(signature)) fail(401,'Invalid SMS device signature');
  const raw=await smallJson(req);
  const expected=createHmac('sha256',Buffer.from(key,'hex')).update(timestamp+'.').update(raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex'))) fail(401,'Invalid SMS device signature');
  let input;try {input=JSON.parse(raw.toString('utf8'));} catch {fail(400,'Invalid SMS payload');}
  if(!input || typeof input!=='object') fail(400,'Invalid SMS payload');
  if(input.action==='health_check' && Object.keys(input).length===1) {
    try {await db.one('SELECT id FROM sms_payment_observations LIMIT 1');} catch {fail(503,'SMS observer database setup is pending');}
    const automatic=process.env.SMS_AUTO_CONFIRM==='true';
    return {ok:true,deviceAuthorized:true,mode:'detection_only',smsAutoConfirmEnabled:automatic,adminVerificationRequired:!automatic};
  }
  const parsed=parseWorldlineSms(input.sender,input.text,config.terminal);
  const received=typeof input.receivedAt==='string'?Date.parse(input.receivedAt):NaN;
  if(!parsed || !Number.isFinite(received)) fail(400,'SMS does not match the configured sender and merchant format');
  const transaction=Date.parse(parsed.transactionAt);
  if(received>now+60000 || transaction>now+60000 || received<now-7*86400000 || transaction<now-7*86400000 || Math.abs(received-transaction)>86400000) fail(400,'SMS timestamp is outside the pilot window');
  if(db.cloud) await db.one('SELECT pg_advisory_xact_lock(73194205)');
  const existing=await db.one('SELECT * FROM sms_payment_observations WHERE rrn=$rrn',{$rrn:parsed.rrn});
  if(existing) {
    if(existing.amount!==parsed.amount || existing.receiver_upi!==receiver.upiId || existing.terminal_id!==parsed.terminalId || existing.transaction_at!==parsed.transactionAt || existing.vpa!==parsed.vpa) fail(409,'Conflicting SMS reference requires manual review');
    return {ok:true,duplicate:true,observationId:existing.id};
  }
  const id=createHash('sha256').update(receiver.upiId+'|'+parsed.rrn).digest('hex');
  await db.run(`INSERT INTO sms_payment_observations(id,rrn,amount,transaction_at,sender,terminal_id,vpa,receiver_upi,device_id,received_at,recorded_at)
    VALUES ($id,$rrn,$amount,$transaction,$sender,$terminal,$vpa,$receiver,$device,$received,$recorded)`,{
    $id:id,$rrn:parsed.rrn,$amount:parsed.amount,$transaction:parsed.transactionAt,$sender:input.sender,$terminal:parsed.terminalId,$vpa:parsed.vpa,$receiver:receiver.upiId,$device:deviceId,$received:new Date(received).toISOString(),$recorded:new Date(now).toISOString()
  });
  return {ok:true,duplicate:false,observationId:id};
}

export async function paymentSmsEvidence(db,p,receiver) {
  if(!observerConfig().enabled || !p.transaction_id || !['direct_upi','balance_upi'].includes(p.gateway) || p.upi_id!==receiver.upiId) return null;
  const row=await db.one('SELECT * FROM sms_payment_observations WHERE rrn=$rrn AND receiver_upi=$receiver',{$rrn:p.transaction_id,$receiver:receiver.upiId});
  if(!row) return null;
  // Do not attribute a credit merely because its amount matches. Require the submitted RRN,
  // an exact amount and a payment created before the credit. Batches remain manual in this pilot.
  const claims=await db.one("SELECT COUNT(*) n FROM payments WHERE transaction_id=$rrn AND gateway IN ('direct_upi','balance_upi') AND status IN ('AWAITING_VERIFICATION','PAID')",{$rrn:p.transaction_id});
  const batch=await db.one('SELECT batch_id FROM payment_batch_items WHERE payment_id=$id',{$id:p.id});
  const status=batch || Number(claims.n)!==1?'manual_review':row.amount!==p.amount?'amount_mismatch':Date.parse(row.transaction_at)<Date.parse(p.created_at)-60000?'manual_review':'matched';
  return {status,rrn:row.rrn,transactionAt:row.transaction_at,recordedAt:row.recorded_at,source:'Worldline SMS',settlementState:'NOT_RECONCILED'};
}
