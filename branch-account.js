import {randomBytes,scryptSync} from 'node:crypto';
import {CASH_SALES_ID} from './cash-payments.js';

export async function updateMainBranch(db,password) {
  const marker='MAIN_BRANCH_ACCOUNT_2026_11';
  if(await db.one('SELECT name FROM integration_settings WHERE name=$name',{$name:marker})) return false;
  const rows=await db.all("SELECT id,username FROM users WHERE role='sales' AND (id=$id OR LOWER(name)='mahalaxmi online services')",{$id:CASH_SALES_ID});
  if(rows.length!==1) throw new Error('Expected exactly one Mahalaxmi sales account; no credentials changed.');
  const conflict=await db.one('SELECT id FROM users WHERE username=$username AND id!=$id',{$username:'7447707277',$id:rows[0].id});
  if(conflict) throw new Error('The new login number belongs to another account; no credentials changed.');
  if(!password || password.length<10) throw new Error('Set MAIN_BRANCH_PASSWORD for this one-time migration.');
  const salt=randomBytes(16).toString('hex'),hash=`${salt}:${scryptSync(password,salt,32).toString('hex')}`;
  await db.run("UPDATE users SET username='7447707277',name='Success Online Main Branch',password_hash=$hash WHERE id=$id",{$id:rows[0].id,$hash:hash});
  await db.run('INSERT INTO integration_settings VALUES ($name,$value)',{$name:marker,$value:new Date().toISOString()});
  return true;
}
