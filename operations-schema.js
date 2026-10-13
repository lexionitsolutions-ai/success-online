import { serviceCatalog } from './service-catalog.js';
export const serviceTabs = Object.fromEntries(serviceCatalog.map(service => [service.name, service.name.slice(0, 31)]));
export const sheetHeaders = {
  'All Cases': ['Case ID','Customer Name','Phone','Service','Created Date','Sales Employee','Back Office Employee','Document State','Payment State','Work Status','Last Updated','Next Follow-up','Completed Date','Required Documents','Uploaded Required Documents','Missing Documents','Drive Folder'],
  'Documents': ['Document ID','Case ID','Document Type','File Name','MIME Type','Bytes','Version','State','Uploaded At','Drive File'],
  'Cashflow': ['Date','Case ID','Type','Transaction Reference','Service Charge','Official Fee','Tax','Total','Status'],
  'Payments': ['Payment ID','Date','Order ID','Customer Name','Mobile Number','Service','Amount','Payment Method','UTR','Payment Status','Sales Employee','Verified By','Verified At'],
  'Payment History': ['Event ID','Payment ID','Action','Method','UTR','Actor ID','Notes','Date'],
  'Daily Report': ['Date','New Cases','Payments','Collections','Completed Cases','Pending Cases','Overdue Cases'],
  'Staff Performance': ['Employee','Role','Cases','Collections','Assignments','Completions','Average Ageing'],
  'Sync Log': ['Time','Type','Entity','Status','Attempts','Error'],
  ...Object.fromEntries(Object.values(serviceTabs).map(tab => [tab, ['Case ID','Customer Name','Phone','Service','Status','Payment','Documents','Updated']]))
};
