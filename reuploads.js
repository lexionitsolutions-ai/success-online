export const correctionStatuses = ['Correction Required', 'Awaiting Documents', 'Customer Action Required'];

export function reuploadMetadata(note) {
  try {
    const data=JSON.parse(note.next_action || '{}');
    if (!data || typeof data!=='object' || Array.isArray(data)) return {};
    return {...data,documentTypes:Array.isArray(data.documentTypes)?data.documentTypes:[],baselineDocumentIds:Array.isArray(data.baselineDocumentIds)?data.baselineDocumentIds:[],documentIds:Array.isArray(data.documentIds)?data.documentIds:[]};
  } catch { return {}; }
}

// Keep correction cycles in the existing case timeline, including the exact
// file IDs present when a reupload was requested and when sales submitted it.
export function reuploadState(item, documents, notes) {
  const active = documents.filter(doc => doc.state === 'uploaded' && doc.doc_type !== 'Received Document');
  const lastExit = notes.findLastIndex(note => note.new_status && !correctionStatuses.includes(note.new_status));
  const requests = notes.slice(lastExit + 1).filter(note =>
    reuploadMetadata(note).type === 'reupload_request' ||
    (correctionStatuses.includes(note.new_status) && !correctionStatuses.includes(note.old_status))
  );
  const pending = correctionStatuses.includes(item.status) && requests.length > 0;
  const requestedTypes = [...new Set(requests.flatMap(note => reuploadMetadata(note).documentTypes || []))];
  const newerThan = (doc, request) => {
    const metadata = reuploadMetadata(request);
    return doc.created_at >= request.created_at && !metadata.baselineDocumentIds?.includes(doc.id);
  };
  const requestFor = type => requests.filter(note => {
    const types = reuploadMetadata(note).documentTypes || [];
    return !types.length || types.includes(type);
  }).at(-1) || requests[0];
  const replacements = pending ? active.filter(doc => newerThan(doc, requestFor(doc.doc_type))) : [];
  const missingTypes = pending ? requestedTypes.filter(type => !replacements.some(doc => doc.doc_type === type)) : [];
  const submission = notes.findLast(note => reuploadMetadata(note).type === 'reupload_submission');
  const submittedIds = reuploadMetadata(submission || {}).documentIds || [];
  return {
    pending, requestedTypes, missingTypes,
    requestIds: requests.map(note => note.id),
    pendingDocumentIds: replacements.map(doc => doc.id),
    submittedDocumentIds: active.filter(doc => submittedIds.includes(doc.id)).map(doc => doc.id),
    canSubmit: pending && replacements.length > 0 && !missingTypes.length && item.document_state === 'complete'
  };
}
