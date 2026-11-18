import {smsAutoConfirmEnabled} from './sms-auto-confirm.js';

export const smsCheckoutSchema = `CREATE TABLE IF NOT EXISTS sms_checkouts (
  checkout_id TEXT PRIMARY KEY, receiver_upi TEXT NOT NULL,
  base_amount INTEGER NOT NULL, adjustment INTEGER NOT NULL,
  payable_amount INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sms_checkout_amount_idx ON sms_checkouts(receiver_upi,payable_amount,created_at);`;

export const uniqueSmsEnabled = () => process.env.SMS_UNIQUE_AMOUNT === 'true' && smsAutoConfirmEnabled();

export async function reserveSmsCheckout(db, checkout, active) {
  const existing = await db.one('SELECT * FROM sms_checkouts WHERE checkout_id=$id', {$id:checkout.id});
  if (existing) return existing;
  // Preserve amounts already shown in an initiated or submitted legacy checkout.
  if (!active || checkout.status !== 'PENDING' || !uniqueSmsEnabled()) return null;
  if (db.cloud) await db.one('SELECT pg_advisory_xact_lock(73194204)');
  const concurrent=await db.one('SELECT * FROM sms_checkouts WHERE checkout_id=$id', {$id:checkout.id});
  if (concurrent) return concurrent;
  // Worldline reports credit timestamps at second precision.
  const stamp = new Date(Math.floor(Date.now()/1000)*1000).toISOString();
  const reserved = await db.all(`SELECT payable_amount FROM sms_checkouts
    WHERE receiver_upi=$receiver AND expires_at>=$cutoff
    UNION SELECT s.amount payable_amount FROM sms_payment_observations s
    WHERE s.receiver_upi=$receiver AND s.transaction_at>=$cutoff
    UNION SELECT p.amount payable_amount FROM payments p JOIN upi_orders o ON o.payment_id=p.id
    WHERE o.upi_id=$receiver AND p.status IN ('PENDING','INITIATED','AWAITING_VERIFICATION')`, {
    $receiver:checkout.upi_id, $cutoff:new Date(Date.now()-86400000).toISOString()
  });
  const used = new Set(reserved.map(row => row.payable_amount));
  // Begin with the owner's requested 17 paise, then use other available amounts.
  for (let offset=0; offset<99; offset++) {
    const adjustment = (16+offset)%99+1;
    const payable = checkout.amount+adjustment;
    if (used.has(payable) || payable>100000000) continue;
    const reservation = {checkout_id:checkout.id,receiver_upi:checkout.upi_id,
      base_amount:checkout.amount,adjustment,payable_amount:payable,
      created_at:stamp,expires_at:checkout.expires_at};
    await db.run(`INSERT INTO sms_checkouts(checkout_id,receiver_upi,base_amount,adjustment,payable_amount,created_at,expires_at)
      VALUES ($id,$receiver,$base,$adjustment,$payable,$at,$expires)`, {
      $id:checkout.id,$receiver:checkout.upi_id,$base:checkout.amount,$adjustment:adjustment,
      $payable:payable,$at:stamp,$expires:checkout.expires_at
    });
    return reservation;
  }
  return null;
}

export function checkoutAmounts(reservation, baseAmount) {
  return {payableAmount:reservation?.payable_amount ?? baseAmount,
    matchingAdjustment:reservation?.adjustment ?? 0,
    automaticReference:!!reservation && uniqueSmsEnabled()};
}

export async function claimUniqueSms(db, rrn, receiver) {
  if (!uniqueSmsEnabled()) return;
  const sms = await db.one('SELECT * FROM sms_payment_observations WHERE rrn=$rrn AND receiver_upi=$receiver', {$rrn:rrn,$receiver:receiver.upiId});
  if (!sms || await db.one('SELECT payment_id FROM verified_upi_refs WHERE utr=$rrn', {$rrn:rrn})) return;
  // Any existing submitted claim takes priority over amount-based attribution.
  if (await db.one("SELECT id FROM payments WHERE transaction_id=$rrn AND status IN ('AWAITING_VERIFICATION','PAID','REFUNDED')", {$rrn:rrn})) return;
  const matches = await db.all(`SELECT * FROM sms_checkouts WHERE receiver_upi=$receiver
    AND payable_amount=$amount AND created_at<=$time AND expires_at>=$time`, {
    $receiver:receiver.upiId,$amount:sms.amount,$time:sms.transaction_at
  });
  if (matches.length!==1) return;
  const reservation=matches[0], id=reservation.checkout_id;
  let payments;
  if (id.startsWith('batch_')) {
    const batch=await db.one("SELECT * FROM payment_batches WHERE id=$id AND status IN ('PENDING','INITIATED','EXPIRED') AND transaction_id IS NULL", {$id:id});
    if (!batch || batch.amount!==reservation.base_amount || batch.upi_id!==receiver.upiId) return;
    payments=await db.all('SELECT p.* FROM payments p JOIN payment_batch_items i ON i.payment_id=p.id WHERE i.batch_id=$id', {$id:id});
  } else {
    const payment=await db.one('SELECT p.* FROM payments p JOIN upi_orders o ON o.payment_id=p.id WHERE p.id=$id AND o.upi_id=$receiver', {$id:id,$receiver:receiver.upiId});
    if (!payment || payment.amount!==reservation.base_amount || await db.one('SELECT batch_id FROM payment_batch_items WHERE payment_id=$id', {$id:id})) return;
    payments=[payment];
  }
  if (!payments.length || payments.some(p=>!['PENDING','INITIATED','EXPIRED'].includes(p.status) || p.transaction_id)) return;
  for (const payment of payments) {
    const c=await db.one('SELECT status FROM cases WHERE id=$id', {$id:payment.case_id});
    if (!c || ['Cancelled','Deleted','Closed','Delivered','Rejected'].includes(c.status)) return;
    if (await db.one("SELECT id FROM payments WHERE case_id=$case AND id!=$id AND (status='AWAITING_VERIFICATION' OR (status='PAID' AND $gateway='direct_upi')) AND gateway IN ('direct_upi','balance_upi')", {$case:payment.case_id,$id:payment.id,$gateway:payment.gateway})) return;
  }
  if (id.startsWith('batch_')) await db.run("UPDATE payment_batches SET status='AWAITING_VERIFICATION',transaction_id=$rrn WHERE id=$id", {$rrn:rrn,$id:id});
  for (const payment of payments) {
    await db.run("UPDATE payments SET status='AWAITING_VERIFICATION',transaction_id=$rrn WHERE id=$id", {$rrn:rrn,$id:payment.id});
    await db.run('UPDATE upi_orders SET submitted_at=$at,updated_at=$at WHERE payment_id=$id', {$at:new Date().toISOString(),$id:payment.id});
  }
}

export async function reconcileUniqueCheckout(db,id,confirm) {
  if (!uniqueSmsEnabled()) return;
  const reservation=await db.one('SELECT * FROM sms_checkouts WHERE checkout_id=$id', {$id:id});
  if (!reservation) return;
  const messages=await db.all(`SELECT s.rrn FROM sms_payment_observations s
    WHERE s.receiver_upi=$receiver AND s.amount=$amount AND s.transaction_at>=$start
    AND s.transaction_at<=$end AND NOT EXISTS (SELECT 1 FROM verified_upi_refs v WHERE v.utr=s.rrn)`, {
    $receiver:reservation.receiver_upi,$amount:reservation.payable_amount,
    $start:reservation.created_at,$end:reservation.expires_at
  });
  if (messages.length===1) await confirm(messages[0].rrn);
}
