// Isolated PostgreSQL engine and Storage HTTP fixture; never used by production.
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import http from 'node:http';
const postgres = new PGlite();
const ready = postgres.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
let queue = Promise.resolve();
pg.Pool = class {
  async query(query) { await ready; return typeof query === 'string' ? {rows:[],fields:[],rowCount:0,...(await postgres.exec(query))[0]} : postgres.query(query.text,query.values); }
  async connect() {
    const previous = queue; let release;
    queue = new Promise(resolve => { release = resolve; });
    await previous;
    return {query:this.query.bind(this),release};
  }
  on() {}
  async end() { await postgres.close(); }
};
const objects = new Map();
let uploadWrites=0,copyWrites=0;
const storagePort = Number(process.env.PORT) + 1;
process.env.SUPABASE_URL = `http://localhost:${storagePort}`;
process.env.SUPABASE_SECRET_KEY = 'test-only-storage-secret';
const storageServer = http.createServer(async (req,res) => {
  const url = new URL(req.url,process.env.SUPABASE_URL);
  const json = (value,status=200) => { res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value)); };
  if(url.pathname==='/test/storage-stats') return json({uploadWrites,copyWrites,objects:objects.size});
  const prefix = '/storage/v1/object/';
  const path = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!url.pathname.startsWith(prefix)) return json({error:'Unexpected storage path'},404);
  if (path.startsWith('upload/sign/')) {
    const object = path.slice(12);
    if (req.method === 'POST') return json({url:`/object/upload/sign/${object}?token=test-token`});
    if (req.method === 'PUT' && url.searchParams.get('token') === 'test-token') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      if (objects.has(object)) return json({error:'Already exists'},409);
      uploadWrites++;objects.set(object,Buffer.concat(chunks));return json({Key:object});
    }
    return json({error:'Denied'},403);
  }
  if (path.startsWith('sign/') && req.method === 'POST') return json({signedURL:`/object/sign/${path.slice(5)}?token=download-token`});
  if (path.startsWith('sign/') && req.method === 'GET') {
    const content = objects.get(path.slice(5));
    if (!content || url.searchParams.get('token') !== 'download-token') return json({error:'Denied'},403);
    res.end(content);return;
  }
  if (req.headers.authorization !== 'Bearer test-only-storage-secret') return json({error:'Denied'},403);
  const key = path.startsWith('authenticated/') ? path.slice(14) : path;
  if (req.method === 'GET') { const content = objects.get(key); if (!content) return json({error:'Missing'},404);res.end(content);return; }
  if (req.method === 'POST') { copyWrites++;const chunks = [];for await (const c of req) chunks.push(c);objects.set(key,Buffer.concat(chunks));return json({Key:key}); }
  return json({error:'Unexpected method'},400);
});
await new Promise(resolve => storageServer.listen(storagePort,resolve));
if(process.env.TEST_GOOGLE_REVOKED==='1') {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (input,options)=>{
    if(new URL(String(input)).hostname==='oauth2.googleapis.com') {await new Promise(resolve=>setTimeout(resolve,Number(process.env.TEST_GOOGLE_DELAY_MS || 0)));return new Response(JSON.stringify({error:'invalid_grant'}),{status:400,headers:{'content-type':'application/json'}});}
    return originalFetch(input,options);
  };
}
const {initialize,handler} = await import('../server.js');
await initialize({setup:true});
const tableState = await postgres.query("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('users','cases','documents','upload_intents')");
if (tableState.rows.some(row => !row.relrowsecurity)) throw new Error('RLS is missing');
await postgres.exec('SET ROLE anon');
let denied = false;
try {await postgres.query('SELECT * FROM users');} catch (error) {denied = error.code === '42501';}
await postgres.exec('RESET ROLE');
if (!denied) throw new Error('Anonymous database access must be denied');
http.createServer(handler).listen(Number(process.env.PORT),() => console.log('running'));
