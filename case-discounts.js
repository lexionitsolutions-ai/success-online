import {cashAccount} from './cash-payments.js';
export const DISCOUNT_KEY='_intakeDiscount';
export const ADDITIONAL_PAYMENT_KEY='_intakeAdditionalPayment';
export function validateAdditionalPayment(user,value) {
  if(!cashAccount(user)) throw Object.assign(new Error('Additional payments are available only for Success Online Main Branch sales.'),{status:403});
  if(!Number.isSafeInteger(value) || value<0 || value>100000000) throw Object.assign(new Error('Enter an additional payment from 0 to 1,000,000 rupees, with at most two decimal places.'),{status:400});
  return value;
}
export function validateDiscount(user,value,amounts) {
  if(!cashAccount(user)) throw Object.assign(new Error('Discounts are available only for Success Online Main Branch sales.'),{status:403});
  if(!Number.isSafeInteger(value) || value<0 || value>amounts.serviceCharge || amounts.total-value<1) throw Object.assign(new Error('Enter a valid discount no greater than the service charge, leaving a positive total payable.'),{status:400});
  return value;
}
export function discountedAmounts(amounts,details={}) {
  const discount=details[DISCOUNT_KEY]?.amount || 0;
  const additionalPayment=details[ADDITIONAL_PAYMENT_KEY]?.amount || 0;
  if(additionalPayment && (!Number.isSafeInteger(amounts.total-discount+additionalPayment) || amounts.total-discount+additionalPayment>100000000)) throw Object.assign(new Error('The total payable cannot exceed 1,000,000 rupees.'),{status:400});
  return {...amounts,serviceCharge:amounts.serviceCharge-discount+additionalPayment,total:amounts.total-discount+additionalPayment,discount,additionalPayment};
}
