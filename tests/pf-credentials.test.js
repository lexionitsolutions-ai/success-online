import test from 'node:test';
import assert from 'node:assert/strict';
import { PF_PASSWORD_KEY, encryptPFPassword, decryptPFPassword, publicCaseDetails } from '../pf-credentials.js';

test('PF passwords are encrypted, bound to their case and absent from public details', () => {
  const password = 'Synthetic PF password!23', secret = 'test-secret-with-sufficient-entropy';
  const encrypted = encryptPFPassword(password, secret, 'case-a');
  assert.ok(!encrypted.includes(password));
  assert.equal(decryptPFPassword(encrypted, secret, 'case-a'), password);
  assert.notEqual(encryptPFPassword(password, secret, 'case-a'), encrypted);
  assert.throws(() => decryptPFPassword(encrypted, secret, 'case-b'));
  assert.throws(() => decryptPFPassword(encrypted, 'other-secret', 'case-a'));
  const visible = publicCaseDetails({ 'UAN No':'123456789012', [PF_PASSWORD_KEY]:encrypted });
  assert.equal(visible[PF_PASSWORD_KEY], undefined);
  assert.notEqual(visible.Password, password);
  assert.ok(!JSON.stringify(visible).includes(encrypted));
});
