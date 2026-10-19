const app = document.querySelector('#app');

let me = null;
let cases = [];
let services = [];
let caseNotifications = [];
let updatesTimer = null;
let updatesInFlight = false;
let caseListNeedsRender = false;
let testPricingMode = true;
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
    drawer.querySelector('.drawer-head,.checkout-header').insertAdjacentHTML('afterend', '<div class="busy-status" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span></span></div>');
    status = drawer.querySelector('.busy-status');
  }
  status.lastElementChild.textContent = message;
}

const money = value => `\u20B9${((value || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const number = value => Number(value || 0).toLocaleString('en-IN');
const h = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const dateTime = value => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
const roleName = role => ({admin:'Administrator',sales:'Sales employee',backoffice:'Back office'}[role] || role);
function icon(name) {
  const paths={dashboard:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',cases:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',completed:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',queue:'<path d="M4 5h16v14H4zM4 13h5l2 3h2l2-3h5M8 9h8"/>',payments:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/>',admin:'<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>',employees:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',plus:'<path d="M12 5v14M5 12h14"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',logout:'<path d="M10 4H4v16h6M14 8l4 4-4 4M8 12h12"/>',switch:'<path d="M4 7h15l-3-3M20 17H5l3 3M20 7v4M4 17v-4"/>'};
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name === 'pending' ? 'queue' : name]||paths.profile}</svg>`;
}
function labelTables() {
  document.querySelectorAll('.table').forEach(table=>{
    const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,index)=>{cell.dataset.label=labels[index]||'';}));
  });
  document.querySelectorAll('.mini-table').forEach(table=>{
    const labels=[...table.querySelector('.mini-head').children].map(cell=>cell.textContent.trim());
    table.querySelectorAll('.mini-row:not(.mini-head)').forEach(row=>[...row.children].forEach((cell,index)=>{cell.dataset.label=labels[index]||'';}));
  });
}
function focusSignIn() {document.querySelector('#login [name="username"]')?.focus();}
async function switchAccount() {await logout();if(!me) focusSignIn();}

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
  document.querySelectorAll('.toast').forEach(item => item.remove());
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
    startCaseUpdatePolling();
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
  const requests = [api('/api/services'), api('/api/cases'), api('/api/notifications')];
  const [serviceData, caseData, noticeData] = await Promise.all(requests);
  caseNotifications = noticeData.notifications || [];
  services = serviceData.services;
  testPricingMode = serviceData.testPricingMode;
  cloudUploads = serviceData.cloudUploads === true;
  cases = caseData.cases;
  if(view==='payments') await loadPayments();
  if(me.role==='admin') await loadViewData();
  else googleStatus=sheetsStatus=adminAnalytics=employeeData=null;
  render();
}

async function loadViewData() {
  if(view==='admin') [googleStatus,sheetsStatus,adminAnalytics] = await Promise.all([api('/api/google/status'),api('/api/google/sheets/status'),api(`/api/admin/dashboard?period=${analyticsPeriod}`)]);
  if(view==='employees') employeeData=await api(employeeUrl());
}

function renderLogin() {
  app.innerHTML = `<section class="login auth-page">
    <div class="auth-shell">
      <aside class="auth-intro">
        <div class="login-brand"><div class="mark">SO</div><div><strong>Success Online</strong><span>Operations workspace</span></div></div>
        <div class="auth-story"><span class="auth-overline">A simpler working day</span><h2>Every case.<br>A step forward.</h2><p>Your customers, documents, and payments. Together in one organised workspace.</p></div>
        <div class="auth-art" aria-hidden="true"><div class="auth-orbit"></div><div class="auth-art-card"><span class="auth-art-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 3h7l4 4v14H7zM14 3v5h5M10 12h5M10 16h5"/></svg></span><span class="auth-art-lines"><i></i><i></i></span><span class="auth-art-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 12 4 4 8-8"/></svg></span></div><div class="auth-art-card auth-art-card-back"></div></div>
        <p class="auth-intro-foot">Built for the way your team works.</p>
      </aside>
      <div class="auth-access">
        <form id="login" class="login-form">
          <div class="auth-welcome"><span class="auth-overline">Your workspace awaits</span><h1>Welcome back</h1><p>Sign in to your Success Online account.</p></div>
          <label for="loginUsername">Phone number or username</label><div class="auth-input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg><input id="loginUsername" name="username" required autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Enter phone number or username"></div>
          <label for="loginPassword">Password</label><div class="auth-input"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input id="loginPassword" name="password" type="password" required autocomplete="current-password" placeholder="Enter your password"><button class="auth-password-toggle" type="button" aria-label="Show password" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></button></div>
          <p class="auth-error" role="alert" hidden></p>
          <button class="primary full" type="submit">Sign in</button>
          <p class="auth-help">Need access? Contact your administrator.</p>
        </form>
        <p class="auth-access-foot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6"/></svg>Secure access for your team</p>
      </div>
    </div>
  </section>`;
  document.querySelector('.auth-password-toggle').onclick = event => {
    const input=document.querySelector('#loginPassword'), visible=input.type==='password';
    input.type=visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-label',visible ? 'Hide password' : 'Show password');
    event.currentTarget.setAttribute('aria-pressed',String(visible));
  };
  document.querySelector('#login').onsubmit = async event => {
    event.preventDefault();
    const button=event.target.querySelector('button.primary');
    if(button.disabled) return;
    const errorMessage=event.target.querySelector('.auth-error');errorMessage.hidden=true;
    button.disabled=true;button.textContent='Signing in…';
    try {
      me = (await api('/api/login', { method: 'POST', body: Object.fromEntries(new FormData(event.target)) })).user;
      await load();
      startCaseUpdatePolling();
    } catch (error) { errorMessage.textContent=error.message;errorMessage.hidden=false; }
    finally {button.disabled=false;button.textContent='Sign in';}
  };
}

const navLabels = { dashboard: 'Overview', cases: 'Active Cases', pending: 'Pending Cases', completed: 'Completed Cases', payments: 'Payments', queue: 'Operations', admin: 'Business analytics', employees: 'Employees' };

function shell(content) {
  const links = ['dashboard','cases','pending','completed','payments','queue','admin','employees']
    .filter(item => item !== 'queue' || me.role !== 'sales')

    .filter(item => !['admin','employees'].includes(item) || me.role === 'admin');
  const canCreate = ['sales','admin'].includes(me.role);
  const primaryLinks=links.filter(item=>['dashboard','cases','pending','completed'].includes(item));
  const moreLinks=links.filter(item=>!primaryLinks.includes(item));
  const navButton=(item,mobile=false)=>`<button data-view="${item}" class="${view===item?'active':''}" ${view===item?'aria-current="page"':''} onclick="setView('${item}')">${icon(item)}<span>${mobile?({dashboard:'Overview',cases:'Active',pending:'Pending',completed:'Completed',queue:'Operations'}[item]||navLabels[item]):navLabels[item]}</span>${hasSectionUpdates(item) ? '<i class="nav-update-dot" title="Unread case updates" aria-hidden="true"></i>' : ''}</button>`;
  const initials=(me.name||me.username).trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  return `<div class="shell">
    <aside class="side">
      <div class="side-brand"><div class="mark">SO</div><div><strong>Success Online</strong><span>e-Seva operations</span></div></div>
      <nav class="nav" aria-label="Main navigation">${links.map(item=>navButton(item)).join('')}</nav>
      <div class="side-foot"><span class="live-dot"></span><div><strong>Workspace online</strong><small>Private assistance service</small></div></div>
    </aside>
    <div class="workspace">
      <header class="top">
        <div class="top-identity"><div class="mobile-brand"><span class="mark">SO</span><div><strong>Success Online</strong><small>${h(roleName(me.role))}</small></div></div><p class="desktop-identity">${h(me.name)} <span class="role">${h(roleName(me.role))}</span></p></div>
        <div class="top-actions">${canCreate?`<button class="primary new-case-button" onclick="startCase()">${icon('plus')}<span>New case</span></button>`:''}<details class="profile"><summary class="profile-button" aria-label="Open profile menu"><span class="avatar">${h(initials)}</span></summary><div class="profile-menu"><p class="eyebrow">Your account</p><strong>${h(me.name)}</strong><small>${h(roleName(me.role))}</small><div class="profile-login"><span>Staff login</span><strong>${h(me.username)}</strong></div><button onclick="setView('dashboard')">${icon('dashboard')}Overview</button><button onclick="switchAccount()">${icon('switch')}Switch account</button><button class="profile-signout" onclick="logout()">${icon('logout')}Sign out</button></div></details></div>
      </header>
      <main class="content">${content}</main>
      <nav class="mobile-nav" aria-label="Mobile navigation">${primaryLinks.map(item=>navButton(item,true)).join('')}${moreLinks.length?`<details class="mobile-more"><summary class="${moreLinks.includes(view)?'active':''}">${icon('more')}<span>More</span></summary><div class="more-menu"><p class="eyebrow">Admin workspace</p>${moreLinks.map(item=>navButton(item)).join('')}</div></details>`:''}</nav>
    </div>
  </div>`;
}

function render() {
  if (!me) return renderLogin();
  caseListNeedsRender = false;
  const content = view === 'pending' ? renderPendingCases() : view === 'cases' ? renderCases() : view === 'completed' ? renderCompletedCases() : view === 'payments' ? renderPayments() : view === 'queue' ? renderQueue() : view === 'admin' ? renderAdmin() : view === 'employees' ? renderEmployees() : renderDashboard();
  app.innerHTML = shell(content);
  labelTables();
}

function pageHead(title, description, action = '') {
  return `<div class="page-head"><div><p class="eyebrow">${h(navLabels[view] || view)}</p><h1>${h(title)}</h1><p>${h(description)}</p></div>${action}</div>`;
}

function statusClass(status) {
  if(/unpaid|missing/i.test(status)) return 'warning';
  if (/Ready|Received|Approved|Delivered|Closed|paid/i.test(status)) return 'success';
  if (/Awaiting|Correction|Action|unpaid/i.test(status)) return 'warning';
  if (/Rejected|Cancelled|failed/i.test(status)) return 'danger';
  return 'neutral';
}
function statusBadge(status) { const label=({paid:'Paid',unpaid:'Unpaid',missing:'Missing',complete:'Complete'})[status]||status;return `<span class="badge ${statusClass(status)}">${h(label)}</span>`; }

function metricCard(label, value, detail, tone = '') {
  return `<article class="metric-card ${tone}"><span>${h(label)}</span><strong>${value}</strong><small>${h(detail)}</small></article>`;
}

function counts() { return cases.reduce((result, item) => { result[item.status] = (result[item.status] || 0) + 1; return result; }, {}); }
const isCompletedCase = item => ['Closed','Delivered'].includes(item.status);

const pendingStatuses = ['Draft','Awaiting Documents','Awaiting Payment','Correction Required','Customer Action Required'];
const isPendingCase = item => pendingStatuses.includes(item.status);
function notificationSection(notice) {
  const item = cases.find(item => item.id === notice.caseId) || {status:notice.status};
  return isCompletedCase(item) ? 'completed' : isPendingCase(item) ? 'pending' : 'cases';
}
function hasSectionUpdates(section) { return caseNotifications.some(notice => notificationSection(notice) === section); }
function updateCaseIndicators() {
  document.querySelectorAll('[data-view]').forEach(button => {
    const unread = hasSectionUpdates(button.dataset.view);
    const dot = button.querySelector('.nav-update-dot');
    if (unread && !dot) button.insertAdjacentHTML('beforeend','<i class="nav-update-dot" title="Unread case updates" aria-hidden="true"></i>');
    if (!unread && dot) dot.remove();
  });
  document.querySelectorAll('[data-case-update]').forEach(dot => { dot.hidden = !caseNotifications.some(notice => notice.caseId === dot.dataset.caseUpdate); });
}
async function markCaseUpdatesRead(caseId) {
  const ids = caseNotifications.filter(notice => notice.caseId === caseId).map(notice => notice.id);
  if (!ids.length) return;
  try {
    await api('/api/notifications/read',{method:'POST',body:{ids}});
    caseNotifications = caseNotifications.filter(notice => !ids.includes(notice.id));
    updateCaseIndicators();
  } catch { /* Keep unread indicators until acknowledgement succeeds. */ }
}
async function refreshCaseUpdates() {
  if (!me || updatesInFlight || document.hidden) return;
  const userId = me.id;
  updatesInFlight = true;
  try {
    const [caseData,noticeData] = await Promise.all([api('/api/cases'),api('/api/notifications')]);
    if (me?.id !== userId) return;
    const casesChanged = JSON.stringify(cases) !== JSON.stringify(caseData.cases);
    if (casesChanged) caseListNeedsRender = true;
    cases = caseData.cases;
    caseNotifications = noticeData.notifications || [];
    updateCaseIndicators();
    const editing = document.activeElement?.matches?.('input,select,textarea');
    if (caseListNeedsRender && !document.querySelector('#drawer,.profile[open],.mobile-more[open]') && !editing && ['dashboard','cases','pending','completed','queue'].includes(view)) {
      const search = document.querySelector('#caseSearch')?.value || '';
      const serviceFilter = document.querySelector('#caseServiceFilter')?.value || '';
      render();
      if (search || serviceFilter) {
        if (document.querySelector('#caseSearch')) document.querySelector('#caseSearch').value = search;
        if (document.querySelector('#caseServiceFilter')) document.querySelector('#caseServiceFilter').value = serviceFilter;
        filterCases(view === 'completed');
      }
    }
  } catch { /* Retry automatically without disrupting an open form. */ }
  finally { updatesInFlight = false; }
}
function startCaseUpdatePolling() {
  clearTimeout(updatesTimer);
  const tick = async () => {
    await refreshCaseUpdates();
    if (me) updatesTimer = setTimeout(tick,15000);
  };
  updatesTimer = setTimeout(tick,15000);
}
function renderPendingCases() {
  const rows = cases.filter(isPendingCase).sort((a,b) => Number(b.status === 'Correction Required') - Number(a.status === 'Correction Required') || String(b.updated_at).localeCompare(String(a.updated_at)));
  return `${pageHead('Pending Cases','Cases awaiting documents, payment, corrections, or customer action.')} ${caseToolbar(rows,false)}<div id="caseList" class="table-shell">${rows.length ? caseTable(rows) : empty('No pending cases. All caught up.')}</div>`;
}

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
  return `${pageHead('Active Cases', 'Search and manage customer applications still in progress.')}
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
  return `<div class="toolbar"><div class="toolbar-controls"><label class="search"><span>Search</span><input id="caseSearch" oninput="filterCases(${completed})" placeholder="Case ID, customer, service, phone"></label>${serviceFilter}</div><span id="caseListCount" class="count-label">${number(rows.length)} ${view === 'pending' ? 'pending' : completed ? 'completed' : 'active'} cases</span></div>`;
}

function caseTable(rows) {
  return `<table class="table case-table"><thead><tr><th>Case</th><th>Customer</th><th>Service</th><th>Status</th><th>Payment</th><th>Owner</th><th>Updated</th></tr></thead><tbody>${rows.map(item => `<tr onclick="openCase('${item.id}')">
    <td><strong><button class="case-link" onclick="event.stopPropagation();openCase('${item.id}')" aria-label="Open case ${h(item.ref)}"><i class="case-update-dot" data-case-update="${item.id}" ${caseNotifications.some(notice => notice.caseId === item.id) ? '' : 'hidden'} title="Unread case update" aria-hidden="true"></i>${h(item.ref)}</button></strong><small>${h(item.priority)}</small></td>
    <td><strong>${h(item.customer.name)}</strong><small>${h(item.customer.mobile.replace(/\d(?=\d{4})/g, 'x'))}</small></td>
    <td>${h(item.service.name)}<small>${h(item.variant.name)}</small></td>
    <td>${statusBadge(item.status)}</td><td>${statusBadge(item.payment?.status || item.payment_state)}<small>${money(item.amounts.total)}</small><small>${h(item.payment?.gateway_order_id || '')}</small></td>
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
    <details class="metric-help"><summary>How performance is measured</summary><p class="muted">New cases, collections, handled cases and completions use the selected period. Active and overdue counts show current workload. Turnaround is measured from case creation to completion. Custom dates include the whole end date in India time.</p></details>
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
    .filter(item => view === 'pending' ? isPendingCase(item) : completed === null || isCompletedCase(item) === completed)
    .filter(item => !serviceId || item.service.id === serviceId)
    .filter(item => [item.ref,item.customer.name,item.customer.mobile,item.service.name,item.status].join(' ').toLowerCase().includes(value));
  document.querySelector('#caseList').innerHTML = filtered.length ? caseTable(filtered) : empty('No cases match this search.');
  labelTables();
  const count = document.querySelector('#caseListCount');
  if (count) count.textContent = `${number(filtered.length)} ${view === 'pending' ? 'pending' : completed ? 'completed' : 'active'} cases`;
}

function startCase() { if (drawerBusy) return; closeDrawer(); draft = { step: 1, customer: {}, details: {}, docs: {} }; selectedCase = null; drawWizard(); }
function drawWizard() {
  const service = services.find(item => item.id === draft.serviceId);
  const variant = service?.variants.find(item => item.id === draft.variantId);
  document.body.insertAdjacentHTML('beforeend', `<div class="drawer" id="drawer"><div class="panel"><div class="drawer-head"><div><p class="eyebrow">Case intake</p><h2>New customer case</h2></div><button class="quiet" onclick="closeDrawer()">Close</button></div><div class="steps">${['Customer','Service','Documents','Review'].map((label,index) => `<div class="step ${draft.step === index + 1 ? 'on' : ''}"><span>${index + 1}</span>${label}</div>`).join('')}</div><div id="wizard">${wizardBody(service, variant)}</div></div></div>`);
  bindWizard();
}

function wizardBody(service, variant) {
  if (draft.step === 1) return `<div class="formgrid"><label>Full name<input id="name" autocomplete="name" value="${h(draft.customer.name || '')}"></label><label>Mobile number<input id="mobile" type="tel" inputmode="numeric" maxlength="10" pattern="[0-9]{10}" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)" autocomplete="tel-national" placeholder="10-digit mobile number" value="${h(draft.customer.mobile || '')}"></label><label>Email<input id="email" type="email" autocomplete="email" value="${h(draft.customer.email || '')}"></label><label>Address<input id="address" autocomplete="street-address" value="${h(draft.customer.address || '')}"></label></div><div class="form-actions"><button class="primary" onclick="saveStep1()">Continue</button></div>`;
  if (draft.step === 2) return `<div class="formgrid"><label>Service<select id="service">${services.map(item => `<option value="${item.id}" ${item.id === draft.serviceId ? 'selected' : ''}>${h(item.name)}</option>`)}</select></label></div><div id="serviceFields" class="formgrid"></div><div id="svcInfo" class="summary-box"></div><div class="form-actions"><button class="primary" onclick="saveStep2()">Continue</button></div>`;
  if (draft.step === 3) {
    const docs = applicableDocuments(variant?.documents || [], draft.details);
    const missing = docs.filter(item => item.required && !draft.docs[item.label]);
    return `<p class="muted">${docs.filter(item => item.required).length - missing.length} of ${docs.filter(item => item.required).length} required documents selected. Upload every required document to continue.</p><div class="upload-list">${docs.map(item => `<div class="doc"><span><strong>${h(item.label)}</strong><small>${h(item.note || (item.required ? 'Required document' : 'Optional supporting document'))}</small><em>${h(draft.docs[item.label]?.pages ? `${draft.docs[item.label].pages.length} pages selected` : draft.docs[item.label]?.fileName || 'Not selected')}</em></span>${uploadControls(encodeURIComponent(item.label), '', item.multiple)}${draft.docs[item.label] && !draft.docs[item.label].pages ? `<ul class="selected-pages"><li><span>${h(draft.docs[item.label].fileName)}</span><button type="button" class="quiet" onclick="removeDraftDocument('${encodeURIComponent(item.label)}')" aria-label="Remove ${h(item.label)}">Remove</button></li></ul>` : ''}${draft.docs[item.label]?.pages ? `<ul class="selected-pages">${draft.docs[item.label].pages.map((page,index) => `<li><span>Page ${index+1}: ${h(page.fileName)}</span><button type="button" class="quiet" onclick="removeDraftPage('${encodeURIComponent(item.label)}',${index})" aria-label="Remove page ${index+1}">Remove</button></li>`).join('')}</ul>` : ''}</div>`).join('')}</div><div class="form-actions"><button class="quiet" onclick="wizardBack(2)">Back</button><button class="primary" onclick="saveStep3()" ${missing.length ? 'disabled' : ''}>Continue</button></div>`;
  }
  const amount = variant?.amounts || { serviceCharge:0, officialFee:0, tax:0, total:0 };
  const pages = Object.values(draft.docs).reduce((count,doc) => count + (doc.pages?.length || 1), 0);
  return `<section class="intake-review"><header class="intake-review-heading"><span class="intake-review-icon">${icon('completed')}</span><div><p class="eyebrow">Ready to submit</p><h3>Review your application</h3><p>Check the details below before saving your case.</p></div></header><div class="intake-review-card"><div class="intake-review-service"><span>Selected service</span><h3>${h(service.name)}</h3><span class="intake-document-count">${pages} ${pages === 1 ? 'file' : 'files'} ready</span></div><dl class="intake-review-details"><div><dt>Full name</dt><dd>${h(draft.customer.name)}</dd></div><div><dt>Mobile number</dt><dd>${h(draft.customer.mobile)}</dd></div>${Object.entries(draft.details).filter(([,value]) => value).map(([label,value]) => `<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl><div class="intake-review-price"><div><span>Service charge</span><strong>${amount.total ? money(amount.serviceCharge) : 'To be confirmed'}</strong></div><div class="intake-review-total"><span>Total payable</span><strong>${amount.total ? money(amount.total) : 'To be confirmed'}</strong></div></div></div><label class="check intake-review-consent"><input type="checkbox" id="consent"><span>Customer consent accepted for this private assistance service</span></label></section><div class="form-actions intake-review-actions"><button class="quiet" onclick="wizardBack(3)">Back</button><button onclick="submitCase('another')">Save & create another</button><button onclick="submitCase('later')">Save & pay later</button><button class="primary" onclick="submitCase()">Create & pay</button></div>`;
}

function bindWizard() {
  if (draft.step !== 2) return;
  const serviceSelect = document.querySelector('#service');
  const collectFields = () => document.querySelectorAll('#serviceFields [data-field]').forEach(input => { draft.details[decodeURIComponent(input.dataset.field)] = input.value; });
  const update = () => {
    const service = services.find(item => item.id === serviceSelect.value);
    const variant = service.variants.find(item => item.id === draft.variantId) || service.variants[0];
    draft.serviceId = service.id;
    draft.variantId = variant.id;
    for (const field of variant.fields || []) {
      if (field.defaultWhen && draft.details[field.defaultWhen.field] === field.defaultWhen.equals) draft.details[field.label] = field.defaultWhen.value;
    }
    document.querySelector('#serviceFields').innerHTML = (variant.fields || []).filter(field => !field.when || draft.details[field.when.field] === field.when.equals || (field.defaultWhen && draft.details[field.defaultWhen.field] === field.defaultWhen.equals)).map(field => {
      const key = encodeURIComponent(field.label);
      const rawValue = draft.details[field.label] || '';
      const value = h(rawValue);
      const automatic = field.defaultWhen && draft.details[field.defaultWhen.field] === field.defaultWhen.equals;
      const control = automatic ? `<input data-field="${key}" value="${value}" readonly aria-readonly="true">` : field.type === 'select'
        ? `<select data-field="${key}"><option value="">Choose…</option>${(field.options || []).map(option => `<option value="${h(option)}" ${option === rawValue ? 'selected' : ''}>${field.label === 'Ration card colour' ? ({ Yellow: '\u{1F7E1} ', Orange: '\u{1F7E0} ', White: '\u26AA ' }[option] || '') : ''}${h(option)}</option>`).join('')}</select>`
        : `<input data-field="${key}" type="${['email','date','number','tel'].includes(field.type) ? field.type : 'text'}" value="${value}" ${field.required ? 'required' : ''} maxlength="500">`;
      return `<label>${h(field.label)}${control}</label>`;
    }).join('');
    document.querySelector('#serviceFields').querySelectorAll('[data-field]').forEach(input => input.onchange = () => {
      const label = decodeURIComponent(input.dataset.field);
      const definition = variant.fields.find(field => field.label === label);
      if (definition.when && draft.details[definition.when.field] !== definition.when.equals) return;
      draft.details[label] = input.value;
      if ((variant.fields || []).some(field => field.when?.field === label)) {
        for (const field of variant.fields) {
          if (field.when && draft.details[field.when.field] !== field.when.equals) delete draft.details[field.label];
        }
        update();
      }
    });
    const docs = applicableDocuments(variant.documents, draft.details);
    document.querySelector('#svcInfo').innerHTML = `<strong>${h(service.description)}</strong><p>${docs.map(item => h(item.label)).join(' · ')}</p><small>${h(variant.instructions || 'Confirm documents and fees before submission.')}</small><span>Fees to confirm before payment</span>`;
  };
  serviceSelect.onchange = () => { collectFields(); draft.details = {}; draft.variantId = ''; update(); };
  update();
}

function applicableDocuments(documents, details) {
  return documents.filter(item => !item.when || !Object.hasOwn(details || {}, item.when.field) || !String(details[item.when.field] || '').trim() || String(details[item.when.field]) === String(item.when.equals));
}

function rerenderWizard({keepScroll=false}={}) {const scroll=keepScroll?(document.querySelector('#drawer .panel')?.scrollTop||0):0;closeDrawer();drawWizard();if(keepScroll) document.querySelector('#drawer .panel').scrollTop=scroll;}
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
  document.querySelectorAll('.toast').forEach(item => item.remove());
  draft.step = 4; rerenderWizard();
}
function wizardBack(step) { draft.step = step; rerenderWizard(); }
function uploadControls(encodedType, caseId = '', multiple = false) {
  const handler = caseId ? `uploadCaseDocument('${caseId}','${encodedType}',this)` : multiple ? `pickDocs('${encodedType}',this.files)` : `pickDoc('${encodedType}',this.files[0])`;
  return `<span class="upload-options"><label class="file-action">${multiple ? 'Add report pages' : 'Upload document'}<input type="file" ${multiple ? 'multiple' : ''} accept="image/jpeg,image/png,application/pdf" onchange="${handler}"></label></span>`;
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
  finally { setDrawerBusy(); rerenderWizard({keepScroll:true}); }
}
async function pickDocs(encodedType, files) {
  if (!files?.length || drawerBusy) return;
  const selected = Array.from(files);
  try { selected.forEach(validateFile); } catch (error) { return toast(error.message); }
  const type = decodeURIComponent(encodedType);
  setDrawerBusy(`Preparing ${selected.length} report pages...`);
  try {
    const pages = [];
    for (const file of selected) pages.push({fileName:file.name,mimeType:file.type,size:file.size,...(cloudUploads ? {file} : {content:await fileAsBase64(file)})});
    const existing = draft.docs[type];
    draft.docs[type] = {pages:[...(existing?.pages || (existing ? [existing] : [])),...pages]};
    toast(`${pages.length} report pages added`);
  } catch (error) { toast(error.message); }
  finally { setDrawerBusy(); rerenderWizard({keepScroll:true}); }
}
function removeDraftPage(encodedType, index) { return removeDraftDocument(encodedType,index); }
async function removeDraftDocument(encodedType, index = null) {
  if (drawerBusy) return;
  const type = decodeURIComponent(encodedType);
  const group = draft.docs[type];
  const doc = index === null ? group : group?.pages[index];
  if (!doc) return;
  const key = doc.uploadKey || (index === null ? type : `${type}:${index}`);
  const documentId = draft.uploadedIds?.[key];
  setDrawerBusy('Removing file...');
  try {
    if (documentId && draft.createdCase) await api(`/api/cases/${draft.createdCase.id}/remove-document`,{method:'POST',body:{documentId}});
    if (index === null) delete draft.docs[type];
    else {
      group.pages.splice(index,1);
      if (!group.pages.length) delete draft.docs[type];
    }
    if (draft.uploaded) delete draft.uploaded[key];
    if (draft.uploadedIds) delete draft.uploadedIds[key];
  } catch (error) { toast(error.message); }
  finally { setDrawerBusy(); rerenderWizard({keepScroll:true}); }
}
async function removeSavedDocument(caseId, documentId) {
  if (drawerBusy) return;
  setDrawerBusy('Removing file...');
  try {
    await api(`/api/cases/${caseId}/remove-document`,{method:'POST',body:{documentId}});
    toast('File removed');
    setDrawerBusy(); closeDrawer();
    await load(); await openCase(caseId);
  } catch (error) { toast(error.message); }
  finally { setDrawerBusy(); }
}
async function submitCase(nextAction='pay') {
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
    draft.uploadedIds ||= {};
    let completed = 0;
    const entries = Object.entries(draft.docs).flatMap(([type,doc]) => doc.pages ? doc.pages.map((page,index) => [type,page,page.uploadKey ||= `${type}:${Date.now()}:${index}`]) : [[type,doc,type]]), total = entries.length;
    const uploadChains = new Map();
    let cursor=0, failure;
    // Three transfers can overlap without flooding a mobile connection.
    const worker=async()=>{
      while(cursor<entries.length && !failure) {
        const [docType,document,uploadKey]=entries[cursor++], identity=document.file || document.content;
        if(draft.uploaded[uploadKey]===identity) {completed++;continue;}
        setDrawerBusy(`Uploading documents: ${completed} of ${total} complete...`);
        try {
          const transfer = (uploadChains.get(docType) || Promise.resolve()).then(() => {
            if (failure) throw failure;
            return uploadDocument(created.id,docType,document,{deferMirrors:cloudUploads});
          });
          uploadChains.set(docType,transfer);
          const result = await transfer;
          if (result?.documentId) draft.uploadedIds[uploadKey] = result.documentId;
          draft.uploaded[uploadKey]=identity;
          completed++;
          setDrawerBusy(`Uploading documents: ${completed} of ${total} complete...`);
        } catch(error) {failure ||= error;}
      }
    };
    await Promise.all(Array.from({length:Math.min(3,total)},worker));
    if(failure) throw failure;
    if(cloudUploads) await api(`/api/cases/${created.id}/finish-uploads`,{method:'POST',body:{}});
    setDrawerBusy(); closeDrawer(); await load(); toast(`Created ${created.ref}`);
    if(nextAction==='another') startCase();
    else if(nextAction==='later') {toast('Case saved. Select unpaid cases in Payments to pay them together.');await setView('payments');}
    else await pay(created.id);
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
    void markCaseUpdatesRead(caseId);
    document.body.insertAdjacentHTML('beforeend', `<div class="drawer" id="drawer"><div class="panel case-panel">${caseDetail(data.case, data.documents, data.notes)}</div></div>`);
  } catch (error) { toast(error.message); }
}

function documentChecklist(item, documents) {
  const active = documents.filter(document => document.state !== 'replaced');
  return applicableDocuments(item.variant.documents || [], item.details || {}).map(requirement => {
    const uploaded = active.filter(document => document.doc_type === requirement.label);
    const multiple = requirement.multiple;
    return `<div class="doc"><span><strong>${h(requirement.label)}</strong><small>${uploaded.length ? multiple ? `${uploaded.length} report pages uploaded` : `Uploaded version ${uploaded[0].version}` : requirement.required ? 'Required document missing' : 'Optional supporting document'}</small>${statusBadge(uploaded.length ? 'Uploaded' : requirement.required ? 'Missing' : 'Optional')}${uploaded.map((doc,index) => `${multiple ? `<small>Page ${index+1}</small>` : ''}${documentActions(item,doc)}`).join('')}</span>${!['Closed','Delivered','Cancelled'].includes(item.status) ? uploadControls(encodeURIComponent(requirement.label), item.id, multiple) : ''}</div>`;
  }).join('');
}

function documentActions(item, document) {
  const url = new URL(document.download_url, location.origin).href;
  const message = `Document ready for ${item.ref} - ${item.customer.name}. Download ${document.doc_type}: ${url}`;
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(message)}`;
  const ready = ['Ready to Submit','Submitted to Official Portal','Under Government Review','Approved','Delivered','Closed'].includes(item.status);
  const removable = !['Closed','Delivered','Cancelled'].includes(item.status) && (document.doc_type !== 'Received Document' || (['backoffice','admin'].includes(me.role) && item.status === 'Document Received'));
  const previewable = ['backoffice','admin'].includes(me.role) && ['image/jpeg','image/png','application/pdf'].includes(document.mime_type);
  return `<span class="doc-actions">${previewable ? `<button type="button" class="quiet preview-document-button" onclick="previewDocument('${document.id}')" aria-label="Preview ${h(document.doc_type)}">Preview</button>` : ''}<a href="${h(document.download_url)}" target="_blank" rel="noopener">Download</a>${ready ? `<a href="${h(whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${removable ? `<button type="button" class="quiet" onclick="removeSavedDocument('${item.id}','${document.id}')" aria-label="Remove ${h(document.doc_type)} file">Remove</button>` : ''}</span>`;
}

let documentPreviewGeneration = 0;
let documentPreviewTrigger = null;
let documentPreviewLoading = null;
let documentPreviewPDF = null;
let documentPreviewRender = null;
let documentPreviewPage = 1;
let documentPreviewZoom = 1;
let documentPreviewBusy = false;
async function previewDocument(documentId) {
  if (drawerBusy) return;
  closeDocumentPreview();
  documentPreviewTrigger = document.activeElement;
  const generation = ++documentPreviewGeneration;
  const saved = selectedCase?.documents.find(document => document.id === documentId);
  const dialog = document.createElement('dialog');
  dialog.id = 'documentPreview';
  dialog.className = 'document-preview';
  dialog.setAttribute('aria-labelledby','documentPreviewTitle');
  dialog.innerHTML = `<header class="document-preview-header"><div><p class="eyebrow">Document preview</p><h2 id="documentPreviewTitle">${h(saved?.doc_type || 'Uploaded document')}</h2><p id="documentPreviewName">${h(saved?.file_name || '')}</p></div><button type="button" class="quiet" onclick="closeDocumentPreview()" aria-label="Close preview">Close</button></header><div class="document-preview-body" id="documentPreviewBody"><p role="status">Loading preview...</p></div><footer class="document-preview-footer"><p>Check the document before downloading.</p><div id="documentPreviewActions"></div></footer>`;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDocumentPreview();});
  dialog.addEventListener('click',event=>{if(event.target===dialog) {const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom) closeDocumentPreview();}});
  document.body.append(dialog);
  dialog.showModal();
  try {
    const preview = await api(`/api/documents/${encodeURIComponent(documentId)}/preview`);
    if (generation !== documentPreviewGeneration || !dialog.isConnected) return;
    dialog.querySelector('#documentPreviewName').textContent = preview.fileName;
    const body = dialog.querySelector('#documentPreviewBody');
    dialog.querySelector('#documentPreviewActions').innerHTML = `<button type="button" class="quiet" onclick="previewDocument('${documentId}')">Reload preview</button><a class="document-preview-open" href="${h(preview.url)}" target="_blank" rel="noopener">Open full-size preview</a><a class="document-preview-download" href="/api/documents/${encodeURIComponent(documentId)}/download" target="_blank" rel="noopener">Download</a>`;
    if (preview.mimeType === 'application/pdf') {
      const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
      if (generation !== documentPreviewGeneration) return;
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      documentPreviewLoading = pdfjs.getDocument({url:preview.url,cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',iccUrl:'/vendor/pdfjs/iccs/',isEvalSupported:false});
      const pdf = await documentPreviewLoading.promise;
      if (generation !== documentPreviewGeneration) {void pdf.destroy();return;}
      documentPreviewPDF = pdf;
      documentPreviewPage = 1;documentPreviewZoom = 1;
      body.classList.add('document-preview-pdf');
      body.innerHTML = `<div class="pdf-preview-toolbar"><button type="button" class="quiet" id="previewPrevious" onclick="changePreviewPage(-1)" aria-label="Previous PDF page">Previous</button><span id="previewPageCount" role="status"></span><button type="button" class="quiet" id="previewNext" onclick="changePreviewPage(1)" aria-label="Next PDF page">Next</button><button type="button" class="quiet" id="previewZoomOut" onclick="zoomDocumentPreview(-0.25)" aria-label="Zoom out">-</button><span id="previewZoomLabel"></span><button type="button" class="quiet" id="previewZoomIn" onclick="zoomDocumentPreview(0.25)" aria-label="Zoom in">+</button></div><div class="pdf-preview-page"><canvas id="documentPreviewCanvas" role="img" aria-label="PDF page 1"></canvas></div>`;
      await renderPDFPreview();
    } else {
      body.innerHTML = `<img class="document-preview-image" src="${h(preview.url)}" alt="Preview of ${h(preview.fileName)}">`;
      body.querySelector('img').onerror = () => { if(generation === documentPreviewGeneration) body.innerHTML='<p role="alert">The preview could not load. Use Reload preview to try again.</p>'; };
    }
  } catch (error) {
    if (generation !== documentPreviewGeneration || !dialog.isConnected) return;
    dialog.querySelector('#documentPreviewBody').innerHTML = `<div class="document-preview-error" role="alert"><p>${h(error.message)}</p><button type="button" class="quiet" onclick="previewDocument('${documentId}')">Retry preview</button></div>`;
  }
}
async function renderPDFPreview() {
  const generation = documentPreviewGeneration;
  const dialog = document.querySelector('#documentPreview');
  if (!dialog || !documentPreviewPDF || documentPreviewBusy) return;
  documentPreviewBusy = true;
  dialog.querySelectorAll('.pdf-preview-toolbar button').forEach(button=>{button.disabled=true;});
  try {
    const page = await documentPreviewPDF.getPage(documentPreviewPage);
    if (generation !== documentPreviewGeneration) return;
    const stage = dialog.querySelector('.pdf-preview-page');
    const canvas = dialog.querySelector('canvas');
    const scale = Math.max(0.1,(stage.clientWidth-32)/page.getViewport({scale:1}).width) * documentPreviewZoom;
    const viewport = page.getViewport({scale});
    const density = Math.min(window.devicePixelRatio || 1,2);
    canvas.width = Math.ceil(viewport.width*density);canvas.height = Math.ceil(viewport.height*density);
    canvas.style.width = `${viewport.width}px`;canvas.style.height = `${viewport.height}px`;
    canvas.setAttribute('aria-label',`PDF page ${documentPreviewPage}`);
    dialog.querySelector('#previewPageCount').textContent = `Page ${documentPreviewPage} of ${documentPreviewPDF.numPages}`;
    dialog.querySelector('#previewZoomLabel').textContent = `${Math.round(documentPreviewZoom*100)}%`;
    documentPreviewRender = page.render({canvas,viewport,transform:density===1?null:[density,0,0,density,0,0]});
    await documentPreviewRender.promise;
    canvas.dataset.rendered = String(documentPreviewPage);
    stage.scrollTo(0,0);
  } catch (error) {
    if (generation === documentPreviewGeneration) {
      dialog.querySelector('#documentPreviewBody').innerHTML = '<p role="alert">This PDF could not be displayed. Try Reload preview or Open full-size preview.</p>';
    }
  } finally {
    if (generation === documentPreviewGeneration) {
      documentPreviewBusy = false;documentPreviewRender = null;
      const setDisabled=(id,disabled)=>{const button=dialog.querySelector(id);if(button) button.disabled=disabled;};
      setDisabled('#previewPrevious',documentPreviewPage<=1);
      setDisabled('#previewNext',documentPreviewPage>=documentPreviewPDF.numPages);
      setDisabled('#previewZoomOut',documentPreviewZoom<=0.5);
      setDisabled('#previewZoomIn',documentPreviewZoom>=3);
    }
  }
}
async function changePreviewPage(delta) {
  if (!documentPreviewPDF || documentPreviewBusy) return;
  documentPreviewPage = Math.max(1,Math.min(documentPreviewPDF.numPages,documentPreviewPage+delta));
  await renderPDFPreview();
}
async function zoomDocumentPreview(delta) {
  if (!documentPreviewPDF || documentPreviewBusy) return;
  documentPreviewZoom = Math.max(0.5,Math.min(3,documentPreviewZoom+delta));
  await renderPDFPreview();
}

function closeDocumentPreview() {
  documentPreviewGeneration++;
  documentPreviewRender?.cancel();documentPreviewRender = null;
  if (documentPreviewLoading) void documentPreviewLoading.destroy().catch(()=>{});
  documentPreviewLoading = documentPreviewPDF = null;documentPreviewBusy = false;
  const dialog = document.querySelector('#documentPreview');
  if (dialog) { dialog.close();dialog.remove(); }
  if (documentPreviewTrigger?.isConnected) documentPreviewTrigger.focus();
  documentPreviewTrigger = null;
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

function casePaymentCard(item) {
  const payment=item.payment, raw=payment?.status || item.payment_state;
  const paid=['PAID','paid','verified','offline_approved'].includes(raw) && payment?.gateway!=='demo';
  const review=raw==='AWAITING_VERIFICATION';
  const labels={PENDING:'Awaiting payment',INITIATED:'Awaiting payment',unpaid:'Awaiting payment',AWAITING_VERIFICATION:'Under review',FAILED:'Claim rejected',CANCELLED:'Cancelled',EXPIRED:'Expired',REFUNDED:'Refunded'};
  const label=paid ? 'Verified' : labels[raw] || 'Awaiting payment';
  return `<section class="detail-section case-payment"><header class="case-payment-heading"><span class="case-payment-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18M7 15h3"/></svg></span><div><h3>Payment</h3><p>${paid ? 'Payment received and verified' : review ? 'Our team is checking the bank record' : 'Pay securely with your UPI app'}</p></div><span class="case-payment-badge ${paid ? 'is-paid' : review ? 'is-review' : ''}"><i></i>${h(label)}</span></header><div class="case-payment-content"><div class="case-payment-total"><span>${paid ? 'Amount paid' : 'Amount payable'}</span><strong>${money(payment?.amount ?? item.amounts.total)}</strong></div>${['sales','admin'].includes(me.role) ? `<button class="case-payment-button" onclick="pay('${item.id}')">${paid ? 'View receipt' : review ? 'Review payment' : 'Open UPI checkout'}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>` : ''}</div>${payment ? `<details class="case-payment-details"><summary>Payment details</summary><dl><dt>Order reference</dt><dd>${h(payment.gateway_order_id)}</dd>${payment.transaction_id ? `<dt>UTR</dt><dd>${h(payment.transaction_id)}</dd>` : ''}${payment.verified_at ? `<dt>Verified on</dt><dd>${dateTime(payment.verified_at)}</dd>` : ''}</dl></details>` : ''}${me.role==='admin' && !paid ? `<details class="case-payment-exception"><summary>Processing exception</summary><p>Allow this case to proceed before payment verification. A reason is required.</p><label>Exception reason<input id="exceptionReason" maxlength="1000" placeholder="Explain why processing should proceed"></label><button onclick="approvePaymentException('${item.id}')">Record exception</button></details>` : ''}</section>`;
}

function caseDetail(item, documents, notes) {
  const intakeDetails = Object.entries(item.details || {}).filter(([, value]) => value).map(([label, value]) => `<div><span>${h(label)}</span><strong>${h(value)}</strong></div>`).join('');
  const priced = item.amounts.total > 0;
  return `<div class="drawer-head"><div><p class="eyebrow">${h(item.ref)}</p><h2>${h(item.customer.name)}</h2><p>${h(item.service.name)} · ${h(item.variant.name)}</p></div><button class="quiet" onclick="closeDrawer()">Close</button></div>
    <div class="case-summary"><div><span>Status</span>${statusBadge(item.status)}</div><div><span>Payment</span>${statusBadge(item.payment_state)}</div><div><span>${priced ? 'Total' : 'Price'}</span><strong>${priced ? money(item.amounts.total) : 'To be confirmed'}</strong></div><div><span>Owner</span><strong>${h(item.backoffice?.name || 'Unassigned')}</strong></div></div>
    ${intakeDetails ? `<section class="detail-section"><div class="panel-title"><div><h3>Application details</h3><p>Information collected for this service request.</p></div></div><div class="review">${intakeDetails}</div></section>` : ''}
    ${item.status === 'Correction Required' ? `<section class="correction-notice"><strong>Returned to sales for correction</strong><p>${h(notes.filter(note => note.new_status === 'Correction Required').at(-1)?.note || 'Review the case timeline and update the requested documents.')}</p></section>` : ''}
    ${casePaymentCard(item)}
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
  return `<section class="workflow-box"><div><p class="eyebrow">Workflow action</p><h3>Move case forward</h3>${item.document_state !== 'complete' ? '<p>Required documents are missing. Upload them to unlock progress.</p>' : ''}</div><select id="nextStatus">${allowed.map(status => `<option>${h(status)}</option>`).join('')}</select><textarea id="note" placeholder="Progress note or correction instructions"></textarea><div class="workflow-actions"><button class="primary" onclick="progress('${item.id}')">Update status</button>${allowed.includes('Correction Required') ? `<button class="return-to-sales" onclick="returnCaseToSales('${item.id}')">Return to sales</button>` : ''}</div></section>`;
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
async function uploadDocument(caseId, docType, document, {deferMirrors=false} = {}) {
  if (!cloudUploads) return api(`/api/cases/${caseId}/documents`, {method:'POST',body:{docType,...document}});
  const metadata = {docType,fileName:document.fileName,mimeType:document.mimeType,size:document.size};
  document.cloudAuthorization ||= await api(`/api/cases/${caseId}/upload-url`, {method:'POST',body:metadata});
  if (!document.cloudTransferred) {
    const response = await fetch(document.cloudAuthorization.uploadUrl, {method:'PUT',headers:{'content-type':document.mimeType},body:document.file});
    if (!response.ok && response.status !== 409) throw new Error('Document upload failed. Retry the pending upload.');
    document.cloudTransferred = true;
  }
  return api(`/api/cases/${caseId}/documents`, {method:'POST',body:{uploadId:document.cloudAuthorization.uploadId,...(deferMirrors?{deferMirrors:true}:{})}});
}
async function uploadCaseDocument(caseId, encodedType, input) {
  const files = Array.from(input.files || []);
  if (!files.length || drawerBusy) return;
  try { files.forEach(validateFile); } catch (error) { input.value = ''; return toast(error.message); }
  const docType = decodeURIComponent(encodedType);
  setDrawerBusy(`Uploading ${docType}… Please wait before moving this case forward.`);
  const badge = docType === 'Received Document' ? input.closest('.doc')?.querySelector('.badge') : null;
  if (badge) { badge.textContent = 'Uploading...'; badge.className = 'badge neutral'; }
  try {
    for (const file of files) await uploadDocument(caseId, docType, { fileName:file.name, mimeType:file.type, size:file.size, ...(cloudUploads ? {file} : {content:await fileAsBase64(file)}) });
    setDrawerBusy(); closeDrawer(); await load(); await openCase(caseId); toast(`${docType} uploaded`);
  } catch (error) { input.value = ''; if (badge) { badge.textContent = 'Upload failed'; badge.className = 'badge danger'; } toast(error.message); }
  finally { setDrawerBusy(); }
}

async function claim(caseId) { try { await api(`/api/cases/${caseId}/claim`, { method:'POST' }); closeDrawer(); await load(); openCase(caseId); toast('Case assigned to you'); } catch (error) { toast(error.message); } }
async function submitReceivedDocument(caseId, button) { try { button.disabled = true; button.textContent = 'Submitting...'; await api(`/api/cases/${caseId}/submit-received-document`, { method:'POST' }); closeDrawer(); await load(); setView('completed'); toast('Document submitted. Request closed'); } catch (error) { button.disabled = false; button.textContent = 'Submit'; toast(error.message); } }
function renderSavedCase(result) {
  cases=cases.map(item=>item.id===result.case.id?result.case:item);
  if(selectedCase?.case.id===result.case.id) {
    selectedCase={...selectedCase,case:result.case,notes:[...selectedCase.notes,...(result.note?[result.note]:[])]};
    const panel=document.querySelector('#drawer .case-panel');
    if(panel) {
      const scroll=panel.scrollTop;
      panel.innerHTML=caseDetail(selectedCase.case,selectedCase.documents,selectedCase.notes);
      panel.scrollTop=scroll;
    }
  }
  render();
}
async function returnCaseToSales(caseId) {
  if (drawerBusy) return;
  const note = document.querySelector('#note');
  if (!note.value.trim()) { note.focus(); return toast('Add correction instructions before returning the case to sales'); }
  document.querySelector('#nextStatus').value = 'Correction Required';
  await progress(caseId);
}
async function progress(caseId) {
  if(drawerBusy) return;
  const body={status:document.querySelector('#nextStatus').value,note:document.querySelector('#note').value,visibility:'sales'};
  setDrawerBusy('Updating status...');
  let result;
  try {result=await api(`/api/cases/${caseId}/progress`,{method:'POST',body});}
  catch(error) {toast(error.message);return;}
  finally {setDrawerBusy();}
  try {renderSavedCase(result);toast('Status updated');}
  catch {toast('Status saved. Reopen the case to refresh its details.');}
}

function closeDrawer() {
  if(drawerBusy) return;
  closeDocumentPreview();
  document.querySelector('#drawer')?.remove();
  document.body?.classList?.remove('payment-open');
}
async function connectGoogleDrive() { try { location.href = (await api('/api/google/oauth/start')).authorizationUrl; } catch (error) { toast(error.message); } }
async function saveDriveRootFolder(button) {
  button.disabled = true;
  try { await api('/api/google/root-folder',{method:'POST',body:{folder:document.querySelector('#driveRootFolder').value}}); await load(); toast('Drive folder verified and saved. Retry your pending uploads.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
}
async function activateGoogleSheets() { try { toast('Verifying workbook and syncing cases'); const result = await api('/api/google/sheets/activate', { method:'POST' }); await load(); toast(`Google Sheets live: ${result.syncedCases} cases synced`); } catch (error) { toast(error.message); } }
async function setAnalyticsPeriod(period) { analyticsPeriod = period; adminAnalytics = await api(`/api/admin/dashboard?period=${period}`); render(); }
async function logout() { if (drawerBusy) return;closeDrawer(); await api('/api/logout', { method:'POST' });clearTimeout(updatesTimer);caseNotifications=[]; me = null;view='dashboard';googleStatus=sheetsStatus=adminAnalytics=employeeData=null;selectedPaymentCases.clear();paymentData=paymentSettings=checkout=null;paymentFilters='';renderLogin(); }
async function setView(next) {
  if(drawerBusy) return;
  closeDrawer();view=next;render();
  await refreshCaseUpdates();
  if(next==='payments') {await refreshPayments();return;}
  if(me.role==='admin' && ['admin','employees'].includes(next)) {
    try {await loadViewData();if(view===next) render();} catch(error) {toast(error.message);}
  }
}

Object.assign(window, { startCase, closeDrawer, saveStep1, saveStep2, saveStep3, pickDoc, pickDocs, removeDraftPage, removeDraftDocument, removeSavedDocument, previewDocument, closeDocumentPreview, changePreviewPage, zoomDocumentPreview, uploadCaseDocument, submitCase, openCase, pay, claim, submitReceivedDocument, progress, returnCaseToSales, connectGoogleDrive, activateGoogleSheets, setAnalyticsPeriod, logout, filterCases, setView });
Object.assign(window, { downloadCaseFiles, wizardBack });
Object.assign(window, { saveDriveRootFolder });
Object.assign(window, { toggleEmployeeDates, applyEmployeePeriod, createEmployee });
Object.assign(window,{focusSignIn,switchAccount});
document.addEventListener('click',event=>{document.querySelectorAll('.profile[open],.mobile-more[open]').forEach(menu=>{if(!menu.contains(event.target)) menu.open=false;});});
document.addEventListener('keydown',event=>{if(event.key==='Escape') document.querySelectorAll('.profile[open],.mobile-more[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary')?.focus();});});
// Direct UPI checkout uses the existing staff session and UI.
let paymentData = null, paymentSettings = null, checkout = null;
let paymentFilters = '';
const selectedPaymentCases=new Set();
const paymentSearchFields={all:'All fields',customer:'Customer name',utr:'UTR',mobile:'Mobile number',service:'Service',employee:'Employee',order:'Order / Case ID',status:'Status',from:'From date',to:'To date'};
async function loadPayments() {
  [paymentData,paymentSettings] = await Promise.all([api('/api/payments'+paymentFilters),api('/api/payment-settings')]);
}
function renderPayments() {
  if (!paymentData) return empty('Loading payments…');
  const m=paymentData.metrics;
  return `${pageHead('Payments','Direct UPI collections. Only receiving-account verification records revenue.')}
    ${me.role==='admin' ? `<section class="metric-grid compact">${metricCard('Verified collections',money(m.collected),'All verified UPI collections','green')}${metricCard('Today',money(m.today),'India time','green')}${metricCard('Pending',number(m.pending),'Unsubmitted / expired','amber')}${metricCard('Awaiting verification',number(m.awaiting),'Customer claims','amber')}${metricCard('Failed / cancelled',number(m.failed),'Review receiving account if needed','blue')}${metricCard('Verified transactions',number(m.verified),'Manually checked','green')}</section>${paymentSettingsPanel()}` : ''}
    ${['sales','admin'].includes(me.role) ? `<section class="summary-box"><strong>Pay for multiple cases together</strong><p>Create cases one by one, then select the unpaid cases below and pay their combined amount once.</p><p id="combinedPaymentTotal">${combinedPaymentSummary()}</p><button class="primary" onclick="paySelectedCases(this)">Pay selected cases together</button></section>` : ''}
    <div class="payment-list-tools"><form id="paymentFilters" class="payment-search" role="search" aria-label="Search payments" onsubmit="filterPayments(event)">
      <label class="payment-search-by"><span>Search by</span><select name="searchBy" onchange="updatePaymentSearch(this.value)">${Object.entries(paymentSearchFields).map(([key,label])=>`<option value="${key}" ${key===(new URLSearchParams(paymentFilters).get('searchBy') || 'all')?'selected':''}>${label}</option>`).join('')}</select></label>
      <input id="paymentSearchInput" name="q" type="${['from','to'].includes(new URLSearchParams(paymentFilters).get('searchBy'))?'date':'search'}" aria-label="Search value" placeholder="Search payments" value="${h(new URLSearchParams(paymentFilters).get('q') || '')}">
      <button class="primary payment-search-submit" aria-label="Search payments" title="Search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg></button>
    </form><div class="payment-search-actions">${paymentFilters?'<button type="button" onclick="resetPaymentFilters()">Clear search</button>':''}<button type="button" onclick="exportPayments()">Export report</button></div></div><div class="table-shell"><table class="table"><thead><tr><th>Select</th><th>Order / Customer</th><th>Service</th><th>Amount</th><th>Method / UTR</th><th>Employee</th><th>Status</th><th>Date</th><th>Action</th></tr></thead><tbody>${paymentData.payments.map(p=>`<tr><td>${batchEligible(p) ? `<input type="checkbox" aria-label="Select ${h(p.customer_name)} ${h(p.case_ref)}" onchange="selectPaymentCase('${p.case_id}',this.checked)" ${selectedPaymentCases.has(p.case_id)?'checked':''}>` : ''}</td><td><strong>${h(p.gateway_order_id)}</strong><small>${h(p.customer_name)} · ${h(p.customer_mobile)}</small></td><td>${h(p.service_name)}</td><td>${money(p.amount)}</td><td>${h(p.payment_method || '—')}<small>${h(p.transaction_id || '—')}</small></td><td>${h(p.employee_name)}</td><td>${statusBadge(p.status)}</td><td>${dateTime(p.created_at)}</td><td><button onclick="showPayment('${p.id}')">${me.role==='admin' && p.status==='AWAITING_VERIFICATION' ? 'Review claim' : 'View'}</button></td></tr>`).join('')}</tbody></table></div>`;
}
function paymentSettingsPanel() {
  const c=paymentSettings;
  return `<details class="summary-box" ${!c.receiverReady ? 'open' : ''}><summary><strong>Receiver & service pricing</strong> · ${c.receiverReady ? 'Checkout enabled' : 'Checkout activation required'} · ${c.testPricingMode ? 'TEST_PRICING_MODE: ₹1' : 'Standard pricing'}</summary>
    <p>${h(c.payeeName)} · ${h(c.upiId)} · ${h(c.mobile)}</p><p>₹1 pricing transfers real money. You can enable checkout by confirming this is the business receiving account. A setup test UTR is not required.</p>
    ${!c.receiverReady ? `<form class="formgrid" onsubmit="confirmReceiver(event)"><label class="check"><input name="ownerConfirmed" type="checkbox" required>I confirm this UPI account belongs to SUCCESS ONLINE SERVICES and want checkout enabled</label><button class="primary">Enable UPI checkout</button></form>` : `<p>Enabled by ${c.receiverActivationBasis==='owner_confirmation' ? 'business account confirmation' : 'received test transfer confirmation'}. Customer payments still require individual verification.</p>`}
    <p>Saved standard prices remain available when test pricing is disabled. Existing orders keep their original amount.</p><button onclick="setTestPricing(${!c.testPricingMode})">${c.testPricingMode ? 'Disable' : 'Enable'} ₹1 test pricing</button>
    <div class="formgrid">${c.prices.map(p=>`<form onsubmit="saveServicePrice(event,'${p.variant_id}')"><label>${h(p.service_name)} — standard ₹ price<input name="price" type="number" min="0.01" max="1000000" step="0.01" value="${(p.price/100).toFixed(2)}" required></label><small>Original: ${money(p.original_price)}</small><button>Save price</button></form>`).join('')}</div>
    <button onclick="retryPaymentSync()">Retry pending Google Drive / Sheets sync</button></details>`;
}
async function filterPayments(event) {
  event.preventDefault();
  const form=event.target, searchBy=form.elements.searchBy.value, q=form.elements.q.value.trim();
  paymentFilters=q?'?'+new URLSearchParams({searchBy,q}):'';
  await refreshPayments();
}
function updatePaymentSearch(field) {
  const input=document.querySelector('#paymentSearchInput');
  input.value='';input.type=['from','to'].includes(field)?'date':'search';
  input.inputMode=['utr','mobile'].includes(field)?'numeric':'text';
  input.placeholder=field==='all'?'Search payments':`Search ${paymentSearchFields[field].toLowerCase()}`;
}
async function resetPaymentFilters() {paymentFilters='';await refreshPayments();}
async function refreshPayments() {try {await loadPayments();render();} catch(e) {toast(e.message);}}
async function paymentSetting(body) {try {await api('/api/payment-settings',{method:'POST',body});await load();await refreshPayments();} catch(e) {toast(e.message);}}
async function confirmReceiver(event) {event.preventDefault();await paymentSetting({action:'enable-receiver',ownerConfirmed:event.target.ownerConfirmed.checked});}
async function setTestPricing(enabled) {await paymentSetting({action:'test-pricing',enabled});}
async function saveServicePrice(event,variantId) {event.preventDefault();await paymentSetting({action:'price',variantId,price:Math.round(Number(event.target.price.value)*100)});}
async function retryPaymentSync() {try {await api('/api/payments-sync',{method:'POST'});toast('Google Sheets retry completed; inspect integration status for failures.');} catch(e) {toast(e.message);}}
function exportPayments() {
  const columns=['id','gateway_order_id','customer_name','customer_mobile','service_name','amount','payment_method','transaction_id','employee_name','status','created_at','verified_by','verified_at'];
  const cell=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';
  const csv=[columns.join(','),...paymentData.payments.map(p=>columns.map(k=>cell(k==='amount' ? (p.amount/100).toFixed(2) : p[k])).join(','))].join('\r\n');
  downloadPaymentAsset(URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),'payments.csv',true);
}
function downloadPaymentAsset(url,name,revoke=false) {const a=document.createElement('a');a.href=url;a.download=name;a.click();if(revoke) setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function copyPayment(kind) {try {await navigator.clipboard.writeText(kind==='id' ? checkout.upi_id : kind==='amount' ? (checkout.amount/100).toFixed(2) : kind==='order' ? checkout.gateway_order_id : checkout.upiIntent);toast('Copied');} catch {toast('Copy unavailable. Select the displayed payment details manually.');}}
async function pay(caseId) {
  if(drawerBusy) return;
  setDrawerBusy('Opening checkout…');
  try {
    const p=await api(`/api/cases/${caseId}/payment-order`,{method:'POST'});
    setDrawerBusy();await showPayment(p.id,p);
  } catch(e) {toast(e.message);} finally {setDrawerBusy();}
}
async function showPayment(pid,payment=null) {
  if(drawerBusy) return;
  try {
    checkout=payment || await api(`/api/payments/${pid}`);closeDrawer();
    document.body.insertAdjacentHTML('beforeend',`<div class="drawer payment-overlay" id="drawer"><div class="panel case-panel payment-checkout" role="dialog" aria-modal="true" aria-label="UPI payment checkout">${checkoutHTML(checkout)}</div></div>`);
    document.body.classList.add('payment-open');
    const dialog=document.querySelector('.payment-checkout');
    dialog.querySelector('.checkout-close')?.focus({preventScroll:true});
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape') {event.preventDefault();closeDrawer();return;}
      if(event.key!=='Tab') return;
      const controls=[...dialog.querySelectorAll('button,input,select,textarea,summary,a[href]')].filter(el=>!el.disabled && el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first) {event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last) {event.preventDefault();first?.focus();}
    });
  } catch(e) {toast(e.message);}
}
function checkoutHTML(p) {
  const active=!!p.upiIntent, editable=['sales','admin'].includes(me.role), verified=p.status==='PAID';
  const compact=(window.innerWidth || 1280)<701;
  const labels={PENDING:'Awaiting payment',INITIATED:'Awaiting payment',AWAITING_VERIFICATION:'Under review',PAID:'Verified',FAILED:'Claim rejected',CANCELLED:'Cancelled',EXPIRED:'Expired',REFUNDED:'Refunded'};
  const receiverChanged=p.receiverChanged && ['PENDING','INITIATED','EXPIRED','CANCELLED','FAILED'].includes(p.status);
  const inactive=['EXPIRED','CANCELLED','FAILED'].includes(p.status) || receiverChanged;
  const glyph=(name)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${{close:'<path d="m6 6 12 12M18 6 6 18"/>',arrow:'<path d="m9 5 7 7-7 7"/>',download:'<path d="M12 3v12m-4-4 4 4 4-4M5 16v5h14v-5"/>',check:'<path d="m5 12 4 4L19 6"/>',qr:'<path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h-3zM21 15v6h-6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'}[name]}</svg>`;
  const primary=editable && !['PAID','REFUNDED'].includes(p.status);
  return `<header class="checkout-header"><div class="checkout-brand"><span class="checkout-brand-mark">SO</span><div><h2>${h(p.payee_name)}</h2><p>UPI checkout</p></div></div><button class="checkout-close" onclick="closeDrawer()" aria-label="Close">${glyph('close')}</button></header>
    <div class="checkout-body"><aside class="checkout-summary"><span class="checkout-kicker">TOTAL PAYABLE</span><div class="checkout-amount">${money(p.amount)}</div><span class="checkout-status checkout-status-${p.status.toLowerCase()}"><i></i>${h(labels[p.status] || p.status)}</span><div class="checkout-service"><span>Service</span><strong>${h(p.service_name)}</strong></div><div class="checkout-customer"><span>Customer</span><strong>${h(p.customer_name)}</strong></div>${p.batch ? `<section class="summary-box checkout-batch-items"><strong>Included work orders</strong>${p.items.map(item=>`<p>${h(item.customer_name)} - ${h(item.service_name)} - ${h(item.ref)} <strong>${money(item.amount)}</strong></p>`).join('')}</section>` : ''}<details class="checkout-order"><summary>Order details</summary><dl><dt class="checkout-mobile-customer">Customer</dt><dd class="checkout-mobile-customer">${h(p.customer_name)}</dd><dt>Order ID</dt><dd class="selectable">${h(p.gateway_order_id)}</dd><dt>UPI ID</dt><dd class="selectable">${h(p.upi_id)}</dd><dt>Checkout expiry</dt><dd>${dateTime(p.expires_at)}</dd></dl>${active ? '<button class="checkout-text-button" onclick="copyPayment(\'link\')">Copy payment link</button>' : ''}</details></aside>
    <main class="checkout-main">
      ${!p.receiverReady ? '<div class="checkout-notice" role="alert"><strong>Checkout is not enabled yet</strong><p>An administrator can enable the receiving account in Payments settings.</p></div>' : ''}
      ${p.otherClaimPending ? '<div class="checkout-notice" role="alert"><strong>A payment claim is already under review</strong><p>Wait for verification before making another payment for this service.</p></div>' : ''}
      ${inactive ? `<div class="checkout-notice" role="alert"><strong>${receiverChanged ? 'Receiving account updated' : h(labels[p.status])+' checkout'}</strong><p>Reopen checkout to start a new payment request. If you already sent money, submit its UTR instead. An inactive checkout does not cancel a bank transfer.</p></div>` : ''}
      ${p.status==='AWAITING_VERIFICATION' ? `<div class="checkout-result checkout-review"><span class="checkout-result-icon">${glyph('lock')}</span><h3>Payment details received</h3><p>Your payment is awaiting verification.</p><span class="checkout-reference">UTR ${h(p.transaction_id)}</span>${editable ? '<button class="checkout-text-button" onclick="revealPaymentUTR()">Update reference</button>' : ''}</div>` : ''}
      ${verified ? `<div class="checkout-result"><span class="checkout-result-icon">${glyph('check')}</span><h3>Payment verified</h3><p>Your service can proceed once the required documents are complete.</p></div><section class="checkout-receipt"><h3>Verified payment receipt</h3><div><span>Transaction reference</span><strong class="selectable">${h(p.transaction_id)}</strong></div><div><span>Verified on</span><strong>${dateTime(p.verified_at)}</strong></div><button class="checkout-secondary" onclick="downloadReceipt()">${glyph('download')}Download receipt</button></section>` : ''}
      ${p.status==='REFUNDED' ? '<div class="checkout-result"><h3>Refund verified</h3><p>This payment has been recorded as refunded.</p></div>' : ''}
      ${active && editable ? `<div class="checkout-section-heading"><h3>Pay with UPI</h3><span>UPI</span></div><div class="upi-layout"><section class="upi-apps"><p class="checkout-section-label">Pay with an app</p><div class="upi-options">${['Google Pay','PhonePe','Paytm','BHIM','Other UPI App'].map((app,i)=>`<button class="upi-app upi-${i}" onclick="launchUPI('${app}')">${i<4 ? `<img class="upi-brand-logo" src="/assets/payments/${['google-pay.png','phonepe.svg','paytm.svg','bhim.png'][i]}" alt="" width="96" height="36"><strong class="upi-brand-name">${app}</strong>` : `<span class="upi-app-mark" aria-hidden="true">${glyph('qr')}</span><strong>${app}</strong>`}${glyph('arrow')}</button>`).join('')}</div><p class="checkout-app-note">Amount and recipient are prefilled.</p></section><details class="upi-qr" id="qrChoice" ontoggle="if(this.open && innerWidth&lt;701) this.querySelector('img').scrollIntoView({block:'center'})" ${compact ? '' : 'open'}><summary>${glyph('qr')}Scan & pay<span>${glyph('arrow')}</span></summary><div class="checkout-qr-content"><img src="${p.qrDataUrl}" alt="UPI QR for ${h(p.gateway_order_id)}" width="360" height="360"><p>Scan with any compatible UPI app</p><button class="checkout-text-button" onclick="downloadPaymentAsset(checkout.qrDataUrl,'upi-qr.png')">${glyph('download')}Download QR</button></div></details></div>` : ''}
      ${primary ? `<form id="utrForm" class="checkout-utr" hidden onsubmit="submitUTR(event)"><div class="checkout-section-heading"><h3>Confirm your payment</h3></div><label>UPI transaction reference<input name="utr" inputmode="numeric" pattern="[0-9]{12}" maxlength="12" required placeholder="Enter the 12-digit UTR" value="${h(p.transaction_id || '')}" autocomplete="off"></label><p>Find this in your UPI app’s transaction details. Our team will verify receipt.</p><button class="checkout-primary">Submit payment details</button></form>` : ''}
      ${me.role==='admin' && p.status==='AWAITING_VERIFICATION' ? `<section class="checkout-verification"><button class="checkout-primary" onclick="verifyUPIPayment()">Verify received payment</button></section>` : ''}
      ${active && editable ? `<details class="checkout-help"><summary>Need another way to pay?</summary><p>If an app link fails, pay directly to the UPI ID inside your app.</p><button class="checkout-secondary" onclick="startManualUPI()">Pay directly in my UPI app</button><section id="manualUPI" hidden><ol><li>Copy <strong class="selectable">${h(p.upi_id)}</strong>, then open your UPI app and choose to pay a UPI ID. <button class="checkout-text-button" onclick="copyPayment('id')">Copy UPI ID</button></li><li>Review the recipient and pay exactly <strong>${money(p.amount)}</strong>. <button class="checkout-text-button" onclick="copyPayment('amount')">Copy amount</button></li><li>Return here and submit the actual transaction UTR for verification.</li></ol><button class="checkout-text-button" onclick="revealPaymentUTR()">Enter UTR</button></section></details>` : ''}
      ${p.attempts.length ? `<details class="checkout-history"><summary>Payment activity <span>${p.attempts.length}</span></summary><div>${p.attempts.map(e=>`<p><strong>${h(e.action)}</strong><small>${dateTime(e.created_at)}${e.method ? ` · ${h(e.method)}` : ''}</small>${e.utr ? `<small>UTR ${h(e.utr)}</small>` : ''}${e.notes ? `<small>${h(e.notes)}</small>` : ''}</p>`).join('')}</div></details>` : ''}
    </main></div><footer class="checkout-footer"><p>${glyph('lock')}Authorize payment only in your UPI app.</p><div>${primary && active ? `<button class="checkout-text-button checkout-cancel" onclick="paymentAction('cancel',{})">Cancel</button><button class="checkout-primary" data-claim-trigger onclick="revealPaymentUTR()">I have paid${glyph('arrow')}</button>` : primary && inactive ? `<button class="checkout-secondary" onclick="revealPaymentUTR()">Enter UTR</button><button class="checkout-primary" onclick="reopenPayment()">Reopen checkout</button>` : primary && !p.transaction_id ? '<button class="checkout-secondary" onclick="revealPaymentUTR()">Enter UTR</button>' : ''}</div></footer>`;
}
function revealPaymentUTR() {
  const form=document.querySelector('#utrForm');
  if(!form) return;
  form.hidden=false;const trigger=document.querySelector('.checkout-footer [data-claim-trigger]');if(trigger) trigger.hidden=true;form.scrollIntoView({block:'center',behavior:'smooth'});form.querySelector('input')?.focus({preventScroll:true});
}

async function launchUPI(method) {
  if(!checkout?.upiIntent) return toast('Reopen checkout before paying.');
  if(Date.now()>=Date.parse(checkout.expires_at)) {toast('Checkout has expired. Reopen the payment request.');await showPayment(checkout.id);return;}
  const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if(!mobile) {toast('Use the QR code with your phone.');document.querySelector('.upi-qr')?.scrollIntoView();return;}
  // Navigation is synchronous within the tap so browsers retain user activation.
  const uri=checkout.upiIntent;
  api(`/api/payments/${checkout.id}/initiate`,{method:'POST',keepalive:true,body:{method}}).catch(e=>toast(e.message));
  location.href=method==='Google Pay' ? uri.replace('upi://pay','gpay://upi/pay') : uri;
  setTimeout(()=>toast('If no app opened, use Other UPI Apps or scan the QR. Payment still requires verification.'),1800);
}
async function startManualUPI(selectedApp='Other UPI App') {
  if(drawerBusy || !checkout?.upiIntent) return;
  if(Date.now()>=Date.parse(checkout.expires_at)) {toast('Checkout has expired. Reopen the payment request.');await showPayment(checkout.id);return;}
  setDrawerBusy('Preparing direct UPI payment…');
  try {
    const r=await api(`/api/payments/${checkout.id}/initiate`,{method:'POST',body:{method:'Manual UPI',notes:`Direct in-app payment selected: ${selectedApp}`}});
    checkout=r.payment;setDrawerBusy();await showPayment(checkout.id,checkout);
    const panel=document.querySelector('#manualUPI');if(panel) {panel.closest('details').open=true;panel.hidden=false;panel.scrollIntoView({block:'start'});}
  } catch(e) {toast(e.message);} finally {setDrawerBusy();}
}
async function paymentAction(action,body) {
  if(drawerBusy) return;
  setDrawerBusy('Saving payment details…');
  try {
    const r=await api(`/api/payments/${checkout.id}/${action}`,{method:'POST',body});
    checkout=r.payment;
    setDrawerBusy();
    await showPayment(checkout.id,checkout);
    if(action==='verify') toast('Payment received and verified.');
    if(action==='submit') toast('Payment details submitted successfully. Your payment is awaiting verification.');
    try {await load();} catch {toast('Payment details saved. The dashboard could not refresh; reload it to see the latest status.');}
  } catch(e) {toast(e.message);} finally {setDrawerBusy();}
}
async function submitUTR(event) {event.preventDefault();await paymentAction('submit',{utr:event.target.utr.value});}
async function verifyUPIPayment() {await paymentAction('verify',{});}
async function downloadReceipt() {try {const p=await api(`/api/payments/${checkout.id}/receipt`);const text=`SUCCESS ONLINE SERVICES\nVerified direct UPI receipt\nOrder: ${p.gateway_order_id}\nCustomer: ${p.customer_name}\nService: ${p.service_name}\n${p.batch ? p.items.map(item=>`Work order: ${item.ref} | ${item.customer_name} | ${item.service_name} | INR ${(item.amount/100).toFixed(2)}`).join('\n')+'\n' : ''}Amount: INR ${(p.amount/100).toFixed(2)}\nUTR: ${p.transaction_id}\nVerified at: ${p.verified_at}\nVerified by: ${p.verified_by}\n`;downloadPaymentAsset(URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),'payment-receipt.txt',true);} catch(e) {toast(e.message);}}
async function approvePaymentException(caseId) {const reason=document.querySelector('#exceptionReason').value.trim();if(!reason) return toast('Enter a reason');try {await api(`/api/cases/${caseId}/payment-exception`,{method:'POST',body:{reason}});closeDrawer();await load();await openCase(caseId);} catch(e) {toast(e.message);}}
Object.assign(window,{showPayment,pay,launchUPI,startManualUPI,revealPaymentUTR,paymentAction,submitUTR,verifyUPIPayment,filterPayments,resetPaymentFilters,updatePaymentSearch,exportPayments,confirmReceiver,setTestPricing,saveServicePrice,retryPaymentSync,downloadPaymentAsset,copyPayment,downloadReceipt,approvePaymentException,selectPaymentCase,paySelectedCases,reopenPayment});


function batchEligible(p) {
  const rows=paymentData?.payments || [];
  return ['sales','admin'].includes(me.role) && !p.batch_id && p.case_status!=='Cancelled' &&
    ['PENDING','INITIATED','EXPIRED','CANCELLED','FAILED'].includes(p.status) &&
    rows.find(row=>row.case_id===p.case_id)?.id===p.id &&
    !rows.some(row=>row.case_id===p.case_id && ['PAID','AWAITING_VERIFICATION'].includes(row.status));
}
function combinedPaymentSummary() {
  const rows=(paymentData?.payments || []).filter(p=>selectedPaymentCases.has(p.case_id) && batchEligible(p));
  return `${rows.length} cases selected - Total ${money(rows.reduce((sum,p)=>sum+p.amount,0))}`;
}
function selectPaymentCase(id,checked) {
  if(checked) selectedPaymentCases.add(id); else selectedPaymentCases.delete(id);
  document.querySelector('#combinedPaymentTotal').textContent=combinedPaymentSummary();
}
async function paySelectedCases(button) {
  if(drawerBusy || button?.disabled) return;
  const ids=(paymentData?.payments || []).filter(p=>selectedPaymentCases.has(p.case_id) && batchEligible(p)).map(p=>p.case_id);
  if(ids.length<2) return toast('Select at least two unpaid cases.');
  if(button) button.disabled=true;
  try {
    const payment=await api('/api/payments/batch',{method:'POST',body:{caseIds:ids}});
    selectedPaymentCases.clear();
    await showPayment(payment.id,payment);
    try {await load();} catch {toast('Combined checkout saved. Refresh Payments to see it in the list.');}
  } catch(error) {toast(error.message);} finally {if(button) button.disabled=false;}
}
async function reopenPayment() {
  if(checkout.batch) await paymentAction('reopen',{});
  else await pay(checkout.case_id);
}

boot();
