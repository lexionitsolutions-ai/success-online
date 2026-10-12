const app = document.querySelector('#app');

let me = null;
let cases = [];
let services = [];
let demoPayments = false;
let cloudUploads = false;
let googleStatus = null;
let sheetsStatus = null;
let adminAnalytics = null;
let analyticsPeriod = 'month';
let view = 'dashboard';
let selectedCase = null;
let draft = { step: 1, customer: {}, details: {}, docs: {} };
let drawerBusy = false;
let employeeData = null;
let employeePeriod = 'month';
let employeeFrom = '';
let employeeTo = '';

function employeeUrl() {
  return '/api/admin/employees?' + new URLSearchParams({ period: employeePeriod, from: employeeFrom, to: employeeTo });
}

function setDrawerBusy(message = '') {
  const drawer = document.querySelector('#drawer');
  drawerBusy = !!message;
  if (!drawer) return;
  drawer.setAttribute('aria-busy', String(drawerBusy));
  drawer.querySelectorAll('button,input,select,textarea').forEach(control => {
    if (drawerBusy && !control.hasAttribute('data-was-disabled')) {
      control.dataset.wasDisabled = String(control.disabled);
      control.disabled = true;
    } else if (!drawerBusy && control.hasAttribute('data-was-disabled')) {
      control.disabled = control.dataset.wasDisabled === 'true';
      delete control.dataset.wasDisabled;
    }
  });
  let status = drawer.querySelector('.busy-status');
  if (!message) { status?.remove(); return; }
  if (!status) {
    drawer.querySelector('.drawer-head').insertAdjacentHTML('afterend', '<div class="busy-status" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span></span></div>');
    status = drawer.querySelector('.busy-status');
  }
  status.lastElementChild.textContent = message;
}

const money = value => `\u20B9${((value || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const number = value => Number(value || 0).toLocaleString('en-IN');
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const dateTime = value => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-';

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { code: data.code });
  return data;
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  document.body.append(item);
  setTimeout(() => item.remove(), 3600);
}

async function boot() {
  try {
    me = (await api('/api/me')).user;
    await load();
    const googleResult = new URLSearchParams(location.search).get('google');
    if (googleResult) {
      history.replaceState({}, '', location.pathname);
      toast(googleResult === 'connected' ? 'Google Drive connected and live' : 'Google Drive connection failed');
    }
  } catch {
    renderLogin();
  }
}

async function load() {
  const requests = [api('/api/services'), api('/api/cases')];
  const [serviceData, caseData] = await Promise.all(requests);
  services = serviceData.services;
  demoPayments = serviceData.demoPayments === true;
  cloudUploads = serviceData.cloudUploads === true;
  cases = caseData.cases;
  if(me.role==='admin') await loadViewData();
  else googleStatus=sheetsStatus=adminAnalytics=employeeData=null;
  render();
}

async function loadViewData() {
  if(view==='admin') [googleStatus,sheetsStatus,adminAnalytics] = await Promise.all([api('/api/google/status'),api('/api/google/sheets/status'),api(`/api/admin/dashboard?period=${analyticsPeriod}`)]);
  if(view==='employees') employeeData=await api(employeeUrl());
}

function renderLogin() {
  app.innerHTML = `<section class="login">
    <div class="login-brand"><div class="mark">SO</div><div><strong>Success Online</strong><span>Operations workspace</span></div></div>
    <form id="login" class="login-form">
      <div><p class="eyebrow">Secure staff access</p><h1>Welcome back</h1><p class="muted">Manage customer cases, documents, payments, and delivery from one workspace.</p></div>
      <label>Username<input name="username" required autocomplete="username"></label>
      <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
      <button class="primary full">Sign in</button>
    </form>
    <p class="login-legal">Success Online is a private assistance business and is not a government portal.</p>
  </section>`;
  document.querySelector('#login').onsubmit = async event => {
    event.preventDefault();
    try {
      me = (await api('/api/login', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) })).user;
      await load();
    } catch (error) { toast(error.message); }
  };
}

const navLabels = { dashboard: 'Overview', cases: 'Active Cases', completed: 'Completed Cases', payments: 'Pending Payments', queue: 'Operations', admin: 'Business analytics', employees: 'Employees' };

function shell(content) {
  const links = ['dashboard','cases','completed','payments','queue','admin','employees']
    .filter(item => item !== 'queue' || me.role !== 'sales')
    .filter(item => item !== 'payments' || me.role === 'admin')
    .filter(item => !['admin','employees'].includes(item) || me.role === 'admin');
  const canCreate = ['sales','admin'].includes(me.role);
  return `<div class="shell">
    <aside class="side">
      <div class="side-brand"><div class="mark">SO</div><div><strong>Success Online</strong><span>e-Seva operations</span></div></div>
      <nav class="nav">${links.map(item => `<button class="${view === item ? 'active' : ''}" onclick="setView('${item}')"><span>${navLabels[item]}</span></button>`).join('')}</nav>
      <div class="side-foot"><span class="live-dot"></span><div><strong>Workspace online</strong><small>Private assistance service</small></div></div>
    </aside>
    <div class="workspace">
      <header class="top">
        <div><span class="mobile-brand">Success Online</span><p>${h(me.name)} <span class="role">${h(me.role)}</span></p></div>
        <div class="top-actions">${canCreate ? '<button class="primary" onclick="startCase()">New case</button>' : ''}<button class="quiet" onclick="logout()">Sign out</button></div>
      </header>
      <main class="content">${content}</main>
    </div>
  </div>`;
}

function render() {
  if (!me) return renderLogin();
  const content = view === 'cases' ? renderCases() : view === 'completed' ? renderCompletedCases() : view === 'payments' ? renderPendingPayments() : view === 'queue' ? renderQueue() : view === 'admin' ? renderAdmin() : view === 'employees' ? renderEmployees() : renderDashboard();
  app.innerHTML = shell(content);
}

function pageHead(title, description, action = '') {
  return `<div class="page-head"><div><p class="eyebrow">${h(navLabels[view] || view)}</p><h1>${h(title)}</h1><p>${h(description)}</p></div>${action}</div>`;
}

function statusClass(status) {
  if (/Ready|Received|Approved|Delivered|Closed|paid/i.test(status)) return 'success';
  if (/Awaiting|Correction|Action|unpaid/i.test(status)) return 'warning';
  if (/Rejected|Cancelled|failed/i.test(status)) return 'danger';
  return 'neutral';
}
function statusBadge(status) { return `<span class="badge ${statusClass(status)}">${h(status)}</span>`; }

function metricCard(label, value, detail, tone = '') {
  return `<article class="metric-card ${tone}"><span>${h(label)}</span><strong>${value}</strong><small>${h(detail)}</small></article>`;
}

function counts() { return cases.reduce((result, item) => { result[item.status] = (result[item.status] || 0) + 1; return result; }, {}); }
const isCompletedCase = item => ['Closed','Delivered'].includes(item.status);

function renderDashboard() {
  const c = counts();
  const mine = (me.role === 'sales' ? cases : cases.filter(item => item.backoffice?.id === me.id || !item.backoffice)).filter(item => !isCompletedCase(item));
  const title = me.role === 'sales' ? 'Sales workspace' : 'Operations workspace';
  return `${pageHead(title, 'Priorities, customer cases, and work requiring action.')}
    <section class="metric-grid">
      ${metricCard('Open cases', number(mine.filter(item => !['Closed','Delivered','Cancelled'].includes(item.status)).length), 'Currently active')}
      ${metricCard('Missing documents', number(mine.filter(item => item.document_state === 'missing').length), 'Customer follow-up needed', 'amber')}
      ${metricCard('Payment pending', number(mine.filter(item => item.payment_state === 'unpaid').length), 'Awaiting collection', 'blue')}
      ${metricCard('Ready to assign', number(c['Ready for Assignment'] || 0), 'Available to operations', 'green')}
    </section>
    <section class="section-head"><div><h2>Needs attention</h2><p>Most recently updated cases in your workload.</p></div><button class="text-button" onclick="setView('cases')">View all cases</button></section>
    <div class="table-shell">${mine.length ? caseTable(mine.slice(0, 8)) : empty('No cases need attention right now.')}</div>`;
}

function renderCases() {
  const activeCases = cases.filter(item => !isCompletedCase(item));
  const action = ['sales','admin'].includes(me.role) ? '<button class="primary" onclick="startCase()">New case</button>' : '';
  return `${pageHead('Active Cases', 'Search and manage customer applications still in progress.', action)}
    ${caseToolbar(activeCases, false)}
    <div id="caseList" class="table-shell">${activeCases.length ? caseTable(activeCases) : empty('No active cases.')}</div>`;
}

function renderCompletedCases() {
  const completedCases = cases.filter(isCompletedCase);
  return `${pageHead('Completed Cases', 'Closed customer applications and their received documents.')}
    ${caseToolbar(completedCases, true)}
    <div id="caseList" class="table-shell">${completedCases.length ? caseTable(completedCases) : empty('No completed cases yet.')}</div>`;
}

function caseToolbar(rows, completed) {
  const serviceFilter = me.role === 'admin' ? `<label class="service-filter"><span>Service</span><select id="caseServiceFilter" onchange="filterCases(${completed})"><option value="">All services</option>${services.map(service => `<option value="${h(service.id)}">${h(service.name)}</option>`).join('')}</select></label>` : '';
  return `<div class="toolbar"><div class="toolbar-controls"><label class="search"><span>Search</span><input id="caseSearch" oninput="filterCases(${completed})" placeholder="Case ID, customer, service, phone"></label>${serviceFilter}</div><span id="caseListCount" class="count-label">${number(rows.length)} ${completed ? 'completed' : 'active'} cases</span></div>`;
}

function renderPendingPayments() {
  if (me.role !== 'admin') return empty('Admin access required.');
  const pending = cases.filter(item => item.payment_state === 'unpaid');
  return `${pageHead('Pending Payments', 'Clients whose payment has not yet been completed.')}
    <section class="metric-grid compact">
      ${metricCard('Pending clients', number(pending.length), 'Awaiting payment', 'amber')}
      ${metricCard('Amount pending', money(pending.reduce((total, item) => total + item.amounts.total, 0)), 'Total outstanding', 'blue')}
    </section>
    <section class="section-head"><div><h2>Unpaid clients</h2><p>Open a client to review the case or record payment.</p></div><span class="count-label">${number(pending.length)} clients</span></section>
    <div class="table-shell">${pending.length ? pendingPaymentTable(pending) : empty('No pending payments.')}</div>`;
}

function pendingPaymentTable(rows) {
  return `<table class="table"><thead><tr><th>Case</th><th>Client</th><th>Service</th><th>Case status</th><th>Amount due</th><th>Created</th></tr></thead><tbody>${rows.map(item => `<tr onclick="openCase('${item.id}')">
    <td><strong>${h(item.ref)}</strong></td><td><strong>${h(item.customer.name)}</strong><small>${h(item.customer.mobile.replace(/\d(?=\d{4})/g, 'x'))}</small></td>
    <td>${h(item.service.name)}<small>${h(item.variant.name)}</small></td><td>${statusBadge(item.status)}</td><td><strong>${money(item.amounts.total)}</strong>${statusBadge('Unpaid')}</td><td>${dateTime(item.created_at)}</td>
  </tr>`).join('')}</tbody></table>`;
}

function caseTable(rows) {
  return `<table class="table"><thead><tr><th>Case</th><th>Customer</th><th>Service</th><th>Status</th><th>Payment</th><th>Owner</th><th>Updated</th></tr></thead><tbody>${rows.map(item => `<tr onclick="openCase('${item.id}')">
    <td><strong>${h(item.ref)}</strong><small>${h(item.priority)}</small></td>
    <td><strong>${h(item.customer.name)}</strong><small>${h(item.customer.mobile.replace(/\d(?=\d{4})/g, 'x'))}</small></td>
    <td>${h(item.service.name)}<small>${h(item.variant.name)}</small></td>
    <td>${statusBadge(item.status)}</td><td>${statusBadge(item.payment_state)}</td>
    <td>${h(item.backoffice?.name || 'Unassigned')}</td><td>${dateTime(item.updated_at)}</td>
  </tr>`).join('')}</tbody></table>`;
}

function renderQueue() {
  const rows = cases.filter(item => item.status !== 'Draft' && !isCompletedCase(item));
  const groups = ['Ready for Assignment','Assigned','Submitted to Official Portal','Document Received'];
  return `${pageHead('Operations queue', 'Claim, review, submit, and follow up on customer cases.')}
    <section class="metric-grid compact">${groups.map((status, index) => metricCard(status, number(rows.filter(item => item.status === status).length), index === 0 ? 'Unassigned work' : 'Current workload', index === 0 ? 'green' : ''))}</section>
    <div class="table-shell">${rows.length ? caseTable(rows) : empty('The operations queue is clear.')}</div>`;
}

function periodControl() {
  const periods = [['week','7 days'],['month','Month'],['quarter','Quarter'],['year','Year'],['all','All time']];
  return `<div class="segmented" aria-label="Analytics period">${periods.map(([key,label]) => `<button class="${analyticsPeriod === key ? 'active' : ''}" onclick="setAnalyticsPeriod('${key}')">${label}</button>`).join('')}</div>`;
}

function horizontalBars(rows, valueKey, formatter = number) {
  const max = Math.max(1, ...rows.map(item => Number(item[valueKey] || 0)));
  return rows.length ? `<div class="bar-list">${rows.map(item => `<div class="bar-row"><div><span>${h(item.name || item.status)}</span><strong>${formatter(item[valueKey])}</strong></div><div class="bar-track"><i style="width:${Math.max(3, Number(item[valueKey] || 0) / max * 100)}%"></i></div></div>`).join('')}</div>` : empty('No data for this period.');
}

function trendChart(rows) {
  const max = Math.max(1, ...rows.map(item => Number(item.collected || 0)));
  return rows.length ? `<div class="trend-chart">${rows.map(item => `<div class="trend-column" title="${h(item.bucket)}: ${money(item.collected)}"><div class="trend-value">${item.collected ? money(item.collected) : ''}</div><i style="height:${Math.max(5, Number(item.collected || 0) / max * 100)}%"></i><span>${h(item.bucket.slice(5))}</span></div>`).join('')}</div>` : empty('No collections recorded for this period.');
}

function renderAdmin() {
  if(me.role!=='admin') return empty('Admin access required.');
  if (!adminAnalytics) return empty('Loading business analytics...');
  const data = adminAnalytics;
  const m = data.metrics;
  const o = data.operations;
  const driveLabel = googleStatus?.reconnectRequired ? 'Reconnect required' : googleStatus?.folderInvalid ? 'Folder needs correction' : googleStatus?.live ? 'Live' : googleStatus?.connected ? 'Connected' : 'Not connected';
  const sheetsLabel = sheetsStatus?.live ? 'Live' : sheetsStatus?.configured ? 'Ready' : 'Not configured';
  return `${pageHead('Business analytics', 'Financial performance, team output, and operational health.', periodControl())}
    <section class="metric-grid admin-metrics">
      ${metricCard('Collections', money(m.collected), `${number(m.payments)} verified payments`, 'green')}
      ${metricCard('Business revenue', money(m.businessRevenue), 'Service charges and tax', 'blue')}
      ${metricCard('New cases', number(m.newCases), `${number(m.completed)} completed`, '')}
      ${metricCard('Outstanding', money(m.outstanding), 'Across all unpaid active cases', 'amber')}
    </section>
    <section class="operations-strip">
      <div><strong>${number(o.active)}</strong><span>Active</span></div><div><strong>${number(o.ready)}</strong><span>Ready to assign</span></div>
      <div><strong>${number(o.missingDocuments)}</strong><span>Missing documents</span></div><div><strong>${number(o.unpaid)}</strong><span>Unpaid</span></div>
      <div><strong>${number(o.followUpsDue)}</strong><span>Follow-ups due</span></div><div><strong>${number(o.syncFailures)}</strong><span>Sync failures</span></div>
    </section>
    <div class="analytics-grid">
      <section class="analytics-panel span-2"><div class="panel-title"><div><h2>Collections trend</h2><p>Verified customer payments during the selected period.</p></div><strong>${money(m.collected)}</strong></div>${trendChart(data.trend)}</section>
      <section class="analytics-panel"><div class="panel-title"><div><h2>Case status</h2><p>Applications opened in this period.</p></div></div>${horizontalBars(data.statusBreakdown, 'count')}</section>
      <section class="analytics-panel"><div class="panel-title"><div><h2>Service performance</h2><p>Cases and collected value by service.</p></div></div>${servicePerformance(data.servicePerformance)}</section>
      <section class="analytics-panel span-2"><div class="panel-title"><div><h2>Sales performance</h2><p>Case acquisition, completions, and collections.</p></div></div>${staffTable(data.staffPerformance.sales, 'sales')}</section>
      <section class="analytics-panel"><div class="panel-title"><div><h2>Back-office workload</h2><p>Assigned work and delivery output.</p></div></div>${staffTable(data.staffPerformance.backoffice, 'backoffice')}</section>
      <section class="analytics-panel"><div class="panel-title"><div><h2>Recent payments</h2><p>Latest verified collections.</p></div></div>${paymentList(data.recentPayments)}</section>
      <section class="analytics-panel span-2"><div class="panel-title"><div><h2>Connected services</h2><p>Operational data destinations and health.</p></div></div><div class="integration-list">
        <div><span class="integration-mark drive">D</span><div><strong>Google Drive</strong><small>${googleStatus?.reconnectRequired ? 'Authorization expired. Reconnect to resume uploads.' : 'Customer document storage'}</small></div>${statusBadge(driveLabel)}<button onclick="connectGoogleDrive()">${googleStatus?.reconnectRequired ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button></div>
        <div><span class="integration-mark sheets">S</span><div><strong>Google Sheets</strong><small>Operations reporting mirror</small></div>${statusBadge(sheetsLabel)}<button onclick="activateGoogleSheets()">Activate Google Sheets</button></div>
      </div><div class="summary-box"><label>Main Google Drive folder<input id="driveRootFolder" placeholder="Paste the Google Drive folder link" value="${h(googleStatus?.rootFolderId || '')}"></label><p>Use a folder the connected business Google account can edit.</p><button onclick="saveDriveRootFolder(this)">Verify and save folder</button><p>For a Google redirect mismatch, add this exact URL under Authorized redirect URIs in your OAuth client:</p><code style="overflow-wrap:anywhere">${h(googleStatus?.callbackUrl || location.origin + '/api/google/oauth/callback')}</code>${googleStatus?.oauthClientSettingsUrl ? `<p><a href="${h(googleStatus.oauthClientSettingsUrl)}" target="_blank" rel="noopener noreferrer">Open Google OAuth client settings</a></p>` : ''}</div></section>
    </div>
    <section class="section-head"><div><h2>All cases</h2><p>Complete operational register.</p></div><span class="count-label">${number(cases.length)} total</span></section>
    <div class="table-shell">${caseTable(cases)}</div>`;
}

function renderEmployees() {
  if (me.role !== 'admin') return empty('Admin access required.');
  if (!employeeData) return empty('Loading employee performance...');
  const rows = employeeData?.employees || [];
  const table = role => {
    const staff = rows.filter(item => item.role === role);
    return staff.length ? `<div class="table-shell"><table class="table"><thead><tr><th>Employee</th>${role === 'sales' ? '<th>New cases</th><th>Collections</th>' : '<th>Cases handled</th>'}<th>Completed</th><th>Avg. turnaround</th><th>Current active</th><th>Current overdue</th></tr></thead><tbody>${staff.map(item => `<tr><td><strong>${h(item.name)}</strong><small>${h(item.username)} · ${item.active ? 'Active' : 'Inactive'}</small></td>${role === 'sales' ? `<td>${number(item.cases)}</td><td>${money(item.collected)}</td>` : `<td>${number(item.handled)}</td>`}<td>${number(item.completed)}</td><td>${item.turnaround === null ? '—' : `${number(item.turnaround)} days`}</td><td>${number(item.activeCases)}</td><td>${number(item.overdue)}</td></tr>`).join('')}</tbody></table></div>` : empty('No employees in this role.');
  };
  return `${pageHead('Employees', 'Review sales and back-office performance and create staff accounts.')}
    <form class="employee-filters" onsubmit="applyEmployeePeriod(event)"><label>Review period<select id="employeePeriod" onchange="toggleEmployeeDates(this.value)">${[['week','Last 7 days'],['month','This month'],['quarter','This quarter'],['year','This year'],['all','All time'],['custom','Custom dates']].map(([key,label]) => `<option value="${key}" ${key === employeePeriod ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="employee-date" ${employeePeriod !== 'custom' ? 'hidden' : ''}>From<input id="employeeFrom" type="date" value="${h(employeeFrom)}" ${employeePeriod === 'custom' ? 'required' : ''}></label><label class="employee-date" ${employeePeriod !== 'custom' ? 'hidden' : ''}>Through<input id="employeeTo" type="date" value="${h(employeeTo)}" ${employeePeriod === 'custom' ? 'required' : ''}></label><button class="primary">Review performance</button></form>
    <p class="muted">New cases, collections, handled cases and completions use the selected period. Active and overdue counts show current workload. Turnaround is measured from case creation to completion. Custom dates include the whole end date in India time.</p>
    <section class="section-head"><h2>Sales employees</h2></section>${table('sales')}
    <section class="section-head"><h2>Back-office employees</h2></section>${table('backoffice')}
    <section class="analytics-panel employee-create"><h2>Create employee</h2><p>Set credentials for a new sales or back-office employee.</p><form onsubmit="createEmployee(event)"><div class="formgrid"><label>Full name<input name="name" required maxlength="100" autocomplete="off"></label><label>Role<select name="role"><option value="sales">Sales</option><option value="backoffice">Back office</option></select></label><label>Username<input name="username" required pattern="[A-Za-z0-9._-]{3,50}" minlength="3" maxlength="50" autocomplete="off"></label><label>Password<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"></label></div><div class="form-actions"><button class="primary">Create employee</button></div><p class="muted" role="status" id="employeeResult"></p></form></section>`;
}

function toggleEmployeeDates(period) {
  document.querySelectorAll('.employee-date').forEach(label => { label.hidden = period !== 'custom'; label.querySelector('input').required = period === 'custom'; });
}

async function applyEmployeePeriod(event) {
  event.preventDefault();
  const period = document.querySelector('#employeePeriod').value;
  const from = document.querySelector('#employeeFrom').value, to = document.querySelector('#employeeTo').value;
  if (period === 'custom' && (!from || !to || from > to)) return toast('Choose a valid start and end date.');
  const button = event.target.querySelector('button');
  button.disabled = true; button.textContent = 'Loading performance…';
  try {
    const data = await api('/api/admin/employees?' + new URLSearchParams({ period, from, to }));
    employeeData = data; employeePeriod = period; employeeFrom = from; employeeTo = to; render();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Review performance'; }
}

async function createEmployee(event) {
  event.preventDefault();
  const form = event.target, button = form.querySelector('button');
  button.disabled = true; button.textContent = 'Creating employee…';
  const result = form.querySelector('#employeeResult');
  let created;
  try {
    created = (await api('/api/admin/employees', { method: 'POST', body: Object.fromEntries(new FormData(form)) })).employee;
    form.reset();
    result.textContent = `Created ${created.name}. Username: ${created.username}. Use the password you entered to sign in.`;
    employeeData = await api(employeeUrl());
    render();
    document.querySelector('#employeeResult').textContent = result.textContent;
  } catch (error) { toast(created ? `Employee ${created.username} created. Refresh to update the performance list.` : error.message); }
  finally { button.disabled = false; button.textContent = 'Create employee'; }
}

function servicePerformance(rows) {
  const max = Math.max(1, ...rows.map(item => Number(item.cases || 0)));
  return `<div class="service-list">${rows.map(item => `<div><div class="service-line"><span>${h(item.name)}</span><strong>${number(item.cases)} cases</strong></div><div class="bar-track"><i style="width:${Math.max(3, item.cases / max * 100)}%"></i></div><small>${money(item.collected)} collected</small></div>`).join('')}</div>`;
}

function staffTable(rows, type) {
  if (!rows.length) return empty('No staff activity for this period.');
  return `<div class="mini-table"><div class="mini-row mini-head"><span>Employee</span><span>${type === 'sales' ? 'Cases' : 'Assigned'}</span><span>Completed</span><span>${type === 'sales' ? 'Collections' : 'Active'}</span></div>${rows.map(item => `<div class="mini-row"><span><strong>${h(item.name)}</strong><small>${h(item.role)}</small></span><span>${number(type === 'sales' ? item.cases : item.assigned)}</span><span>${number(item.completed)}</span><span>${type === 'sales' ? money(item.collected) : number(item.active)}</span></div>`).join('')}</div>`;
}

function paymentList(rows) {
  if (!rows.length) return empty('No verified payments for this period.');
  return `<div class="payment-list">${rows.map(item => `<div><span><strong>${h(item.customer)}</strong><small>${h(item.ref)} · ${dateTime(item.verified_at)}</small></span><strong>${money(item.amount)}</strong></div>`).join('')}</div>`;
}

function empty(text) { return `<div class="empty">${h(text)}</div>`; }
function filterCases(completed = null) {
  const value = (document.querySelector('#caseSearch')?.value || '').toLowerCase();
  const serviceId = document.querySelector('#caseServiceFilter')?.value || '';
  const filtered = cases
    .filter(item => completed === null || isCompletedCase(item) === completed)
    .filter(item => !serviceId || item.service.id === serviceId)
    .filter(item => [item.ref,item.customer.name,item.customer.mobile,item.service.name,item.status].join(' ').toLowerCase().includes(value));
  document.querySelector('#caseList').innerHTML = filtered.length ? caseTable(filtered) : empty('No cases match this search.');
  const count = document.querySelector('#caseListCount');
  if (count) count.textContent = `${number(filtered.length)} ${completed ? 'completed' : 'active'} cases`;
}

function startCase() { if (drawerBusy) return; closeDrawer(); draft = { step: 1, customer: {}, details: {}, docs: {} }; selectedCase = null; drawWizard(); }
function drawWizard() {
  const service = services.find(item => item.id === draft.serviceId);
  const variant = service?.variants.find(item => item.id === draft.variantId);
  document.body.insertAdjacentHTML('beforeend', `<div class="drawer" id="drawer"><div class="panel"><div class="drawer-head"><div><p class="eyebrow">Case intake</p><h2>New customer case</h2></div><button class="quiet" onclick="closeDrawer()">Close</button></div><div class="steps">${['Customer','Service','Documents','Review'].map((label,index) => `<div class="step ${draft.step === index + 1 ? 'on' : ''}"><span>${index + 1}</span>${label}</div>`).join('')}</div><div id="wizard">${wizardBody(service, variant)}</div></div></div>`);
  bindWizard();
}

function wizardBody(service, variant) {
  if (draft.step === 1) return `<div class="formgrid"><label>Mobile<input id="mobile" value="${h(draft.customer.mobile || '')}"></label><label>Full name<input id="name" value="${h(draft.customer.name || '')}"></label><label>Email<input id="email" value="${h(draft.customer.email || '')}"></label><label>Address<input id="address" value="${h(draft.customer.address || '')}"></label></div><div class="form-actions"><button class="primary" onclick="saveStep1()">Continue</button></div>`;
  if (draft.step === 2) return `<div class="formgrid"><label>Service<select id="service">${services.map(item => `<option value="${item.id}" ${item.id === draft.serviceId ? 'selected' : ''}>${h(item.name)}</option>`)}</select></label><label>Request type<select id="variant"></select></label></div><div id="serviceFields" class="formgrid"></div><div id="svcInfo" class="summary-box"></div><div class="form-actions"><button class="primary" onclick="saveStep2()">Continue</button></div>`;
  if (draft.step === 3) {
    const docs = applicableDocuments(variant?.documents || [], draft.details);
    const missing = docs.filter(item => item.required && !draft.docs[item.label]);
    return `<p class="muted">${docs.filter(item => item.required).length - missing.length} of ${docs.filter(item => item.required).length} required documents selected. Upload every required document to continue.</p><div class="upload-list">${docs.map(item => `<div class="doc"><span><strong>${h(item.label)}</strong><small>${h(item.note || (item.required ? 'Required document' : 'Optional supporting document'))}</small><em>${h(draft.docs[item.label]?.fileName || 'Not selected')}</em></span>${uploadControls(encodeURIComponent(item.label))}</div>`).join('')}</div><div class="form-actions"><button class="quiet" onclick="wizardBack(2)">Back</button><button class="primary" onclick="saveStep3()" ${missing.length ? 'disabled' : ''}>Continue</button></div>`;
  }
  const amount = variant?.amounts || { serviceCharge:0, officialFee:0, tax:0, total:0 };
  const pricing = amount.total ? `<div class="price-row"><span>Service charge ${money(amount.serviceCharge)}</span><span>Official fee ${money(amount.officialFee)}</span><span>Tax ${money(amount.tax)}</span></div><div class="review-total"><span>Total payable</span><strong>${money(amount.total)}</strong></div>` : `<div class="review-total"><span>Price</span><strong>To be confirmed</strong><small>The source PDF does not list fees. Confirm the service and official fees before collecting payment.</small></div>`;
  return `<div class="review"><div><span>Customer</span><strong>${h(draft.customer.name)}</strong></div><div><span>Service</span><strong>${h(service.name)} · ${h(variant.name)}</strong></div>${pricing}<label class="check"><input type="checkbox" id="consent"><span>Customer consent accepted for this private assistance service</span></label></div><div class="form-actions"><button class="primary" onclick="submitCase()">Create case</button></div>`;
}

function bindWizard() {
  if (draft.step !== 2) return;
  const serviceSelect = document.querySelector('#service');
  const variantSelect = document.querySelector('#variant');
  const collectFields = () => document.querySelectorAll('#serviceFields [data-field]').forEach(input => { draft.details[decodeURIComponent(input.dataset.field)] = input.value; });
  const update = () => {
    const service = services.find(item => item.id === serviceSelect.value);
    variantSelect.innerHTML = service.variants.map(item => `<option value="${item.id}" ${item.id === draft.variantId ? 'selected' : ''}>${h(item.name)}</option>`).join('');
    const variant = service.variants.find(item => item.id === variantSelect.value) || service.variants[0];
    document.querySelector('#serviceFields').innerHTML = (variant.fields || []).map(field => {
      const key = encodeURIComponent(field.label);
      const rawValue = draft.details[field.label] || '';
      const value = h(rawValue);
      const control = field.type === 'select'
        ? `<select data-field="${key}"><option value="">Choose…</option>${(field.options || []).map(option => `<option ${option === rawValue ? 'selected' : ''}>${h(option)}</option>`).join('')}</select>`
        : `<input data-field="${key}" type="${['email','date','number','tel'].includes(field.type) ? field.type : 'text'}" value="${value}">`;
      return `<label>${h(field.label)}${control}</label>`;
    }).join('');
    document.querySelector('#serviceFields').querySelectorAll('[data-field]').forEach(input => input.onchange = collectFields);
    const docs = applicableDocuments(variant.documents, draft.details);
    document.querySelector('#svcInfo').innerHTML = `<strong>${h(service.description)}</strong><p>${docs.map(item => h(item.label)).join(' · ')}</p><small>${h(variant.instructions || 'Confirm documents and fees before submission.')}</small><span>Fees to confirm before payment</span>`;
  };
  serviceSelect.onchange = () => { collectFields(); draft.details = {}; draft.variantId = ''; update(); };
  variantSelect.onchange = () => { collectFields(); update(); };
  update();
}

function applicableDocuments(documents, details) {
  return documents.filter(item => !item.when || !Object.hasOwn(details || {}, item.when.field) || !String(details[item.when.field] || '').trim() || String(details[item.when.field]) === String(item.when.equals));
}

function rerenderWizard() { closeDrawer(); drawWizard(); }
function saveStep1() {
  draft.customer = { mobile: document.querySelector('#mobile').value, name: document.querySelector('#name').value, email: document.querySelector('#email').value, address: document.querySelector('#address').value };
  if (!draft.customer.mobile || !draft.customer.name) return toast('Name and mobile are required');
  if (!/^[6-9]\d{9}$/.test(draft.customer.mobile)) return toast('Enter a valid 10-digit Indian mobile number');
  if (draft.customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.customer.email)) return toast('Enter a valid email address');
  draft.step = 2; rerenderWizard();
}
function saveStep2() {
  for (const input of document.querySelectorAll('#serviceFields [data-field]')) {
    if (input.tagName === 'SELECT' && !input.value) return toast(`Choose ${decodeURIComponent(input.dataset.field)}`);
    if (!input.checkValidity()) { input.reportValidity(); return; }
  }
  document.querySelectorAll('#serviceFields [data-field]').forEach(input => { draft.details[decodeURIComponent(input.dataset.field)] = input.value; });
  draft.serviceId = document.querySelector('#service').value;
  draft.variantId = document.querySelector('#variant').value;
  draft.step = 3;
  rerenderWizard();
}
function draftMissing() {
  const variant = services.find(s => s.id === draft.serviceId)?.variants.find(v => v.id === draft.variantId);
  return applicableDocuments(variant?.documents || [], draft.details).filter(d => d.required && !draft.docs[d.label]);
}
function saveStep3() {
  if (drawerBusy) return;
  if (draftMissing().length) return toast('Upload all required documents to continue');
  draft.step = 4; rerenderWizard();
}
function wizardBack(step) { draft.step = step; rerenderWizard(); }
function uploadControls(encodedType, caseId = '') {
  const handler = caseId ? `uploadCaseDocument('${caseId}','${encodedType}',this)` : `pickDoc('${encodedType}',this.files[0])`;
  return `<span class="upload-options"><label class="file-action">Upload document<input type="file" accept="image/jpeg,image/png,application/pdf" onchange="${handler}"></label></span>`;
}
function validateFile(file) {
  if (!['image/jpeg','image/png','application/pdf'].includes(file.type) || !file.size || file.size > 10_000_000) throw new Error('Choose JPG, PNG, or PDF up to 10 MB');
}
async function pickDoc(encodedType, file) {
  if (!file || drawerBusy) return;
  try { validateFile(file); } catch (error) { return toast(error.message); }
  const type = decodeURIComponent(encodedType);
  setDrawerBusy(`Preparing ${type}… Please wait before continuing.`);
  try {
    draft.docs[type] = { fileName:file.name, mimeType:file.type, size:file.size, ...(cloudUploads ? {file} : {content:await fileAsBase64(file)}) };
    toast(`${type} ready`);
  } catch (error) { toast(error.message); }
  finally { setDrawerBusy(); rerenderWizard(); }
}
async function submitCase() {
  if (drawerBusy || draft.submitting) return;
  if (!document.querySelector('#consent').checked) return toast('Consent is required');
  if (draftMissing().length) return toast('Upload all required documents to create this case');
  if (draft.submitting) return;
  draft.submitting = true;
  setDrawerBusy('Creating case… Please keep this form open.');
  try {
    const created = draft.createdCase || (await api('/api/cases', { method:'POST', body:{ customer:draft.customer, variantId:draft.variantId, details:draft.details, consent:true } })).case;
    draft.createdCase = created;
    draft.uploaded ||= {};
    let completed = 0;
    const total = Object.keys(draft.docs).length;
    for (const [docType, document] of Object.entries(draft.docs)) {
      const identity = document.file || document.content;
      if (draft.uploaded[docType] === identity) { completed++; continue; }
      setDrawerBusy(`Uploading document ${completed + 1} of ${total}: ${docType}…`);
      await uploadDocument(created.id, docType, document);
      draft.uploaded[docType] = identity;
      completed++;
    }
    setDrawerBusy(); closeDrawer(); await load(); toast(`Created ${created.ref}`); await openCase(created.id);
  } catch (error) {
    toast(error.message + (draft.createdCase ? ` Case ${draft.createdCase.ref} is saved; retry pending uploads after fixing the issue.` : ''));
    const actions = document.querySelector('#wizard .form-actions');
    document.querySelector('#uploadRecovery')?.remove();
    if (actions) {
      actions.insertAdjacentHTML('beforebegin', `<div id="uploadRecovery" class="summary-box" role="alert"><strong>${draft.createdCase ? `Case ${h(draft.createdCase.ref)} saved — uploads pending` : 'Case has not been created'}</strong><p>${h(error.message)}</p>${error.code === 'GOOGLE_RECONNECT_REQUIRED' ? '<p>Keep this form open. In another tab, an admin should open Business analytics and reconnect Google Drive. Then retry here.</p>' : error.code === 'GOOGLE_ROOT_FOLDER_INVALID' ? '<p>Keep this form open. In another tab, an admin should open Business analytics, paste the correct Main Google Drive folder link, and click Verify and save folder. Then retry here.</p>' : ''}</div>`);
      const button = actions.querySelector('button.primary');
      if (button) button.textContent = draft.createdCase ? 'Retry pending uploads' : 'Retry create case';
    }
  }
  finally { draft.submitting = false; setDrawerBusy(); }
}

async function openCase(caseId) {
  if (drawerBusy) return;
  try {
    const data = await api(`/api/cases/${caseId}`);
    selectedCase = data;
    document.body.insertAdjacentHTML('beforeend', `<div class="drawer" id="drawer"><div class="panel case-panel">${caseDetail(data.case, data.documents, data.notes)}</div></div>`);
  } catch (error) { toast(error.message); }
}

function documentChecklist(item, documents) {
  const active = documents.filter(document => document.state !== 'replaced');
  const byType = new Map(active.map(document => [document.doc_type, document]));
  return applicableDocuments(item.variant.documents || [], item.details || {}).map(requirement => {
    const uploaded = byType.get(requirement.label);
    return `<div class="doc"><span><strong>${h(requirement.label)}</strong><small>${uploaded ? `Uploaded version ${uploaded.version}` : requirement.required ? 'Required document missing' : 'Optional supporting document'}</small>${statusBadge(uploaded ? 'Uploaded' : requirement.required ? 'Missing' : 'Optional')}${uploaded ? documentActions(item, uploaded) : ''}</span>${!['Closed','Delivered','Cancelled'].includes(item.status) ? uploadControls(encodeURIComponent(requirement.label), item.id) : ''}</div>`;
  }).join('');
}

function documentActions(item, document) {
  const url = new URL(document.download_url, location.origin).href;
  const message = `Document ready for ${item.ref} - ${item.customer.name}. Download ${document.doc_type}: ${url}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const ready = ['Ready to Submit','Submitted to Official Portal','Under Government Review','Approved','Delivered','Closed'].includes(item.status);
  return `<span class="doc-actions"><a href="${h(document.download_url)}" target="_blank" rel="noopener">Download</a>${ready ? `<a href="${h(whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</span>`;
}

function receivedDocumentPanel(item, documents) {
  const document = documents.filter(entry => entry.state !== 'replaced' && entry.doc_type === 'Received Document').at(-1);
  const isOperations = ['backoffice','admin'].includes(me.role);
  const canUpload = isOperations && item.status === 'Document Received';
  const submitted = isCompletedCase(item);
  if (document && !isOperations && !submitted) return '';
  if (!document && !canUpload) return '';
  return `<section class="detail-section received-document"><div class="panel-title"><div><h3>Received ${h(item.service.name)} document</h3><p>Upload the completed document received for this request.</p></div></div>
    <div class="doc"><span><strong>${h(document?.file_name || 'No received document uploaded')}</strong><small>${document ? `Uploaded version ${document.version}` : 'Upload the received PDF, JPG, or PNG.'}</small>${document ? statusBadge(submitted ? 'Submitted' : 'Uploaded') + documentActions(item, document) : statusBadge('Pending')}</span>
    ${canUpload ? `<span class="file-action">${document ? 'Replace received document' : 'Upload received document'}${uploadControls(encodeURIComponent('Received Document'), item.id)}${document ? `<button class="primary complete-case" onclick="submitReceivedDocument('${item.id}',this)">Submit</button>` : ''}</span>` : ''}</div></section>`;
}

function caseDetail(item, documents, notes) {
  const intakeDetails = Object.entries(item.details || {}).filter(([, value]) => value).map(([label, value]) => `<div><span>${h(label)}</span><strong>${h(value)}</strong></div>`).join('');
  const priced = item.amounts.total > 0;
  return `<div class="drawer-head"><div><p class="eyebrow">${h(item.ref)}</p><h2>${h(item.customer.name)}</h2><p>${h(item.service.name)} · ${h(item.variant.name)}</p></div><button class="quiet" onclick="closeDrawer()">Close</button></div>
    <div class="case-summary"><div><span>Status</span>${statusBadge(item.status)}</div><div><span>Payment</span>${statusBadge(item.payment_state)}</div><div><span>${priced ? 'Total' : 'Price'}</span><strong>${priced ? money(item.amounts.total) : 'To be confirmed'}</strong></div><div><span>Owner</span><strong>${h(item.backoffice?.name || 'Unassigned')}</strong></div></div>
    ${intakeDetails ? `<section class="detail-section"><div class="panel-title"><div><h3>Application details</h3><p>Information collected for this service request.</p></div></div><div class="review">${intakeDetails}</div></section>` : ''}
    <section class="detail-section"><div class="panel-title"><div><h3>Payment</h3><p>${priced ? 'Service, government fee, and tax collection.' : 'Fees need confirmation. Trial payment lets you demonstrate the workflow without collecting money.'}</p></div>${demoPayments && item.payment_state === 'unpaid' ? `<button onclick="pay('${item.id}')" ${item.document_state !== 'complete' ? 'disabled' : ''}>${priced ? 'Run demo payment' : 'Confirm trial payment (no charge)'}</button>` : ''}</div>${priced ? `<div class="price-row"><span>Service ${money(item.amounts.serviceCharge)}</span><span>Official ${money(item.amounts.officialFee)}</span><span>Tax ${money(item.amounts.tax)}</span></div>` : ''}</section>
    <section class="detail-section"><div class="panel-title"><div><h3>Documents</h3><p>Upload every required document before moving the case forward.</p></div>${['backoffice','admin'].includes(me.role) ? `<button onclick="downloadCaseFiles('${item.id}',this)">Download all files</button>` : ''}</div><div class="upload-list">${documentChecklist(item, documents)}</div></section>
    ${receivedDocumentPanel(item, documents)}
    <section class="detail-section"><div class="panel-title"><div><h3>Timeline</h3><p>Recorded status changes and internal notes.</p></div></div><div class="timeline">${notes.length ? notes.map(note => `<div><i></i><span><strong>${h(note.new_status)}</strong><p>${h(note.note || 'Status updated')}</p><small>${h(note.actor)} · ${dateTime(note.created_at)}</small></span></div>`).join('') : empty('No updates yet.')}</div></section>
    ${me.role === 'backoffice' && item.status === 'Ready for Assignment' ? `<div class="sticky-actions"><button class="primary" onclick="claim('${item.id}')">Claim case</button></div>` : ''}
    ${['backoffice','admin'].includes(me.role) ? progressControls(item) : ''}`;
}

function progressControls(item) {
  const next = {
    'Draft':['Awaiting Documents','Awaiting Payment','Ready for Assignment','Cancelled'], 'Awaiting Documents':['Awaiting Payment','Ready for Assignment','Correction Required','Cancelled'],
    'Awaiting Payment':['Ready for Assignment','Cancelled'], 'Ready for Assignment':['Assigned','Cancelled'], 'Assigned':['Document Review','Ready to Submit','Correction Required','Customer Action Required','Cancelled'],
    'Document Review':['Ready to Submit','Correction Required','Customer Action Required','Cancelled'], 'Correction Required':['Awaiting Documents','Document Review','Ready to Submit','Cancelled'], 'Ready to Submit':['Submitted to Official Portal','Correction Required','Customer Action Required','Cancelled'],
    'Submitted to Official Portal':['Under Government Review','Customer Action Required','Document Received','Rejected','Cancelled'], 'Under Government Review':['Customer Action Required','Document Received','Rejected','Cancelled'],
    'Customer Action Required':['Document Review','Ready to Submit','Under Government Review','Correction Required','Cancelled'], 'Document Received':['Correction Required','Cancelled'], 'Approved':['Document Received','Delivered','Closed'], 'Delivered':['Closed','Customer Action Required'], 'Rejected':['Correction Required','Closed']
  }[item.status] || [];
  const allowed = next.filter(status => (item.document_state === 'complete' || ['Awaiting Documents','Correction Required','Customer Action Required','Rejected','Cancelled'].includes(status)) && (!['Ready for Assignment','Assigned'].includes(status) || item.payment_state === 'paid'));
  if (!allowed.length) return '';
  return `<section class="workflow-box"><div><p class="eyebrow">Workflow action</p><h3>Move case forward</h3>${item.document_state !== 'complete' ? '<p>Required documents are missing. Upload them to unlock progress.</p>' : ''}</div><select id="nextStatus">${allowed.map(status => `<option>${h(status)}</option>`).join('')}</select><textarea id="note" placeholder="Progress note or required reason"></textarea><button class="primary" onclick="progress('${item.id}')">Update status</button></section>`;
}

async function downloadCaseFiles(caseId, button) {
  const item = selectedCase.case;
  const folder = `${item.ref} - ${item.customer.name} - ${item.service.name}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150);
  button.disabled = true;
  let writable;
  try {
    const handle = window.showSaveFilePicker && window.isSecureContext ? await window.showSaveFilePicker({ suggestedName: folder + '.zip', types: [{ description: 'Case documents (ZIP)', accept: { 'application/zip': ['.zip'] } }] }) : null;
    button.textContent = 'Preparing files…';
    const response = await fetch(`/api/cases/${caseId}/download-all?folder=${encodeURIComponent(folder)}`);
    if (!response.ok) throw new Error((await response.json()).error || 'Download failed');
    const blob = await response.blob();
    if (handle) {
      button.textContent = 'Saving files…';
      writable = await handle.createWritable();
      await writable.write(blob); await writable.close(); writable = null;
      toast('Case ZIP saved to your selected location. Extract it to access the documents.');
      return;
    }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/)?.[1];
    link.href = url; link.download = encoded ? decodeURIComponent(encoded) : 'case-files.zip';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
    toast('ZIP download started. To choose its location, enable “Ask where to save each file” in your browser download settings.');
  } catch (error) { if (writable) await writable.abort().catch(() => {}); if (error.name !== 'AbortError') toast(error.message); }
  finally { button.disabled = false; button.textContent = 'Download all files'; }
}

async function fileAsBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}
async function uploadDocument(caseId, docType, document) {
  if (!cloudUploads) return api(`/api/cases/${caseId}/documents`, {method:'POST',body:{docType,...document}});
  const metadata = {docType,fileName:document.fileName,mimeType:document.mimeType,size:document.size};
  document.cloudAuthorization ||= await api(`/api/cases/${caseId}/upload-url`, {method:'POST',body:metadata});
  if (!document.cloudTransferred) {
    const response = await fetch(document.cloudAuthorization.uploadUrl, {method:'PUT',headers:{'content-type':document.mimeType},body:document.file});
    if (!response.ok && response.status !== 409) throw new Error('Document upload failed. Retry the pending upload.');
    document.cloudTransferred = true;
  }
  return api(`/api/cases/${caseId}/documents`, {method:'POST',body:{uploadId:document.cloudAuthorization.uploadId}});
}
async function uploadCaseDocument(caseId, encodedType, input) {
  const file = input.files?.[0];
  if (!file || drawerBusy) return;
  try { validateFile(file); } catch (error) { input.value = ''; return toast(error.message); }
  const docType = decodeURIComponent(encodedType);
  setDrawerBusy(`Uploading ${docType}… Please wait before moving this case forward.`);
  const badge = docType === 'Received Document' ? input.closest('.doc')?.querySelector('.badge') : null;
  if (badge) { badge.textContent = 'Uploading...'; badge.className = 'badge neutral'; }
  try {
    await uploadDocument(caseId, docType, { fileName:file.name, mimeType:file.type, size:file.size, ...(cloudUploads ? {file} : {content:await fileAsBase64(file)}) });
    setDrawerBusy(); closeDrawer(); await load(); await openCase(caseId); toast(`${docType} uploaded`);
  } catch (error) { input.value = ''; if (badge) { badge.textContent = 'Upload failed'; badge.className = 'badge danger'; } toast(error.message); }
  finally { setDrawerBusy(); }
}
async function pay(caseId) { try { const order = await api(`/api/cases/${caseId}/payment-order`, { method:'POST' }); await api(`/api/cases/${caseId}/verify-payment`, { method:'POST', body:{ orderId:order.orderId } }); closeDrawer(); await load(); openCase(caseId); toast('Demo payment verified'); } catch (error) { toast(error.message); } }
async function claim(caseId) { try { await api(`/api/cases/${caseId}/claim`, { method:'POST' }); closeDrawer(); await load(); openCase(caseId); toast('Case assigned to you'); } catch (error) { toast(error.message); } }
async function submitReceivedDocument(caseId, button) { try { button.disabled = true; button.textContent = 'Submitting...'; await api(`/api/cases/${caseId}/submit-received-document`, { method:'POST' }); closeDrawer(); await load(); setView('completed'); toast('Document submitted. Request closed'); } catch (error) { button.disabled = false; button.textContent = 'Submit'; toast(error.message); } }
async function progress(caseId) { try { await api(`/api/cases/${caseId}/progress`, { method:'POST', body:{ status:document.querySelector('#nextStatus').value, note:document.querySelector('#note').value, visibility:'sales' } }); closeDrawer(); await load(); openCase(caseId); toast('Status updated'); } catch (error) { toast(error.message); } }

function closeDrawer() { if (!drawerBusy) document.querySelector('#drawer')?.remove(); }
async function connectGoogleDrive() { try { location.href = (await api('/api/google/oauth/start')).authorizationUrl; } catch (error) { toast(error.message); } }
async function saveDriveRootFolder(button) {
  button.disabled = true;
  try { await api('/api/google/root-folder',{method:'POST',body:{folder:document.querySelector('#driveRootFolder').value}}); await load(); toast('Drive folder verified and saved. Retry your pending uploads.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
async function activateGoogleSheets() { try { toast('Verifying workbook and syncing cases'); const result = await api('/api/google/sheets/activate', { method:'POST' }); await load(); toast(`Google Sheets live: ${result.syncedCases} cases synced`); } catch (error) { toast(error.message); } }
async function setAnalyticsPeriod(period) { analyticsPeriod = period; adminAnalytics = await api(`/api/admin/dashboard?period=${period}`); render(); }
async function logout() { if (drawerBusy) return; closeDrawer(); await api('/api/logout', { method:'POST' }); me = null;view='dashboard';googleStatus=sheetsStatus=adminAnalytics=employeeData=null;renderLogin(); }
async function setView(next) {
  if(drawerBusy) return;
  closeDrawer();view=next;render();
  if(me.role==='admin' && ['admin','employees'].includes(next)) {
    try {await loadViewData();if(view===next) render();} catch(error) {toast(error.message);}
  }
}

Object.assign(window, { startCase, closeDrawer, saveStep1, saveStep2, saveStep3, pickDoc, uploadCaseDocument, submitCase, openCase, pay, claim, submitReceivedDocument, progress, connectGoogleDrive, activateGoogleSheets, setAnalyticsPeriod, logout, filterCases, setView });
Object.assign(window, { downloadCaseFiles, wizardBack });
Object.assign(window, { saveDriveRootFolder });
Object.assign(window, { toggleEmployeeDates, applyEmployeePeriod, createEmployee });
boot();
