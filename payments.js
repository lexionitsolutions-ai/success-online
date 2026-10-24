import './public/intake-rules.js';
import { randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import {batchSchema,createBatchPayments} from './payment-batches.js';

export function paymentConfig() {
  return { upiId: '0791934A0195602.bqr@kotak', payeeName: 'SUCCESS ONLINE SERVICES', mobile: '+91 7558548187', currency: 'INR', accountType:'merchant', testPricingMode: process.env.TEST_PRICING_MODE !== 'false' };
}
export function receiverActivation(confirmation, activation) {
  const config=paymentConfig();
  const matches=record=>record?.upiId===config.upiId && record?.payeeName===config.payeeName;
  if(matches(activation) && activation.basis==='owner_confirmation' && activation.enabledBy && activation.enabledAt) return {ready:true,basis:'owner_confirmation'};
  if(matches(confirmation) && confirmation.verifiedBy && confirmation.verifiedAt && /^\d{12}$/.test(confirmation.utr || '')) return {ready:true,basis:'test_transfer'};
  return {ready:false,basis:null};
}
export function priceAmounts(v, override, original) {
  if (paymentConfig().testPricingMode && !original?.testPricingExempt) return { serviceCharge:100, officialFee:0, tax:0, total:100 };
  const serviceCharge = override ?? v.service_charge ?? 0, officialFee = original?.officialFee ?? v.official_fee ?? 0;
  const tax = Math.round(serviceCharge * (original?.taxRate ?? v.tax_rate ?? 0) / 100);
  return {serviceCharge, officialFee, tax, total:serviceCharge + officialFee + tax};
}
export function generateUPIPaymentURL({upiId, payeeName, amount, orderId, serviceName, customerName}) {
  const config = paymentConfig();
  if (upiId !== config.upiId || payeeName !== config.payeeName) throw new Error('Incorrect payment receiver');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000) throw new Error('Invalid payment amount in paise');
  const clean=value=>String(value || '').replace(/[\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim();
  const reference=clean(orderId);
  if(!reference || reference.length>60) throw new Error('Invalid payment order reference');
  const customer = clean(customerName), service = clean(serviceName);
  const budget = 80 - reference.length - (customer ? 6 : 3);
  const customerBudget = customer ? Math.min(customer.length, Math.max(Math.floor(budget / 2), budget - service.length)) : 0;
  const description = [customer.slice(0,customerBudget), service.slice(0,budget-customerBudget), reference].filter(Boolean).join(' - ');
  return 'upi://pay?' + Object.entries({pa:upiId,pn:payeeName,am:(amount/100).toFixed(2),cu:'INR',tn:description}).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&');
}
export const paymentSchema = `
CREATE TABLE IF NOT EXISTS service_prices (variant_id TEXT PRIMARY KEY, price INTEGER NOT NULL CHECK(price >= 0), original_price INTEGER NOT NULL, original_config TEXT NOT NULL, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS upi_orders (payment_id TEXT PRIMARY KEY REFERENCES payments(id), upi_id TEXT NOT NULL, payee_name TEXT NOT NULL, service_name TEXT NOT NULL, created_by TEXT NOT NULL, payment_method TEXT, initiated_at TEXT, submitted_at TEXT, verified_by TEXT, verification_notes TEXT, expires_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_attempts (id TEXT PRIMARY KEY, payment_id TEXT NOT NULL REFERENCES payments(id), action TEXT NOT NULL, method TEXT, utr TEXT, actor_id TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS verified_upi_refs (utr TEXT PRIMARY KEY, payment_id TEXT UNIQUE NOT NULL REFERENCES payments(id));
CREATE TABLE IF NOT EXISTS payment_exceptions (case_id TEXT PRIMARY KEY REFERENCES cases(id), approved_by TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_paid_upi_per_case ON payments(case_id) WHERE gateway='direct_upi' AND status='PAID';
CREATE INDEX IF NOT EXISTS upi_status_idx ON payments(gateway,status,created_at);
` + batchSchema;
const fail = (status,message) => { throw Object.assign(new Error(message),{status}); };
const normalizeUTR = value => {
  const utr = String(value || '').trim();
  if (!/^\d{12}$/.test(utr)) fail(400,'Enter the 12-digit UPI transaction reference from the receiving or paying app.');
  return utr;
};
export function createPayments({db, recomputeCase, send, body}) {
  const {one,all,run} = db;
  const at = () => new Date().toISOString();
  async function audit(user, action, entity, notes) {
    await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:randomUUID(),$actor:user.id,$action:`payment.${action}`,$type:'payment',$entity:entity,$reason:notes || '',$at:at()});
  }
  async function receiverStatus() {
    const records=await all("SELECT name,value FROM integration_settings WHERE name IN ('UPI_RECEIVER_CONFIRMATION','UPI_RECEIVER_ACTIVATION')");
    const read=name=>{try {return JSON.parse(records.find(r=>r.name===name)?.value || '{}');} catch {return {};}};
    return receiverActivation(read('UPI_RECEIVER_CONFIRMATION'),read('UPI_RECEIVER_ACTIVATION'));
  }
  async function receiverReady() {return (await receiverStatus()).ready;}
  async function list(caseId, user, paymentId=null) {
    const params={}, filters=[];
    if(caseId) {params.$case=caseId;filters.push('p.case_id=$case');}
    if(user.role==='sales') {params.$user=user.id;filters.push('c.sales_user_id=$user');}
    if(paymentId) {params.$payment=paymentId;filters.push('p.id=$payment');}
    return all(`SELECT p.*,o.*,bi.batch_id,pb.status batch_status,EXISTS (SELECT 1 FROM payments locked WHERE locked.case_id=p.case_id AND locked.gateway='direct_upi' AND locked.status IN ('PAID','AWAITING_VERIFICATION')) case_payment_locked,cu.name customer_name,cu.mobile customer_mobile,c.ref case_ref,c.status case_status,c.customer_id,c.service_id,c.sales_user_id,u.name employee_name FROM payments p JOIN upi_orders o ON o.payment_id=p.id LEFT JOIN payment_batch_items bi ON bi.payment_id=p.id LEFT JOIN payment_batches pb ON pb.id=bi.batch_id JOIN cases c ON c.id=p.case_id JOIN customers cu ON cu.id=c.customer_id JOIN users u ON u.id=o.created_by ${filters.length ? 'WHERE '+filters.join(' AND ') : ''} ORDER BY p.created_at DESC,p.id`,params);
  }
  async function createOrder(c,user,{individual=false}={}) {
    if (c.status === 'Cancelled') fail(409,'The service request is cancelled');
    const receiver=paymentConfig();
    // Most cases already have an order. Reuse it with one read, without
    // issuing expiry/receiver updates when nothing has changed.
    const current=await one(`SELECT p.*,bi.batch_id selection_batch_id FROM payments p JOIN upi_orders o ON o.payment_id=p.id
      LEFT JOIN payment_batch_items bi ON bi.payment_id=p.id LEFT JOIN payment_batches b ON b.id=bi.batch_id
      WHERE p.case_id=$case AND p.gateway='direct_upi' AND (
        p.status IN ('PAID','AWAITING_VERIFICATION') OR
        (p.status IN ('PENDING','INITIATED') AND o.upi_id=$upi AND o.payee_name=$name AND o.expires_at>=$at
          AND (bi.batch_id IS NULL OR (b.status IN ('PENDING','INITIATED') AND b.expires_at>=$at))))
      ORDER BY CASE WHEN p.status='PAID' THEN 0 WHEN p.status='AWAITING_VERIFICATION' THEN 1 ELSE 2 END,p.created_at DESC LIMIT 1`,
      {$case:c.id,$upi:receiver.upiId,$name:receiver.payeeName,$at:at()});
    if(current && (!individual || !current.selection_batch_id || ['PAID','AWAITING_VERIFICATION'].includes(current.status))) return current;
    if(individual) await batches.prepareSelection([c.id],user,{allowSingle:true,reuse:false});
    const grouped=await one("SELECT p.* FROM payments p JOIN payment_batch_items i ON i.payment_id=p.id JOIN payment_batches b ON b.id=i.batch_id WHERE p.case_id=$id AND b.status IN ('PENDING','INITIATED','AWAITING_VERIFICATION','PAID') LIMIT 1",{$id:c.id});
    if(grouped) return grouped;
    const superseded=await all("SELECT p.* FROM payments p JOIN upi_orders o ON o.payment_id=p.id WHERE p.case_id=$case AND p.gateway='direct_upi' AND p.status IN ('PENDING','INITIATED') AND (o.upi_id!=$upi OR o.payee_name!=$name)",{$case:c.id,$upi:receiver.upiId,$name:receiver.payeeName});
    for(const p of superseded) {
      await run("UPDATE payments SET status='CANCELLED' WHERE id=$id AND status IN ('PENDING','INITIATED')",{$id:p.id});
      await event(p,user,'receiver_changed',{notes:`Payment request superseded by the configured receiver ${receiver.upiId}. Original receiver and any late transfer remain reconcilable.`});
    }
    await run("UPDATE payments SET status='EXPIRED' WHERE case_id=$case AND gateway='direct_upi' AND status IN ('PENDING','INITIATED') AND id IN (SELECT payment_id FROM upi_orders WHERE expires_at < $at)",{$case:c.id,$at:at()});
    const existing = await one("SELECT * FROM payments WHERE case_id=$case AND gateway='direct_upi' AND status IN ('PENDING','INITIATED','AWAITING_VERIFICATION','PAID') ORDER BY CASE WHEN status='PAID' THEN 0 WHEN status='AWAITING_VERIFICATION' THEN 1 ELSE 2 END,created_at DESC LIMIT 1",{$case:c.id});
    if (existing) return existing;
    const variant = await one('SELECT v.*,s.price configured_price,s.original_config FROM variants v LEFT JOIN service_prices s ON s.variant_id=v.id WHERE v.id=$id',{$id:c.variant_id});
    const base = priceAmounts(variant,variant.configured_price,variant.original_config ? JSON.parse(variant.original_config) : undefined);
    const a = JSON.parse(variant.fields_json || '[]').some(f=>[IntakeRules.available,IntakeRules.addressProof].includes(f.label)) ? IntakeRules.withSurcharge(base, JSON.parse(c.details_json || '{}')) : base;
    if (!Number.isSafeInteger(a.total) || a.total <= 0) fail(409,'Configure a positive service price first');
    const service = await one('SELECT name FROM services WHERE id=$id',{$id:c.service_id});
    const config = paymentConfig(), pid = `pay_${randomUUID()}`, order = `SO-P-${new Date().getUTCFullYear()}-${randomUUID()}`, stamp = at();
    await run("INSERT INTO payments VALUES ($id,$case,'direct_upi',$order,NULL,$amount,$sc,$fee,$tax,'PENDING',NULL,$at)",{$id:pid,$case:c.id,$order:order,$amount:a.total,$sc:a.serviceCharge,$fee:a.officialFee,$tax:a.tax,$at:stamp});
    await run('INSERT INTO upi_orders(payment_id,upi_id,payee_name,service_name,created_by,expires_at,updated_at) VALUES ($id,$upi,$name,$service,$user,$expires,$at)',{$id:pid,$upi:config.upiId,$name:config.payeeName,$service:service.name,$user:user.id,$expires:new Date(Date.now()+30*60000).toISOString(),$at:stamp});
    await audit(user,'create',pid,`Order ${order}; amount ${a.total} paise`);
    return one('SELECT * FROM payments WHERE id=$id',{$id:pid});
  }
  async function detail(pid,user) {
    const member=await batches.membership(pid);
    if(member) return batches.detail(member.batch_id,user);
    const p = (await list(null,user,pid))[0];
    if (!p) fail(404,'Payment not found');
    if (['PENDING','INITIATED'].includes(p.status) && p.expires_at < at()) {
      await run("UPDATE payments SET status='EXPIRED' WHERE id=$id AND status IN ('PENDING','INITIATED')",{$id:pid}); p.status='EXPIRED';
      await run('UPDATE upi_orders SET updated_at=$at WHERE payment_id=$id',{$at:at(),$id:pid});
      await audit(user,'expire',pid,'Checkout expired; this does not cancel a bank transfer');
      await recomputeCase(p.case_id);
    }
    const ready = await receiverReady();
    const otherPaid=await one("SELECT id FROM payments WHERE case_id=$case AND id!=$id AND status='PAID' AND gateway='direct_upi'",{$case:p.case_id,$id:p.id});
    const otherClaim=await one("SELECT id FROM payments WHERE case_id=$case AND id!=$id AND status='AWAITING_VERIFICATION' AND gateway='direct_upi'",{$case:p.case_id,$id:p.id});
    const config=paymentConfig(),receiverChanged=p.upi_id!==config.upiId || p.payee_name!==config.payeeName;
    const active = ready && !receiverChanged && !otherPaid && !otherClaim && p.case_status!=='Cancelled' && ['PENDING','INITIATED'].includes(p.status);
    const upiIntent = active ? generateUPIPaymentURL({upiId:p.upi_id,payeeName:p.payee_name,amount:p.amount,orderId:p.gateway_order_id,serviceName:p.service_name,customerName:p.customer_name}) : null;
    return {...p,orderId:p.gateway_order_id,receiverReady:ready,receiverChanged,otherClaimPending:!!otherClaim,otherPaymentVerified:!!otherPaid,receiverAccountType:receiverChanged ? 'previous_receiver' : config.accountType,upiIntent,qrDataUrl:upiIntent ? await QRCode.toDataURL(upiIntent,{width:360,margin:4,errorCorrectionLevel:'M'}) : null,attempts:await all('SELECT * FROM payment_attempts WHERE payment_id=$id ORDER BY created_at',{$id:pid})};
  }
  async function event(p,user,action,b) {
    await run('UPDATE upi_orders SET updated_at=$at WHERE payment_id=$id',{$at:at(),$id:p.id});
    await run('INSERT INTO payment_attempts VALUES ($id,$payment,$action,$method,$utr,$actor,$notes,$at)',{$id:randomUUID(),$payment:p.id,$action:action,$method:b.method || null,$utr:b.utr || null,$actor:user.id,$notes:b.notes || '',$at:at()});
    await audit(user,action,p.id,b.notes);
  }
  const batches=createBatchPayments({db,send,body,createOrder,recomputeCase,receiverReady,event,config:paymentConfig,generateURL:generateUPIPaymentURL});
  async function handle(req,res,url,user) {
    if(await batches.handle(req,res,url,user)) return true;
    if (url.pathname === '/api/payment-settings') {
      if (req.method === 'GET') { const receiver=await receiverStatus();send(res,200,{...paymentConfig(),receiverReady:receiver.ready,receiverActivationBasis:receiver.basis,prices:user.role==='admin' ? await all('SELECT p.*,v.name,s.name service_name FROM service_prices p JOIN variants v ON v.id=p.variant_id JOIN services s ON s.id=v.service_id') : []}); return true; }
      if (user.role !== 'admin') fail(403,'Admin access required');
      const b = await body(req);
      if (req.method !== 'POST') fail(405,'Method not allowed');
      if(b.action==='enable-receiver') {
        if(b.ownerConfirmed!==true) fail(400,'Confirm that the configured UPI account belongs to the business');
        const record={upiId:paymentConfig().upiId,payeeName:paymentConfig().payeeName,basis:'owner_confirmation',enabledBy:user.id,enabledAt:at(),notes:String(b.notes || 'Business owner confirmed the configured account and requested checkout activation.').trim().slice(0,1000)};
        await run("INSERT INTO integration_settings VALUES ('UPI_RECEIVER_ACTIVATION',$value) ON CONFLICT(name) DO UPDATE SET value=$value",{$value:JSON.stringify(record)});
        await audit(user,'receiver.enable','receiver',JSON.stringify(record));
      } else if (b.action === 'confirm-receiver') {
        if (b.received !== true || b.correctRecipient !== true || b.amount !== 1 || !String(b.notes || '').trim()) fail(400,'Confirm the actual recipient and a received ₹1 test transfer, with notes');
        const utr=normalizeUTR(b.utr), record={...paymentConfig(),utr,verifiedBy:user.id,verifiedAt:at(),notes:String(b.notes).slice(0,1000)};
        await run("INSERT INTO integration_settings VALUES ('UPI_RECEIVER_CONFIRMATION',$value) ON CONFLICT(name) DO UPDATE SET value=$value",{$value:JSON.stringify(record)});
        await audit(user,'receiver.confirm','receiver',JSON.stringify(record));
      } else if (b.action === 'price') {
        if (!Number.isSafeInteger(b.price) || b.price < 1 || b.price > 100000000) fail(400,'Price must be positive integer paise');
        const result=await run('UPDATE service_prices SET price=$price,updated_by=$user,updated_at=$at WHERE variant_id=$id',{$price:b.price,$user:user.id,$at:at(),$id:b.variantId});
        if (!result.changes) fail(404,'Service price not found');
        await audit(user,'price',b.variantId,String(b.price));
      } else if (b.action === 'test-pricing') {
        if (typeof b.enabled !== 'boolean') fail(400,'A boolean enabled setting is required');
        await run("INSERT INTO integration_settings VALUES ('TEST_PRICING_MODE',$v) ON CONFLICT(name) DO UPDATE SET value=$v",{$v:String(b.enabled)});
        process.env.TEST_PRICING_MODE=String(b.enabled); await audit(user,'test-pricing','settings',String(b.enabled));
      } else fail(400,'Unknown settings action');
      send(res,200,{ok:true});return true;
    }
    if (url.pathname === '/api/payments' && req.method === 'GET') {
      let rows=await list(null,user);
      const today=new Date(Date.now()+330*60000).toISOString().slice(0,10), verified=rows.filter(p=>p.status==='PAID');
      const metrics={collected:verified.reduce((n,p)=>n+p.amount,0),today:verified.filter(p=>new Date(Date.parse(p.verified_at)+330*60000).toISOString().startsWith(today)).reduce((n,p)=>n+p.amount,0),verified:new Set(verified.map(p=>p.batch_id || p.id)).size,pending:rows.filter(p=>['PENDING','INITIATED','EXPIRED'].includes(p.status)).length,awaiting:rows.filter(p=>p.status==='AWAITING_VERIFICATION').length,failed:rows.filter(p=>['FAILED','CANCELLED'].includes(p.status)).length};
      for (const [key,column] of Object.entries({utr:'transaction_id',mobile:'customer_mobile',employee:'created_by',service:'service_id',status:'status'})) { const value=url.searchParams.get(key);if(value) rows=rows.filter(p=>String(p[column]||'').includes(value)); }
      for(const key of ['from','to']) {const value=url.searchParams.get(key);if(value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)))) fail(400,'Invalid date filter');}
      const indiaDay=p=>new Date(Date.parse(p.created_at)+330*60000).toISOString().slice(0,10);
      if(url.searchParams.get('from')) rows=rows.filter(p=>indiaDay(p)>=url.searchParams.get('from'));
      if(url.searchParams.get('to')) rows=rows.filter(p=>indiaDay(p)<=url.searchParams.get('to'));
      const query=(url.searchParams.get('q') || '').trim().toLowerCase(), searchBy=url.searchParams.get('searchBy') || 'all';
      if(query) {
        const fields={customer:['customer_name'],utr:['transaction_id'],mobile:['customer_mobile'],service:['service_name'],employee:['employee_name'],order:['gateway_order_id','case_ref','batch_id'],status:['status']};
        if(['from','to'].includes(searchBy)) {
          if(!/^\d{4}-\d{2}-\d{2}$/.test(query) || !Number.isFinite(Date.parse(query))) fail(400,'Choose a valid date');
          rows=rows.filter(p=>searchBy==='from'?indiaDay(p)>=query:indiaDay(p)<=query);
        } else {
          if(searchBy!=='all' && !fields[searchBy]) fail(400,'Choose a valid search filter');
          const columns=searchBy==='all'?Object.values(fields).flat():fields[searchBy];
          rows=rows.filter(p=>columns.some(column=>String(p[column] || '').toLowerCase().replaceAll('_',' ').includes(query.replaceAll('_',' '))));
        }
      }
      send(res,200,{payments:rows,metrics}); return true;
    }
    const match=url.pathname.match(/^\/api\/payments\/([^/]+)(?:\/(initiate|submit|cancel|verify|reject|refund|receipt))?$/);
    if (!match) return false;
    if (req.method==='POST' && db.cloud) {
      // Serialize payment mutations with order creation, refunds and case processing.
      await one('SELECT id FROM cases WHERE id=(SELECT case_id FROM payments WHERE id=$id) FOR UPDATE',{$id:match[1]});
    }
    const p=await detail(match[1],user), action=match[2];
    if (req.method==='GET') {
      if(action==='receipt' && p.status!=='PAID') fail(409,'A receipt requires verified payment');
      send(res,200,p);return true;
    }
    if(req.method!=='POST' || !action || action==='receipt') fail(405,'Method not allowed');
    const b=await body(req);
    b.notes=String(b.notes || '').trim().slice(0,1000);
    if(['verify','reject','refund'].includes(action) && user.role!=='admin') fail(403,'Only administrators can verify receiving account records');
    if(['initiate','submit','cancel'].includes(action) && user.role==='backoffice') fail(403,'Only sales or admin can record payment attempts');
    if(action==='initiate') {
      if(!p.upiIntent) fail(409,'Checkout unavailable. Confirm the receiver or reopen an active order.');
      if(!['Google Pay','PhonePe','Paytm','BHIM','Other UPI App','QR','Manual UPI'].includes(b.method)) fail(400,'Choose a UPI payment method');
      await run("UPDATE payments SET status='INITIATED' WHERE id=$id",{$id:p.id});
      await run('UPDATE upi_orders SET payment_method=$method,initiated_at=$at,updated_at=$at WHERE payment_id=$id',{$id:p.id,$method:b.method,$at:at()});
    } else if(action==='submit') {
      if(['PAID','REFUNDED'].includes(p.status)) fail(409,'This payment is already verified');
      if(p.otherClaimPending || p.otherPaymentVerified) fail(409,'This case is already paid or awaiting payment verification');
      b.utr=normalizeUTR(b.utr);
      const used=await one('SELECT payment_id FROM verified_upi_refs WHERE utr=$utr',{$utr:b.utr});
      if(used && used.payment_id!==p.id) fail(409,'This UTR is already assigned to a verified payment');
      await run("UPDATE payments SET status='AWAITING_VERIFICATION',transaction_id=$utr WHERE id=$id",{$utr:b.utr,$id:p.id});
      await run('UPDATE upi_orders SET submitted_at=$at,updated_at=$at WHERE payment_id=$id',{$id:p.id,$at:at()});
    } else if(action==='verify') {
      if(p.status==='PAID') {send(res,200,{ok:true,payment:p});return true;}
      if(p.status!=='AWAITING_VERIFICATION') fail(409,'A submitted UTR is required');
      b.notes ||= 'Received payment verified by administrator.';
      if(!(await receiverReady())) fail(409,'Confirm the receiving account first');
      const assigned=await one('SELECT payment_id FROM verified_upi_refs WHERE utr=$utr',{$utr:p.transaction_id});
      if(assigned && assigned.payment_id!==p.id) fail(409,'This UTR is already assigned to a verified payment');
      const paid=await one("SELECT id FROM payments WHERE case_id=$case AND gateway='direct_upi' AND status='PAID'",{$case:p.case_id});
      if(paid && paid.id!==p.id) fail(409,'Another payment is already verified for this service request');
      await run('INSERT INTO verified_upi_refs VALUES ($utr,$id)',{$utr:normalizeUTR(p.transaction_id),$id:p.id});
      await run("UPDATE payments SET status='PAID',verified_at=$at WHERE id=$id",{$at:at(),$id:p.id});
      await run('UPDATE upi_orders SET verified_by=$user,verification_notes=$notes,updated_at=$at WHERE payment_id=$id',{$user:user.id,$notes:b.notes,$at:at(),$id:p.id});
    } else if(action==='reject') {
      if(p.status!=='AWAITING_VERIFICATION' || !b.notes) fail(409,'Reject only a pending claim with a reason');
      await run("UPDATE payments SET status='FAILED' WHERE id=$id",{$id:p.id});
    } else if(action==='cancel') {
      if(!['PENDING','INITIATED'].includes(p.status)) fail(409,'Only an unsubmitted checkout can be cancelled; receiving account verification may still be necessary');
      await run("UPDATE payments SET status='CANCELLED' WHERE id=$id",{$id:p.id});
    } else if(action==='refund') {
      if(p.status!=='PAID' || b.refundReceived!==true || !b.notes) fail(409,'Confirm an actual completed refund and record its reference in notes');
      await run("UPDATE payments SET status='REFUNDED' WHERE id=$id",{$id:p.id});
    }
    await event(p,user,action,b);
    await recomputeCase(p.case_id);
    send(res,200,{ok:true,payment:await detail(p.id,user)}); return true;
  }
  return {handle,createOrder,detail,list,receiverReady,audit};
}
