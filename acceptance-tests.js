import {createHmac,timingSafeEqual} from 'node:crypto';

// A private maintenance script can mark its own synthetic case before creation.
// This only suppresses reporting; there is no public payment-bypass endpoint.
export const ACCEPTANCE_KEY='_intakeAcceptanceTest';
export const ACCEPTANCE_GATEWAY='acceptance_test';
export function acceptanceToken(caseId,secret) {
  return createHmac('sha256',secret).update('synthetic-acceptance:'+caseId).digest('hex');
}
export function validAcceptanceToken(caseId,token,secret) {
  if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(token),Buffer.from(acceptanceToken(caseId,secret)));
}
export function isAcceptanceCase(c,secret) {
  if(!c) return false;
  try {return validAcceptanceToken(c.id,JSON.parse(c.details_json || '{}')[ACCEPTANCE_KEY],secret);}catch{return false;}
}
