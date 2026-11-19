import {cashAccount} from './cash-payments.js';
export const DISCOUNT_KEY='_intakeDiscount';
export function validateDiscount(user,value,amounts) {
  if(!cashAccount(user)) throw Object.assign(new Error('Discounts are available only for Success Online Main Branch sales.'),{status:403});
  if(!Number.isSafeInteger(value) || value<0 || value>amounts.serviceCharge || amounts.total-value<1) throw Object.assign(new Error('Enter a valid discount no greater than the service charge, leaving a positive total payable.'),{status:400});
  return value;
}
export function discountedAmounts(amounts,details={}) {
  const discount=details[DISCOUNT_KEY]?.amount || 0;
  return {...amounts,serviceCharge:amounts.serviceCharge-discount,total:amounts.total-discount,discount};
}
