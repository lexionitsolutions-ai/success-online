import { serviceCatalog } from './service-catalog.js';

// Refresh form definitions without changing service IDs, prices or case records.
export async function syncServiceForms(db) {
  const rows = await db.all('SELECT v.id,v.name,v.fields_json,v.documents_json,v.instructions,s.slug,s.id service_id,s.name service_name FROM variants v JOIN services s ON s.id=v.service_id WHERE v.active=1 AND s.active=1');
  const catalog = new Map(serviceCatalog.map(service => [service.slug, service]));
  let updated = 0;
  await db.transaction(async () => {
    for (const row of rows) {
      const service = catalog.get(row.slug);
      if (!service || row.name !== (service.variant || 'Application')) continue;
      if (row.service_name !== service.name) await db.run('UPDATE services SET name=$name WHERE id=$id', {$name:service.name,$id:row.service_id});
      const fields = JSON.stringify(service.fields || []);
      const documents = JSON.stringify(service.documents || []);
      const instructions = service.instructions || 'Required documents follow the client-provided checklist. Confirm current requirements and fees before submission.';
      if (row.fields_json === fields && row.documents_json === documents && row.instructions === instructions) continue;
      await db.run('UPDATE variants SET fields_json=$fields,documents_json=$documents,instructions=$instructions WHERE id=$id', {
        $fields: fields, $documents: documents, $instructions: instructions, $id: row.id
      });
      updated++;
    }
  });
  return updated;
}
