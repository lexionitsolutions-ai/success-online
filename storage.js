import { createClient } from '@supabase/supabase-js';
let client;
export const storageEnabled = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
export const bucketName = () => process.env.SUPABASE_STORAGE_BUCKET || 'case-documents';
export const downloadBucketName = () => process.env.SUPABASE_DOWNLOAD_BUCKET || 'case-downloads';
export function downloadFileLimit() {
  const limit = Number(process.env.SUPABASE_DOWNLOAD_MAX_BYTES || 50000000);
  if (!Number.isSafeInteger(limit) || limit < 10000000) throw new Error('SUPABASE_DOWNLOAD_MAX_BYTES must be an integer of at least 10000000 bytes.');
  return limit;
}
export function storage(path = '') {
  if (!storageEnabled()) throw Object.assign(new Error('Configure SUPABASE_URL and SUPABASE_SECRET_KEY for private document storage.'), {status:503});
  client ||= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  return client.storage.from(path.startsWith('downloads') ? downloadBucketName() : bucketName());
}
export async function signedDownload(path, name) {
  const { data, error } = await storage(path).createSignedUrl(path, 120, {download:name || true});
  if (error) throw Object.assign(new Error('Could not prepare a private document download.'), {status:502});
  return data.signedUrl;
}
export async function signedPreview(path) {
  const { data, error } = await storage(path).createSignedUrl(path, 120);
  if (error) throw Object.assign(new Error('Could not prepare a private document preview.'), {status:502});
  return data.signedUrl;
}
export async function readStorage(path) {
  const { data, error } = await storage(path).download(path);
  if (error) throw Object.assign(new Error('Stored document could not be read.'), {status:502});
  return Buffer.from(await data.arrayBuffer());
}
export async function writeStorage(path, content, mimeType) {
  if (path.startsWith('downloads') && content.length > downloadFileLimit()) throw Object.assign(new Error('Case ZIP exceeds the configured download size limit. Download the documents individually.'), {status:413});
  const { error } = await storage(path).upload(path, content, {contentType:mimeType,upsert:false});
  if (error) throw Object.assign(new Error('Document could not be saved to private storage.'), {status:502});
  return path;
}
