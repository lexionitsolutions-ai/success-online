import test from 'node:test';
import assert from 'node:assert/strict';
import {staffPerformance} from '../staff-performance.js';

const period={start:'2026-10-31T18:30:00.000Z',end:'2026-11-30T18:30:00.000Z'};
const employee=role=>({id:role,role,name:'Test Employee'});
const row=(id,changes={})=>({id,ref:id,customer_id:'customer',customer_name:'Test Customer',sales_user_id:'sales',backoffice_user_id:'backoffice',service_name:'Certificates',variant_name:'Income',variant_id:'income',created_at:'2026-11-01T00:00:00.000Z',status:'Assigned',...changes});
const receipt=(id,changes={})=>({case_id:id,status:'PAID',gateway:'direct_upi',amount:10000,service_charge:8000,tax:1000,official_fee:1000,verified_at:'2026-11-02T00:00:00.000Z',...changes});
const input={employee:employee('sales'),period,now:'2026-11-10T00:00:00.000Z',notes:[]};

test('sales separates period receipts from intake cohorts and excludes unpaid, demo and refunded cases',()=>{
  const report=staffPerformance({...input,cases:[row('new'),row('older',{created_at:'2026-10-01T00:00:00.000Z'}),row('unpaid'),row('demo'),row('refund'),row('other',{sales_user_id:'other'})],payments:[receipt('new'),receipt('older'),receipt('unpaid',{status:'AWAITING_VERIFICATION'}),receipt('demo',{gateway:'demo'}),receipt('refund',{status:'REFUNDED'}),receipt('other')]});
  assert.equal(report.metrics.cases,1);
  assert.equal(report.metrics.collected,20000);
  assert.equal(report.metrics.serviceRevenue,16000);
  assert.equal(report.metrics.tax,2000);
  assert.equal(report.metrics.officialFees,2000);
  assert.equal(report.metrics.averageSale,10000);
  assert.equal(report.metrics.active,2);
  assert.equal(report.services[0].cases,1);
  assert.equal(report.services[0].collected,20000);
  assert.deepEqual(report.cases.map(c=>c.id),['new']);
  assert.equal(report.trend[0].cases,1);
});

test('backoffice uses assignment dates, distinct correction cases, India due dates and period completions',()=>{
  const cases=[row('done',{created_at:'2026-10-01T00:00:00.000Z',status:'Closed',completed_at:'2026-11-02T18:29:59.000Z',due_date:'2026-11-02'}),row('old',{status:'Closed',completed_at:'2026-11-03T18:30:00.000Z',due_date:'2026-11-03'}),row('open',{due_date:'2026-11-09',follow_up_date:'2026-11-10'})];
  const notes=[{case_id:'done',actor_id:'backoffice',new_status:'Assigned',created_at:'2026-11-01T18:29:59.000Z'},{case_id:'old',actor_id:'backoffice',new_status:'Assigned',created_at:'2026-10-31T18:29:59.000Z'},...Array.from({length:2},()=>({case_id:'open',actor_id:'backoffice',new_status:'Correction Required',created_at:'2026-11-04T00:00:00.000Z'}))];
  const report=staffPerformance({...input,employee:employee('backoffice'),cases,payments:cases.map(c=>receipt(c.id)),notes});
  assert.equal(report.metrics.cases,2,'Done and legacy open case belong to November; October assignment does not');
  assert.equal(report.metrics.completed,2,'Includes older assignments completed in period');
  assert.equal(report.metrics.completionRate,50);
  assert.equal(report.metrics.onTimeRate,50,'18:30 UTC is the next day in India');
  assert.equal(report.metrics.onTimeEligible,2);
  assert.equal(report.metrics.correctionCases,1);
  assert.equal(report.metrics.overdue,1);
  assert.equal(report.metrics.followUps,1);
  assert.equal(report.metrics.legacyAssignments,1);
  assert.equal(report.metrics.active,1);
  assert.equal(report.cases.find(c=>c.id==='done').startedAt,notes[0].created_at);
});

test('empty reviews use unavailable rates and dates rather than inventing zero performance',()=>{
  const report=staffPerformance({...input,cases:[],payments:[]});
  assert.equal(report.metrics.cases,0);
  for(const key of ['averageSale','completionRate','turnaround','onTimeRate','oldestActiveDays']) assert.equal(report.metrics[key],null,key);
  assert.deepEqual(report.services,[]);
  assert.deepEqual(report.trend,[]);
});
