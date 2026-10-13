import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createDatabase} from '../database.js';
import {paymentConfig} from '../payments.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
try {
  const row=await db.one("SELECT value FROM integration_settings WHERE name='UPI_RECEIVER_CONFIRMATION'");
  const confirmation=JSON.parse(row?.value || '{}'),config=paymentConfig();
  if(confirmation.upiId!==config.upiId || confirmation.payeeName!==config.payeeName || !confirmation.verifiedBy || !confirmation.verifiedAt || !/^\d{12}$/.test(confirmation.utr || '')) throw Error('Release blocked: administrator must confirm an actual received INR 1 transfer for the configured UPI account in the target database.');
  console.log('Receiver confirmation exists in the target database. Physical device acceptance is still required before customer use.');
} catch(error) {console.error(error.message);process.exitCode=1;} finally {await db.close();}
