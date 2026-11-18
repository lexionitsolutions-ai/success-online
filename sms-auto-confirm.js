import {randomUUID} from 'node:crypto';
import {observerConfig} from './sms-observer.js';

export const smsAutoConfirmEnabled=()=>process.env.SMS_AUTO_CONFIRM==='true' && Boolean(observerConfig().enabled);

// Called only inside a payment transaction, never from a browser success callback.
export async function confirmMatchedSms(db,rrn,{receiver,receiverReady,recomputeCase,scheduleCaseSync,assertBalanceFits}) {
  if(!smsAutoConfirmEnabled() || !/^\d{12}$/.test(rrn || '') || !await receiverReady())return false;
  if(db.cloud)await db.one('SELECT pg_advisory_xact_lock(73194204)');
  const sms=await db.one('SELECT * FROM sms_payment_observations WHERE rrn=$rrn AND receiver_upi=$upi',{$rrn:rrn,$upi:receiver.upiId});
  if(!sms || await db.one('SELECT payment_id FROM verified_upi_refs WHERE utr=$rrn',{$rrn:rrn}))return false;
  const claims=await db.all(`SELECT p.*,o.upi_id,o.payee_name,o.expires_at,c.status case_status,i.batch_id
    FROM payments p JOIN upi_orders o ON o.payment_id=p.id JOIN cases c ON c.id=p.case_id
    LEFT JOIN payment_batch_items i ON i.payment_id=p.id
    WHERE p.transaction_id=$rrn AND p.gateway IN ('direct_upi','balance_upi') AND p.status IN ('AWAITING_VERIFICATION','PAID','REFUNDED') ORDER BY p.id`,{$rrn:rrn});
  if(!claims.length || claims.some(p=>p.status!=='AWAITING_VERIFICATION' || ['Deleted','Cancelled','Rejected','Closed','Delivered'].includes(p.case_status) || p.upi_id!==receiver.upiId || p.payee_name!==receiver.payeeName))return false;
  const batchId=claims[0].batch_id;
  let batch=null;
  if(batchId) {
    if(claims.some(p=>p.batch_id!==batchId || p.gateway!=='direct_upi'))return false;
    batch=await db.one('SELECT * FROM payment_batches WHERE id=$id',{$id:batchId});
    const count=await db.one('SELECT COUNT(*) n FROM payment_batch_items WHERE batch_id=$id',{$id:batchId});
    if(!batch || batch.status!=='AWAITING_VERIFICATION' || batch.transaction_id!==rrn || Number(count.n)!==claims.length || batch.amount!==claims.reduce((sum,p)=>sum+p.amount,0) || batch.upi_id!==receiver.upiId || batch.payee_name!==receiver.payeeName)return false;
  } else if(claims.length!==1)return false;
  const expected=batch || claims[0],transaction=Date.parse(sms.transaction_at),created=Date.parse(expected.created_at),expires=Date.parse(expected.expires_at);
  const reservation=await db.one('SELECT * FROM sms_checkouts WHERE checkout_id=$id',{$id:expected.id});
  const amountMatches=reservation ? reservation.base_amount===expected.amount && sms.amount===reservation.payable_amount : sms.amount===expected.amount;
  if(!amountMatches || !Number.isFinite(transaction) || !Number.isFinite(created) || !Number.isFinite(expires) || transaction<created-60000 || transaction>expires+5*60000)return false;
  for(const p of claims) {
    const others=await db.all("SELECT id,gateway,status FROM payments WHERE case_id=$case AND id!=$id AND gateway IN ('direct_upi','balance_upi') AND status IN ('PAID','AWAITING_VERIFICATION')",{$case:p.case_id,$id:p.id});
    if(others.some(other=>!claims.some(item=>item.id===other.id) && (p.gateway==='direct_upi' || other.status==='AWAITING_VERIFICATION')))return false;
    if(p.gateway==='balance_upi') {
      try {await assertBalanceFits(p);}catch(error){if(error.status===409)return false;throw error;}
    } else if(await db.one('SELECT case_id FROM cash_accounts WHERE case_id=$case',{$case:p.case_id}))return false;
  }
  const stamp=new Date().toISOString(),actor='system:worldline-sms';
  const notes='Automatically confirmed from an authenticated merchant-phone Worldline SMS; exact RRN, amount, configured receiver and payment window matched. The BQR token is retained as alert metadata, not merchant identity. This is SMS-based confirmation, not bank-statement reconciliation.';
  await db.run('INSERT INTO verified_upi_refs VALUES ($rrn,$id)',{$rrn:rrn,$id:claims[0].id});
  if(batch)await db.run("UPDATE payment_batches SET status='PAID',verified_at=$at,verified_by=$actor WHERE id=$id",{$at:stamp,$actor:actor,$id:batch.id});
  for(const p of claims) {
    await db.run("UPDATE payments SET status='PAID',verified_at=$at WHERE id=$id AND status='AWAITING_VERIFICATION'",{$at:stamp,$id:p.id});
    await db.run('UPDATE upi_orders SET verified_by=$actor,verification_notes=$notes,updated_at=$at WHERE payment_id=$id',{$actor:actor,$notes:notes,$at:stamp,$id:p.id});
    await db.run('INSERT INTO payment_attempts VALUES ($id,$payment,$action,$method,$rrn,$actor,$notes,$at)',{$id:randomUUID(),$payment:p.id,$action:'auto_verify_sms',$method:'Worldline SMS',$rrn:rrn,$actor:actor,$notes:notes,$at:stamp});
    await db.run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:randomUUID(),$actor:actor,$action:'payment.auto_verify_sms',$type:'payment',$entity:p.id,$reason:JSON.stringify({observationId:sms.id,amount:p.amount,receivedAmount:sms.amount,matchingAdjustment:reservation?.adjustment || 0,rrn}),$at:stamp});
    await recomputeCase(p.case_id,{sync:false});
    await scheduleCaseSync(p.case_id);
  }
  return true;
}
