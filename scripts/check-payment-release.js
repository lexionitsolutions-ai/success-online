import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {createDatabase} from '../database.js';
import {receiverActivation} from '../payments.js';
if(existsSync('.env')) loadEnvFile('.env');
const db=createDatabase();
try {
  const rows=await db.all("SELECT name,value FROM integration_settings WHERE name IN ('UPI_RECEIVER_CONFIRMATION','UPI_RECEIVER_ACTIVATION')");
  const read=name=>{try {return JSON.parse(rows.find(r=>r.name===name)?.value || '{}');} catch {return {};}};
  const status=receiverActivation(read('UPI_RECEIVER_CONFIRMATION'),read('UPI_RECEIVER_ACTIVATION'));
  if(!status.ready) throw Error('Release blocked: an administrator must enable the configured receiving account. A test UTR is not required.');
  console.log('Direct UPI checkout enabled. Activation basis: '+status.basis+'. Customer transfers still require individual admin verification.');
} catch(error) {console.error(error.message);process.exitCode=1;} finally {await db.close();}
