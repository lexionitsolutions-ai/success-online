import {randomUUID} from 'node:crypto';
import QRCode from 'qrcode';

export const batchSchema = `
CREATE TABLE IF NOT EXISTS payment_batches (id TEXT PRIMARY KEY, created_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL, amount INTEGER NOT NULL, transaction_id TEXT, payment_method TEXT, upi_id TEXT NOT NULL, payee_name TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, verified_at TEXT, verified_by TEXT);
CREATE TABLE IF NOT EXISTS payment_batch_items (batch_id TEXT NOT NULL REFERENCES payment_batches(id), payment_id TEXT UNIQUE NOT NULL REFERENCES payments(id), PRIMARY KEY(batch_id,payment_id));
`;

export function createBatchPayments({db,send,body,createOrder,recomputeCase,receiverReady,event,config,generateURL}) {
  const {one,all,run}=db, now=()=>new Date().toISOString();
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const utr=value=>{const ref=String(value || '').trim();if(!/^\d{12}$/.test(ref)) fail(400,'Enter the 12-digit UPI transaction reference.');return ref;};
  async function membership(paymentId) {return one('SELECT batch_id FROM payment_batch_items WHERE payment_id=$id',{$id:paymentId});}
  async function detail(id,user) {
    const batch=await one('SELECT * FROM payment_batches WHERE id=$id',{$id:id});
    if(!batch) fail(404,'Combined payment not found');
    const items=await all('SELECT p.*,c.ref,c.sales_user_id,c.status case_status,cu.name customer_name,o.service_name FROM payment_batch_items i JOIN payments p ON p.id=i.payment_id JOIN cases c ON c.id=p.case_id JOIN customers cu ON cu.id=c.customer_id JOIN upi_orders o ON o.payment_id=p.id WHERE i.batch_id=$id ORDER BY c.id',{$id:id});
    if(user.role==='sales' && (batch.created_by!==user.id || items.some(p=>p.sales_user_id!==user.id))) fail(403,'Not allowed');
    if(['PENDING','INITIATED'].includes(batch.status) && batch.expires_at<now()) {
      batch.status='EXPIRED';
      await run("UPDATE payment_batches SET status='EXPIRED' WHERE id=$id",{$id:id});
      await run("UPDATE payments SET status='EXPIRED' WHERE id IN (SELECT payment_id FROM payment_batch_items WHERE batch_id=$id)",{$id:id});
      for(const item of items) await recomputeCase(item.case_id);
    }
    const receiver=config(), ready=await receiverReady();
    const receiverChanged=batch.upi_id!==receiver.upiId || batch.payee_name!==receiver.payeeName;
    const conflicts=await all("SELECT p.status FROM payments p WHERE p.gateway='direct_upi' AND p.status IN ('PAID','AWAITING_VERIFICATION') AND p.case_id IN (SELECT case_id FROM payments WHERE id IN (SELECT payment_id FROM payment_batch_items WHERE batch_id=$id)) AND p.id NOT IN (SELECT payment_id FROM payment_batch_items WHERE batch_id=$id)",{$id:id});
    const otherClaimPending=conflicts.some(p=>p.status==='AWAITING_VERIFICATION'),otherPaymentVerified=conflicts.some(p=>p.status==='PAID');
    const active=ready && !conflicts.length && !receiverChanged && ['PENDING','INITIATED'].includes(batch.status) && items.every(p=>p.case_status!=='Cancelled');
    const names=[...new Set(items.map(p=>p.customer_name))];
    const intent=active ? generateURL({upiId:batch.upi_id,payeeName:batch.payee_name,amount:batch.amount,orderId:batch.id,customerName:names.length===1?names[0]:`${names[0]} +${names.length-1}`,serviceName:`${items.length} work orders`}) : null;
    return {...batch,otherClaimPending,otherPaymentVerified,batch:true,batch_id:id,case_id:items[0]?.case_id,gateway_order_id:id,orderId:id,customer_name:names.join(', '),service_name:`${items.length} work orders`,items,receiverReady:ready,receiverChanged,upiIntent:intent,qrDataUrl:intent?await QRCode.toDataURL(intent,{width:360,margin:4,errorCorrectionLevel:'M'}):null,attempts:await all('SELECT a.* FROM payment_attempts a WHERE a.payment_id=(SELECT payment_id FROM payment_batch_items WHERE batch_id=$id ORDER BY payment_id LIMIT 1) ORDER BY a.created_at',{$id:id})};
  }
  async function prepareSelection(caseIds,user,{allowSingle=false,reuse=true}={}) {
    if(!['sales','admin'].includes(user.role)) fail(403,'Only sales or admin can combine payments');
    if(!Array.isArray(caseIds) || caseIds.length<(allowSingle?1:2) || caseIds.length>50 || caseIds.some(id=>typeof id!=='string') || new Set(caseIds).size!==caseIds.length) fail(400,'Select between 2 and 50 different unpaid cases');
    const selected=[];
    for(const id of [...caseIds].sort()) {
      const c=await one('SELECT * FROM cases WHERE id=$id'+(db.cloud?' FOR UPDATE':''),{$id:id});
      if(!c || (user.role==='sales' && c.sales_user_id!==user.id)) fail(403,'You can only combine your own cases');
      if(['Cancelled','Closed','Delivered'].includes(c.status)) fail(409,'A selected case is closed or cancelled');
      selected.push(c);
    }
    if(new Set(selected.map(c=>c.sales_user_id)).size!==1) fail(400,'Select cases belonging to one salesperson');
    // A checkout is provisional until a transfer is submitted for verification.
    // Validate the entire selection before releasing any previous group.
    const groups=new Set();
    for(const c of selected) {
      if(await one("SELECT id FROM payments WHERE case_id=$id AND gateway='direct_upi' AND status IN ('PAID','AWAITING_VERIFICATION')",{$id:c.id})) fail(409,'A selected case is paid or awaiting payment verification');
      for(const row of await all("SELECT b.id FROM payment_batches b JOIN payment_batch_items i ON i.batch_id=b.id JOIN payments p ON p.id=i.payment_id WHERE p.case_id=$id AND b.status IN ('PENDING','INITIATED')",{$id:c.id})) groups.add(row.id);
    }
    if(reuse && groups.size===1) {
      const existing=await detail([...groups][0],user);
      if(existing.upiIntent && existing.items.length===selected.length && existing.items.every(p=>caseIds.includes(p.case_id))) return {selected,existing};
    }
    for(const id of groups) {
      const previous=await detail(id,user);
      if(!['PENDING','INITIATED'].includes(previous.status)) continue;
      await run("UPDATE payment_batches SET status='CANCELLED' WHERE id=$id",{$id:id});
      for(const item of previous.items) {
        await run("UPDATE payments SET status='CANCELLED' WHERE id=$id AND status IN ('PENDING','INITIATED')",{$id:item.id});
        await event(item,user,'supersede',{notes:'Unsubmitted combined checkout replaced by a new payment selection. Any late transfer remains reconcilable.'});
        await recomputeCase(item.case_id);
      }
    }
    return {selected};
  }
  async function create(caseIds,user) {
    const {selected,existing}=await prepareSelection(caseIds,user);
    if(existing) return existing;
    const orders=[];
    for(const c of selected) {
      const payment=await createOrder(c,user);
      if(!['PENDING','INITIATED'].includes(payment.status) || await membership(payment.id)) fail(409,'A selected case is paid, under review, or already in a combined payment');
      orders.push(payment);
    }
    const amount=orders.reduce((n,p)=>n+p.amount,0);
    if(!Number.isSafeInteger(amount) || amount<=0 || amount>100000000) fail(400,'Combined amount exceeds the supported payment limit');
    const id=`batch_${randomUUID()}`, receiver=config(), stamp=now();
    await run("INSERT INTO payment_batches VALUES ($id,$user,'PENDING',$amount,NULL,NULL,$upi,$name,$at,$expires,NULL,NULL)",{$id:id,$user:selected[0].sales_user_id,$amount:amount,$upi:receiver.upiId,$name:receiver.payeeName,$at:stamp,$expires:new Date(Date.now()+30*60000).toISOString()});
    for(const p of orders) {
      await run('INSERT INTO payment_batch_items VALUES ($batch,$payment)',{$batch:id,$payment:p.id});
      await run('UPDATE upi_orders SET expires_at=$expires WHERE payment_id=$id',{$expires:new Date(Date.now()+30*60000).toISOString(),$id:p.id});
      await event(p,user,'combine',{notes:`Combined payment ${id}`});
    }
    return detail(id,user);
  }
  async function handle(req,res,url,user) {
    if(url.pathname==='/api/payments/batch' && req.method==='POST') {send(res,201,await create((await body(req)).caseIds,user));return true;}
    const match=url.pathname.match(/^\/api\/payments\/([^/]+)(?:\/(initiate|submit|cancel|verify|reject|refund|receipt|reopen))?$/);
    if(!match) return false;
    const member=match[1].startsWith('batch_')?{batch_id:match[1]}:await membership(match[1]);
    if(!member) return false;
    if(db.cloud) await all('SELECT c.id FROM cases c JOIN payments p ON p.case_id=c.id JOIN payment_batch_items i ON i.payment_id=p.id WHERE i.batch_id=$id ORDER BY c.id FOR UPDATE OF c',{$id:member.batch_id});
    const p=await detail(member.batch_id,user), action=match[2];
    if(req.method==='GET') {
      if(action==='receipt' && p.status!=='PAID') fail(409,'A receipt requires verified payment');
      send(res,200,p);return true;
    }
    if(req.method!=='POST' || !action || action==='receipt') fail(405,'Method not allowed');
    if(['verify','reject','refund'].includes(action) && user.role!=='admin') fail(403,'Only administrators can verify receiving account records');
    if(!['admin','sales'].includes(user.role)) fail(403,'Not allowed');
    const b=await body(req); b.notes=String(b.notes || '').trim().slice(0,1000);
    if(action==='reopen') {
      if(!['EXPIRED','CANCELLED','FAILED'].includes(p.status)) fail(409,'This combined payment is still active');
      send(res,201,{payment:await create(p.items.map(i=>i.case_id),user)});return true;
    }
    let status=p.status, transaction=p.transaction_id, verifiedAt=p.verified_at, verifiedBy=p.verified_by;
    if(action==='initiate') {
      if(!p.upiIntent) fail(409,'Reopen an active combined checkout first');
      if(!['Google Pay','PhonePe','Paytm','BHIM','Other UPI App','QR','Manual UPI'].includes(b.method)) fail(400,'Choose a UPI payment method');
      status='INITIATED';
    } else if(action==='submit') {
      if(['PAID','REFUNDED'].includes(p.status)) fail(409,'This combined payment is already verified');
      if(p.otherClaimPending || p.otherPaymentVerified) fail(409,'A selected case is already paid or awaiting payment verification');
      transaction=utr(b.utr);
      const assigned=await one('SELECT payment_id FROM verified_upi_refs WHERE utr=$utr',{$utr:transaction});
      if(assigned) fail(409,'This UTR is already assigned to a verified payment');
      status='AWAITING_VERIFICATION';
    } else if(action==='verify') {
      if(p.status==='PAID') {send(res,200,{ok:true,payment:p});return true;}
      if(p.status!=='AWAITING_VERIFICATION') fail(409,'A submitted UTR is required');
      if(p.otherClaimPending || p.otherPaymentVerified) fail(409,'A selected case has another payment under verification or already paid');
      if(p.items.reduce((sum,item)=>sum+item.amount,0)!==p.amount) fail(409,'Combined payment allocations do not match the total');
      if(!(await receiverReady())) fail(409,'Confirm the receiving account first');
      for(const item of p.items) if(await one("SELECT id FROM payments WHERE case_id=$case AND status='PAID' AND gateway='direct_upi'",{$case:item.case_id})) fail(409,'A selected case already has a verified payment');
      if(await one('SELECT payment_id FROM verified_upi_refs WHERE utr=$utr',{$utr:transaction})) fail(409,'This UTR is already assigned to a verified payment');
      const leader=[...p.items].sort((a,b)=>a.id.localeCompare(b.id))[0];
      await run('INSERT INTO verified_upi_refs VALUES ($utr,$id)',{$utr:utr(transaction),$id:leader.id});
      status='PAID';verifiedAt=now();verifiedBy=user.id;b.notes||='Combined received payment verified by administrator.';
    } else if(action==='cancel') {
      if(!['PENDING','INITIATED'].includes(p.status)) fail(409,'Only an unsubmitted checkout can be cancelled');
      status='CANCELLED';
    } else if(action==='reject') {
      if(p.status!=='AWAITING_VERIFICATION' || !b.notes) fail(409,'Reject only a pending claim with a reason');status='FAILED';
    } else if(action==='refund') {
      if(p.status!=='PAID' || b.refundReceived!==true || !b.notes) fail(409,'Confirm the completed combined refund and record its reference');status='REFUNDED';
    }
    await run('UPDATE payment_batches SET status=$status,transaction_id=$utr,payment_method=$method,verified_at=$at,verified_by=$user WHERE id=$id',{$status:status,$utr:transaction,$method:b.method || p.payment_method,$at:verifiedAt,$user:verifiedBy,$id:p.id});
    for(const item of p.items) {
      await run('UPDATE payments SET status=$status,transaction_id=$utr,verified_at=$at WHERE id=$id',{$status:status,$utr:transaction,$at:verifiedAt,$id:item.id});
      await run('UPDATE upi_orders SET payment_method=$method,verified_by=$user,verification_notes=$notes,updated_at=$at WHERE payment_id=$id',{$method:b.method || p.payment_method,$user:verifiedBy,$notes:b.notes || null,$at:now(),$id:item.id});
      await event(item,user,action,{...b,utr:transaction});
      await recomputeCase(item.case_id);
    }
    send(res,200,{ok:true,payment:await detail(p.id,user)});return true;
  }
  return {handle,detail,membership,prepareSelection};
}
