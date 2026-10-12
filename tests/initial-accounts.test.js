import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { configureInitialAccounts } from '../initial-accounts.js';
import { postgresQuery } from '../database.js';

test('explicit setup creates three staff roles, hashes passwords and safely updates the same accounts', async () => {
  const engine = new PGlite();
  const keys = ['ADMIN','SALES','BACKOFFICE'].flatMap(role=>[`INITIAL_${role}_USERNAME`,`INITIAL_${role}_PASSWORD`]);
  const previous = Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const db = {
    one: async (sql,params) => {const {text,values}=postgresQuery(sql,params);return (await engine.query(text,values)).rows[0];},
    run: async (sql,params) => {const {text,values}=postgresQuery(sql,params);return engine.query(text,values);}
  };
  try {
    await engine.exec('CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT UNIQUE,name TEXT,role TEXT,password_hash TEXT,active INTEGER,created_at TEXT)');
    for (const role of ['ADMIN','SALES','BACKOFFICE']) {
      process.env[`INITIAL_${role}_USERNAME`] = 'test.'+role.toLowerCase();
      process.env[`INITIAL_${role}_PASSWORD`] = 'Test123456';
    }
    await configureInitialAccounts(db);
    const first = (await engine.query('SELECT * FROM users ORDER BY role')).rows;
    assert.deepEqual(first.map(row=>row.role),['admin','backoffice','sales']);
    for (const row of first) {
      const [salt,hash]=row.password_hash.split(':');
      assert.equal(hash,scryptSync('Test123456',salt,32).toString('hex'));
      assert.equal(row.active,1);
    }
    process.env.INITIAL_ADMIN_PASSWORD='Changed12345';
    await configureInitialAccounts(db);
    const second = (await engine.query('SELECT * FROM users ORDER BY role')).rows;
    assert.deepEqual(second.map(row=>row.id),first.map(row=>row.id));
    assert.equal(second.length,3);
    const [salt,hash]=second[0].password_hash.split(':');
    assert.equal(hash,scryptSync('Changed12345',salt,32).toString('hex'));
    process.env.INITIAL_SALES_USERNAME=process.env.INITIAL_ADMIN_USERNAME;
    await assert.rejects(configureInitialAccounts(db),/another role/);
  } finally {
    for (const key of keys) {if (previous[key]===undefined) delete process.env[key];else process.env[key]=previous[key];}
    await engine.close();
  }
});
