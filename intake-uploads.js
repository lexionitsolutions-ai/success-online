export const INTAKE_UPLOADS = '_intakeUploads';
export function createUploadBatch(manifest, requirements, details, matches) {
  if (manifest === undefined) return null;
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 200) throw Object.assign(new Error('Choose between 1 and 200 files.'), {status:400});
  const allowed = requirements.filter(doc => matches(doc.when, details));
  const keys = new Set(), counts = new Map();
  const files = manifest.map(file => {
    const requirement = allowed.find(doc => doc.label === file.docType);
    if (!requirement || typeof file.key !== 'string' || file.key.length > 160 || !file.key || keys.has(file.key) || typeof file.fileName !== 'string' || !file.fileName || file.fileName.length > 255 || !['image/jpeg','image/png','application/pdf'].includes(file.mimeType) || !Number.isInteger(file.size) || file.size < 1 || file.size > 10_000_000) throw Object.assign(new Error('Invalid selected document manifest.'), {status:400});
    keys.add(file.key);
    counts.set(file.docType, (counts.get(file.docType) || 0) + 1);
    if (!requirement.multiple && counts.get(file.docType) > 1) throw Object.assign(new Error(`Select only one file for ${file.docType}.`), {status:400});
    return {key:file.key,docType:file.docType,fileName:file.fileName,mimeType:file.mimeType,size:file.size};
  });
  if (allowed.some(doc => doc.required && !counts.has(doc.label))) throw Object.assign(new Error('Select every required document before creating the case.'), {status:400});
  return {files,finalized:false};
}
export function uploadBatchState(details, documents) {
  const batch = details[INTAKE_UPLOADS];
  if (!batch) return null;
  const active = new Set(documents.filter(doc => doc.state !== 'replaced').map(doc => doc.id));
  const completed = batch.finalized ? batch.files.length : batch.files.filter(file => file.documentId && active.has(file.documentId)).length;
  return {total:batch.files.length,completed,finalized:batch.finalized === true,complete:batch.finalized === true && completed === batch.files.length};
}
export function uploadManifestEntry(details, key, metadata) {
  if (!key) return null;
  const file = details[INTAKE_UPLOADS]?.files.find(file => file.key === key);
  if (!file || file.docType !== metadata.docType || file.fileName !== metadata.fileName || file.mimeType !== metadata.mimeType || file.size !== Number(metadata.size)) throw Object.assign(new Error('This file does not match the saved upload manifest.'), {status:400});
  return file;
}
