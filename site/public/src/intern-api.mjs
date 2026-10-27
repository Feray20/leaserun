// Web-Admin → API Management: Übersicht, Zugang, Schlüssel, Nutzung, Anfragen, Webhooks, Playground, Dokumentation,
// Sandbox, Health, Changelog, Einstellungen und „Get Started“. Alle Daten kommen aus /api/admin/api bzw. der echten
// API (/api/v1). Rechte prüft ausschließlich der Server; nichts hier ist simuliert.
import { api, dtt, esc } from './sess.mjs?v=892f3666';
import { ENDPOINTS, ERRORS, EVENTS, SCOPE_LIST, SECTIONS } from './api-catalog.mjs?v=892f3666';

const SUB = [['api', 'Overview'], ['api-start', 'Get Started'], ['api-access', 'Access'], ['api-keys', 'API Keys'], ['api-usage', 'Usage'], ['api-requests', 'Requests'], ['api-webhooks', 'Webhooks'],
  ['api-playground', 'Playground'], ['api-docs', 'Documentation'], ['api-sandbox', 'Sandbox'], ['api-health', 'Health'], ['api-changelog', 'Changelog'], ['api-settings', 'Settings']];
const PLAN = { BASIC: 'Basic', PRO: 'Pro', ENTERPRISE: 'Enterprise' };
const ST = { Operational: 'ok', Degraded: 'warn', Disabled: '', 'Configuration Required': 'bad', operational: 'ok', degraded: 'warn', unavailable: 'bad', active: 'ok', disabled: 'warn', expired: '', revoked: 'bad', delivered: 'ok', retrying: 'warn', pending: 'warn', failed: 'bad' };
const chip = (t, cls = ST[t] ?? '') => `<span class="st ${cls}" style="margin:0">${esc(t)}</span>`;
const num = (n) => Number(n || 0).toLocaleString('de-DE');
const LS = 'lr-api-tenant';
const tenantId = () => { try { return localStorage.getItem(LS) || ''; } catch { return ''; } };
const setTenant = (id) => { try { localStorage.setItem(LS, id); } catch { /* nur Komfort */ } };
// Schlüssel für den Playground: nur Test-Schlüssel in sessionStorage (Tab), Live-Schlüssel nur im Arbeitsspeicher.
const mem = { keys: [] };
const SK = 'lr-api-pg-keys';
function sessionKeys() {
  let saved = [];
  try { saved = JSON.parse(sessionStorage.getItem(SK) || '[]'); } catch { saved = []; }
  return [...saved, ...mem.keys].filter((k, i, a) => a.findIndex((x) => x.secret === k.secret) === i);
}
function rememberKey(secret, label) {
  if (!secret) return;
  const k = { secret, label: label || secret.slice(0, 13), env: secret.startsWith('live_') ? 'live' : 'test' };
  if (k.env === 'test') { try { const s = JSON.parse(sessionStorage.getItem(SK) || '[]').filter((x) => x.secret !== secret); s.unshift(k); sessionStorage.setItem(SK, JSON.stringify(s.slice(0, 8))); } catch { mem.keys.unshift(k); } }
  else mem.keys.unshift(k);
}
function forgetKey(secret) { try { sessionStorage.setItem(SK, JSON.stringify(JSON.parse(sessionStorage.getItem(SK) || '[]').filter((x) => x.secret !== secret))); } catch { /* ignore */ } mem.keys = mem.keys.filter((x) => x.secret !== secret); }

// Fortschritt des Testablaufs (Playground und Get Started) – je Tab.
const FK = 'lr-api-flow';
const flow = () => { try { return JSON.parse(sessionStorage.getItem(FK) || '{}'); } catch { return {}; } };
const setFlow = (o) => { try { sessionStorage.setItem(FK, JSON.stringify({ ...flow(), ...o })); } catch { /* ignore */ } };

function copy(text, btn) {
  navigator.clipboard?.writeText(text).then(() => { if (btn) { const o = btn.textContent; btn.textContent = 'Kopiert ✓'; setTimeout(() => { btn.textContent = o; }, 1400); } }, () => window.prompt('Kopieren:', text));
}
const errBox = (v, t) => { v.insertAdjacentHTML('beforeend', `<div class="wa-state err" role="alert"><strong>${esc(t || 'Nicht möglich.')}</strong></div>`); };
const subnav = (cur) => `<nav class="co-sub" aria-label="API Management">${SUB.map(([k, l]) => `<a href="#${k}"${k === cur ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
const testBanner = (on) => (on ? '<div class="api-test-banner" role="status"><strong>TEST MODE</strong> – Sie arbeiten in der Testumgebung (test_-Schlüssel). Es werden keine Live-Daten verändert.</div>' : '');

let cache = null; // Mandantenliste
async function tenants(force = false) {
  if (cache && !force) return cache;
  const r = await api('/api/admin/api?view=tenants');
  if (!r.ok) throw new Error(r.data?.error || 'Mandanten konnten nicht geladen werden.');
  cache = r.data;
  return cache;
}

async function head(v, cur) {
  const d = await tenants();
  let id = tenantId();
  if (!d.tenants.some((t) => t.id === id)) { id = (d.tenants.find((t) => t.test_tenant) || d.tenants.find((t) => t.policy.enabled) || d.tenants[0] || {}).id || ''; if (id) setTenant(id); }
  const opts = d.tenants.map((t) => `<option value="${t.id}"${t.id === id ? ' selected' : ''}>${esc(t.company)}${t.test_tenant ? ' · TEST' : ''} · ${t.plan ? PLAN[t.plan] : 'ohne Tarif'}${t.policy.enabled ? ' · API aktiv' : ''}</option>`).join('');
  v.innerHTML = `${subnav(cur)}<section class="pt-card api-head"><div class="wa-h-row"><label class="api-tenant">Mandant <select id="apiTenant">${opts || '<option value="">Keine Unternehmenskonten</option>'}</select></label>
    <button type="button" class="btn btn-outline" id="apiTestTenant">${d.tenants.some((t) => t.test_tenant) ? 'Testmandant öffnen' : 'Testmandant anlegen'}</button></div>
    ${d.config.length ? `<p class="pt-alert bad">Konfiguration fehlt in Vercel: <strong>${d.config.map(esc).join(', ')}</strong> – siehe <a href="#api-settings">Settings</a>. Bis dahin antwortet die API mit 503 CONFIGURATION_REQUIRED.</p>` : ''}</section><div id="apiBody"></div>`;
  v.querySelector('#apiTenant').onchange = (e) => { setTenant(e.target.value); window.dispatchEvent(new HashChangeEvent('hashchange')); };
  v.querySelector('#apiTestTenant').onclick = async (e) => {
    e.target.disabled = true;
    const r = await api('/api/admin/api', { method: 'POST', body: JSON.stringify({ action: 'test_tenant' }) });
    e.target.disabled = false;
    if (!r.ok) return alert(r.data?.error || 'Nicht möglich.');
    setTenant(r.data.tenant); cache = null; window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  return { id, d, body: v.querySelector('#apiBody'), tenant: d.tenants.find((t) => t.id === id) };
}

export async function apiOps(v) {
  const h = location.hash.slice(1) || 'api';
  const view = { api: overview, 'api-start': start, 'api-access': access, 'api-keys': keysView, 'api-usage': usage, 'api-requests': requests, 'api-webhooks': webhooks,
    'api-playground': playground, 'api-docs': docs, 'api-sandbox': sandbox, 'api-health': health, 'api-changelog': changelog, 'api-settings': settings }[h] || overview;
  try {
    const ctx = await head(v, SUB.some(([k]) => k === h) ? h : 'api');
    if (!ctx.id && !['api-docs', 'api-health', 'api-changelog', 'api-settings'].includes(h)) { ctx.body.innerHTML = '<div class="wa-state"><strong>Noch kein Unternehmenskonto.</strong><span>Legen Sie oben einen Testmandanten an.</span></div>'; return; }
    await view(ctx);
  } catch (e) { errBox(v, e.message); }
}

const post = (action, extra = {}) => api('/api/admin/api', { method: 'POST', body: JSON.stringify({ action, tenant: tenantId(), ...extra }) });
const get = (view, q = '') => api(`/api/admin/api?view=${view}&tenant=${encodeURIComponent(tenantId())}${q}`);

// ---------- Overview ----------
async function overview({ body }) {
  const r = await get('overview');
  if (!r.ok) return errBox(body, r.data?.error);
  const d = r.data, m = d.metrics, p = d.policy;
  const k = (l, val, sub = '') => `<div class="api-kpi"><small>${l}</small><strong>${val}</strong>${sub ? `<span>${sub}</span>` : ''}</div>`;
  body.innerHTML = `<section class="pt-card"><div class="wa-h-row"><h2>${esc(d.tenant.company)} ${d.tenant.test_tenant ? chip('TEST', 'warn') : ''}</h2>${chip(d.status)}</div>
    <div class="api-kpis">${k('API Status', esc(d.status))}${k('Plan', p.plan ? PLAN[p.plan] : 'ohne Tarif', p.plan_includes_api ? 'API im Tarif enthalten' : 'API nicht im Tarif')}${k('API Access', p.admin_enabled ? 'aktiviert' : 'deaktiviert', p.live_enabled ? 'Test + Live' : 'nur Testumgebung')}
    ${k('Active Keys', num(m.active_keys), `${m.active_test_keys} Test · ${m.active_live_keys} Live`)}${k('Requests Today', num(m.requests_today))}${k('Requests This Month', num(m.requests_month))}
    ${k('Current Limit', `${num(p.rate_limit)}/min`, `Burst ${num(p.burst_limit)}/10 s`)}${k('Error Rate (24 h)', `${m.error_rate_24h.toLocaleString('de-DE')} %`)}${k('Average Latency (24 h)', m.avg_latency_ms_24h == null ? '–' : `${num(m.avg_latency_ms_24h)} ms`)}
    ${k('Active Webhooks', num(m.active_webhooks), p.webhook_enabled ? '' : 'Webhooks nicht im Tarif')}${k('Last Request', m.last_request ? dtt(m.last_request.created_at) : '–', m.last_request ? `${esc(m.last_request.method)} ${esc(m.last_request.route)} · ${m.last_request.status}` : '')}${k('Health', esc(d.health.status))}</div>
    <p class="form-note">Basis-URL: <code>${esc(d.base_url)}</code> · Scopes im Tarif: ${p.allowed_scopes.length ? p.allowed_scopes.map((s) => `<code>${esc(s)}</code>`).join(' ') : '–'}</p></section>`;
}

// ---------- Get Started ----------
async function start({ body, tenant }) {
  const [ov, ks, sb] = await Promise.all([get('overview'), get('keys'), get('sandbox')]);
  const f = flow();
  const p = ov.data?.policy || {};
  const testKeys = (ks.data?.keys || []).filter((x) => x.environment === 'test' && x.status === 'active');
  const steps = [
    ['API-Zugang aktivieren', 'Im Reiter Access die API für den Mandanten freischalten (Tarif Pro oder Enterprise).', p.admin_enabled && p.enabled, '#api-access', 'Zum Zugang', p.plan_includes_api ? '' : 'Tarif enthält keine API.'],
    ['API-Key erstellen', 'Einen Test-Schlüssel (test_…) anlegen. Das Geheimnis wird genau einmal angezeigt.', testKeys.length > 0, '#api-keys', 'Schlüssel anlegen', `${testKeys.length} aktive Test-Schlüssel`],
    ['Scope auswählen', 'Beim Anlegen die nötigen Scopes wählen – z. B. cases:write, validation:execute, documents:write, reports:create.', testKeys.some((x) => x.scopes.length >= 4), '#api-keys', 'Scopes prüfen', testKeys[0] ? testKeys[0].scopes.join(', ') : ''],
    ['Test Case erstellen', 'Im Playground POST /api/v1/cases mit den Testdaten senden.', Boolean(f.caseId) || (sb.data?.counts?.cases || 0) > 0, '#api-playground', 'Playground öffnen', f.caseId ? `Fall ${f.caseId.slice(0, 8)}…` : ''],
    ['Validation ausführen', 'GET /api/v1/cases/{id}/validate – liefert Checks, fehlende Unterlagen und Bank-Readiness.', Boolean(f.validationId), '#api-playground', 'Validieren', f.validationId ? `Prüflauf ${f.validationId.slice(0, 8)}…` : ''],
    ['Dokument hochladen', 'POST /api/v1/cases/{id}/documents mit einer PDF-Datei (Testdatei im Playground erzeugbar).', Boolean(f.documentId) || (sb.data?.counts?.documents || 0) > 0, '#api-playground', 'Hochladen', ''],
    ['Report erzeugen', 'POST /api/v1/cases/{id}/reports – Status über GET abfragen, Download per signiertem Link.', Boolean(f.reportId) || (sb.data?.counts?.reports || 0) > 0, '#api-playground', 'Bericht', ''],
    ['Webhook testen', 'Enterprise: Webhook anlegen und POST /webhooks/{id}/test senden; Zustellung im Reiter Webhooks prüfen.', Boolean(f.webhookTested), '#api-playground', 'Webhook', p.webhook_enabled ? '' : 'Nur Enterprise.'],
  ];
  body.innerHTML = `<section class="pt-card"><h2>Get Started with API</h2><p class="form-note">Mandant: <strong>${esc(tenant?.company || '')}</strong>. Der Status jedes Schritts kommt aus echten Daten (Datenbank bzw. Antworten des Playgrounds in diesem Tab).</p>
    <ol class="api-steps">${steps.map(([t, d, done, href, btn, res], i) => `<li class="${done ? 'done' : ''}"><span class="api-step-n">${done ? '✓' : i + 1}</span><div><strong>${t}</strong><p>${d}</p>${res ? `<small>Ergebnis: ${esc(res)}</small>` : ''}</div><a class="btn ${done ? 'btn-outline' : 'btn-dark'}" href="${href}">${btn}</a></li>`).join('')}</ol></section>`;
}

// ---------- Access ----------
async function access({ body }) {
  const r = await get('overview');
  if (!r.ok) return errBox(body, r.data?.error);
  const p = r.data.policy, row = r.data.row || {};
  const tri = (name, val) => `<select name="${name}"><option value=""${val == null ? ' selected' : ''}>laut Tarif</option><option value="true"${val === true ? ' selected' : ''}>erlauben</option><option value="false"${val === false ? ' selected' : ''}>sperren</option></select>`;
  body.innerHTML = `<section class="pt-card"><h2>API-Zugang</h2>
    ${p.plan_includes_api ? '' : `<p class="pt-alert bad">Tarif ${p.plan ? PLAN[p.plan] : '–'} enthält keine API. Freischaltung erst mit Pro oder Enterprise (Reiter Partner → Tarif).</p>`}
    <form id="apiPol" class="api-form">
      <label class="api-switch"><input type="checkbox" name="enabled"${row.enabled ? ' checked' : ''}${p.plan_includes_api ? '' : ' disabled'}> API aktivieren</label>
      <label class="api-switch"><input type="checkbox" name="live_enabled"${row.live_enabled ? ' checked' : ''}> Live-Schlüssel erlauben <small>(aus = nur Testumgebung / Test Mode)</small></label>
      <div class="api-grid2">
        <label>Rate Limit (Anfragen/Minute) <input type="number" name="rate_limit" min="1" max="100000" placeholder="Tarif: ${p.plan === 'ENTERPRISE' ? 300 : 60}" value="${row.rate_limit ?? ''}"></label>
        <label>Burst (Anfragen/10 s) <input type="number" name="burst_limit" min="1" max="100000" placeholder="automatisch" value="${row.burst_limit ?? ''}"></label>
        <label>Maximale Dateigröße (Byte, ≤ 4.194.304) <input type="number" name="max_document_bytes" min="1024" max="4194304" placeholder="4194304" value="${row.max_document_bytes ?? ''}"></label>
        <label>Webhooks ${tri('webhooks_allowed', row.webhooks_allowed)}</label>
        <label>White-Label-Berichte ${tri('white_label_allowed', row.white_label_allowed)}</label>
        <label class="api-switch"><input type="checkbox" name="routing_enabled"${row.routing_enabled ? ' checked' : ''}> Mandanten-/Berater-Routing</label>
      </div>
      <label>Interne Notiz <input name="note" maxlength="500" value="${esc(row.note || '')}"></label>
      <div class="wiz-nav"><button class="btn btn-dark" type="submit">Speichern</button></div><p class="form-note" id="apiPolMsg" role="status"></p>
    </form>
    <p class="form-note">Wirksam: ${p.enabled ? chip('API aktiv', 'ok') : chip('API aus', '')} · ${p.webhook_enabled ? 'Webhooks erlaubt' : 'keine Webhooks'} · ${p.white_label_enabled ? 'White-Label' : 'LeaseRun-Branding'} · ${num(p.rate_limit)}/min. Jede Änderung wird im Audit-Protokoll (Hash-Kette) festgehalten.</p></section>`;
  body.querySelector('#apiPol').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, n = (x) => (f[x].value === '' ? null : Number(f[x].value)), t = (x) => (f[x].value === '' ? null : f[x].value === 'true');
    const policy = { enabled: f.enabled.checked, live_enabled: f.live_enabled.checked, rate_limit: n('rate_limit'), burst_limit: n('burst_limit'), max_document_bytes: n('max_document_bytes'), webhooks_allowed: t('webhooks_allowed'), white_label_allowed: t('white_label_allowed'), routing_enabled: f.routing_enabled.checked, note: f.note.value.trim() || null };
    const res = await post('policy', { policy });
    body.querySelector('#apiPolMsg').textContent = res.ok ? 'Gespeichert.' : res.data?.error || 'Nicht gespeichert.';
    if (res.ok) { cache = null; setTimeout(() => access({ body }), 600); }
  };
}

// ---------- API Keys ----------
function secretDialog(title, secret, note) {
  const d = document.createElement('dialog');
  d.className = 'wa-dlg';
  d.innerHTML = `<div class="wa-dlg-in"><h3>${esc(title)}</h3><p class="pt-alert">${esc(note || 'Dieses Geheimnis wird nur jetzt vollständig angezeigt. Bitte sicher speichern.')}</p>
    <code class="api-secret">${esc(secret)}</code><div class="wiz-nav"><button type="button" class="btn btn-outline" data-c>Kopieren</button><button type="button" class="btn btn-outline" data-p>Im Playground verwenden</button><button type="button" class="btn btn-dark" data-x>Fertig</button></div></div>`;
  document.body.append(d);
  d.querySelector('[data-c]').onclick = (e) => copy(secret, e.target);
  d.querySelector('[data-p]').onclick = () => { rememberKey(secret); d.close(); location.hash = 'api-playground'; };
  d.querySelector('[data-x]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

async function keysView(ctx) {
  const { body } = ctx;
  const r = await get('keys');
  if (!r.ok) return errBox(body, r.data?.error);
  const { keys, allowed_scopes: allowed } = r.data;
  body.innerHTML = `<section class="pt-card"><div class="wa-h-row"><h2>API Keys</h2><button type="button" class="btn btn-dark" id="kNew">+ Schlüssel</button></div>
    <p class="form-note">Gespeichert sind nur Präfix und HMAC-Hash. Rotation erzeugt einen neuen Schlüssel und widerruft den alten sofort.</p>
    <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Name</th><th>Schlüssel</th><th>Umgebung</th><th>Status</th><th>Scopes</th><th>IP-Allowlist</th><th>Zuletzt genutzt</th><th>Läuft ab</th><th></th></tr></thead><tbody>
    ${keys.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.masked)}</code></td><td>${k.environment === 'test' ? chip('test', 'warn') : chip('live', 'ok')}</td><td>${chip(k.status)}</td><td class="api-scopes">${k.scopes.map((s) => `<code>${esc(s)}</code>`).join(' ')}</td><td>${k.allowed_ips.length ? k.allowed_ips.map(esc).join(', ') : '–'}</td><td>${dtt(k.last_used_at)}</td><td>${k.expires_at ? dtt(k.expires_at) : '–'}</td>
      <td class="api-acts">${k.status === 'revoked' ? '' : `<button type="button" class="btn btn-outline" data-a="key_rotate" data-id="${k.id}">Rotate</button>${k.status === 'disabled' ? `<button type="button" class="btn btn-outline" data-a="key_enable" data-id="${k.id}">Enable</button>` : `<button type="button" class="btn btn-outline" data-a="key_disable" data-id="${k.id}">Disable</button>`}<button type="button" class="btn btn-outline" data-a="key_expire" data-id="${k.id}">Expire</button><button type="button" class="btn btn-outline" data-a="key_revoke" data-id="${k.id}">Revoke</button>`}</td></tr>`).join('') || '<tr><td colspan="9">Noch keine Schlüssel.</td></tr>'}
    </tbody></table></div></section>`;
  body.querySelectorAll('[data-a]').forEach((b) => b.onclick = async () => {
    const a = b.dataset.a;
    if (['key_revoke', 'key_expire', 'key_rotate'].includes(a) && !confirm({ key_revoke: 'Schlüssel endgültig widerrufen?', key_expire: 'Schlüssel sofort ablaufen lassen?', key_rotate: 'Neuen Schlüssel erzeugen und den alten sofort widerrufen?' }[a])) return;
    b.disabled = true;
    const res = await post(a, { id: b.dataset.id });
    b.disabled = false;
    if (!res.ok) return alert(res.data?.error || 'Nicht möglich.');
    if (res.data.secret) secretDialog('Neuer Schlüssel nach Rotation', res.data.secret, 'Der bisherige Schlüssel ist ab sofort ungültig (401 API_KEY_REVOKED). Dieses Geheimnis wird nur jetzt angezeigt.');
    keysView(ctx);
  });
  body.querySelector('#kNew').onclick = () => {
    const d = document.createElement('dialog');
    d.className = 'wa-dlg';
    const defaults = new Set(['cases:read', 'cases:write', 'validation:read', 'validation:execute', 'documents:read', 'documents:write', 'reports:read', 'reports:create', 'webhooks:read', 'webhooks:write', 'webhooks:test', 'usage:read']);
    d.innerHTML = `<form class="wa-dlg-in" novalidate><h3>Neuer API-Schlüssel</h3>
      <label>Name <input name="name" required maxlength="80" value="Playground Test"></label>
      <label>Umgebung <select name="environment"><option value="test">Test (test_…)</option><option value="live">Live (live_…)</option></select></label>
      <fieldset class="api-scopepick"><legend>Scopes</legend>${SCOPE_LIST.map((s) => `<label><input type="checkbox" name="scope" value="${s}"${allowed.includes(s) ? (defaults.has(s) ? ' checked' : '') : ' disabled'}> <code>${s}</code>${allowed.includes(s) ? '' : ' <small>(nicht im Tarif)</small>'}</label>`).join('')}</fieldset>
      <label>Ablaufdatum (optional) <input type="date" name="exp"></label>
      <label>IP-Allowlist (optional, je Zeile eine IP oder CIDR) <textarea name="ips" rows="2" placeholder="203.0.113.0/24"></textarea></label>
      <p class="pt-alert bad" data-err hidden></p><div class="wiz-nav"><button type="button" class="btn btn-outline" data-x>Abbrechen</button><button type="submit" class="btn btn-dark">Erstellen</button></div></form>`;
    document.body.append(d);
    d.querySelector('[data-x]').onclick = () => d.close();
    d.addEventListener('close', () => d.remove());
    d.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target, err = d.querySelector('[data-err]');
      const scopes = [...f.querySelectorAll('[name=scope]:checked')].map((x) => x.value);
      const key = { name: f.name.value.trim(), environment: f.environment.value, scopes, allowed_ips: f.ips.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean), expires_at: f.exp.value ? new Date(`${f.exp.value}T23:59:59`).toISOString() : null };
      const res = await post('key_create', { key });
      if (!res.ok) { err.hidden = false; err.textContent = res.data?.error || 'Nicht möglich.'; return; }
      d.close();
      secretDialog('Schlüssel erstellt', res.data.secret);
      keysView(ctx);
    };
    d.showModal();
  };
}

// ---------- Usage ----------
let range = '7d';
function bars(series, key, label, fmt = num) {
  const vals = series.map((s) => Number(s[key] || 0));
  const max = Math.max(1, ...vals);
  const w = 100 / Math.max(1, vals.length);
  return `<figure class="api-chart"><figcaption>${label} <strong>${fmt(vals.reduce((a, b) => a + b, 0) / (key.endsWith('_ms') ? Math.max(1, vals.filter(Boolean).length) : 1))}${key.endsWith('_ms') ? ' ms Ø' : ''}</strong></figcaption>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">${vals.map((x, i) => `<rect x="${i * w + w * 0.1}" y="${40 - (x / max) * 38}" width="${w * 0.8}" height="${(x / max) * 38}"><title>${esc(new Date(series[i].bucket).toLocaleString('de-DE'))}: ${fmt(x)}</title></rect>`).join('')}</svg></figure>`;
}
async function usage(ctx) {
  const { body } = ctx;
  const r = await get('usage', `&range=${range}`);
  if (!r.ok) return errBox(body, r.data?.error);
  const s = r.data.series.map((x) => ({ ...x, errors: Number(x.errors_4xx) + Number(x.errors_5xx) }));
  body.innerHTML = `<section class="pt-card"><div class="wa-h-row"><h2>Usage</h2><div class="pc-chips" role="group" aria-label="Zeitraum">${['24h', '7d', '30d', '90d'].map((k) => `<button type="button" data-r="${k}" aria-pressed="${k === range}">${k}</button>`).join('')}</div></div>
    ${s.length ? `<div class="api-charts">${bars(s, 'requests', 'Requests')}${bars(s, 'errors', 'Errors')}${bars(s, 'errors_4xx', '4xx')}${bars(s, 'errors_5xx', '5xx')}${bars(s, 'rate_limited', 'Rate-Limit-Ereignisse')}${bars(s, 'avg_ms', 'Latenz', (x) => num(Math.round(x)))}${bars(s, 'p95_ms', 'P95', (x) => num(Math.round(x)))}${bars(s, 'p99_ms', 'P99', (x) => num(Math.round(x)))}</div>` : '<div class="wa-state"><strong>Keine Anfragen im Zeitraum.</strong><span>Senden Sie im Playground eine Anfrage.</span></div>'}
    <p class="form-note">Grundlage für eine spätere nutzungsbasierte Abrechnung; derzeit werden keine zusätzlichen Gebühren berechnet.</p></section>`;
  body.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => { range = b.dataset.r; usage(ctx); });
}

// ---------- Requests ----------
async function requests(ctx, before = null, append = false) {
  const { body } = ctx;
  const f = requests.f || (requests.f = { status: '', route: '', key: '', env: '', from: '', to: '' });
  const q = Object.entries(f).filter(([, x]) => x).map(([k, x]) => `&${k}=${encodeURIComponent(k === 'from' || k === 'to' ? new Date(x).toISOString() : x)}`).join('') + (before ? `&before=${before}` : '');
  const r = await get('requests', q);
  if (!r.ok) return errBox(body, r.data?.error);
  const rows = r.data.requests.map((x) => `<tr><td>${dtt(x.created_at)}</td><td><code>${esc(x.request_id)}</code></td><td>${esc(x.method)}</td><td><code>${esc(x.route)}</code></td><td>${x.key_prefix ? `<code>${esc(x.key_prefix)}_…</code>` : '–'}</td><td>${chip(String(x.status), x.status < 300 ? 'ok' : x.status < 500 ? 'warn' : 'bad')}</td><td>${num(x.duration_ms)} ms</td><td>${x.response_bytes ? num(x.response_bytes) + ' B' : '–'}</td><td>${x.error_code ? `<code>${esc(x.error_code)}</code>` : ''}</td></tr>`).join('');
  if (append) { body.querySelector('tbody').insertAdjacentHTML('beforeend', rows); }
  else {
    body.innerHTML = `<section class="pt-card"><h2>Requests</h2>
      <form id="rqF" class="api-filters"><label>Von <input type="datetime-local" name="from" value="${esc(f.from)}"></label><label>Bis <input type="datetime-local" name="to" value="${esc(f.to)}"></label>
      <label>Endpoint <input name="route" placeholder="/cases" value="${esc(f.route)}"></label><label>API Key (Präfix) <input name="key" placeholder="test_AbCd1234" value="${esc(f.key)}"></label>
      <label>Status <select name="status">${['', '2xx', '4xx', '5xx', '401', '403', '404', '409', '422', '429'].map((s) => `<option${s === f.status ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Umgebung <select name="env">${['', 'test', 'live'].map((s) => `<option${s === f.env ? ' selected' : ''}>${s}</option>`).join('')}</select></label><button class="btn btn-dark">Filtern</button></form>
      <p class="form-note">Das Protokoll enthält keine Anfrage- oder Antwortinhalte und keine personenbezogenen Daten (IP nur gekürzt und gehasht). Aufbewahrung 90 Tage.</p>
      <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Zeit</th><th>Request ID</th><th>Methode</th><th>Endpoint</th><th>API Key</th><th>Status</th><th>Dauer</th><th>Größe</th><th>Fehlercode</th></tr></thead><tbody>${rows || '<tr><td colspan="9">Keine Einträge.</td></tr>'}</tbody></table></div>
      <p><button type="button" class="btn btn-outline" id="rqMore"${r.data.next_before ? '' : ' hidden'}>Mehr laden</button></p></section>`;
    body.querySelector('#rqF').onsubmit = (e) => { e.preventDefault(); const fd = new FormData(e.target); requests.f = Object.fromEntries(['status', 'route', 'key', 'env', 'from', 'to'].map((k) => [k, String(fd.get(k) || '')])); requests(ctx); };
  }
  const more = body.querySelector('#rqMore');
  more.hidden = !r.data.next_before;
  more.onclick = () => requests(ctx, r.data.next_before, true);
}

// ---------- Webhooks ----------
async function webhooks(ctx) {
  const { body } = ctx;
  const r = await get('webhooks');
  if (!r.ok) return errBox(body, r.data?.error);
  const { webhooks: eps, deliveries } = r.data;
  const url = (id) => eps.find((w) => w.id === id)?.url || '–';
  body.innerHTML = `<section class="pt-card"><h2>Webhook-Endpunkte</h2><p class="form-note">Anlegen über die API (<code>POST /api/v1/webhooks</code>, z. B. im Playground). Signatur: <code>X-LeaseRun-Signature: v1=HMAC_SHA256(secret, timestamp + "." + body)</code>.</p>
    <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>URL</th><th>Umgebung</th><th>Ereignisse</th><th>Status</th><th>Fehler in Folge</th><th>Letzte Zustellung</th><th></th></tr></thead><tbody>
    ${eps.map((w) => `<tr><td><code>${esc(w.url)}</code></td><td>${w.environment}</td><td>${w.events.map((e) => `<code>${esc(e)}</code>`).join(' ')}</td><td>${w.enabled ? chip('aktiv', 'ok') : chip('deaktiviert', '')}</td><td>${w.failure_count}</td><td>${dtt(w.last_delivery_at)}</td><td class="api-acts"><button type="button" class="btn btn-outline" data-t="${w.id}">Send Test</button><button type="button" class="btn btn-outline" data-g="${w.id}">${w.enabled ? 'Disable' : 'Enable'}</button></td></tr>`).join('') || '<tr><td colspan="7">Keine Endpunkte.</td></tr>'}
    </tbody></table></div></section>
    <section class="pt-card"><h2>Webhook Debugger</h2><div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Zeit</th><th>Webhook</th><th>Event</th><th>Delivery ID</th><th>HTTP</th><th>Dauer</th><th>Versuche</th><th>Status</th><th>Antwort (gekürzt, maskiert)</th><th></th></tr></thead><tbody>
    ${deliveries.map((d) => `<tr><td>${dtt(d.created_at)}</td><td><code>${esc(url(d.endpoint_id))}</code></td><td><code>${esc(d.event)}</code>${d.is_test ? ' ' + chip('Test', 'warn') : ''}</td><td><code>${esc(d.id)}</code></td><td>${d.last_status ?? '–'}</td><td>${d.duration_ms == null ? '–' : num(d.duration_ms) + ' ms'}</td><td>${d.attempts}</td><td>${chip(d.status)}${d.last_error ? `<br><small>${esc(d.last_error)}</small>` : ''}</td><td><small>${esc(d.response_excerpt || '')}</small></td><td>${d.status !== 'delivered' ? `<button type="button" class="btn btn-outline" data-r="${d.id}">Retry</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="10">Noch keine Zustellungen.</td></tr>'}
    </tbody></table></div></section>`;
  const act = async (b, action, extra) => { b.disabled = true; const res = await post(action, extra); b.disabled = false; if (!res.ok && !('status' in (res.data || {}))) alert(res.data?.error || 'Nicht möglich.'); else if (action !== 'webhook_toggle') alert(res.data.ok ? `Zugestellt (HTTP ${res.data.status}).` : `Nicht zugestellt: ${res.data.error || 'HTTP ' + res.data.status}`); webhooks(ctx); };
  body.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => act(b, 'webhook_test', { id: b.dataset.t }));
  body.querySelectorAll('[data-g]').forEach((b) => b.onclick = () => act(b, 'webhook_toggle', { id: b.dataset.g }));
  body.querySelectorAll('[data-r]').forEach((b) => b.onclick = () => act(b, 'delivery_retry', { id: b.dataset.r }));
}

// ---------- Playground ----------
const FLOW = [['case-create', 'Create Case'], ['case-get', 'View Case'], ['validate', 'Run Validation'], ['validation-get', 'View Validation'], ['document-upload', 'Upload Document'], ['validate', 'Run Validation Again'], ['report-create', 'Create Report'], ['report-get', 'View Report Status'], ['report-download', 'Download Report'], ['webhook-create', 'Create Webhook'], ['webhook-test', 'Test Webhook']];
const newIdem = () => 'idem_' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
function fillPath(path, f) {
  const map = { id: f.caseId, validationId: f.validationId, documentId: f.documentId, reportId: f.reportId, webhookId: f.webhookId, keyId: f.keyId };
  return path.replace(/\{(\w+)\}/g, (m, n) => map[n] || m);
}
function snippet(kind, req, keyMode) {
  const keyStr = keyMode === 'insert' ? req.key : '$LEASERUN_API_KEY';
  const url = new URL(req.url, location.origin).toString();
  const hdr = Object.entries(req.headers);
  if (kind === 'curl') {
    const parts = [`curl -X ${req.method} '${url}'`, `  -H 'Authorization: Bearer ${keyStr}'`, ...hdr.map(([k, x]) => `  -H '${k}: ${String(x).replace(/'/g, "'\\''")}'`)];
    if (req.file) parts.push(`  -F 'file=@${req.file}'`, ...Object.entries(req.form || {}).map(([k, x]) => `  -F '${k}=${x}'`));
    else if (req.body != null) parts.push(`  -H 'Content-Type: application/json'`, `  --data '${JSON.stringify(req.body).replace(/'/g, "'\\''")}'`);
    return parts.join(' \\\n');
  }
  const ts = kind === 'ts';
  const headers = { Authorization: '__KEY__', ...(req.body != null && !req.file ? { 'Content-Type': 'application/json' } : {}), ...req.headers };
  const hs = JSON.stringify(headers, null, 2).replace('"__KEY__"', keyMode === 'insert' ? JSON.stringify(`Bearer ${req.key}`) : '`Bearer ${process.env.LEASERUN_API_KEY}`');
  const bodyLine = req.file ? `  body: form, // FormData mit "file" und ${Object.keys(req.form || {}).map((k) => `"${k}"`).join(', ')}\n` : req.body != null ? `  body: JSON.stringify(${JSON.stringify(req.body, null, 2).replace(/\n/g, '\n  ')}),\n` : '';
  return `${ts ? 'type ApiResponse = Record<string, unknown>;\n\n' : ''}const res = await fetch('${url}', {\n  method: '${req.method}',\n  headers: ${hs.replace(/\n/g, '\n  ')},\n${bodyLine}});\nconst data${ts ? ': ApiResponse' : ''} = res.status === 204 ? null : await res.json();\nconsole.log(res.status, res.headers.get('x-request-id'), data);`;
}

async function playground(ctx) {
  const { body } = ctx;
  const keys = sessionKeys();
  const f = flow();
  const sel = playground.sel || 'case-create';
  const ep = ENDPOINTS.find((x) => x.id === sel) || ENDPOINTS[0];
  const isTest = !keys.length || (playground.key || keys[0]?.secret || '').startsWith('test_');
  body.innerHTML = `${testBanner(isTest)}<section class="pt-card"><h2>API Playground</h2><p class="form-note">Sendet echte Anfragen an <code>${esc(location.origin)}/api/v1</code> mit dem gewählten Schlüssel. Test-Schlüssel bleiben nur in diesem Tab gespeichert, Live-Schlüssel nur bis zum Neuladen.</p>
    <div class="api-flow">${FLOW.map(([id, l], i) => { const done = (f.done || []).includes(i); return `<button type="button" class="api-flow-step${done ? ' done' : ''}" data-flow="${i}" data-ep="${id}">${done ? '✓ ' : ''}${i + 1}. ${l}</button>`; }).join('<span aria-hidden="true">→</span>')}</div>
    <div class="api-pg">
      <div class="api-pg-req">
        <label>API Key <select id="pgKey">${keys.map((k) => `<option value="${esc(k.secret)}"${k.secret === playground.key ? ' selected' : ''}>${esc(k.label)} (${k.env})</option>`).join('')}<option value="">– anderen Schlüssel einfügen –</option></select></label>
        <input id="pgKeyIn" placeholder="test_XXXXXXXX_…" autocomplete="off" spellcheck="false"${keys.length ? ' hidden' : ''}>
        <label>Endpoint <select id="pgEp">${SECTIONS.map(([s, l]) => `<optgroup label="${l}">${ENDPOINTS.filter((e) => e.section === s).map((e) => `<option value="${e.id}"${e.id === ep.id ? ' selected' : ''}>${e.method} ${e.path} – ${esc(e.summary)}</option>`).join('')}</optgroup>`).join('')}</select></label>
        <div class="api-grid2"><label>Methode <input id="pgMethod" value="${ep.method}" readonly></label><label>Pfad <input id="pgPath" value="${esc(fillPath(ep.path, f))}${ep.query ? '?' + new URLSearchParams(ep.query) : ''}"></label></div>
        <label>Headers (JSON) <textarea id="pgHdr" rows="2" spellcheck="false">${esc(JSON.stringify(ep.idempotent ? { 'Idempotency-Key': newIdem() } : {}, null, 0))}</textarea></label>
        ${ep.multipart ? `<div class="api-grid2"><label>Datei <input type="file" id="pgFile" accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"></label><label>type <input id="pgType" value="${esc(ep.form?.type || 'identity')}"></label></div><button type="button" class="btn btn-outline" id="pgTestPdf">Test-PDF erzeugen (TEST-Unterlage)</button>`
          : ['POST', 'PATCH', 'PUT'].includes(ep.method) ? `<label>Body (JSON) <textarea id="pgBody" rows="12" spellcheck="false">${esc(JSON.stringify(ep.body ?? {}, null, 2))}</textarea></label>` : ''}
        <div class="wiz-nav"><button type="button" class="btn btn-dark" id="pgSend">SEND REQUEST</button></div>
        <p class="form-note">${ep.scope ? `Scope: <code>${ep.scope}</code>` : 'Ohne Schlüssel'}${ep.enterprise ? ' · nur Enterprise' : ''} · <a href="#api-docs" data-doc="${ep.id}">Open Documentation</a></p>
      </div>
      <div class="api-pg-res" id="pgRes"><div class="wa-state"><strong>Noch keine Antwort.</strong><span>Endpoint wählen und SEND REQUEST drücken.</span></div></div>
    </div></section>`;
  const $ = (s) => body.querySelector(s);
  $('#pgKey')?.addEventListener('change', (e) => { playground.key = e.target.value; $('#pgKeyIn').hidden = Boolean(e.target.value); if (e.target.value) playground(ctx); });
  $('#pgEp').onchange = (e) => { playground.sel = e.target.value; playground(ctx); };
  body.querySelector('[data-doc]').onclick = () => { docs.focus = ep.id; };
  body.querySelectorAll('[data-flow]').forEach((b) => b.onclick = () => {
    const i = Number(b.dataset.flow);
    if (b.dataset.ep === 'report-download') return downloadReport(ctx, i);
    playground.sel = b.dataset.ep; playground.step = i; playground(ctx);
  });
  $('#pgTestPdf')?.addEventListener('click', () => {
    const pdf = makeTestPdf();
    const dt = new DataTransfer(); dt.items.add(new File([pdf], 'TEST-Unterlage.pdf', { type: 'application/pdf' }));
    $('#pgFile').files = dt.files;
  });
  $('#pgSend').onclick = async () => {
    const key = $('#pgKey')?.value || $('#pgKeyIn').value.trim();
    if (ep.scope && !key) return alert('Bitte einen API-Schlüssel wählen oder einfügen (Reiter API Keys).');
    if (key && !$('#pgKey')?.value) rememberKey(key);
    let headers = {};
    try { headers = JSON.parse($('#pgHdr').value || '{}'); } catch { return alert('Headers sind kein gültiges JSON.'); }
    let reqBody = null, fd = null, fileName = null;
    if (ep.multipart) {
      const file = $('#pgFile').files[0];
      if (!file) return alert('Bitte eine Datei wählen oder ein Test-PDF erzeugen.');
      fd = new FormData(); fd.append('file', file); fd.append('type', $('#pgType').value.trim()); fileName = file.name;
    } else if ($('#pgBody')) {
      try { reqBody = JSON.parse($('#pgBody').value || '{}'); } catch { return alert('Body ist kein gültiges JSON.'); }
    }
    const path = $('#pgPath').value.trim();
    if (/\{\w+\}/.test(path)) return alert('Bitte die Platzhalter im Pfad ersetzen (zuerst einen Fall anlegen).');
    const req = { method: ep.method, url: path, headers, body: reqBody, key, file: fileName, form: fd ? { type: $('#pgType').value.trim() } : null };
    $('#pgSend').disabled = true;
    const t0 = performance.now();
    let res, text = '';
    try {
      res = await fetch(path, { method: ep.method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(reqBody != null ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: fd || (reqBody != null ? JSON.stringify(reqBody) : undefined), cache: 'no-store' });
      text = await res.text();
    } catch (e) { $('#pgSend').disabled = false; $('#pgRes').innerHTML = `<div class="wa-state err"><strong>Netzwerkfehler</strong><span>${esc(e.message)}</span></div>`; return; }
    const ms = Math.round(performance.now() - t0);
    $('#pgSend').disabled = false;
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    // Kennungen aus der Antwort für die nächsten Schritte übernehmen.
    if (res.ok && data && typeof data === 'object' && ep.capture) { const upd = {}; for (const [k, field] of Object.entries(ep.capture)) if (data[field]) upd[k] = data[field]; setFlow(upd); }
    if (res.ok && data?.secret && String(data.secret).match(/^(test|live)_/)) rememberKey(data.secret, `${data.name || 'Schlüssel'} (neu)`);
    if (res.ok && ep.id === 'webhook-test' && data?.delivered) setFlow({ webhookTested: true });
    if (res.ok && playground.step != null && FLOW[playground.step]?.[0] === ep.id) setFlow({ done: [...new Set([...(flow().done || []), playground.step])] });
    else if (res.ok) { const idx = FLOW.findIndex(([id], i) => id === ep.id && !(flow().done || []).includes(i)); if (idx >= 0) setFlow({ done: [...new Set([...(flow().done || []), idx])] }); }
    playground.step = null;
    const hdrs = [...res.headers.entries()].filter(([k]) => /^(x-request-id|x-ratelimit|retry-after|location|content-type|api-version|idempotent-replayed|deprecation|sunset)/i.test(k));
    const pretty = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    $('#pgRes').innerHTML = `<div class="api-res-head">${chip(`HTTP ${res.status}`, res.ok ? 'ok' : res.status >= 500 ? 'bad' : 'warn')}<span>${ms} ms</span><span>Request ID: <code>${esc(res.headers.get('x-request-id') || '–')}</code></span></div>
      <details open><summary>Response</summary><pre class="api-pre">${esc(pretty || '(leer)')}</pre></details>
      <details><summary>Headers</summary><pre class="api-pre">${esc(hdrs.map(([k, x]) => `${k}: ${x}`).join('\n'))}</pre></details>
      <div class="api-copy"><label><input type="checkbox" id="pgIns"${key.startsWith('test_') ? '' : ' disabled'}> Test-Schlüssel einsetzen</label><button type="button" class="btn btn-outline" data-s="curl">Copy cURL</button><button type="button" class="btn btn-outline" data-s="json">Copy JSON</button><button type="button" class="btn btn-outline" data-s="js">JavaScript</button><button type="button" class="btn btn-outline" data-s="ts">TypeScript</button></div>
      <pre class="api-pre" id="pgSnip" hidden></pre>`;
    $('#pgRes').querySelectorAll('[data-s]').forEach((b) => b.onclick = () => {
      if (b.dataset.s === 'json') return copy(pretty, b);
      const sn = snippet(b.dataset.s, req, $('#pgIns').checked && key.startsWith('test_') ? 'insert' : 'env');
      $('#pgSnip').hidden = false; $('#pgSnip').textContent = sn; copy(sn, b);
    });
    // Flow-Leiste aktualisieren, Pfade mit neuen IDs vorbelegen
    body.querySelectorAll('[data-flow]').forEach((b) => { const done = (flow().done || []).includes(Number(b.dataset.flow)); b.classList.toggle('done', done); b.textContent = `${done ? '✓ ' : ''}${Number(b.dataset.flow) + 1}. ${FLOW[Number(b.dataset.flow)][1]}`; });
    if (res.status === 401 && data?.code === 'API_KEY_REVOKED') forgetKey(key);
  };
}

async function downloadReport(ctx, stepIndex) {
  const f = flow();
  const key = playground.key || sessionKeys()[0]?.secret;
  if (!f.caseId || !f.reportId || !key) return alert('Zuerst einen Bericht erzeugen (Schritt 7).');
  const r = await fetch(`/api/v1/cases/${f.caseId}/reports/${f.reportId}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return alert(d.detail || `HTTP ${r.status}`);
  if (d.status !== 'completed' || !d.download_url) return alert(`Bericht noch nicht fertig (Status: ${d.status}). Bitte gleich erneut versuchen.`);
  window.open(d.download_url, '_blank', 'noopener');
  setFlow({ done: [...new Set([...(flow().done || []), stepIndex])] });
  playground(ctx);
}

// Minimales, gültiges PDF im Browser (gleiche Struktur wie lib/api/testdata.ts).
function makeTestPdf() {
  const text = 'BT /F1 18 Tf 72 720 Td (TEST-UNTERLAGE - LeaseRun Sandbox, keine Echtdaten) Tj ET';
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

// ---------- Documentation ----------
async function docs({ body }) {
  const base = `${location.origin}/api/v1`;
  const ep = (e) => `<article class="api-doc-ep" id="doc-${e.id}"><h4><span class="api-m api-m-${e.method.toLowerCase()}">${e.method}</span> <code>${esc(e.path)}</code></h4><p>${esc(e.desc)}</p>
    <dl class="pt-dl"><div><dt>Authentication</dt><dd>${e.scope ? 'Bearer API-Key' : 'keine'}</dd></div><div><dt>Scope</dt><dd>${e.scope ? `<code>${e.scope}</code>` : '–'}${e.enterprise ? ' · Enterprise' : ''}</dd></div><div><dt>Erfolg</dt><dd>HTTP ${e.status}</dd></div><div><dt>Fehler</dt><dd>${e.errors.join(', ')}</dd></div>${e.idempotent ? '<div><dt>Idempotenz</dt><dd>Idempotency-Key unterstützt</dd></div>' : ''}</dl>
    ${e.body ? `<details><summary>Request (Beispiel)</summary><pre class="api-pre">${esc(JSON.stringify(e.body, null, 2))}</pre></details>` : ''}${e.multipart ? '<p class="form-note">Request: multipart/form-data mit <code>file</code> und <code>type</code>.</p>' : ''}
    <details><summary>Example (cURL)</summary><pre class="api-pre">${esc(`curl -X ${e.method} '${base}${e.path.replace('/api/v1', '')}' \\\n  -H 'Authorization: Bearer $LEASERUN_API_KEY'${e.body ? ` \\\n  -H 'Content-Type: application/json' \\\n  --data '${JSON.stringify(e.body)}'` : ''}${e.multipart ? " \\\n  -F 'file=@unterlage.pdf' -F 'type=identity'" : ''}`)}</pre></details>
    <p><a class="btn btn-outline" href="#api-playground" data-try="${e.id}">Try it</a></p></article>`;
  body.innerHTML = `<section class="pt-card api-docs"><h2>LeaseRun API v1 – Dokumentation</h2>
    <nav class="api-toc">${[['intro', 'Introduction'], ['auth', 'Authentication'], ['keys', 'API Keys'], ['quick', 'Quick Start'], ...SECTIONS.map(([k, l]) => [`sec-${k}`, l]), ['errors', 'Errors'], ['limits', 'Rate Limits'], ['security', 'Security'], ['chg', 'Changelog']].map(([k, l]) => `<a href="#api-docs" data-jump="${k}">${l}</a>`).join('')}</nav>
    <h3 id="d-intro">Introduction</h3><p>REST-Schnittstelle für Makler-CRM, Vermittler-, Bank- und ERP-Systeme: Fälle übergeben, Vorprüfung abrufen, Unterlagen hochladen, Berichte erzeugen. Basis-URL: <code>${esc(base)}</code>. JSON in UTF-8, Zeitangaben ISO 8601 (UTC). OpenAPI 3.1: <a href="/api/v1/openapi.json" target="_blank" rel="noopener">/api/v1/openapi.json</a>. <strong>Keine Kreditentscheidung:</strong> Die API liefert eine Vorprüfung und Plausibilisierung; die Entscheidung trifft allein das Kreditinstitut.</p>
    <h3 id="d-auth">Authentication</h3><p><code>Authorization: Bearer &lt;API_KEY&gt;</code>. Test-Schlüssel (<code>test_…</code>) arbeiten ausschließlich mit Testdaten, Live-Schlüssel (<code>live_…</code>) mit Echtdaten. Der Mandant ergibt sich allein aus dem Schlüssel – eine tenant_id im Body wird nie ausgewertet.</p>
    <h3 id="d-keys">API Keys</h3><p>Schlüssel werden im Web-Admin oder über <code>/api/v1/api-keys</code> verwaltet: anlegen, rotieren (alter Schlüssel sofort ungültig), widerrufen, deaktivieren, ablaufen lassen. Gespeichert wird nur ein HMAC-Hash; das Geheimnis erscheint genau einmal. Optional: IP-Allowlist (IPv4/IPv6, CIDR) → sonst 403 IP_NOT_ALLOWED.</p>
    <p>Scopes: ${SCOPE_LIST.map((s) => `<code>${s}</code>`).join(' ')}. Fehlender Scope → 403 INSUFFICIENT_SCOPE.</p>
    <h3 id="d-quick">Quick Start</h3><ol><li>Web-Admin → API Management → Access: API aktivieren.</li><li>API Keys: Test-Schlüssel mit Scopes anlegen.</li><li><code>POST /cases</code> mit den Testdaten.</li><li><code>GET /cases/{id}/validate</code>.</li><li><code>POST /cases/{id}/documents</code> (PDF).</li><li><code>POST /cases/{id}/reports</code>, dann <code>GET …/reports/{reportId}</code>.</li><li>Enterprise: <code>POST /webhooks</code> und <code>POST /webhooks/{id}/test</code>.</li></ol>
    ${SECTIONS.map(([k, l]) => `<h3 id="d-sec-${k}">${l}</h3>${ENDPOINTS.filter((e) => e.section === k).map(ep).join('')}${k === 'webhooks' ? `<p class="form-note">Ereignisse: ${EVENTS.map((e) => `<code>${e}</code>`).join(' ')}. Header: X-LeaseRun-Event, X-LeaseRun-Delivery, X-LeaseRun-Timestamp, X-LeaseRun-Signature (<code>v1=HMAC_SHA256(secret, timestamp + "." + raw_body)</code>). Empfänger: Signatur zeitkonstant prüfen, Zeitstempel höchstens 5 Minuten alt (Replay-Schutz), Delivery-ID nur einmal verarbeiten. Wiederholungen nach 1 min, 5 min, 30 min, 2 h, 12 h.</p>` : ''}`).join('')}
    <h3 id="d-errors">Errors</h3><p>Problem Details (RFC 9457): <code>{ type, title, status, code, detail, request_id, errors[] }</code>.</p><table class="wa-table"><tbody>${ERRORS.map(([s, c]) => `<tr><th>${s}</th><td>${esc(c)}</td></tr>`).join('')}</tbody></table>
    <h3 id="d-limits">Rate Limits</h3><p>Pro: 60 Anfragen/Minute, Enterprise: vertraglich (Standard 300). Zusätzlich Burst je 10 Sekunden. Header: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset (Unix-Zeit). Überschreitung: 429 RATE_LIMIT_EXCEEDED mit Retry-After.</p>
    <h3 id="d-security">Security</h3><p>Mandantentrennung (Mandant aus dem Schlüssel, jede Abfrage gefiltert, RLS ohne Client-Zugriff), private Speicherung mit kurzlebigen signierten Links, keine Inhalte im Anfrageprotokoll, Audit-Protokoll als Hash-Kette, SSRF-Schutz für Webhooks (https, Port 443, öffentliche Ziele, Prüfung beim Verbindungsaufbau).</p>
    <h3 id="d-chg">Changelog</h3><p>Siehe Reiter <a href="#api-changelog">Changelog</a>. Breaking Changes nur über <code>/api/v2</code>; Abkündigungen mit Deprecation- und Sunset-Headern.</p></section>`;
  body.querySelectorAll('[data-jump]').forEach((a) => a.onclick = (e) => { e.preventDefault(); body.querySelector(`#d-${a.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth' }); });
  body.querySelectorAll('[data-try]').forEach((a) => a.onclick = () => { playground.sel = a.dataset.try; });
  if (docs.focus) { body.querySelector(`#doc-${docs.focus}`)?.scrollIntoView(); docs.focus = null; }
}

// ---------- Sandbox ----------
async function sandbox(ctx) {
  const { body } = ctx;
  const r = await get('sandbox');
  if (!r.ok) return errBox(body, r.data?.error);
  const c = r.data.counts;
  body.innerHTML = `${testBanner(true)}<section class="pt-card"><h2>Sandbox / Testumgebung</h2><p class="form-note">Alle Daten mit test_-Schlüsseln liegen in der Umgebung <code>test</code> und sind strikt von Live-Daten getrennt (jede Abfrage ist auf die Umgebung des Schlüssels begrenzt). Testberichte tragen das Wasserzeichen TEST.</p>
    <div class="api-kpis">${[['Testfälle', c.cases], ['Unterlagen', c.documents], ['Prüfläufe', c.validations], ['Berichte', c.reports], ['Webhook-Zustellungen', c.deliveries]].map(([l, x]) => `<div class="api-kpi"><small>${l}</small><strong>${num(x)}</strong></div>`).join('')}</div>
    <div class="wiz-nav"><button type="button" class="btn btn-dark" id="sbSeed">Test Case erstellen</button></div>
    <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Referenz</th><th>Fall-ID</th><th>Status</th><th>Angelegt</th></tr></thead><tbody>${r.data.cases.map((x) => `<tr><td>${esc(x.external_reference || '–')} ${chip('TEST', 'warn')}</td><td><code>${esc(x.id)}</code></td><td>${esc(x.status)}</td><td>${dtt(x.created_at)}</td></tr>`).join('') || '<tr><td colspan="4">Keine Testfälle.</td></tr>'}</tbody></table></div>
    <p class="form-note">Einzelne Testfälle löschen Sie über <code>DELETE /api/v1/cases/{id}</code> (Playground).</p></section>
    <section class="pt-card api-danger"><h3>RESET TEST ENVIRONMENT</h3><p>Löscht ausschließlich Testdaten dieses Mandanten: Testfälle mit Unterlagen, Prüfläufen und Berichten, Test-Zustellungen und Idempotenz-Einträge. Live-Daten werden nicht berührt.</p>
      <label><input type="checkbox" id="sbKeys"> Test-Schlüssel ebenfalls widerrufen</label> <label><input type="checkbox" id="sbHooks"> Test-Webhooks ebenfalls löschen</label>
      <p><label>Zur Bestätigung <code>RESET</code> eingeben <input id="sbConfirm" autocomplete="off"></label></p><button type="button" class="btn btn-outline" id="sbReset">RESET TEST ENVIRONMENT</button><p class="form-note" id="sbMsg" role="status"></p></section>`;
  body.querySelector('#sbSeed').onclick = async (e) => { e.target.disabled = true; const res = await post('sandbox_seed', { count: 1 }); e.target.disabled = false; if (!res.ok) return alert(res.data?.error || 'Nicht möglich.'); setFlow({ caseId: res.data.cases[0] }); sandbox(ctx); };
  body.querySelector('#sbReset').onclick = async () => {
    if (body.querySelector('#sbConfirm').value.trim() !== 'RESET') return alert('Bitte RESET eingeben.');
    const res = await post('sandbox_reset', { include_keys: body.querySelector('#sbKeys').checked, include_webhooks: body.querySelector('#sbHooks').checked });
    if (!res.ok) return alert(res.data?.error || 'Nicht möglich.');
    try { sessionStorage.removeItem(FK); if (body.querySelector('#sbKeys').checked) sessionStorage.removeItem(SK); } catch { /* ignore */ }
    await sandbox(ctx);
    body.querySelector('#sbMsg').textContent = `Gelöscht: ${num(res.data.deleted.cases)} Testfälle, ${num(res.data.deleted.files)} Dateien, ${num(res.data.deleted.deliveries)} Zustellungen${res.data.deleted.revoked_keys ? `, ${res.data.deleted.revoked_keys} Schlüssel widerrufen` : ''}.`;
  };
}

// ---------- Health ----------
async function health({ body }) {
  const r = await api('/api/admin/api?view=health');
  if (!r.ok) return errBox(body, r.data?.error);
  const LBL = { api: 'API availability', database: 'Database', storage: 'Storage', validation_engine: 'Validation Engine', report_engine: 'Report Engine', webhook_dispatcher: 'Webhook Dispatcher' };
  body.innerHTML = `<section class="pt-card"><div class="wa-h-row"><h2>API Health ${chip(r.data.status)}</h2><button type="button" class="btn btn-outline" id="hRe">Erneut prüfen</button></div>
    <table class="wa-table"><thead><tr><th>Komponente</th><th>Status</th><th>Latenz</th><th>Detail (nur Admin)</th></tr></thead><tbody>${r.data.components.map((c) => `<tr><td>${LBL[c.name] || esc(c.name)}</td><td>${chip(c.status)}</td><td>${c.latency_ms == null ? '–' : c.latency_ms + ' ms'}</td><td>${esc(c.detail)}</td></tr>`).join('')}</tbody></table>
    <p class="form-note">Geprüft ${dtt(r.data.checked_at)}. Öffentlich (ohne Details): <a href="/api/v1/health" target="_blank" rel="noopener">/api/v1/health</a>.</p></section>`;
  body.querySelector('#hRe').onclick = () => health({ body });
}

// ---------- Changelog ----------
async function changelog({ body }) {
  const r = await api('/api/admin/api?view=changelog');
  if (!r.ok) return errBox(body, r.data?.error);
  body.innerHTML = `<section class="pt-card"><h2>API Changelog</h2>${r.data.changelog.map((c) => `<article class="api-chg"><h3>v${esc(c.version)} <small>${esc(c.date)} · ${esc(c.status)}</small></h3><ul>${c.changes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p><strong>Deprecated:</strong> ${c.deprecated.length ? c.deprecated.map(esc).join(', ') : 'keine'} · <strong>Breaking Changes:</strong> ${c.breaking.length ? c.breaking.map(esc).join(', ') : 'keine'}</p></article>`).join('')}</section>`;
}

// ---------- Settings ----------
async function settings({ body }) {
  const d = await tenants(true);
  const need = { API_KEY_PEPPER: 'Mindestens 32 Zeichen; Pfeffer für die Schlüssel-Hashes. Änderung macht alle API-Schlüssel ungültig.', API_ENCRYPTION_KEY: '32 Byte (64 Hex-Zeichen) für die Verschlüsselung der Webhook-Geheimnisse. Nie löschen.', SUPABASE: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY (nur serverseitig).' };
  body.innerHTML = `<section class="pt-card"><h2>Settings</h2><dl class="pt-dl">
    <div><dt>Basis-URL</dt><dd><code>${esc(d.base_url)}</code> (eigene Subdomain api.leaserun.com; zusätzlich erreichbar unter leaserun.com/api/v1)</dd></div>
    <div><dt>Version</dt><dd>${esc(d.version)} · Hauptversion /api/v1, Breaking Changes nur über /api/v2</dd></div>
    <div><dt>Testumgebung</dt><dd>über test_-Schlüssel an derselben Basis-URL (keine eigene Domain nötig)</dd></div>
    <div><dt>Tarife</dt><dd>Basic: keine API (CSV-Export) · Pro: Standard-API, 60/min · Enterprise: voll inkl. Webhooks, White-Label, Routing, Limit nach Vertrag</dd></div>
    <div><dt>Aufbewahrung</dt><dd>Anfrageprotokoll 90 Tage · Idempotenz und Rate-Zähler 24 Stunden · Audit dauerhaft (Hash-Kette)</dd></div>
    <div><dt>Virenscan</dt><dd>${'MALWARE_SCAN_URL'} optional – ohne Angabe: Status „not_configured“ (Dateien werden dennoch per Signatur und Prüfsumme geprüft)</dd></div></dl>
    <h3>Umgebungsvariablen</h3><table class="wa-table"><tbody>${Object.entries(need).map(([k, x]) => `<tr><th><code>${k}</code></th><td>${d.config.includes(k) ? chip('fehlt', 'bad') : chip('gesetzt', 'ok')}</td><td>${esc(x)}</td></tr>`).join('')}</tbody></table></section>`;
}
