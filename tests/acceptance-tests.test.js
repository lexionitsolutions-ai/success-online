import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCEPTANCE_KEY,acceptanceToken,validAcceptanceToken,isAcceptanceCase} from '../acceptance-tests.js';
import {staffPerformance} from '../staff-performance.js';
import {operationsRows} from '../operations-schema.js';

test('synthetic-case authorization is bound to the case and private server secret',()=>{
  const token=acceptanceToken('case-one','private-test-secret');
  assert.ok(validAcceptanceToken('case-one',token,'private-test-secret'));
  assert.equal(validAcceptanceToken('case-two',token,'private-test-secret'),false);
  assert.equal(validAcceptanceToken('case-one',token,'different-secret'),false);
  for(const invalid of [null,{},'',token+'a','x'.repeat(64)]) assert.equal(validAcceptanceToken('case-one',invalid,'private-test-secret'),false);
  assert.ok(isAcceptanceCase({id:'case-one',details_json:JSON.stringify({[ACCEPTANCE_KEY]:token})},'private-test-secret'));
  assert.equal(isAcceptanceCase({id:'case-one',details_json:'invalid'},'private-test-secret'),false);
});

test('temporary acceptance receipts never count as finance or Sheets cash flow',()=>{
  const c={id:'case-one',ref:'TEST',created_at:'2026-11-11T00:00:00Z',updated_at:'2026-11-11T00:00:00Z',status:'Assigned',sales_user_id:'sales',customer:{name:'Synthetic',mobile:'9876543210'},service:{name:'Certificate'},sales:{name:'QA'},amounts:{total:140000}};
  const payment={case_id:c.id,gateway:'acceptance_test',amount:140000,service_charge:140000,tax:0,official_fee:0,status:'PAID',verified_at:'2026-11-11T00:00:00Z'};
  const sheet=operationsRows(c,[payment]);assert.deepEqual(sheet.cash,[]);assert.equal(sheet.working[9],0);
  const performance=staffPerformance({employee:{id:'sales',role:'sales',name:'QA'},cases:[c],payments:[payment],notes:[],period:{start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'}});
  assert.equal(performance.metrics.collected,0);assert.equal(performance.metrics.cases,0);
});
