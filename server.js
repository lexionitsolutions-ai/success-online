import http from 'node:http';
import { createHmac, randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { createZip, safeFileName } from './archive.js';
import { loadEnvFile } from 'node:process';
import { createDatabase } from './database.js';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { storage, storageEnabled, signedDownload, readStorage, writeStorage, downloadFileLimit } from './storage.js';
import { serviceCatalog } from './service-catalog.js';
import { sheetHeaders, serviceTabs } from './operations-schema.js';

if (existsSync('.env')) loadEnvFile('.env');

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-session-secret-change-me';
if (process.env.NODE_ENV === 'production' && (!process.env.SESSION_SECRET || SESSION_SECRET.length < 32)) throw new Error('Production requires SESSION_SECRET with at least 32 characters');
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const DEMO_ROOT = process.env.STORAGE_PATH || (process.env.VERCEL ? join(tmpdir(), 'success-online') : './demo-integrations');
const RECEIVED_DOCUMENT_TYPE = 'Received Document';
if (!process.env.VERCEL) mkdirSync(DEMO_ROOT, { recursive: true });
export const db = createDatabase();
const { one, all, run } = db;

const statuses = ['Draft','Awaiting Documents','Awaiting Payment','Ready for Assignment','Assigned','Document Review','Correction Required','Ready to Submit','Submitted to Official Portal','Under Government Review','Customer Action Required','Document Received','Approved','Rejected','Delivered','Closed','Cancelled'];
const transitions = {
  'Draft': ['Awaiting Documents','Awaiting Payment','Ready for Assignment','Cancelled'],
  'Awaiting Documents': ['Awaiting Payment','Ready for Assignment','Correction Required','Cancelled'],
  'Awaiting Payment': ['Ready for Assignment','Cancelled'],
  'Ready for Assignment': ['Assigned','Cancelled'],
  'Assigned': ['Document Review','Ready to Submit','Correction Required','Customer Action Required','Cancelled'],
  'Document Review': ['Ready to Submit','Correction Required','Customer Action Required','Cancelled'],
  'Correction Required': ['Awaiting Documents','Document Review','Ready to Submit','Cancelled'],
  'Ready to Submit': ['Submitted to Official Portal','Correction Required','Customer Action Required','Cancelled'],
  'Submitted to Official Portal': ['Under Government Review','Customer Action Required','Document Received','Rejected','Cancelled'],
  'Under Government Review': ['Customer Action Required','Document Received','Rejected','Cancelled'],
  'Customer Action Required': ['Document Review','Ready to Submit','Under Government Review','Correction Required','Cancelled'],
  'Document Received': ['Correction Required','Cancelled'],
  'Approved': ['Document Received','Delivered','Closed'],
  'Delivered': ['Closed','Customer Action Required'],
  'Rejected': ['Correction Required','Closed'],
  'Closed': [],
  'Cancelled': []
};

async function migrate() {
  await db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, name TEXT, role TEXT, password_hash TEXT, active INTEGER, created_at TEXT);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT, mobile TEXT, email TEXT, address TEXT, created_by TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS services (id TEXT PRIMARY KEY, name TEXT, slug TEXT UNIQUE, active INTEGER, description TEXT, official_url TEXT, processing_period TEXT, admin_review_required INTEGER);
    CREATE TABLE IF NOT EXISTS variants (id TEXT PRIMARY KEY, service_id TEXT, name TEXT, service_charge INTEGER, official_fee INTEGER, tax_rate REAL, fields_json TEXT, documents_json TEXT, instructions TEXT, checklist_version INTEGER, active INTEGER);
    CREATE TABLE IF NOT EXISTS cases (id TEXT PRIMARY KEY, ref TEXT UNIQUE, customer_id TEXT, service_id TEXT, variant_id TEXT, sales_user_id TEXT, backoffice_user_id TEXT, status TEXT, priority TEXT, due_date TEXT, consent_version TEXT, consent_at TEXT, details_json TEXT, drive_customer_folder_id TEXT, drive_case_folder_id TEXT, document_state TEXT, payment_state TEXT, official_reference TEXT, follow_up_date TEXT, created_at TEXT, updated_at TEXT, submitted_at TEXT, completed_at TEXT);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, case_id TEXT, doc_type TEXT, file_name TEXT, mime_type TEXT, size INTEGER, storage_path TEXT, drive_file_id TEXT, state TEXT, version INTEGER, created_at TEXT);
    CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, case_id TEXT, gateway TEXT, gateway_order_id TEXT, transaction_id TEXT, amount INTEGER, service_charge INTEGER, official_fee INTEGER, tax INTEGER, status TEXT, verified_at TEXT, created_at TEXT, UNIQUE(gateway_order_id));
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, case_id TEXT, actor_id TEXT, old_status TEXT, new_status TEXT, note TEXT, visibility TEXT, next_action TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, body TEXT, read_at TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, reason TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS sync_jobs (id TEXT PRIMARY KEY, type TEXT, entity_id TEXT, status TEXT, attempts INTEGER, last_error TEXT, created_at TEXT, updated_at TEXT, UNIQUE(type, entity_id));
    CREATE TABLE IF NOT EXISTS integration_settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS upload_intents (id TEXT PRIMARY KEY, case_id TEXT, user_id TEXT, doc_type TEXT, file_name TEXT, mime_type TEXT, size INTEGER, storage_path TEXT, expires_at TEXT, completed_at TEXT);
  `.replace(db.cloud ? /PRAGMA journal_mode = WAL;/ : /$^/, ''));
}

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${randomUUID()}`; }
function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 32));
}
function json(row, key, fallback) { try { return JSON.parse(row?.[key] || ''); } catch { return fallback; } }
function publicUser(u) { return u && { id: u.id, username: u.username, name: u.name, role: u.role }; }

async function seed() {
  if ((await one('SELECT id FROM users LIMIT 1'))) return;
  if (db.cloud || process.env.NODE_ENV === 'production') {
    const username = process.env.INITIAL_ADMIN_USERNAME;
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!username || !password || password.length < 10) throw new Error('Set INITIAL_ADMIN_USERNAME and INITIAL_ADMIN_PASSWORD (at least 10 characters) before database setup.');
    await run('INSERT INTO users VALUES ($id,$username,$name,$role,$password_hash,1,$created_at)', { $id: id('usr'), $username: username.toLowerCase(), $name: process.env.INITIAL_ADMIN_NAME || 'Administrator', $role:'admin', $password_hash:hashPassword(password), $created_at:now() });
    return;
  }
  const users = [
    ...Array.from({ length: 5 }, (_, i) => [`sales0${i + 1}`, `Sales ${i + 1}`, 'sales']),
    ...Array.from({ length: 2 }, (_, i) => [`backoffice0${i + 1}`, `Back Office ${i + 1}`, 'backoffice']),
    ...Array.from({ length: 2 }, (_, i) => [`admin0${i + 1}`, `Admin ${i + 1}`, 'admin'])
  ];
  for (const [username, name, role] of users) (await run('INSERT INTO users VALUES ($id,$username,$name,$role,$password_hash,1,$created_at)', { $id: id('usr'), $username: username, $name: name, $role: role, $password_hash: hashPassword('Demo@12345'), $created_at: now() }));
}

async function seedServiceCatalog() {
  const activeSlugs = serviceCatalog.map(service => service.slug);
  await run(`UPDATE services SET active=0 WHERE slug NOT IN (${activeSlugs.map((_, i) => `$s${i}`).join(',')})`, Object.fromEntries(activeSlugs.map((slug, i) => [`$s${i}`, slug])));
  for (const service of serviceCatalog) {
    let serviceRow = (await one('SELECT * FROM services WHERE slug=$slug', { $slug: service.slug }));
    const serviceValues = {
      $name: service.name,
      $description: service.description,
      $url: service.officialUrl || '',
      $period: service.processingPeriod || 'Confirm at intake',
      $slug: service.slug
    };
    if (serviceRow) {
      (await run('UPDATE services SET name=$name,active=1,description=$description,official_url=$url,processing_period=$period,admin_review_required=1 WHERE id=$id', { $name: service.name, $description: service.description, $url: service.officialUrl || '', $period: service.processingPeriod || 'Confirm at intake', $id: serviceRow.id }));
    } else {
      const serviceId = id('svc');
      (await run('INSERT INTO services VALUES ($id,$name,$slug,1,$description,$url,$period,1)', { $id: serviceId, ...serviceValues }));
      serviceRow = { id: serviceId };
    }

    (await run('UPDATE variants SET active=0 WHERE service_id=$service_id', { $service_id: serviceRow.id }));
    const variantName = service.variant || 'Application';
    let variant = (await one('SELECT * FROM variants WHERE service_id=$service_id AND name=$name', { $service_id: serviceRow.id, $name: variantName }));
    const variantValues = {
      $service_charge: service.serviceCharge || 0,
      $official_fee: service.officialFee || 0,
      $tax_rate: service.taxRate || 0,
      $fields_json: JSON.stringify(service.fields || []),
      $documents_json: JSON.stringify(service.documents),
      $instructions: service.instructions || 'Required documents follow the client-provided checklist. Confirm current requirements and fees before submission.'
    };
    if (variant) {
    (await run('UPDATE variants SET service_charge=$service_charge,official_fee=$official_fee,tax_rate=$tax_rate,fields_json=$fields_json,documents_json=$documents_json,instructions=$instructions,active=1 WHERE id=$id', { ...variantValues, $id: variant.id }));
    } else {
      (await run('INSERT INTO variants VALUES ($id,$service_id,$name,$service_charge,$official_fee,$tax_rate,$fields_json,$documents_json,$instructions,1,1)', { $id: id('var'), $service_id: serviceRow.id, $name: variantName, ...variantValues }));
    }
  }
}

function prefix(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [`$${k}`, v]));
}
async function nextCaseRef() {
  const y = new Date().getFullYear();
  if (db.cloud) {
    const row = await one(`INSERT INTO integration_settings(name,value) VALUES ($name,'1')
      ON CONFLICT(name) DO UPDATE SET value=(integration_settings.value::bigint+1)::text RETURNING value`, { $name:`CASE_REFERENCE_LAST_${y}` });
    return `SO-${y}-${String(row.value).padStart(6,'0')}`;
  }
  const row = (await one("SELECT MAX(CAST(substr(ref,9) AS INTEGER)) n FROM cases WHERE ref LIKE $p", { $p: `SO-${y}-%` }));
  const name = `CASE_REFERENCE_LAST_${y}`;
  const previous = Number((await one('SELECT value FROM integration_settings WHERE name=$name', { $name:name }))?.value || 0);
  const next = Math.max(previous, row?.n || 0) + 1;
  (await run('INSERT INTO integration_settings (name,value) VALUES ($name,$value) ON CONFLICT(name) DO UPDATE SET value=$value', { $name:name, $value:String(next) }));
  return `SO-${y}-${String(next).padStart(6, '0')}`;
}

async function sessionFrom(req) {
  const cookie = req.headers.cookie || '';
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith('so_session='))?.split('=')[1];
  if (!token) return null;
  const [userId, expires, signature] = Buffer.from(token, 'base64url').toString().split('|');
  if (!userId || !expires || !signature || Number(expires) < Date.now()) return null;
  const expected = createHmac('sha256', SESSION_SECRET).update(`${userId}|${expires}`).digest('hex');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const row = (await one('SELECT * FROM users WHERE id=$id AND active=1', { $id: userId }));
  return row || null;
}
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}
function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}
async function updateEnv(name, value) {
  (await run('INSERT INTO integration_settings (name,value) VALUES ($name,$value) ON CONFLICT(name) DO UPDATE SET value=$value', { $name: name, $value: value }));
  process.env[name] = value;
}
function oauthConfig() {
  return {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
    rootFolderId: process.env.GOOGLE_ROOT_FOLDER_ID || '',
    redirectUri: `${APP_ORIGIN}/api/google/oauth/callback`
  };
}
function signedOAuthState(user) {
  const payload = Buffer.from(JSON.stringify({ userId: user.id, expires: Date.now() + 10 * 60_000 })).toString('base64url');
  const signature = createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function verifyOAuthState(state, user) {
  const [payload, signature] = String(state || '').split('.');
  if (!payload || !signature) return false;
  const expected = createHmac('sha256', SESSION_SECRET).update(payload).digest();
  const supplied = Buffer.from(signature, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.userId === user.id && data.expires > Date.now();
  } catch { return false; }
}
async function tokenRequest(params) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params)
  });
  const result = await response.json();
  if (!response.ok) {
    if (params.grant_type === 'refresh_token' && result.error === 'invalid_grant') {
      (await updateEnv('GOOGLE_RECONNECT_REQUIRED', '1'));
      throw Object.assign(new Error('Google connection expired. An admin must reconnect Google Drive from Business analytics, then retry the upload.'), { status: 409, code: 'GOOGLE_RECONNECT_REQUIRED' });
    }
    throw new Error(result.error_description || result.error || 'Google token request failed');
  }
  return result;
}
async function googleAccessToken() {
  const config = oauthConfig();
  if (!config.clientId || !config.clientSecret || !config.refreshToken) throw new Error('Google Drive OAuth is not connected');
  const token = await tokenRequest({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken, grant_type: 'refresh_token' });
  if (process.env.GOOGLE_RECONNECT_REQUIRED === '1') (await updateEnv('GOOGLE_RECONNECT_REQUIRED', '0'));
  return token.access_token;
}
async function driveRequest(path, options = {}) {
  const token = await googleAccessToken();
  const response = await fetch(`https://www.googleapis.com${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(result.error?.message || `Google Drive request failed (${response.status})`), { googleStatus: response.status });
  return result;
}
async function sheetsRequest(path, options = {}) {
  const token = await googleAccessToken();
  const response = await fetch(`https://sheets.googleapis.com${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const text = await response.text();
  const result = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(result.error?.message || `Google Sheets request failed (${response.status})`);
  return result;
}
function spreadsheetId() { return process.env.GOOGLE_OPERATIONS_SPREADSHEET_ID || ''; }
function sheetSafe(value) { return String(value ?? '').replace(/^[=+\-@]/, "'$&"); }
function sheetRange(tab, range) { return encodeURIComponent(`'${tab}'!${range}`); }
async function ensureSheetsWorkbook() {
  const id = spreadsheetId();
  if (!id) throw new Error('GOOGLE_OPERATIONS_SPREADSHEET_ID is missing');
  const metadata = await sheetsRequest(`/v4/spreadsheets/${encodeURIComponent(id)}?fields=spreadsheetId,properties(title),sheets(properties(title))`);
  const existing = new Set((metadata.sheets || []).map(s => s.properties.title));
  const missing = Object.keys(sheetHeaders).filter(name => !existing.has(name));
  if (missing.length) {
    await sheetsRequest(`/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests: missing.map(title => ({ addSheet: { properties: { title } } })) })
    });
  }
  await sheetsRequest(`/v4/spreadsheets/${encodeURIComponent(id)}/values:batchUpdate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: Object.entries(sheetHeaders).map(([tab, headers]) => ({ range: `'${tab}'!A1`, values: [headers] })) })
  });
  return { id: metadata.spreadsheetId, title: metadata.properties.title, tabs: Object.keys(sheetHeaders) };
}
async function upsertSheetRow(tab, key, values, keyColumn = 'A:A') {
  const id = spreadsheetId();
  const column = await sheetsRequest(`/v4/spreadsheets/${encodeURIComponent(id)}/values/${sheetRange(tab, keyColumn)}?majorDimension=COLUMNS`);
  const keys = column.values?.[0] || [];
  const index = keys.findIndex(value => value === key);
  const row = index >= 1 ? index + 1 : keys.length + 1;
  await sheetsRequest(`/v4/spreadsheets/${encodeURIComponent(id)}/values/${sheetRange(tab, `A${row}`)}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ values: [values] })
  });
}
function serviceSheet(name) { return serviceTabs[name]; }
async function syncCaseToGoogle(caseId) {
  const c = (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: caseId }))));
  const missing = (await missingDocuments(c));
  const required = c.variant.documents.filter(d => d.required && (!d.when || !String(c.details[d.when.field] || '').trim() || String(c.details[d.when.field]) === String(d.when.equals))).length;
  const master = [c.ref, sheetSafe(c.customer.name), c.customer.mobile, c.service.name, c.created_at, c.sales.name, c.backoffice?.name || '', c.document_state, c.payment_state, c.status, c.updated_at, c.follow_up_date || '', c.completed_at || '', required, required - missing.length, missing.join('; '), c.drive_case_folder_id ? `https://drive.google.com/drive/folders/${c.drive_case_folder_id}` : ''];
  await upsertSheetRow('All Cases', c.ref, master);
  const tab = serviceSheet(c.service.name);
  if (tab) await upsertSheetRow(tab, c.ref, [c.ref, sheetSafe(c.customer.name), c.customer.mobile, c.service.name, c.status, c.payment_state, c.document_state, c.updated_at]);
  for (const d of (await all('SELECT * FROM documents WHERE case_id=$id ORDER BY created_at', { $id: caseId }))) {
    await upsertSheetRow('Documents', d.id, [d.id, c.ref, sheetSafe(d.doc_type), sheetSafe(d.file_name), d.mime_type, d.size, d.version, d.state, d.created_at, d.drive_file_id && !d.drive_file_id.startsWith('demo-') ? `https://drive.google.com/file/d/${d.drive_file_id}/view` : d.storage_path.startsWith('supabase://') ? 'Private cloud storage' : 'Local demo storage']);
  }
  const payments = (await all("SELECT * FROM payments WHERE case_id=$id AND status IN ('verified','offline_approved') ORDER BY created_at", { $id: caseId }));
  for (const payment of payments) {
    const reference = payment.transaction_id || payment.gateway_order_id;
    await upsertSheetRow('Cashflow', reference, [payment.verified_at || payment.created_at, c.ref, payment.gateway, reference, payment.service_charge / 100, payment.official_fee / 100, payment.tax / 100, payment.amount / 100, payment.status], 'D:D');
  }
}
let sheetsSyncChain = Promise.resolve();
async function queueSheetsSync(caseId) {
  (await run(`INSERT INTO sync_jobs VALUES ($id,'sheets',$entity,'pending',0,NULL,$n,$n) ON CONFLICT(type, entity_id) DO UPDATE SET status='pending', updated_at=$n`, { $id: id('sync'), $entity: caseId, $n: now() }));
  if(process.env.GOOGLE_RECONNECT_REQUIRED==='1' && storageEnabled()) {
    await run("UPDATE sync_jobs SET status='failed',attempts=attempts+1,last_error='GOOGLE_RECONNECT_REQUIRED',updated_at=$n WHERE type='sheets' AND entity_id=$entity",{$entity:caseId,$n:now()});
    return;
  }
  sheetsSyncChain = sheetsSyncChain.then(async () => {
    try {
      await syncCaseToGoogle(caseId);
      (await run("UPDATE sync_jobs SET status='ok',attempts=attempts+1,last_error=NULL,updated_at=$n WHERE type='sheets' AND entity_id=$entity", { $entity: caseId, $n: now() }));
    } catch (error) {
      (await run("UPDATE sync_jobs SET status='failed',attempts=attempts+1,last_error=$error,updated_at=$n WHERE type='sheets' AND entity_id=$entity", { $entity: caseId, $error: error.message, $n: now() }));
      console.error(`Sheets sync failed for ${caseId}: ${error.message}`);
    }
  });
  await sheetsSyncChain;
}
async function verifyDriveRoot(folderId = oauthConfig().rootFolderId) {
  try {
    if (!folderId) throw Object.assign(new Error('The main Google Drive folder has not been configured.'),{invalidRoot:true});
    const folder = await driveRequest(`/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,trashed,capabilities(canAddChildren)`);
    if (folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder') throw Object.assign(new Error('The main Google Drive folder is deleted or is not a folder.'),{invalidRoot:true});
    if (folder.capabilities?.canAddChildren === false) throw Object.assign(new Error('The connected Google account cannot upload into the main Drive folder.'),{invalidRoot:true});
    if (folderId === oauthConfig().rootFolderId && process.env.GOOGLE_ROOT_FOLDER_INVALID === '1') (await updateEnv('GOOGLE_ROOT_FOLDER_INVALID', '0'));
    return folder;
  } catch (error) {
    if (error.code === 'GOOGLE_RECONNECT_REQUIRED') throw error;
    if (!error.invalidRoot && ![403,404].includes(error.googleStatus)) throw error;
    if (folderId === oauthConfig().rootFolderId) (await updateEnv('GOOGLE_ROOT_FOLDER_INVALID', '1'));
    throw Object.assign(new Error('The main Google Drive folder is unavailable or not writable. An admin must open Business analytics and set a Drive folder the connected Google account can edit.'), {status:409,code:'GOOGLE_ROOT_FOLDER_INVALID'});
  }
}
async function createDriveFolder(name, parentId) {
  return driveRequest('/drive/v3/files?supportsAllDrives=true&fields=id,name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
}
function customerDriveFolderName(customer) {
  const name = String(customer.name || 'Customer').trim().replace(/[\\/:*?"<>|]/g, '-');
  const shortId = String(customer.id || '').replace(/^cus_/, '').slice(0, 8).toUpperCase();
  return `${name} - CUST-${shortId}`;
}
async function renameDriveFile(fileId, name) {
  return driveRequest(`/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
}
async function uploadDriveFile(name, mimeType, parentId, content) {
  const boundary = `success_online_${randomBytes(12).toString('hex')}`;
  const metadata = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const ending = Buffer.from(`\r\n--${boundary}--`);
  return driveRequest('/upload/drive/v3/files?supportsAllDrives=true&uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: Buffer.concat([metadata, content, ending])
  });
}
async function driveFoldersForCase(c, customer, service) {
  let customerFolderId = c.drive_customer_folder_id || (await one('SELECT drive_customer_folder_id id FROM cases WHERE customer_id=$id AND drive_customer_folder_id IS NOT NULL LIMIT 1', { $id: c.customer_id }))?.id;
  if (!customerFolderId) customerFolderId = (await createDriveFolder(customerDriveFolderName(customer), oauthConfig().rootFolderId)).id;
  let caseFolderId = c.drive_case_folder_id;
  if (!caseFolderId) caseFolderId = (await createDriveFolder(`${c.ref} - ${service.name}`, customerFolderId)).id;
  (await run('UPDATE cases SET drive_customer_folder_id=$customer,drive_case_folder_id=$case WHERE id=$id', { $customer: customerFolderId, $case: caseFolderId, $id: c.id }));
  return { customerFolderId, caseFolderId };
}
async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 14_000_000) throw Object.assign(new Error('Request exceeds upload limit'), { status: 413 });
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}
async function requireUser(req, res, roles) {
  const user = (await sessionFrom(req));
  if (!user) { send(res, 401, { error: 'Login required' }); return null; }
  if (roles && !roles.includes(user.role)) { send(res, 403, { error: 'Not allowed' }); return null; }
  return user;
}
function maskPhone(mobile) { return mobile ? mobile.replace(/\d(?=\d{4})/g, 'x') : ''; }
async function caseRow(c) {
  return (await caseRows([c]))[0];
}
async function caseRows(rows) {
  if (!rows.length) return [];
  const related = async (table, column, values, fields='*', condition='') => {
    const ids = [...new Set(values.filter(Boolean))];
    if (!ids.length) return [];
    const params = Object.fromEntries(ids.map((value,index)=>['$v'+index,value]));
    return all(`SELECT ${fields} FROM ${table} WHERE ${column} IN (${ids.map((_,index)=>'$v'+index).join(',')})${condition}`,params);
  };
  const [variants,customers,serviceRows,users,documents] = await Promise.all([
    related('variants','id',rows.map(c=>c.variant_id)),
    related('customers','id',rows.map(c=>c.customer_id),'id,name,mobile,email'),
    related('services','id',rows.map(c=>c.service_id),'id,name'),
    related('users','id',rows.flatMap(c=>[c.sales_user_id,c.backoffice_user_id]),'id,username,name,role'),
    related('documents','case_id',rows.map(c=>c.id),'case_id,doc_type'," AND state='uploaded'")
  ]);
  const byId = items => new Map(items.map(item=>[item.id,item]));
  const variantMap=byId(variants),customerMap=byId(customers),serviceMap=byId(serviceRows),userMap=byId(users);
  const have=new Map();
  for(const document of documents) {if(!have.has(document.case_id)) have.set(document.case_id,new Set());have.get(document.case_id).add(document.doc_type);}
  return rows.map(c=>{
    const variant=variantMap.get(c.variant_id),details=json(c,'details_json',{});
    const requirements=json(variant,'documents_json',[]);
    const missing=requirements.some(d=>d.required && (!d.when || !String(details[d.when.field]||'').trim() || String(details[d.when.field])===String(d.when.equals)) && !have.get(c.id)?.has(d.label));
    return {...c,document_state:missing?'missing':'complete',customer:customerMap.get(c.customer_id),service:serviceMap.get(c.service_id),variant:{...variant,fields:json(variant,'fields_json',[]),documents:requirements},details,amounts:amounts(variant),sales:publicUser(userMap.get(c.sales_user_id)),backoffice:publicUser(userMap.get(c.backoffice_user_id))};
  });
}
function amounts(v) {
  const serviceCharge = v.service_charge || 0, officialFee = v.official_fee || 0, tax = Math.round(serviceCharge * (v.tax_rate || 0) / 100);
  return { serviceCharge, officialFee, tax, total: serviceCharge + officialFee + tax };
}
function analyticsPeriod(key) {
  const valid = new Set(['week','month','quarter','year','all']);
  const period = valid.has(key) ? key : 'month';
  const indiaOffset = 330 * 60000;
  const date = new Date(Date.now() + indiaOffset);
  if (period === 'week') date.setUTCDate(date.getUTCDate() - 6);
  if (period === 'month') date.setUTCDate(1);
  if (period === 'quarter') date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3, 1);
  if (period === 'year') date.setUTCMonth(0, 1);
  if (period === 'all') date.setUTCFullYear(2000, 0, 1);
  date.setUTCHours(0, 0, 0, 0);
  return { key: period, start: new Date(date.getTime() - indiaOffset).toISOString(), end: now(), group: ['week','month'].includes(period) ? 'day' : 'month' };
}
async function recomputeCase(id) {
  const c = (await one('SELECT * FROM cases WHERE id=$id', { $id: id }));
  const docsReq = json((await one('SELECT documents_json FROM variants WHERE id=$id', { $id: c.variant_id })), 'documents_json', []);
  const docs = (await all('SELECT * FROM documents WHERE case_id=$id AND state!=$state', { $id: id, $state: 'replaced' }));
  const have = new Set(docs.map(d => d.doc_type));
  const details = json(c, 'details_json', {});
  const requiredDocs = docsReq.filter(d => d.required && (!d.when || !Object.hasOwn(details, d.when.field) || !String(details[d.when.field] || '').trim() || String(details[d.when.field]) === String(d.when.equals)));
  const documentState = requiredDocs.every(d => have.has(d.label)) ? 'complete' : 'missing';
  const paid = (await one("SELECT * FROM payments WHERE case_id=$id AND status IN ('verified','offline_approved')", { $id: id }));
  const paymentState = paid ? 'paid' : 'unpaid';
  let status = c.status;
  if (!['Assigned','Document Review','Correction Required','Ready to Submit','Submitted to Official Portal','Under Government Review','Customer Action Required','Document Received','Approved','Rejected','Delivered','Closed','Cancelled'].includes(status)) {
    status = documentState === 'complete' && paymentState === 'paid' ? 'Ready for Assignment' : documentState === 'missing' ? 'Awaiting Documents' : 'Awaiting Payment';
  }
  (await run('UPDATE cases SET document_state=$d,payment_state=$p,status=$s,updated_at=$u WHERE id=$id', { $d: documentState, $p: paymentState, $s: status, $u: now(), $id: id }));
  (await syncCase(id));
}
function canSee(user, c) { return user.role === 'admin' || user.role === 'backoffice' || c.sales_user_id === user.id; }
function publicDocument(document) {
  const { storage_path, drive_file_id, ...visible } = document;
  return { ...visible, download_url: `/api/documents/${encodeURIComponent(document.id)}/download` };
}
async function syncCase(caseId) {
  if (process.env.VERCEL) {
    if (process.env.SHEETS_MODE === 'live') await queueSheetsSync(caseId);
    return;
  }
  const c = (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: caseId }))));
  const safe = v => String(v ?? '').replace(/^[=+\-@]/, "'$&");
  const row = { missingDocuments: (await missingDocuments(c)), driveFolder: c.drive_case_folder_id || null, caseId: c.ref, customer: safe(c.customer.name), phone: maskPhone(c.customer.mobile), service: c.service.name, status: c.status, payment: c.payment_state, documents: c.document_state, sales: c.sales.name, backoffice: c.backoffice?.name || '', updated: c.updated_at };
  const file = join(DEMO_ROOT, 'Success Online Operations.json');
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { allCases: {}, cashflow: [], syncLog: [] };
  data.allCases[c.ref] = row;
  data.documents ||= {};
  data.documents[c.ref] = (await all('SELECT id,doc_type,file_name,mime_type,size,state,version,created_at FROM documents WHERE case_id=$id', { $id: caseId }));
  data.syncLog.push({ at: now(), type: 'case', key: c.ref, status: 'ok' });
  writeFileSync(file, JSON.stringify(data, null, 2));
  if (process.env.SHEETS_MODE === 'live') (await queueSheetsSync(caseId));
  else (await run(`INSERT INTO sync_jobs VALUES ($id,'sheets',$entity,'ok',1,NULL,$n,$n) ON CONFLICT(type, entity_id) DO UPDATE SET status='ok', attempts=attempts+1, updated_at=$n`, { $id: id('sync'), $entity: caseId, $n: now() }));
}

async function readDocument(document) {
  if (document.storage_path?.startsWith('supabase://')) return readStorage(document.storage_path.slice(11));
  if (document.storage_path?.startsWith('gdrive://')) {
    const token = await googleAccessToken();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(document.drive_file_id)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw Object.assign(new Error('Google Drive document download failed'), { status: 502 });
    return Buffer.from(await response.arrayBuffer());
  }
  const path = resolve(document.storage_path || '');
  if (!path.startsWith(resolve(DEMO_ROOT) + '/') && !path.startsWith(resolve(DEMO_ROOT) + '\\')) throw Object.assign(new Error('Invalid document path'), { status: 403 });
  if (!existsSync(path)) throw Object.assign(new Error('Document file is missing'), { status: 404 });
  return readFileSync(path);
}
async function missingDocuments(c) {
  const requirements = json((await one('SELECT documents_json FROM variants WHERE id=$id', { $id: c.variant_id })), 'documents_json', []);
  const details = json(c, 'details_json', {});
  const have = new Set((await all("SELECT doc_type FROM documents WHERE case_id=$id AND state='uploaded'", { $id: c.id })).map(d => d.doc_type));
  return requirements.filter(d => d.required && (!d.when || !String(details[d.when.field] || '').trim() || String(details[d.when.field]) === String(d.when.equals)) && !have.has(d.label)).map(d => d.label);
}
async function documentGate(c, res) {
  const pending = await one('SELECT id FROM upload_intents WHERE case_id=$id AND completed_at IS NULL AND expires_at>$at LIMIT 1', { $id:c.id, $at:now() });
  if (pending) { send(res,409,{error:'Wait for all pending document uploads to finish before proceeding.'}); return false; }
  const missing = (await missingDocuments(c));
  if (!missing.length) return true;
  send(res, 409, { error: `Upload required documents before proceeding: ${missing.join(', ')}`, missingDocuments: missing });
  return false;
}
async function routeApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
  if (req.method === 'POST' && url.pathname === '/api/login') return body(req).then(async b => {
    const u = (await one('SELECT * FROM users WHERE username=$u AND active=1', { $u: b.username }));
    if (!u || !verifyPassword(b.password || '', u.password_hash)) return send(res, 401, { error: 'Invalid credentials' });
    const payload = `${u.id}|${Date.now() + 8 * 60 * 60 * 1000}`;
    const token = Buffer.from(`${payload}|${createHmac('sha256', SESSION_SECRET).update(payload).digest('hex')}`).toString('base64url');
    send(res, 200, { user: publicUser(u) }, { 'set-cookie': `so_session=${token}; HttpOnly; SameSite=Lax; Max-Age=28800; Path=/${APP_ORIGIN.startsWith('https:') ? '; Secure' : ''}` });
  });
  if (req.method === 'POST' && url.pathname === '/api/logout') return send(res, 200, { ok: true }, { 'set-cookie': 'so_session=; Max-Age=0; Path=/' });
  const user = (await requireUser(req, res));
  if (!user) return;
  const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)\/download$/);
  if (req.method === 'GET' && documentMatch) {
    const document = (await one('SELECT * FROM documents WHERE id=$id AND state!=$state', { $id: documentMatch[1], $state: 'replaced' }));
    if (!document) return send(res, 404, { error: 'Document not found' });
    const c = (await one('SELECT * FROM cases WHERE id=$id', { $id: document.case_id }));
    if (!c || !canSee(user, c)) return send(res, c ? 403 : 404, { error: c ? 'Not allowed' : 'Not found' });
    if (document.doc_type === RECEIVED_DOCUMENT_TYPE && user.role === 'sales' && !['Closed','Delivered'].includes(c.status)) {
      return send(res, 403, { error: 'The received document has not been submitted yet' });
    }
    if (document.storage_path?.startsWith('supabase://')) return redirect(res, await signedDownload(document.storage_path.slice(11), document.file_name));
    const content = await readDocument(document);
    if (process.env.VERCEL && storageEnabled()) {
      const path = `downloads/${randomUUID()}/${safeFileName(document.file_name)}`;
      await writeStorage(path,content,document.mime_type);
      return redirect(res,await signedDownload(path,document.file_name));
    }
    res.writeHead(200, {
      'content-type': document.mime_type || 'application/octet-stream',
      'content-length': content.length,
      'content-disposition': `attachment; filename="document${extname(document.file_name)}"; filename*=UTF-8''${encodeURIComponent(document.file_name)}`
    });
    return res.end(content);
  }
  if (req.method === 'GET' && url.pathname === '/api/me') return send(res, 200, { user: publicUser(user) });
  if (req.method === 'GET' && url.pathname === '/api/google/status') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    const config = oauthConfig();
    return send(res, 200, {
      configured: Boolean(config.clientId && config.clientSecret && config.rootFolderId),
      connected: Boolean(config.refreshToken) && process.env.GOOGLE_RECONNECT_REQUIRED !== '1',
      reconnectRequired: process.env.GOOGLE_RECONNECT_REQUIRED === '1',
      folderInvalid: process.env.GOOGLE_ROOT_FOLDER_INVALID === '1',
      live: process.env.DRIVE_MODE === 'live',
      rootFolderId: config.rootFolderId || null,
      callbackUrl: config.redirectUri,
      oauthClientSettingsUrl: config.clientId ? 'https://console.cloud.google.com/apis/credentials/oauthclient/' + encodeURIComponent(config.clientId) : null
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/google/sheets/status') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    return send(res, 200, { configured: Boolean(spreadsheetId()), live: process.env.SHEETS_MODE === 'live', spreadsheetId: spreadsheetId() || null });
  }
  if (req.method === 'POST' && url.pathname === '/api/google/root-folder') {
    if (user.role !== 'admin') return send(res,403,{error:'Admin access required'});
    return body(req).then(async b => {
      const value = String(b.folder || '').trim();
      const folderId = value.match(/^https:\/\/drive\.google\.com\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/)?.[1] || value;
      if (!/^[A-Za-z0-9_-]{3,200}$/.test(folderId)) return send(res,400,{error:'Paste a valid Google Drive folder link or folder ID'});
      const folder = await verifyDriveRoot(folderId);
      (await updateEnv('GOOGLE_ROOT_FOLDER_ID',folderId));
      (await updateEnv('GOOGLE_ROOT_FOLDER_INVALID','0'));
      return send(res,200,{ok:true,folder:{id:folder.id,name:folder.name}});
    });
  }
  if (req.method === 'POST' && url.pathname === '/api/google/sheets/activate') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    return (async () => {
      const workbook = await ensureSheetsWorkbook();
      (await updateEnv('SHEETS_MODE', 'live'));
      const caseIds = (await all('SELECT id FROM cases ORDER BY created_at')).map(row => row.id);
      for (const caseId of caseIds) await queueSheetsSync(caseId);
      await sheetsSyncChain;
      const failures = (await all("SELECT entity_id,last_error FROM sync_jobs WHERE type='sheets' AND status='failed'"));
      if (failures.length) throw new Error(`Workbook connected, but ${failures.length} case syncs failed: ${failures[0].last_error}`);
      send(res, 200, { live: true, workbook, syncedCases: caseIds.length });
    })();
  }
  if (req.method === 'POST' && url.pathname === '/api/google/normalize-folders') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    if (process.env.DRIVE_MODE !== 'live') return send(res, 409, { error: 'Google Drive is not live' });
    return (async () => {
      const folders = (await all('SELECT customer_id,drive_customer_folder_id FROM cases WHERE drive_customer_folder_id IS NOT NULL GROUP BY customer_id,drive_customer_folder_id'));
      let renamed = 0;
      for (const folder of folders) {
        const customer = (await one('SELECT id,name FROM customers WHERE id=$id', { $id: folder.customer_id }));
        if (!customer) continue;
        await renameDriveFile(folder.drive_customer_folder_id, customerDriveFolderName(customer));
        renamed += 1;
      }
      (await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)', { $id: id('aud'), $actor: user.id, $action: 'google_drive.normalize_folders', $type: 'integration', $entity: oauthConfig().rootFolderId, $reason: `${renamed} customer folders renamed`, $at: now() }));
      send(res, 200, { renamed });
    })();
  }
  if (req.method === 'GET' && url.pathname === '/api/google/oauth/start') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    const config = oauthConfig();
    if (!config.clientId || !config.clientSecret || !config.rootFolderId) return send(res, 400, { error: 'Google OAuth client or root folder configuration is incomplete' });
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: signedOAuthState(user)
    });
    return send(res, 200, { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }
  if (req.method === 'GET' && url.pathname === '/api/google/oauth/callback') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    if (url.searchParams.get('error')) return redirect(res, `/?google=error&message=${encodeURIComponent(url.searchParams.get('error'))}`);
    if (!verifyOAuthState(url.searchParams.get('state'), user)) return send(res, 400, { error: 'Invalid or expired Google OAuth state' });
    const code = url.searchParams.get('code');
    if (!code) return send(res, 400, { error: 'Google did not return an authorization code' });
    return (async () => {
      const config = oauthConfig();
      const tokens = await tokenRequest({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: 'authorization_code', redirect_uri: config.redirectUri });
      if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Revoke the app permission and connect again.');
      (await updateEnv('GOOGLE_OAUTH_REFRESH_TOKEN', tokens.refresh_token));
      const folder = await verifyDriveRoot();
      (await updateEnv('GOOGLE_RECONNECT_REQUIRED', '0'));
      (await updateEnv('DRIVE_MODE', 'live'));
      (await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)', { $id: id('aud'), $actor: user.id, $action: 'google_drive.connect', $type: 'integration', $entity: folder.id, $reason: folder.name, $at: now() }));
      redirect(res, '/?google=connected');
    })();
  }
  if (req.method === 'GET' && url.pathname === '/api/services') {
    const [serviceRows,variants]=await Promise.all([all('SELECT * FROM services WHERE active=1'),all('SELECT * FROM variants WHERE active=1')]);
    return send(res,200,{demoPayments:process.env.PAYMENT_MODE==='demo',cloudUploads:storageEnabled(),services:serviceRows.map(service=>({...service,variants:variants.filter(v=>v.service_id===service.id).map(v=>({...v,fields:json(v,'fields_json',[]),documents:json(v,'documents_json',[]),amounts:amounts(v)}))}))});
  }
  if (req.method === 'GET' && url.pathname === '/api/customers') {
    const q = `%${url.searchParams.get('q') || ''}%`;
    return send(res, 200, { customers: (await all('SELECT id,name,mobile,email FROM customers WHERE (mobile LIKE $q OR name LIKE $q) AND ($sales=0 OR created_by=$user) LIMIT 20', { $q: q, $sales: user.role === 'sales' ? 1 : 0, $user: user.id })) });
  }
  if (req.method === 'GET' && url.pathname === '/api/cases') {
    const where = user.role === 'sales' ? 'WHERE sales_user_id=$uid' : user.role === 'backoffice' ? "WHERE status!='Draft' AND (backoffice_user_id=$uid OR backoffice_user_id IS NULL OR status IN ('Awaiting Documents','Awaiting Payment'))" : '';
    const params = user.role === 'admin' ? {} : { $uid: user.id };
    return send(res, 200, { cases: await caseRows(await all(`SELECT * FROM cases ${where} ORDER BY updated_at DESC`, params)) });
  }
  if (req.method === 'POST' && url.pathname === '/api/cases') return body(req).then(async b => {
    if (user.role !== 'sales' && user.role !== 'admin') return send(res, 403, { error: 'Only sales or admin can create cases' });
    const variant = (await one('SELECT * FROM variants WHERE id=$id', { $id: b.variantId }));
    if (!variant || !variant.active) return send(res, 400, { error: 'Choose an active service request type' });
    if (b.consent !== true) return send(res, 400, { error: 'Customer consent is required' });
    if (!b.customerId && (!String(b.customer?.name || '').trim() || !/^[6-9]\d{9}$/.test(b.customer?.mobile || ''))) return send(res, 400, { error: 'Customer name and a valid 10-digit Indian mobile number are required' });
    if (b.customerId && !(await one('SELECT id FROM customers WHERE id=$id AND ($admin=1 OR created_by=$user)', { $id: b.customerId, $admin: user.role === 'admin' ? 1 : 0, $user: user.id }))) return send(res, 404, { error: 'Customer not found' });
    const fields = json(variant, 'fields_json', []);
    for (const field of fields) {
      const value = String(b.details?.[field.label] ?? '').trim();
      if (field.type === 'select' && !field.options.includes(value)) return send(res, 400, { error: `Choose ${field.label}` });
      if (value && field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return send(res, 400, { error: `Invalid ${field.label}` });
      if (value && field.type === 'number' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return send(res, 400, { error: `Invalid ${field.label}` });
    }
    // Supabase is the primary store; Google availability must not block intake.
    if (process.env.DRIVE_MODE === 'live' && !storageEnabled()) await verifyDriveRoot();
    let customerId = b.customerId;
    if (!customerId) {
      customerId = id('cus');
      (await run('INSERT INTO customers VALUES ($id,$name,$mobile,$email,$address,$created_by,$created_at)', { $id: customerId, $name: b.customer.name, $mobile: b.customer.mobile, $email: b.customer.email || '', $address: b.customer.address || '', $created_by: user.id, $created_at: now() }));
    }
    const allowedFields = new Set(json(variant, 'fields_json', []).map(field => field.label).filter(label => !/password/i.test(label)));
    const details = Object.fromEntries(Object.entries(b.details || {}).filter(([key, value]) => allowedFields.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')).map(([key, value]) => [key, String(value).slice(0, 500)]));
    const caseId = id('case');
    (await run(`INSERT INTO cases VALUES ($id,$ref,$customer_id,$service_id,$variant_id,$sales_user_id,NULL,'Draft','Normal',NULL,'SO-CONSENT-2026-01',$consent_at,$details,NULL,NULL,'missing','unpaid',NULL,NULL,$created_at,$updated_at,NULL,NULL)`,
      { $id: caseId, $ref: (await nextCaseRef()), $customer_id: customerId, $service_id: variant.service_id, $variant_id: variant.id, $sales_user_id: user.id, $consent_at: b.consent ? now() : null, $details: JSON.stringify(details), $created_at: now(), $updated_at: now() }));
    (await recomputeCase(caseId));
    (await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)', { $id: id('aud'), $actor: user.id, $action: 'case.create', $type: 'case', $entity: caseId, $reason: '', $at: now() }));
    send(res, 201, { case: (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: caseId })))) });
  });
  const caseMatch = url.pathname.match(/^\/api\/cases\/([^/]+)(?:\/([^/]+))?$/);
  if (caseMatch) {
    const c = (await one('SELECT * FROM cases WHERE id=$id OR ref=$id' + (db.cloud && req.method === 'POST' ? ' FOR UPDATE' : ''), { $id: caseMatch[1] }));
    if (!c || !canSee(user, c)) return send(res, c ? 403 : 404, { error: c ? 'Not allowed' : 'Not found' });
    if (req.method === 'GET' && caseMatch[2] === 'download-all') {
      if (!['backoffice','admin'].includes(user.role)) return send(res, 403, { error: 'Only back office or admin can download a case bundle' });
      const documents = (await all("SELECT * FROM documents WHERE case_id=$id AND state='uploaded' ORDER BY doc_type", { $id: c.id }));
      if (!documents.length) return send(res, 409, { error: 'No files have been uploaded for this case' });
      const bundleLimit = storageEnabled() ? downloadFileLimit() : 200_000_000;
      if (documents.reduce((total, d) => total + d.size, 0) > bundleLimit) return send(res, 413, { error: `Case bundle exceeds ${bundleLimit / 1000000} MB; download files individually` });
      const item = (await caseRow(c));
      const folder = safeFileName(url.searchParams.get('folder') || `${c.ref} - ${item.customer.name} - ${item.service.name}`);
      const entries = [];
      for (const document of documents) entries.push({ name: `${folder}/${safeFileName(document.doc_type)}/${safeFileName(document.file_name)}`, data: await readDocument(document) });
      const content = createZip(entries);
      if (storageEnabled()) {
        const path = `downloads/${randomUUID()}/${folder}.zip`;
        await writeStorage(path,content,'application/zip');
        return redirect(res,await signedDownload(path,folder + '.zip'));
      }
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': content.length, 'content-disposition': `attachment; filename="case-files.zip"; filename*=UTF-8''${encodeURIComponent(folder + '.zip')}` });
      return res.end(content);
    }
    if (req.method === 'GET' && !caseMatch[2]) return send(res, 200, { case: (await caseRow(c)), documents: (await all('SELECT * FROM documents WHERE case_id=$id ORDER BY created_at', { $id: c.id })).map(publicDocument), notes: (await all('SELECT n.*,u.name actor FROM notes n JOIN users u ON u.id=n.actor_id WHERE case_id=$id AND ($role!=$sales OR visibility=$sales) ORDER BY created_at', { $id: c.id, $role: user.role, $sales: 'sales' })) });
    if (req.method === 'POST' && caseMatch[2] === 'upload-url') {
      const b = await body(req);
      if (!storageEnabled()) return send(res,503,{error:'Private cloud document storage is not configured.'});
      if (['Closed','Delivered','Cancelled'].includes(c.status)) return send(res,409,{error:'This case is closed for uploads'});
      const variant = await one('SELECT documents_json FROM variants WHERE id=$id',{$id:c.variant_id});
      if (b.docType === RECEIVED_DOCUMENT_TYPE ? !['backoffice','admin'].includes(user.role) || c.status !== 'Document Received' : !json(variant,'documents_json',[]).some(d => d.label === b.docType)) return send(res,403,{error:'Document type or role is not allowed for this case.'});
      if (typeof b.fileName !== 'string' || !b.fileName || b.fileName.length > 255 || !['image/jpeg','image/png','application/pdf'].includes(b.mimeType) || !Number.isInteger(b.size) || b.size <= 0 || b.size > 10000000) return send(res,400,{error:'Choose JPG, PNG or PDF up to 10 MB.'});
      const uploadId = id('upload'), path = `staging/${c.id}/${randomUUID()}`;
      const {data,error} = await storage().createSignedUploadUrl(path);
      if (error) throw Object.assign(new Error('Could not authorize the document upload.'),{status:502});
      await run('INSERT INTO upload_intents VALUES ($id,$case,$user,$type,$name,$mime,$size,$path,$expires,NULL)',{$id:uploadId,$case:c.id,$user:user.id,$type:b.docType,$name:b.fileName,$mime:b.mimeType,$size:b.size,$path:path,$expires:new Date(Date.now()+2*3600000).toISOString()});
      return send(res,201,{uploadId,uploadUrl:data.signedUrl});
    }
    if (req.method === 'POST' && caseMatch[2] === 'documents') return body(req).then(async b => {
      let intent;
      if (b.uploadId) {
        intent = await one('SELECT * FROM upload_intents WHERE id=$id AND case_id=$case AND user_id=$user',{$id:b.uploadId,$case:c.id,$user:user.id});
        if (!intent) return send(res,404,{error:'Upload authorization not found.'});
        if (intent.completed_at) return send(res,200,{ok:true,case:await caseRow(c)});
        if (intent.expires_at < now()) return send(res,409,{error:'Upload authorization expired. Select the file again.'});
        Object.assign(b,{docType:intent.doc_type,fileName:intent.file_name,mimeType:intent.mime_type,size:intent.size});
      } else if (process.env.VERCEL) return send(res,400,{error:'Use the signed cloud upload flow for documents.'});
      if (['Closed','Delivered','Cancelled'].includes(c.status)) return send(res, 409, { error: 'This case is closed for uploads' });
      const variant = (await one('SELECT documents_json FROM variants WHERE id=$id', { $id: c.variant_id }));
      const allowed = json(variant, 'documents_json', []).map(d => d.label);
      const isReceivedDocument = b.docType === RECEIVED_DOCUMENT_TYPE;
      if (isReceivedDocument && (!['backoffice','admin'].includes(user.role) || c.status !== 'Document Received')) {
        return send(res, 403, { error: 'The received document can only be uploaded by back office when the status is Document Received' });
      }
      if (!isReceivedDocument && !allowed.includes(b.docType)) return send(res, 400, { error: 'Document type is not in this checklist' });
      if (typeof b.fileName !== 'string' || !b.fileName || b.fileName.length > 255) return send(res, 400, { error: 'A valid file name is required' });
      if (!['image/jpeg','image/png','application/pdf'].includes(b.mimeType) || Number(b.size) > 10_000_000) return send(res, 400, { error: 'Only JPG, PNG, or PDF up to 10 MB is allowed' });
      const customer = (await one('SELECT * FROM customers WHERE id=$id', { $id: c.customer_id }));
      const service = (await one('SELECT * FROM services WHERE id=$id', { $id: c.service_id }));
      const safeName = `${b.docType} - ${customer.name} - ${c.ref}${extname(b.fileName) || '.bin'}`.replace(/[\\/:*?"<>|]/g, '-');
      const content = intent ? await readStorage(intent.storage_path) : Buffer.from(b.content || '', 'base64');
      if (!content.length || content.length > 10_000_000) return send(res, 400, { error: 'Uploaded file content is empty or exceeds 10 MB' });
      if (intent && content.length !== intent.size) return send(res,400,{error:'Upload size does not match the selected document.'});
      const signatureOK = b.mimeType === 'application/pdf' ? content.subarray(0, 5).toString() === '%PDF-' : b.mimeType === 'image/png' ? content.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : content[0] === 255 && content[1] === 216 && content[2] === 255;
      if (!signatureOK) return send(res, 400, { error: 'File content does not match JPG, PNG, or PDF format' });
      let storage;
      let driveFileId;
      let googleSyncError;
      if (process.env.DRIVE_MODE === 'live') {
        try {
          if(process.env.GOOGLE_RECONNECT_REQUIRED==='1' && storageEnabled()) throw Object.assign(new Error('Google reconnection is required'),{status:409,code:'GOOGLE_RECONNECT_REQUIRED'});
          const folders = await driveFoldersForCase(c, customer, service);
          const uploaded = await uploadDriveFile(safeName, b.mimeType, folders.caseFolderId, content);
          storage = `gdrive://${uploaded.id}`;
          driveFileId = uploaded.id;
        } catch (error) {
          if (!storageEnabled()) throw error;
          googleSyncError = error.code || 'GOOGLE_SYNC_FAILED';
        }
      } else if (!storageEnabled()) {
        const folder = join(DEMO_ROOT, 'Success Online Customers', customerDriveFolderName(customer), safeFileName(`${c.ref} - ${service.name}`));
        mkdirSync(folder, { recursive: true });
        storage = join(folder, `${randomUUID()} - ${safeName}`);
        writeFileSync(storage, content);
        driveFileId = `demo-drive-${randomUUID()}`;
      }
      if (storageEnabled()) {
        const path = `cases/${c.id}/${randomUUID()}/${safeFileName(safeName)}`;
        await writeStorage(path,content,b.mimeType);
        storage = `supabase://${path}`;
        driveFileId ||= '';
      }
      const old = (await one('SELECT MAX(version) v FROM documents WHERE case_id=$id AND doc_type=$t', { $id: c.id, $t: b.docType }))?.v || 0;
      if (old) (await run('UPDATE documents SET state=$replaced WHERE case_id=$id AND doc_type=$t AND state!=$replaced', { $id: c.id, $t: b.docType, $replaced: 'replaced' }));
      const documentId = id('doc');
      (await run('INSERT INTO documents VALUES ($id,$case_id,$doc_type,$file_name,$mime_type,$size,$storage,$drive,$state,$version,$created)', { $id: documentId, $case_id: c.id, $doc_type: b.docType, $file_name: safeName, $mime_type: b.mimeType, $size: content.length, $storage: storage, $drive: driveFileId, $state: 'uploaded', $version: old + 1, $created: now() }));
      if (googleSyncError) await run('INSERT INTO sync_jobs VALUES ($id,$type,$entity,$status,1,$error,$at,$at)',{$id:id('sync'),$type:'drive',$entity:documentId,$status:'failed',$error:googleSyncError,$at:now()});
      if (intent) await run('UPDATE upload_intents SET completed_at=$at WHERE id=$id',{$id:intent.id,$at:now()});
      if (intent) await run('UPDATE upload_intents SET expires_at=$at WHERE case_id=$case AND doc_type=$type AND completed_at IS NULL',{$at:now(),$case:c.id,$type:b.docType});
      (await recomputeCase(c.id));
      send(res, 201, { ok: true, googleSyncPending:Boolean(googleSyncError), case: (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: c.id })))) });
    });
    if (req.method === 'POST' && caseMatch[2] === 'payment-order') {
      if (!(await documentGate(c, res))) return;
      if (process.env.PAYMENT_MODE !== 'demo') return send(res, 409, { error: 'Live payment gateway is not configured' });
      const v = (await one('SELECT * FROM variants WHERE id=$id', { $id: c.variant_id }));
      const a = amounts(v), order = `demo_order_${randomUUID()}`;
      (await run('INSERT INTO payments VALUES ($id,$case_id,$gateway,$order,NULL,$amount,$sc,$fee,$tax,$status,NULL,$created)', { $id: id('pay'), $case_id: c.id, $gateway: 'demo', $order: order, $amount: a.total, $sc: a.serviceCharge, $fee: a.officialFee, $tax: a.tax, $status: 'created', $created: now() }));
      return send(res, 201, { orderId: order, amount: a.total, upiIntent: `upi://pay?pa=demo@upi&pn=Success%20Online&am=${(a.total/100).toFixed(2)}&cu=INR` });
    }
    if (req.method === 'POST' && caseMatch[2] === 'verify-payment') return body(req).then(async b => {
      if (!(await documentGate(c, res))) return;
      if (process.env.PAYMENT_MODE !== 'demo') return send(res, 409, { error: 'Live payment gateway is not configured' });
      const p = (await one('SELECT * FROM payments WHERE gateway_order_id=$o AND case_id=$c', { $o: b.orderId, $c: c.id }));
      if (!p) return send(res, 404, { error: 'Payment order not found' });
      if (p.status !== 'verified') (await run('UPDATE payments SET status=$status, transaction_id=$tx, verified_at=$at WHERE id=$id', { $status: 'verified', $tx: `demo_txn_${randomUUID()}`, $at: now(), $id: p.id }));
      (await recomputeCase(c.id));
      send(res, 200, { ok: true, case: (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: c.id })))) });
    });
    if (req.method === 'POST' && caseMatch[2] === 'claim') {
      if (user.role !== 'backoffice') return send(res, 403, { error: 'Only back office can claim cases' });
      if (!(await documentGate(c, res))) return;
      const result = (await run("UPDATE cases SET backoffice_user_id=$u,status='Assigned',updated_at=$at WHERE id=$id AND backoffice_user_id IS NULL AND status='Ready for Assignment'", { $u: user.id, $at: now(), $id: c.id }));
      if (!result.changes) return send(res, 409, { error: 'Case was already claimed or is not ready' });
      (await syncCase(c.id));
      return send(res, 200, { case: (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: c.id })))) });
    }
    if (req.method === 'POST' && caseMatch[2] === 'submit-received-document') {
      if (!['backoffice','admin'].includes(user.role)) return send(res, 403, { error: 'Only back office or admin can complete cases' });
      if (!(await documentGate(c, res))) return;
      if (c.status !== 'Document Received') return send(res, 400, { error: 'Only a case with a received document can be completed' });
      const receivedDocument = (await one('SELECT id FROM documents WHERE case_id=$id AND doc_type=$type AND state!=$replaced ORDER BY created_at DESC LIMIT 1', { $id: c.id, $type: RECEIVED_DOCUMENT_TYPE, $replaced: 'replaced' }));
      if (!receivedDocument) return send(res, 400, { error: 'Upload the received document before submitting this case' });
      const at = now();
      (await run('UPDATE cases SET status=$status,completed_at=$at,updated_at=$at WHERE id=$id', { $status: 'Closed', $at: at, $id: c.id }));
      (await run('INSERT INTO notes VALUES ($id,$case,$actor,$old,$new,$note,$vis,$next,$at)', { $id: id('note'), $case: c.id, $actor: user.id, $old: c.status, $new: 'Closed', $note: 'Received document submitted and request closed', $vis: 'sales', $next: '', $at: at }));
      (await syncCase(c.id));
      return send(res, 200, { case: (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: c.id })))) });
    }
    if (req.method === 'POST' && caseMatch[2] === 'progress') return body(req).then(async b => {
      if (!['backoffice','admin'].includes(user.role)) return send(res, 403, { error: 'Only back office or admin can update progress' });
      if (!transitions[c.status]?.includes(b.status)) return send(res, 400, { error: `Cannot move from ${c.status} to ${b.status}` });
      if (!['Awaiting Documents','Correction Required','Customer Action Required','Rejected','Cancelled'].includes(b.status) && !(await documentGate(c, res))) return;
      if (['Ready for Assignment','Assigned'].includes(b.status) && c.payment_state !== 'paid') return send(res, 409, { error: 'Verified payment is required before assignment' });
      if (['Correction Required','Rejected','Cancelled'].includes(b.status) && !b.note) return send(res, 400, { error: 'A reason is required' });
      (await run('UPDATE cases SET status=$s,follow_up_date=$f,official_reference=COALESCE($r,official_reference),completed_at=CASE WHEN $s IN ($delivered,$closed) THEN $at ELSE completed_at END,updated_at=$at WHERE id=$id', { $s: b.status, $f: b.followUpDate || null, $r: b.officialReference || null, $delivered: 'Delivered', $closed: 'Closed', $at: now(), $id: c.id }));
      (await run('INSERT INTO notes VALUES ($id,$case,$actor,$old,$new,$note,$vis,$next,$at)', { $id: id('note'), $case: c.id, $actor: user.id, $old: c.status, $new: b.status, $note: b.note || '', $vis: b.visibility || 'sales', $next: b.nextAction || '', $at: now() }));
      (await syncCase(c.id));
      send(res, 200, { case: (await caseRow((await one('SELECT * FROM cases WHERE id=$id', { $id: c.id })))) });
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    const period = analyticsPeriod(url.searchParams.get('period'));
    const params = { $start: period.start };
    const casesSummary = (await one(`SELECT SUM(CASE WHEN created_at >= $start THEN 1 ELSE 0 END) new_cases,
      SUM(CASE WHEN completed_at >= $start THEN 1 ELSE 0 END) completed,
      AVG(CASE WHEN completed_at >= $start THEN julianday(completed_at)-julianday(created_at) END) avg_turnaround
      FROM cases WHERE created_at >= $start OR completed_at >= $start`, params));
    const paymentSummary = (await one(`SELECT COUNT(*) payments,COALESCE(SUM(amount),0) collected,
      COALESCE(SUM(service_charge + tax),0) business_revenue,COALESCE(SUM(official_fee),0) official_fees
      FROM payments WHERE status IN ('verified','offline_approved') AND COALESCE(verified_at,created_at) >= $start`, params));
    const outstanding = (await one(`SELECT COALESCE(SUM(v.service_charge + v.official_fee + ROUND(v.service_charge*v.tax_rate/100)),0) n
      FROM cases c JOIN variants v ON v.id=c.variant_id WHERE c.payment_state='unpaid' AND c.status!='Cancelled'`)).n;
    const operations = {
      active: (await one("SELECT COUNT(*) n FROM cases WHERE status NOT IN ('Closed','Delivered','Cancelled','Rejected')")).n,
      ready: (await one("SELECT COUNT(*) n FROM cases WHERE status='Ready for Assignment' AND backoffice_user_id IS NULL")).n,
      missingDocuments: (await one("SELECT COUNT(*) n FROM cases WHERE document_state='missing' AND status NOT IN ('Closed','Cancelled')")).n,
      unpaid: (await one("SELECT COUNT(*) n FROM cases WHERE payment_state='unpaid' AND status NOT IN ('Closed','Cancelled')")).n,
      followUpsDue: (await one("SELECT COUNT(*) n FROM cases WHERE follow_up_date IS NOT NULL AND follow_up_date <= date('now') AND status NOT IN ('Closed','Delivered','Cancelled','Rejected')")).n,
      overdue: (await one("SELECT COUNT(*) n FROM cases WHERE due_date IS NOT NULL AND due_date < date('now') AND status NOT IN ('Closed','Delivered','Cancelled','Rejected')")).n,
      syncFailures: (await one("SELECT COUNT(*) n FROM sync_jobs WHERE status='failed'")).n
    };
    const statusBreakdown = (await all(`SELECT status,COUNT(*) count FROM cases WHERE created_at >= $start GROUP BY status ORDER BY count DESC`, params));
    const serviceCases = (await all(`SELECT s.id,s.name,COUNT(c.id) cases,
      SUM(CASE WHEN c.completed_at >= $start THEN 1 ELSE 0 END) completed
      FROM services s LEFT JOIN cases c ON c.service_id=s.id AND c.created_at >= $start
      GROUP BY s.id ORDER BY cases DESC`, params));
    const serviceMoney = (await all(`SELECT c.service_id,COALESCE(SUM(p.amount),0) collected,COALESCE(SUM(p.service_charge+p.tax),0) revenue
      FROM payments p JOIN cases c ON c.id=p.case_id
      WHERE p.status IN ('verified','offline_approved') AND COALESCE(p.verified_at,p.created_at) >= $start GROUP BY c.service_id`, params));
    const moneyByService = new Map(serviceMoney.map(row => [row.service_id, row]));
    const servicePerformance = serviceCases.map(row => ({ ...row, collected: moneyByService.get(row.id)?.collected || 0, revenue: moneyByService.get(row.id)?.revenue || 0 }));
    const salesPerformance = (await all(`SELECT u.id,u.name,u.role,COUNT(DISTINCT c.id) cases,
      SUM(CASE WHEN c.completed_at >= $start THEN 1 ELSE 0 END) completed,
      COALESCE((SELECT SUM(p.amount) FROM payments p JOIN cases pc ON pc.id=p.case_id WHERE pc.sales_user_id=u.id AND p.status IN ('verified','offline_approved') AND COALESCE(p.verified_at,p.created_at) >= $start),0) collected
      FROM users u LEFT JOIN cases c ON c.sales_user_id=u.id AND c.created_at >= $start
      WHERE u.role='sales' AND u.active=1 GROUP BY u.id ORDER BY collected DESC,cases DESC`, params));
    const backofficePerformance = (await all(`SELECT u.id,u.name,u.role,COUNT(DISTINCT CASE WHEN c.updated_at >= $start THEN c.id END) assigned,
      SUM(CASE WHEN c.completed_at >= $start THEN 1 ELSE 0 END) completed,
      SUM(CASE WHEN c.status NOT IN ('Closed','Delivered','Cancelled','Rejected') THEN 1 ELSE 0 END) active
      FROM users u LEFT JOIN cases c ON c.backoffice_user_id=u.id
      WHERE u.role='backoffice' AND u.active=1 GROUP BY u.id ORDER BY completed DESC,assigned DESC`, params));
    const bucket = period.group === 'day' ? "date(created_at)" : "strftime('%Y-%m',created_at)";
    const paymentBucket = period.group === 'day' ? "date(COALESCE(verified_at,created_at))" : "strftime('%Y-%m',COALESCE(verified_at,created_at))";
    const caseTrend = (await all(`SELECT ${bucket} bucket,COUNT(*) cases FROM cases WHERE created_at >= $start GROUP BY bucket ORDER BY bucket`, params));
    const paymentTrend = (await all(`SELECT ${paymentBucket} bucket,COALESCE(SUM(amount),0) collected FROM payments WHERE status IN ('verified','offline_approved') AND COALESCE(verified_at,created_at) >= $start GROUP BY bucket ORDER BY bucket`, params));
    const trendMap = new Map(caseTrend.map(row => [row.bucket, { bucket: row.bucket, cases: row.cases, collected: 0 }]));
    for (const row of paymentTrend) trendMap.set(row.bucket, { ...(trendMap.get(row.bucket) || { bucket: row.bucket, cases: 0 }), collected: row.collected });
    const recentPayments = (await all(`SELECT p.id,p.amount,p.status,p.gateway,p.transaction_id,p.verified_at,c.ref,cu.name customer
      FROM payments p JOIN cases c ON c.id=p.case_id JOIN customers cu ON cu.id=c.customer_id
      WHERE p.status IN ('verified','offline_approved') AND COALESCE(p.verified_at,p.created_at) >= $start
      ORDER BY COALESCE(p.verified_at,p.created_at) DESC LIMIT 10`, params));
    return send(res, 200, {
      period,
      metrics: {
        newCases: casesSummary.new_cases || 0, completed: casesSummary.completed || 0,
        averageTurnaroundDays: Math.round((casesSummary.avg_turnaround || 0) * 10) / 10,
        payments: paymentSummary.payments || 0, collected: paymentSummary.collected || 0,
        businessRevenue: paymentSummary.business_revenue || 0, officialFees: paymentSummary.official_fees || 0,
        outstanding
      },
      operations, statusBreakdown, servicePerformance,
      staffPerformance: { sales: salesPerformance, backoffice: backofficePerformance },
      trend: [...trendMap.values()].sort((a,b) => a.bucket.localeCompare(b.bucket)),
      recentPayments,
      integrations: { drive: process.env.DRIVE_MODE === 'live', sheets: process.env.SHEETS_MODE === 'live' }
    });
  }
  if (url.pathname === '/api/admin/employees') {
    if (user.role !== 'admin') return send(res, 403, { error: 'Admin access required' });
    if (req.method === 'POST') return body(req).then(async b => {
      const username = String(b.username || '').trim().toLowerCase();
      const name = String(b.name || '').trim();
      if (!['sales','backoffice'].includes(b.role) || !name || name.length > 100 || !/^[a-z0-9._-]{3,50}$/.test(username) || typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128) return send(res, 400, { error: 'Enter a name, sales/back-office role, username (3–50 letters, numbers, dots, underscores or hyphens), and password (10–128 characters).' });
      if ((await one('SELECT id FROM users WHERE username=$username COLLATE NOCASE', { $username: username }))) return send(res, 409, { error: 'Username already exists' });
      const employee = { id: id('usr'), username, name, role: b.role, active: 1 };
      (await run('INSERT INTO users VALUES ($id,$username,$name,$role,$hash,1,$at)', { $id: employee.id, $username: username, $name: name, $role: b.role, $hash: hashPassword(b.password), $at: now() }));
      (await run('INSERT INTO audit_logs VALUES ($id,$actor,$action,$type,$entity,$reason,$at)', { $id: id('aud'), $actor: user.id, $action: 'employee.create', $type: 'user', $entity: employee.id, $reason: b.role, $at: now() }));
      return send(res, 201, { employee });
    });
    if (req.method === 'GET') {
      let period = analyticsPeriod(url.searchParams.get('period'));
      if (url.searchParams.get('period') === 'custom') {
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
        if (!valid(from) || !valid(to) || from > to) return send(res, 400, { error: 'Choose a valid start and end date, with start before end.' });
        period = { key: 'custom', start: new Date(from + 'T00:00:00+05:30').toISOString(), end: new Date(Date.parse(to + 'T00:00:00+05:30') + 86400000).toISOString() };
      }
      const within = value => value && value >= period.start && value < period.end;
      const work = (await all('SELECT * FROM cases'));
      const payments = (await all("SELECT p.*,c.sales_user_id FROM payments p JOIN cases c ON c.id=p.case_id WHERE p.status IN ('verified','offline_approved')"));
      const activity = (await all('SELECT actor_id,case_id,created_at FROM notes'));
      const employees = (await all("SELECT id,username,name,role,active FROM users WHERE role IN ('sales','backoffice') ORDER BY role,name")).map(employee => {
        const owned = work.filter(c => c[employee.role === 'sales' ? 'sales_user_id' : 'backoffice_user_id'] === employee.id);
        const completed = owned.filter(c => within(c.completed_at) && ['Closed','Delivered'].includes(c.status));
        const open = owned.filter(c => !['Closed','Delivered','Cancelled','Rejected'].includes(c.status));
        return { ...employee, cases: owned.filter(c => within(c.created_at)).length, completed: completed.length,
          collected: employee.role === 'sales' ? payments.filter(p => p.sales_user_id === employee.id && within(p.verified_at || p.created_at)).reduce((sum,p) => sum + p.amount, 0) : 0,
          handled: new Set(activity.filter(n => n.actor_id === employee.id && within(n.created_at)).map(n => n.case_id)).size,
          activeCases: open.length, overdue: open.filter(c => c.due_date && c.due_date < now().slice(0,10)).length,
          turnaround: completed.length ? Math.round(completed.reduce((sum,c) => sum + (Date.parse(c.completed_at) - Date.parse(c.created_at)) / 86400000, 0) / completed.length * 10) / 10 : null };
      });
      return send(res, 200, { period, employees });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/users') return send(res, 200, { users: (await all('SELECT id,username,name,role,active FROM users ORDER BY role,username')) });
  send(res, 404, { error: 'Not found' });
}

function staticFile(req, res, url) {
  if (!['GET','HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed' });
  const path = resolve('public', url.pathname === '/' ? 'index.html' : '.' + decodeURIComponent(url.pathname));
  if (!path.startsWith(resolve('public') + '/') && !path.startsWith(resolve('public') + '\\')) { res.writeHead(403).end(); return; }
  if (!existsSync(path)) { res.writeHead(404).end('Not found'); return; }
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
}

let initialization;
export async function initialize({setup = false} = {}) {
  if (setup || !db.cloud) {
    if (!db.cloud) await migrate();
    await db.transaction(async () => {
      if (db.cloud) await db.exec(readFileSync(new URL('./supabase/schema.sql', import.meta.url),'utf8'));
      await seed();
      await seedServiceCatalog();
    });
  }
  for (const setting of await all('SELECT name,value FROM integration_settings')) process.env[setting.name] = setting.value;
}

export async function handler(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('cache-control', 'no-store');
  if (!['GET','HEAD'].includes(req.method) && req.headers.origin && req.headers.origin !== APP_ORIGIN) return send(res, 403, { error: 'Request origin is not allowed' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    initialization ||= initialize().catch(error => { initialization = null; throw error; });
    await initialization;
    if (!url.pathname.startsWith('/api/')) return staticFile(req, res, url);
    // Commit before sending success; a database failure must not appear successful.
    let response;
    const buffered = {
      writeHead(status, headers) { response = { status, headers }; return this; },
      end(content) { response ||= {status:200,headers:{}}; response.content = content; },
      setHeader(key,value) { res.setHeader(key,value); }
    };
    await db.transaction(async () => {
      if (db.cloud) for (const setting of await all('SELECT name,value FROM integration_settings')) process.env[setting.name] = setting.value;
      await routeApi(req, buffered, url);
    });
    res.writeHead(response.status, response.headers); res.end(response.content);
  } catch (error) {
    const status = error.status || (['23505','SQLITE_CONSTRAINT_UNIQUE'].includes(error.code) ? 409 : 500);
    if (status >= 500) console.error('Request failed:', error.code || error.name);
    send(res, status, { error: status >= 500 ? 'Server request failed. Check the server configuration and retry.' : error.message, ...(error.status && error.code ? {code:error.code} : {}) });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await initialize();
  initialization = Promise.resolve();
  http.createServer(handler).listen(PORT, () => console.log(`Success Online running at http://localhost:${PORT}`));
}
