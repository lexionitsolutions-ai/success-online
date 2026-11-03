import {randomUUID} from 'node:crypto';
const protectedPayments=new Set(['PAID','paid','verified','offline_approved','REFUNDED','AWAITING_VERIFICATION']);
export function paymentBlocksDeletion(c,payments) {
  return ['paid','partially_paid'].includes(c.payment_state) || payments.some(p=>protectedPayments.has(p.status) || !!p.verified_at);
}

// Keep the case and payment history for reconciliation, but revoke application
// access and invalidate every unpaid checkout before removing it from lists.
export async function deleteUnpaidCase({db,c,user,recomputeCase}) {
  const {all,run}=db;
  if(user.role!=='sales' || c.sales_user_id!==user.id) throw Object.assign(new Error('Only the salesperson who created an unpaid case can delete it.'),{status:403});
  const payments=await all('SELECT status,verified_at FROM payments WHERE case_id=$id',{$id:c.id});
  if(paymentBlocksDeletion(c,payments)) throw Object.assign(new Error('This case cannot be deleted because a payment has been recorded or is awaiting verification. Paid cases cannot be deleted, including partial payments and refunds.'),{status:409});
  const batches=await all('SELECT DISTINCT b.id,b.status,b.verified_at FROM payment_batches b JOIN payment_batch_items i ON i.batch_id=b.id JOIN payments p ON p.id=i.payment_id WHERE p.case_id=$id',{$id:c.id});
  if(batches.some(b=>protectedPayments.has(b.status) || b.verified_at)) throw Object.assign(new Error('This case has a submitted or verified combined payment and cannot be deleted.'),{status:409});
  for(const batch of batches) {
    await run("UPDATE payment_batches SET status='CANCELLED' WHERE id=$id",{$id:batch.id});
    const members=await all('SELECT DISTINCT case_id FROM payments WHERE id IN (SELECT payment_id FROM payment_batch_items WHERE batch_id=$id)',{$id:batch.id});
    await run("UPDATE payments SET status='CANCELLED' WHERE id IN (SELECT payment_id FROM payment_batch_items WHERE batch_id=$id) AND status IN ('PENDING','INITIATED','EXPIRED')",{$id:batch.id});
    for(const member of members) if(member.case_id!==c.id) await recomputeCase(member.case_id);
  }
  await run("UPDATE payments SET status='CANCELLED' WHERE case_id=$id AND status IN ('PENDING','INITIATED','EXPIRED')",{$id:c.id});
  const stamp=new Date().toISOString();
  await run("UPDATE cases SET status='Deleted',updated_at=$at WHERE id=$id",{$id:c.id,$at:stamp});
  await run('DELETE FROM upload_intents WHERE case_id=$id',{$id:c.id});
  await run('DELETE FROM sync_jobs WHERE entity_id=$id',{$id:c.id});
  const notifications=await all('SELECT id,body FROM notifications');
  for(const notice of notifications) {
    let body;try {body=JSON.parse(notice.body);}catch {continue;}
    if(body.caseId===c.id) await run('DELETE FROM notifications WHERE id=$id',{$id:notice.id});
  }
  await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:'aud_'+randomUUID(),$actor:user.id,$action:'case.delete_unpaid',$type:'case',$entity:c.id,$reason:`Unpaid case ${c.ref} deleted by its salesperson; payment history retained for reconciliation.`,$at:stamp});
  return {ok:true,caseId:c.id};
}
