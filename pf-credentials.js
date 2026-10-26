import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export const PF_PASSWORD_KEY = '_pfPassword';
const keyFor = secret => createHash('sha256').update(`success-online:pf-password:${secret}`).digest();
export function encryptPFPassword(password, secret, caseId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret), iv);
  cipher.setAAD(Buffer.from(caseId));
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64')).join('.');
}
export function decryptPFPassword(encrypted, secret, caseId) {
  const [iv, tag, ciphertext] = encrypted.split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', keyFor(secret), iv);
  decipher.setAAD(Buffer.from(caseId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
export function publicCaseDetails(details) {
  const visible = Object.fromEntries(Object.entries(details).filter(([key]) => key !== PF_PASSWORD_KEY && !/password/i.test(key)));
  if (details[PF_PASSWORD_KEY]) visible.Password = '••••••••';
  return visible;
}
