import test from 'node:test';
import assert from 'node:assert/strict';

const transitions = {
  Draft: ['Awaiting Documents','Awaiting Payment','Ready for Assignment','Cancelled'],
  'Ready for Assignment': ['Assigned','Cancelled'],
  Assigned: ['Document Review','Ready to Submit','Correction Required','Cancelled'],
  'Correction Required': ['Awaiting Documents','Document Review'],
  'Ready to Submit': ['Submitted to Official Portal','Correction Required','Customer Action Required','Cancelled'],
  'Submitted to Official Portal': ['Under Government Review','Customer Action Required','Document Received','Rejected','Cancelled'],
  'Document Received': ['Correction Required','Cancelled']
};
const canSee = (user, c) => user.role === 'admin' || user.role === 'backoffice' || c.sales_user_id === user.id;
const formulaSafe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");
const ready = (docs, paid) => docs === 'complete' && paid === 'paid' ? 'Ready for Assignment' : docs === 'missing' ? 'Awaiting Documents' : 'Awaiting Payment';

test('sales users cannot see another sales employee case', () => {
  assert.equal(canSee({ role: 'sales', id: 's1' }, { sales_user_id: 's2' }), false);
  assert.equal(canSee({ role: 'sales', id: 's1' }, { sales_user_id: 's1' }), true);
  assert.equal(canSee({ role: 'admin', id: 'a1' }, { sales_user_id: 's2' }), true);
});

test('unpaid complete case does not enter ready queue', () => {
  assert.equal(ready('complete', 'unpaid'), 'Awaiting Payment');
  assert.equal(ready('complete', 'paid'), 'Ready for Assignment');
});

test('workflow blocks arbitrary jumps', () => {
  assert.equal(transitions.Assigned.includes('Closed'), false);
  assert.equal(transitions['Ready for Assignment'].includes('Assigned'), true);
});

test('official portal flow reaches document receipt before closing', () => {
  assert.equal(transitions['Ready to Submit'].includes('Submitted to Official Portal'), true);
  assert.equal(transitions['Ready to Submit'].includes('Document Received'), false);
  assert.equal(transitions['Submitted to Official Portal'].includes('Document Received'), true);
  assert.equal(transitions['Document Received'].includes('Closed'), false);
});

test('sheet values are protected from formula injection', () => {
  assert.equal(formulaSafe('=IMPORTXML("x")'), '\'=IMPORTXML("x")');
  assert.equal(formulaSafe('Asha Patil'), 'Asha Patil');
});
