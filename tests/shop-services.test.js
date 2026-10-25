import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {splitShopServices} from '../scripts/split-shop-services.js';

test('splitting Shop Act preserves existing links and prices and can be rerun safely', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    one: async (sql, params={})=>sqlite.prepare(sql).get(params),
    run: async (sql, params={})=>sqlite.prepare(sql).run(params),
    transaction: async work=>{sqlite.exec('BEGIN');try {await work();sqlite.exec('COMMIT');} catch(error) {sqlite.exec('ROLLBACK');throw error;}}
  };
  try {
    sqlite.exec(`
      CREATE TABLE services (id TEXT PRIMARY KEY,name TEXT,slug TEXT UNIQUE,active INTEGER,description TEXT,official_url TEXT,processing_period TEXT,admin_review_required INTEGER);
      CREATE TABLE variants (id TEXT PRIMARY KEY,service_id TEXT,name TEXT,service_charge INTEGER,official_fee INTEGER,tax_rate REAL,fields_json TEXT,documents_json TEXT,instructions TEXT,checklist_version INTEGER,active INTEGER);
      CREATE TABLE service_prices (variant_id TEXT PRIMARY KEY,price INTEGER,original_price INTEGER,original_config TEXT);
      CREATE TABLE cases (id TEXT,service_id TEXT,variant_id TEXT);
      CREATE TABLE documents (id TEXT,case_id TEXT,doc_type TEXT);
      CREATE TABLE payments (id TEXT,case_id TEXT,amount INTEGER);
      INSERT INTO services VALUES ('old-shop','Shop Act / Udyam Aadhaar','shop-act-udyam',1,'','','',1);
      INSERT INTO variants VALUES ('old-variant','old-shop','Application',25000,0,0,'[]','[]','',1,1);
      INSERT INTO service_prices VALUES ('old-variant',28000,25000,'{"serviceCharge":25000,"officialFee":0,"taxRate":0}');
      INSERT INTO cases VALUES ('case-one','old-shop','old-variant');
      INSERT INTO documents VALUES ('doc-one','case-one','Owner Aadhaar Card');
      INSERT INTO payments VALUES ('payment-one','case-one',25000);
    `);
    const original = Object.fromEntries(['cases','documents','payments','service_prices'].map(table=>[table,sqlite.prepare(`SELECT * FROM ${table}`).all()]));
    await splitShopServices(db);
    await splitShopServices(db);
    assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM services WHERE active=1').get().n,2);
    assert.equal(sqlite.prepare("SELECT id FROM services WHERE slug='shop-act'").get().id,'old-shop');
    for (const table of ['cases','documents','payments']) assert.deepEqual(sqlite.prepare(`SELECT * FROM ${table}`).all(),original[table]);
    assert.deepEqual(sqlite.prepare("SELECT * FROM service_prices WHERE variant_id='old-variant'").get(),original.service_prices[0]);
    const udyam = sqlite.prepare("SELECT v.* FROM variants v JOIN services s ON s.id=v.service_id WHERE s.slug='udyam-aadhaar'").get();
    assert.equal(sqlite.prepare('SELECT price FROM service_prices WHERE variant_id=?').get(udyam.id).price,28000);
    const fields=JSON.parse(sqlite.prepare("SELECT fields_json FROM variants WHERE id='old-variant'").get().fields_json);
    assert.ok(fields.some(field=>field.label==='Male workers'));
    assert.ok(fields.some(field=>field.label==='Female workers'));
  } finally {sqlite.close();}
});
