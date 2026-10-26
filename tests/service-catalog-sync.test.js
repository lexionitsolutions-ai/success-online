import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { syncServiceForms } from '../service-catalog-sync.js';
import { serviceCatalog } from '../service-catalog.js';

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
