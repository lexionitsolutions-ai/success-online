import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { syncServiceForms, currentServiceForms, applyCurrentServiceForm } from '../service-catalog-sync.js';
import { serviceCatalog } from '../service-catalog.js';

test('current forms survive an older deployment overwriting shared definitions without changing prices or custom variants',()=>{
  const forms=currentServiceForms([{id:'gazette-1',name:'Application',slug:'gazette'},{id:'custom-1',name:'Custom',slug:'gazette'}]);
  const old={id:'gazette-1',fields_json:'[{"label":"Old first name (Marathi)"}]',documents_json:'[]',instructions:'Old wording',service_charge:12345};
  const current=applyCurrentServiceForm(old,forms);
  assert.equal(current.service_charge,12345);
  assert.equal(current.id,old.id);
  assert.equal(JSON.parse(current.fields_json).filter(field=>field.marathiInput).length,2);
  assert.ok(JSON.parse(current.fields_json).some(field=>field.label==='Old full name (Marathi)'));
  assert.equal(old.instructions,'Old wording','Reads never write shared definitions');
  assert.deepEqual(applyCurrentServiceForm({...old,id:'custom-1'},forms),{...old,id:'custom-1'});
  assert.equal(applyCurrentServiceForm({id:'gazette-1',documents_json:'[]'},forms).fields_json,undefined);
});

test('existing cloud form definitions refresh without changing prices or identifiers', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec(`CREATE TABLE services (id TEXT, slug TEXT, active INTEGER, name TEXT);
      CREATE TABLE variants (id TEXT, service_id TEXT, name TEXT, active INTEGER, fields_json TEXT, documents_json TEXT, instructions TEXT, service_charge INTEGER);
      INSERT INTO services VALUES ('service-1','passport',1,'Passport');
      INSERT INTO variants VALUES ('variant-1','service-1','Application',1,'[]','[]','Old instructions',12345);`);
    const db = {
      all: async sql => sqlite.prepare(sql).all(),
      run: async (sql, params) => sqlite.prepare(sql).run(params),
      transaction: async fn => fn()
    };
    assert.equal(await syncServiceForms(db), 1);
    const row = sqlite.prepare('SELECT * FROM variants').get();
    const passport = serviceCatalog.find(service => service.slug === 'passport');
    assert.deepEqual(JSON.parse(row.fields_json), passport.fields);
    assert.equal(row.documents_json, JSON.stringify(passport.documents));
    assert.equal(row.service_charge, 12345);
    assert.equal(row.id, 'variant-1');
    assert.equal(row.service_id, 'service-1');
    assert.equal(await syncServiceForms(db), 0);
  } finally {
    sqlite.close();
  }
});
