import {randomUUID} from 'node:crypto';

export const CASH_SALES_ID='usr_45ca9fa8-2cd5-4b12-9509-8c8b6c3eeded';
export const cashAccount=user=>user?.role==='sales' && user.id===CASH_SALES_ID && user.username==='7028405101';
export const cashSchema=`CREATE TABLE IF NOT EXISTS cash_accounts (case_id TEXT PRIMARY KEY REFERENCES cases(id),total INTEGER NOT NULL CHECK(total>0),service_charge INTEGER NOT NULL,official_fee INTEGER NOT NULL,tax INTEGER NOT NULL,created_at TEXT NOT NULL);`;
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const confirmed=p=>['PAID','verified','offline_approved'].includes(p.status) && p.gateway!=='demo';
export function cashSummary(account,receipts) {
  if(!account) return null;
  const paid=receipts.filter(confirmed).reduce((sum,p)=>sum+p.amount,0);
  const awaiting=receipts.filter(p=>p.status==='AWAITING_VERIFICATION').reduce((sum,p)=>sum+p.amount,0);
  const cashRecorded=receipts.filter(p=>p.gateway==='cash' && ['PAID','AWAITING_VERIFICATION'].includes(p.status)).reduce((sum,p)=>sum+p.amount,0);
  return {total:account.total,confirmedPaid:paid,awaitingVerification:awaiting,recordedPaid:paid+awaiting,pendingAmount:Math.max(0,account.total-paid),amountToPay:Math.max(0,account.total-paid-awaiting),processingAllowed:cashRecorded>0 || paid>0,releaseAllowed:paid>=account.total};
}
export function createCashPayments({db,config}) {
  const {one,all,run}=db,at=()=>new Date().toISOString();
  const account=caseId=>one('SELECT * FROM cash_accounts WHERE case_id=$id',{$id:caseId});
  const receipts=caseId=>all("SELECT * FROM payments WHERE case_id=$id AND gateway!='demo' ORDER BY created_at DESC",{$id:caseId});
  async function summary(caseId) {const a=await account(caseId);return cashSummary(a,a?await receipts(caseId):[]);}
  async function authorize(c,user) {
    const owner=await one('SELECT id,username,role FROM users WHERE id=$id',{$id:c.sales_user_id});
    if(!cashAccount(owner) || !(user.role==='admin' || cashAccount(user) && c.sales_user_id===user.id)) fail(403,'Cash payments are available only for the Mahalaxmi Online Services sales account.');
  }
  async function enroll(c,order,user,amount,requestId=randomUUID()) {
    await authorize(c,user);
    if(!cashAccount(user)) fail(403,'Only the Mahalaxmi sales account can select cash.');
    if(await account(c.id)) return record(c,user,{amount,requestId});
    if(['Deleted','Cancelled','Closed','Delivered'].includes(c.status)) fail(409,'Cash cannot be selected for this closed case.');
    if(!Number.isSafeInteger(amount) || amount<1 || amount>order.amount) fail(400,'Enter a positive cash amount no greater than the total payable.');
    if((await receipts(c.id)).some(p=>confirmed(p) || p.status==='REFUNDED' || p.status==='AWAITING_VERIFICATION' || p.verified_at)) fail(409,'A payment is already confirmed or under review. Cash cannot replace that payment.');
    if(await one('SELECT batch_id FROM payment_batch_items WHERE payment_id=$id',{$id:order.id})) fail(409,'Open an individual case checkout before choosing cash.');
    await run('INSERT INTO cash_accounts VALUES ($case,$total,$service,$fee,$tax,$at)',{$case:c.id,$total:order.amount,$service:order.service_charge,$fee:order.official_fee,$tax:order.tax,$at:at()});
    await run("UPDATE payments SET status='CANCELLED' WHERE case_id=$case AND gateway='direct_upi' AND status IN ('PENDING','INITIATED')",{$case:c.id});
    return record(c,user,{amount,requestId});
  }
  async function insert(c,user,a,amount,gateway,requestId,status) {
    const existing=await receipts(c.id);
    const allocated=existing.filter(p=>confirmed(p) || p.status==='AWAITING_VERIFICATION');
    const remaining=key=>Math.max(0,a[key]-allocated.reduce((n,p)=>n+p[key],0));
    const service=Math.min(amount,remaining('service_charge')),fee=Math.min(amount-service,remaining('official_fee')),tax=amount-service-fee;
    const id='pay_'+randomUUID(),stamp=at(),receiver=config();
    const serviceRow=await one('SELECT name FROM services WHERE id=$id',{$id:c.service_id});
    await run('INSERT INTO payments VALUES ($id,$case,$gateway,$order,NULL,$amount,$service,$fee,$tax,$status,NULL,$at)',{$id:id,$case:c.id,$gateway:gateway,$order:'SO-INST-'+requestId,$amount:amount,$service:service,$fee:fee,$tax:tax,$status:status,$at:stamp});
    await run('INSERT INTO upi_orders(payment_id,upi_id,payee_name,service_name,created_by,payment_method,submitted_at,expires_at,updated_at) VALUES ($id,$upi,$name,$service,$user,$method,$submitted,$expires,$at)',{$id:id,$upi:receiver.upiId,$name:receiver.payeeName,$service:serviceRow.name,$user:user.id,$method:gateway==='cash'?'Cash':null,$submitted:gateway==='cash'?stamp:null,$expires:new Date(Date.now()+1800000).toISOString(),$at:stamp});
    await run('INSERT INTO payment_attempts VALUES ($id,$payment,$action,$method,NULL,$actor,$notes,$at)',{$id:randomUUID(),$payment:id,$action:gateway==='cash'?'cash_recorded':'balance_order',$method:gateway==='cash'?'Cash':null,$actor:user.id,$notes:'Mahalaxmi instalment; final documents require full admin-confirmed payment.',$at:stamp});
    await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)',{$id:randomUUID(),$actor:user.id,$action:gateway==='cash'?'payment.cash_recorded':'payment.balance_order',$type:'payment',$entity:id,$reason:`${amount} paise for ${c.ref}`,$at:stamp});
    return one('SELECT * FROM payments WHERE id=$id',{$id:id});
  }
  async function record(c,user,{amount,requestId}) {
    await authorize(c,user);
    const a=await account(c.id);
    if(!a) fail(409,'This case uses the normal online payment flow.');
    if(!/^[a-f0-9-]{36}$/i.test(requestId || '')) fail(400,'A payment request identifier is required.');
    const old=await one('SELECT * FROM payments WHERE gateway_order_id=$order',{$order:'SO-INST-'+requestId});
    if(old) {if(old.case_id!==c.id || old.gateway!=='cash' || old.amount!==amount) fail(409,'Payment request identifier already used.');return old;}
    if(c.status==='Cancelled') fail(409,'The case is cancelled.');
    if(await one("SELECT id FROM payments WHERE case_id=$id AND gateway='balance_upi' AND status='AWAITING_VERIFICATION'",{$id:c.id})) fail(409,'Wait for admin to review the submitted UPI payment before recording more cash.');
    const state=await summary(c.id);
    if(!Number.isSafeInteger(amount) || amount<1 || amount>state.amountToPay) fail(400,'Cash amount must be positive and cannot exceed the remaining unrecorded balance.');
    // An active QR must never remain payable after its balance changes.
    await run("UPDATE payments SET status='CANCELLED' WHERE case_id=$id AND gateway='balance_upi' AND status IN ('PENDING','INITIATED')",{$id:c.id});
    return insert(c,user,a,amount,'cash',requestId,'AWAITING_VERIFICATION');
  }
  async function createBalanceOrder(c,user) {
    await authorize(c,user);
    const a=await account(c.id),state=await summary(c.id);
    const pending=await one("SELECT * FROM payments WHERE case_id=$id AND gateway='balance_upi' AND status='AWAITING_VERIFICATION'",{$id:c.id});
    if(pending) return pending;
    if(!state.amountToPay) fail(409,state.releaseAllowed?'The full amount is already confirmed.':'All recorded payments are awaiting admin confirmation.');
    const existing=await one("SELECT p.* FROM payments p JOIN upi_orders o ON o.payment_id=p.id WHERE p.case_id=$id AND p.gateway='balance_upi' AND p.status IN ('PENDING','INITIATED') AND o.expires_at>$at AND o.upi_id=$upi AND o.payee_name=$name AND p.amount=$amount ORDER BY p.created_at DESC LIMIT 1",{$id:c.id,$at:at(),$upi:config().upiId,$name:config().payeeName,$amount:state.amountToPay});
    if(existing) return existing;
    await run("UPDATE payments SET status='CANCELLED' WHERE case_id=$id AND gateway='balance_upi' AND status IN ('PENDING','INITIATED')",{$id:c.id});
    return insert(c,user,a,state.amountToPay,'balance_upi',randomUUID(),'PENDING');
  }
  async function assertFits(p) {
    const a=await one(`SELECT a.total,COALESCE(SUM(CASE WHEN p.id!=$payment AND (p.status IN ('PAID','verified','offline_approved','AWAITING_VERIFICATION')) AND p.gateway!='demo' THEN p.amount ELSE 0 END),0) reserved FROM cash_accounts a LEFT JOIN payments p ON p.case_id=a.case_id WHERE a.case_id=$case GROUP BY a.case_id,a.total`,{$payment:p.id,$case:p.case_id});
    if(!a) fail(409,'Instalment account not found.');
    if(p.amount+Number(a.reserved)>a.total) fail(409,'This payment exceeds the remaining balance. Review the other recorded payments first.');
  }
  return {account,summary,enroll,record,createBalanceOrder,assertFits,authorize};
}
