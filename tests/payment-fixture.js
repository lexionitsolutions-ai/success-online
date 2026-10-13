// Synthetic receiving-account attestations only in isolated test databases.
// These exercise authorization; they are never evidence of a real transfer.
import assert from 'node:assert/strict';
export const confirmations={exists:true,amountMatches:true,recipientMatches:true,utrMatches:true,notAssigned:true,notes:'Synthetic bank-record fixture; no real money transferred'};
export async function confirmTestReceiver(request,admin) {
  const r=await request('/api/payment-settings',{cookie:admin,body:{action:'confirm-receiver',utr:'100000000001',amount:1,received:true,correctRecipient:true,notes:'Isolated automated test fixture, not a real payment'}});
  assert.equal(r.status,200,JSON.stringify(r.data));
}
export async function verifyTestOrder(request,admin,sales,pid,utr='123456789012') {
  assert.equal((await request(`/api/payments/${pid}/submit`,{cookie:sales,body:{utr}})).status,200);
  assert.equal((await request(`/api/payments/${pid}/verify`,{cookie:admin,body:confirmations})).status,200);
}
