import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

export function postgresQuery(sql, params = {}) {
  // Application queries use named bindings. Keep literals untouched.
  const values = [], positions = new Map();
  let text = sql.replace(/'(?:''|[^'])*'|\$[a-zA-Z_]\w*/g, token => {
    if (token[0] !== '$') return token;
    if (!positions.has(token)) { positions.set(token, values.length + 1); values.push(params[token] ?? null); }
    return '$' + positions.get(token);
  });
  text = text.replace(/\busername\s*=\s*(\$\d+)\s+COLLATE NOCASE/gi, 'LOWER(username)=LOWER($1)');
  text = text.replace(/date\('now'\)/gi, "to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD')");
  text = text.replace(/julianday\((\w+)\)/gi, '(EXTRACT(EPOCH FROM $1::timestamptz)/86400)');
  text = text.replace(/strftime\('%Y-%m',\s*(COALESCE\([^)]*\)|\w+)\)/gi, 'substr($1,1,7)');
  text = text.replace(/date\((COALESCE\([^)]*\)|\w+)\)/gi, 'substr($1,1,10)');
  return { text, values };
}

export function postgresConnectionOptions(env = process.env) {
  const url = new URL(env.DATABASE_URL);
  const path = env.DATABASE_CA_CERT_PATH || url.searchParams.get('sslrootcert');
  let ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (!ca && path) {
    try { ca = readFileSync(resolve(path)); }
    catch { throw new Error('Database CA certificate file not found. Check DATABASE_CA_CERT_PATH in .env.'); }
  }
  if (ca) {
    try {
      const certificate = new X509Certificate(ca);
      // Supabase downloads may use either PEM or DER certificate encoding.
      ca = ca.toString().includes('-----BEGIN CERTIFICATE-----') ? ca.toString() : certificate.toString();
    } catch { throw new Error('Invalid database CA certificate. Download the SSL root certificate from Supabase Database settings.'); }
  }
  // pg URL SSL parameters would replace the verified SSL object (and its CA).
  for (const key of ['ssl','sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat']) url.searchParams.delete(key);
  const local = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (env.DATABASE_SSL === 'disable' && !local) throw new Error('DATABASE_SSL=disable is supported only for a local PostgreSQL server.');
  return {connectionString:url.toString(),ssl:env.DATABASE_SSL === 'disable' ? false : {rejectUnauthorized:true,...(ca ? {ca} : {})}};
}

export function createDatabase() {
  const context = new AsyncLocalStorage();
  const cloud = Boolean(process.env.DATABASE_URL);
  let sqlite, pool, queue = Promise.resolve();
  if (cloud) {
    // Unnamed queries work with Supabase's transaction pooler.
    pool = new pg.Pool({ ...postgresConnectionOptions(), max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
      options: '-c statement_timeout=30000' });
    pool.on('error', () => console.error('Database pool connection failed'));
  } else {
    if (process.env.VERCEL) throw new Error('Set DATABASE_URL to your Supabase PostgreSQL transaction-pooler connection string.');
    const path = process.env.DATABASE_PATH || './data/success-online.sqlite';
    mkdirSync(dirname(resolve(path)), { recursive: true });
    sqlite = new DatabaseSync(path);
  }
  const query = async (sql, params = {}) => {
    if (!cloud) {
      const statement = sqlite.prepare(sql);
      if (/^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return { rows: statement.all(params) };
      return { rows: [], rowCount: Number(statement.run(params).changes) };
    }
    let result;
    try { result = await (context.getStore() || pool).query(postgresQuery(sql, params)); }
    catch (error) {
      if (['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(error.code)) {
        error.message = 'Database certificate verification failed. Download the SSL root certificate from Supabase Database settings, then set DATABASE_CA_CERT_PATH to that file in .env (or DATABASE_CA_CERT to its PEM contents on Vercel).';
      }
      throw error;
    }
    // PostgreSQL returns int8/numeric aggregates as strings; keep the API numeric.
    result.rows = result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,
      typeof value === 'string' && result.fields.find(f => f.name === key && [20,1700].includes(f.dataTypeID)) ? Number(value) : value])));
    return result;
  };
  return {
    cloud,
    one: async (sql, params) => (await query(sql, params)).rows[0],
    all: async (sql, params) => (await query(sql, params)).rows,
    run: async (sql, params) => ({ changes: (await query(sql, params)).rowCount || 0 }),
    exec: async sql => cloud ? (context.getStore() || pool).query(sql) : sqlite.exec(sql),
    transaction: async task => {
      if (context.getStore()) return task();
      if (cloud) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await context.run(client, task);
          await client.query('COMMIT'); return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }
      const previous = queue;
      let release;
      queue = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        sqlite.exec('BEGIN IMMEDIATE');
        const result = await context.run(sqlite, task);
        sqlite.exec('COMMIT'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
      finally { release(); }
    },
    close: async () => cloud ? pool.end() : sqlite.close()
  };
}
