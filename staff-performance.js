const paidStatuses = new Set(['PAID','verified','offline_approved']);
const closed = c => ['Closed','Delivered'].includes(c.status);
const open = c => !['Closed','Delivered','Rejected','Cancelled'].includes(c.status);
const round = n => Math.round(n * 10) / 10;
const average = values => values.length ? round(values.reduce((a,b)=>a+b,0) / values.length) : null;
const day = value => new Date(Date.parse(value) + 330 * 60000).toISOString().slice(0,10);

export function staffPerformance({employee, cases, payments, notes, period, now = new Date().toISOString()}) {
  const within = value => !!value && value >= period.start && value < period.end;
  const paid = payments.filter(p=>paidStatuses.has(p.status) && !['demo','acceptance_test'].includes(p.gateway));
  const paidIds = new Set(paid.map(p=>p.case_id));
  const role = employee.role;
  const owned = cases.filter(c=>paidIds.has(c.id) && c[role === 'sales' ? 'sales_user_id' : 'backoffice_user_id'] === employee.id);
  const ownedIds = new Set(owned.map(c=>c.id));
  const ownedById = new Map(owned.map(c=>[c.id,c]));
  const events = notes.filter(n=>ownedIds.has(n.case_id));
  const assignments = new Map();
  for(const n of events) {
    if(n.actor_id===employee.id && n.new_status==='Assigned' && (!assignments.has(n.case_id) || n.created_at<assignments.get(n.case_id))) assignments.set(n.case_id,n.created_at);
  }
  const assigned = c => assignments.get(c.id);
  const started = c => role === 'sales' ? c.created_at : assigned(c) || c.created_at;
  const cohort = owned.filter(c=>within(started(c)));
  const completed = owned.filter(c=>closed(c) && within(c.completed_at));
  const active = owned.filter(open);
  const currentDay = day(now);
  const overdue = c => open(c) && c.due_date && c.due_date < currentDay;
  const receipts = paid.filter(p=>ownedIds.has(p.case_id) && within(p.verified_at || p.created_at));
  const total = (rows,key) => rows.reduce((sum,p)=>sum+Number(p[key] || 0),0);
  const collected = total(receipts,'amount');
  const completedCohort = cohort.filter(closed);
  const duration = c => Math.max(0,(Date.parse(c.completed_at)-Date.parse(started(c))) / 86400000);
  const onTime = completed.filter(c=>c.due_date);
  const corrections = new Set(events.filter(n=>n.new_status==='Correction Required' && within(n.created_at)).map(n=>n.case_id));
  const groups = new Map();
  for (const c of cohort) {
    const key=c.variant_id;
    if(!groups.has(key)) groups.set(key,{id:key,service:c.service_name,variant:c.variant_name,cases:0,completed:0,active:0,rejected:0,cancelled:0,collected:0});
    const row=groups.get(key);row.cases++;row.completed+=Number(closed(c));row.active+=Number(open(c));row.rejected+=Number(c.status==='Rejected');row.cancelled+=Number(c.status==='Cancelled');
  }
  // Collections use receipt dates, even for cases opened before this period.
  for(const p of receipts) {
    const c=ownedById.get(p.case_id),key=c.variant_id;
    if(!groups.has(key)) groups.set(key,{id:key,service:c.service_name,variant:c.variant_name,cases:0,completed:0,active:0,rejected:0,cancelled:0,collected:0});
    groups.get(key).collected+=Number(p.amount);
  }
  const statuses = new Map();
  for(const c of cohort) statuses.set(c.status,(statuses.get(c.status)||0)+1);
  const months=new Map();
  const month=value=>day(value).slice(0,7);
  const bucket=value=>{const key=month(value);if(!months.has(key)) months.set(key,{bucket:key,cases:0,completed:0,collected:0});return months.get(key);};
  for(const c of cohort) bucket(started(c)).cases++;
  for(const c of completed) bucket(c.completed_at).completed++;
  for(const p of receipts) bucket(p.verified_at || p.created_at).collected+=Number(p.amount);
  return {
    employee,period,
    metrics:{cases:cohort.length,completed:completed.length,cohortCompleted:completedCohort.length,completionRate:cohort.length?round(completedCohort.length/cohort.length*100):null,
      collected,serviceRevenue:total(receipts,'service_charge'),tax:total(receipts,'tax'),officialFees:total(receipts,'official_fee'),averageSale:receipts.length?Math.round(collected/new Set(receipts.map(p=>p.case_id)).size):null,
      customers:new Set(cohort.map(c=>c.customer_id)).size,active:active.length,overdue:active.filter(overdue).length,
      followUps:active.filter(c=>c.follow_up_date && c.follow_up_date<=currentDay).length,
      correctionCases:corrections.size,rejected:cohort.filter(c=>c.status==='Rejected').length,cancelled:cohort.filter(c=>c.status==='Cancelled').length,
      turnaround:average(completed.map(duration)),onTimeRate:onTime.length?round(onTime.filter(c=>day(c.completed_at)<=c.due_date).length/onTime.length*100):null,
      onTimeEligible:onTime.length,oldestActiveDays:active.length?round(Math.max(...active.map(c=>Math.max(0,(Date.parse(now)-Date.parse(started(c)))/86400000)))):null,
      legacyAssignments:role==='backoffice'?owned.filter(c=>!assigned(c)).length:0},
    services:[...groups.values()].sort((a,b)=>b.cases-a.cases || a.service.localeCompare(b.service)),
    statuses:[...statuses].map(([status,count])=>({status,count})),trend:[...months.values()].sort((a,b)=>a.bucket.localeCompare(b.bucket)),
    cases:cohort.sort((a,b)=>started(b).localeCompare(started(a))).map(c=>({id:c.id,ref:c.ref,customer:c.customer_name,service:c.service_name,variant:c.variant_name,status:c.status,startedAt:started(c),completedAt:c.completed_at,dueDate:c.due_date,overdue:!!overdue(c)}))
  };
}
