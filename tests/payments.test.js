import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {PNG} from 'pngjs';
import {generateUPIPaymentURL,priceAmounts,paymentConfig} from '../payments.js';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
test('release check blocks an unconfirmed or changed receiver in the target database',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'upi-release-')),'db.sqlite'),db=new DatabaseSync(path);
  db.exec('CREATE TABLE integration_settings(name TEXT PRIMARY KEY,value TEXT)');
  const env={...process.env,DATABASE_URL:'',DATABASE_PATH:path,VERCEL:''};
  const check=()=>spawnSync(process.execPath,['scripts/check-payment-release.js'],{env,encoding:'utf8'});
  assert.equal(check().status,1);
  const confirmation={...paymentConfig(),utr:'100000000001',verifiedBy:'test-admin',verifiedAt:new Date().toISOString()};
  db.prepare('INSERT INTO integration_settings VALUES (?,?)').run('UPI_RECEIVER_CONFIRMATION',JSON.stringify(confirmation));
  assert.equal(check().status,0);
  db.prepare('UPDATE integration_settings SET value=?').run(JSON.stringify({...confirmation,upiId:'different@upi'}));
  assert.equal(check().status,1);
  const activation={...paymentConfig(),basis:'owner_confirmation',enabledBy:'test-admin',enabledAt:new Date().toISOString()};
  db.prepare('INSERT INTO integration_settings VALUES (?,?)').run('UPI_RECEIVER_ACTIVATION',JSON.stringify(activation));
  assert.equal(check().status,0,'Owner activation passes without a received test UTR');
  db.prepare("UPDATE integration_settings SET value=? WHERE name='UPI_RECEIVER_ACTIVATION'").run(JSON.stringify({...activation,upiId:'different@upi'}));
  assert.equal(check().status,1,'Activation is bound to the configured recipient');db.close();
});
test('UPI URI validates integer paise, configured receiver and safe encoded description',()=>{
  const input={...paymentConfig(),amount:100,orderId:'SO-2026-000001',serviceName:'PAN & Aadhaar\nTrial',customerName:'Raj Shah'};
  const uri=generateUPIPaymentURL(input),q=new URL(uri).searchParams;
  assert.equal(q.get('pa'),'0791934A0195602.bqr@kotak');assert.equal(q.get('pn'),'SUCCESS ONLINE SERVICES');
  assert.equal(q.get('am'),'1.00');assert.equal(q.get('cu'),'INR');assert.equal(q.has('tr'),false);
  assert.equal(q.get('tn'),'Raj Shah - PAN & Aadhaar Trial - SO-2026-000001');
  for(const amount of [-1,0,1.1,NaN,Infinity,100000001]) assert.throws(()=>generateUPIPaymentURL({...input,amount}));
  assert.throws(()=>generateUPIPaymentURL({...input,upiId:'attacker@upi'}));
  assert.throws(()=>generateUPIPaymentURL({...input,upiId:'7558548187-3@ybl'}),'Previous receiver cannot be used for new payment links');
  const longNote=new URL(generateUPIPaymentURL({...input,serviceName:'Long service '.repeat(20)})).searchParams.get('tn');
  assert.ok(longNote.length<=80);assert.ok(longNote.endsWith(input.orderId));assert.ok(longNote.startsWith('Raj Shah - '));
  const longBoth=new URL(generateUPIPaymentURL({...input,customerName:'Long client '.repeat(20),serviceName:'Long service '.repeat(20),orderId:'SO-P-2026-12345678-1234-1234-1234-123456789012'})).searchParams.get('tn');
  assert.ok(longBoth.length<=80);assert.equal(longBoth.split(' - ').length,3);assert.ok(longBoth.endsWith('SO-P-2026-12345678-1234-1234-1234-123456789012'));
});
test('QR decoder reads exactly the same URI, with quiet margin and no external provider',async()=>{
  const uri=generateUPIPaymentURL({...paymentConfig(),amount:100,orderId:'SO-P-test',serviceName:'PAN Card'});
  const png=PNG.sync.read(await QRCode.toBuffer(uri,{width:360,margin:4,errorCorrectionLevel:'M'}));
  const result=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
  assert.equal(result.data,uri);assert.equal(png.data[0],255);
});
test('test pricing covers new services and preserves standard pricing for restoration',()=>{
  const previous=process.env.TEST_PRICING_MODE;
  try {
    process.env.TEST_PRICING_MODE='true';assert.equal(priceAmounts({service_charge:90000,official_fee:10000,tax_rate:18},12300).total,100);
    assert.equal(priceAmounts({}).total,100);
    process.env.TEST_PRICING_MODE='false';assert.deepEqual(priceAmounts({service_charge:1000,official_fee:200,tax_rate:18},3000),{serviceCharge:3000,officialFee:200,tax:540,total:3740});
  } finally {if(previous===undefined) delete process.env.TEST_PRICING_MODE;else process.env.TEST_PRICING_MODE=previous;}
});
