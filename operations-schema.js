export const sheetHeaders = {
  'All Workings': ['SORO Number','Date','Client Name','Mobile Number','Work / Service','Salesperson','Document Status','Work Person','Total Amount (INR)','Amount Paid (INR)','Balance (INR)','Payment Mode','Payment Status','Work Status','Last Updated'],
  'Cash Flow': ['Date','Payment Description','Amount (INR)','Payment Mode','SORO Number','Client Name','Work / Service','Payment Reference','Payment Status']
};

const safe = value => typeof value === 'string' && /^[=+\-@\t\r\n]/.test(value) ? "'" + value : value;
const dateInIndia = value => {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? new Date(date.getTime()+330*60000).toISOString().slice(0,10) : '';
};
export function operationsRows(c, payments, refunds = []) {
  const confirmed=payments.filter(p=>p.gateway!=='demo' && ['PAID','verified','offline_approved','REFUNDED'].includes(p.status));
  const paid=confirmed.filter(p=>p.status!=='REFUNDED').reduce((sum,p)=>sum+p.amount,0);
  const total=c.amounts?.total || 0;
  const modes=[...new Set(confirmed.map(p=>p.payment_method).filter(Boolean))].join(', ') || c.payment?.payment_method || '';
  const paymentStatus=paid>0 ? (paid>=total ? 'PAID' : 'PARTIALLY PAID') : confirmed.some(p=>p.status==='REFUNDED') ? 'REFUNDED' : c.payment?.status || 'UNPAID';
  const working=[c.ref,dateInIndia(c.created_at),c.customer.name,c.customer.mobile,c.service.name,c.sales.name,c.document_state,c.backoffice?.name || 'Unassigned',total/100,paid/100,Math.max(0,total-paid)/100,modes,paymentStatus,c.status,c.updated_at].map(safe);
  const cash=[];
  for(const p of confirmed) {
    const description=c.service.name+' - '+c.customer.name;
    cash.push([p.id,[dateInIndia(p.verified_at || p.created_at),description,p.amount/100,p.payment_method || '',c.ref,c.customer.name,c.service.name,p.id,'PAID'].map(safe)]);
    if(p.status==='REFUNDED') {
      const refund=refunds.find(event=>event.payment_id===p.id);
      cash.push([p.id+':refund',[dateInIndia(refund?.created_at || p.updated_at || p.created_at),'Refund - '+description,-p.amount/100,p.payment_method || '',c.ref,c.customer.name,c.service.name,p.id+':refund','REFUNDED'].map(safe)]);
    }
  }
  return {working,cash};
}
