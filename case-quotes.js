export const QUOTE_KEY = '_intakeQuote';
export const quotedServices = ['passport', 'pf-assistance', 'ration-card'];
export function caseQuote(c) {
  try { return JSON.parse(c.details_json || '{}')[QUOTE_KEY] || null; } catch { return null; }
}
export const quoteVisible = c => !!caseQuote(c)?.submittedAt && !['Deleted','Cancelled'].includes(c.status);
export const quoteAmounts = quote => ({serviceCharge:quote?.amount || 0,officialFee:0,tax:0,total:quote?.amount || 0});
