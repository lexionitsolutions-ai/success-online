import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ensureGazettePricingOptions} from '../service-options.js';

test('existing Gazette Application upgrades to two priced options without changing cases or other services',async()=>{
  const sql=new DatabaseSync(':memory:');
  sql.exec(`
    CREATE TABLE services(id TEXT PRIMARY KEY,slug TEXT);
    CREATE TABLE variants(id TEXT PRIMARY KEY,service_id TEXT,name TEXT,service_charge INTEGER,official_fee INTEGER,tax_rate INTEGER,fields_json TEXT,documents_json TEXT,instructions TEXT,sla_days INTEGER,active INTEGER);
    CREATE TABLE service_prices(variant_id TEXT PRIMARY KEY,price INTEGER,original_price INTEGER,original_config TEXT);
    CREATE TABLE salesperson_prices(sales_user_id TEXT,variant_id TEXT,price INTEGER,updated_by TEXT NOT NULL,updated_at TEXT,PRIMARY KEY(sales_user_id,variant_id));
    CREATE TABLE cases(id TEXT,variant_id TEXT);
    INSERT INTO services VALUES ('gazette','gazette'),('other','pan');
    INSERT INTO variants VALUES ('legacy','gazette','Application',50000,1000,0,'[]','[]','Legacy form',1,1),('other','other','Application',10000,0,0,'[]','[]','Other',1,1);
    INSERT INTO service_prices VALUES ('legacy',55000,50000,'{"officialFee":1000,"taxRate":0}');
    INSERT INTO salesperson_prices VALUES ('sales','legacy',65000,'admin','2026-11-19');
    INSERT INTO cases VALUES ('old-case','legacy');
  `);
  let writes=0;
  const db={
    one:async(q,p={})=>sql.prepare(q).get(p),all:async(q,p={})=>sql.prepare(q).all(p),
    run:async(q,p={})=>{writes++;return sql.prepare(q).run(p);},
    transaction:async fn=>{sql.exec('BEGIN');try{const result=await fn();sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}
  };
  try {
    assert.equal(await ensureGazettePricingOptions(db),true);
    const options=await db.all("SELECT * FROM variants WHERE service_id='gazette' AND active=1 ORDER BY name");
    assert.deepEqual(options.map(v=>v.name),['With affidavit charges','Without affidavit charges']);
    for(const v of options) {
      assert.equal(v.service_charge,50000);assert.equal(v.official_fee,1000);
      assert.equal((await db.one('SELECT price FROM service_prices WHERE variant_id=$id',{$id:v.id})).price,55000);
      assert.equal((await db.one('SELECT price FROM salesperson_prices WHERE variant_id=$id',{$id:v.id})).price,65000);
    }
    assert.equal((await db.one("SELECT variant_id FROM cases WHERE id='old-case'")).variant_id,'legacy');
    assert.equal((await db.one("SELECT active FROM variants WHERE id='legacy'")).active,0);
    assert.equal((await db.one("SELECT active FROM variants WHERE id='other'")).active,1);
    await db.run('UPDATE salesperson_prices SET price=70000 WHERE variant_id=$id',{$id:options[0].id});
    const before=writes;assert.equal(await ensureGazettePricingOptions(db),false);assert.equal(writes,before);
    assert.equal((await db.one('SELECT price FROM salesperson_prices WHERE variant_id=$id',{$id:options[0].id})).price,70000);
  } finally {sql.close();}
});
