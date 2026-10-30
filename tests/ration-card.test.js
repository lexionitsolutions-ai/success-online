import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceCatalog } from '../service-catalog.js';
import '../public/intake-rules.js';

const ration = serviceCatalog.find(service => service.slug === 'ration-card');
const changes = ['Add a member?', 'Add a member due to marriage?', 'Remove a member?', 'Remove a member due to marriage?', 'Change ration card address?'];
const visibleDocs = details => ration.documents.filter(doc => IntakeRules.matches(doc.when, details));

test('Ration Card supports every combination of five changes, housing, card colour and removal reason', () => {
  for (let mask = 0; mask < 32; mask++) for (const home of ['Owned', 'Rented']) for (const white of ['Yes', 'No']) for (const reason of ['Death', 'Separation']) {
    const details = Object.fromEntries(changes.map((label, index) => [label, mask & (1 << index) ? 'Yes' : 'No']));
    Object.assign(details, { 'Ration card residence': home, 'Is the ration card white?': white, 'Reason for member removal': reason });
    const docs = visibleDocs(details), labels = docs.map(doc => doc.label);
    for (const label of ['Ration Card', 'All Members Aadhaar Cards', 'All Members PAN Cards', 'All Members Photos', 'Gas Passbook', 'Ration Shop A.B.C. Certificate', 'Female Head Bank Passbook']) assert.ok(labels.includes(label), label);
    assert.ok(docs.every(doc => doc.required));
    assert.equal(new Set(labels).size, labels.length, 'No duplicate upload slots');
    const expected = [
      ['Member Addition Aadhaar Card', details[changes[0]] === 'Yes'],
      ['Member Addition Birth Certificate', details[changes[0]] === 'Yes'],
      ['Marriage Addition Aadhaar Card', details[changes[1]] === 'Yes'],
      ['Marriage Addition Name Removal Certificate', details[changes[1]] === 'Yes'],
      ['Marriage Addition Wedding Invitation', details[changes[1]] === 'Yes'],
      ['Death Certificate / Separation Application', details[changes[2]] === 'Yes'],
      ['Marriage Removal Aadhaar Card', details[changes[3]] === 'Yes'],
      ['Marriage Removal Wedding Invitation', details[changes[3]] === 'Yes'],
      ['Address Change Proof', details[changes[4]] === 'Yes'],
      ['Electricity Bill', details[changes[4]] === 'No'],
      ['Consent Letter / Rent Agreement', home === 'Rented'],
      ['ITR / Form 16 / Pension Statement', white === 'Yes']
    ];
    for (const [label, present] of expected) assert.equal(labels.includes(label), present, label);
    assert.equal(docs.filter(doc => ['Electricity Bill', 'Address Change Proof'].includes(doc.label)).length, 1);
  }
});

test('one answered Ration Card question is enough and unanswered questions add no conditional proofs', () => {
  for (const label of changes) {
    const question = ration.fields.find(field => field.label === label);
    assert.deepEqual(question.options, ['Yes', 'No']);
    assert.equal(question.optional, true);
    assert.equal(question.when, undefined);
  }
  assert.equal(IntakeRules.missingAnswerGroups(ration.fields, {}).length, 1);
  for (const label of changes) {
    for (const answer of ['Yes', 'No']) assert.equal(IntakeRules.missingAnswerGroups(ration.fields, {[label]:answer}).length, 0);
  }
  const docs = ration.documents.filter(doc => IntakeRules.matches(doc.when, {'Add a member?':'Yes'}, true)).map(doc => doc.label);
  assert.equal(docs.length, 10);
  assert.ok(docs.includes('Member Addition Birth Certificate'));
  assert.ok(docs.includes('Member Addition Aadhaar Card'));
  assert.ok(!docs.includes('ITR / Form 16 / Pension Statement'));
  assert.ok(!docs.includes('Consent Letter / Rent Agreement'));
  assert.ok(ration.documents.slice(0, 4).every(doc => doc.multiple));
});
