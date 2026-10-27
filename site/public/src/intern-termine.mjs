// Web-Admin → Appointments: accept requests from leaserun.com/book (Teams meeting in the Outlook calendar), decline, cancel; working hours.
// Times are shown in the owner's calendar time zone (config.timeZone).
import { api, esc } from './sess.mjs?v=892f3666';

const $ = (s, r = document) => r.querySelector(s);
let TZ = 'Europe/Berlin';
const ZN = { 'Europe/Berlin': 'Berlin (CET/CEST)', 'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii', UTC: 'UTC' };
const zAbbr = (t) => (new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName') || {}).value || '';
const fFull = (t) => new Date(t).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ' + zAbbr(t);
const fTime = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
// Guest view: US Eastern time for orientation.
const fEt = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET';
const LAB = { angefragt: 'Open', bestaetigt: 'Confirmed', abgelehnt: 'Declined', abgesagt: 'Canceled' };
const DAYS = [['0', 'Sunday'], ['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday']];
const toast = (t, bad) => { let el = $('#tmToast'); if (!el) { el = document.createElement('div'); el.id = 'tmToast'; el.className = 'pt-toast'; document.body.append(el); } el.textContent = t; el.style.background = bad ? '#991B1B' : ''; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3800); };
let S = { tab: 'offen', data: null, week: null, cal: {}, mode: (() => { try { return localStorage.getItem('lr-tm-mode') === 'monat' ? 'monat' : 'woche'; } catch { return 'woche'; } })() };

export async function termine(v) {
  v.innerHTML = '<div class="lr-ld" role="status">Loading appointments …</div>';
  const r = await api('/api/admin/termine');
  if (!r.ok) { v.innerHTML = `<p class="form-note">${esc(r.data?.error || 'Not available.')}</p>`; return; }
  S.data = r.data; TZ = r.data.config?.timeZone || TZ; draw(v);
}

function draw(v) {
  const { bookings, graph } = S.data, now = Date.now();
  const open = bookings.filter((b) => b.status === 'angefragt' && Date.parse(b.ends_at) > now);
  const next = bookings.filter((b) => b.status === 'bestaetigt' && Date.parse(b.ends_at) > now);
  const past = bookings.filter((b) => !open.includes(b) && !next.includes(b)).reverse();
  const list = { offen: open, kommend: next, verlauf: past }[S.tab];
  v.innerHTML = `<section class="tma">
    <div class="tma-head"><div><h2>Appointments</h2><p class="form-note">Booking page: <a href="/book" target="_blank" rel="noopener">leaserun.com/book</a> · ${S.data.config.active ? 'open for booking' : '<strong>paused</strong>'} · times in ${esc(ZN[TZ] || TZ)}</p></div>
      <div class="tma-btns"><button class="btn btn-outline btn-sm" type="button" id="tmaCopy">Copy link</button><button class="btn btn-outline btn-sm" type="button" id="tmaCfg">Working hours</button><button class="btn btn-outline btn-sm" type="button" id="tmaIcs">Calendar subscription (iPhone/Outlook)</button></div></div>
    <div class="tma-ms ${graph.ok ? 'ok' : 'warn'}" id="tmaMsBox"><div><strong>Microsoft Teams &amp; Outlook:</strong> <span id="tmaMs">${esc(graph.message)}</span>${graph.ok ? '' : '<br><small>Sign in once: after that, accepting a request automatically creates a Teams meeting in your Outlook calendar, and busy times are hidden.</small>'}</div>
      <div class="tma-btns">${graph.ok ? `<button class="btn btn-ghost btn-sm" type="button" id="tmaTest">Test connection</button>${graph.mode === 'login' ? '<button class="btn btn-ghost btn-sm" type="button" id="tmaOut">Sign out</button>' : ''}` : '<button class="btn btn-sm tma-ms-btn" type="button" id="tmaLogin"><svg viewBox="0 0 21 21" width="16" height="16" aria-hidden="true"><path fill="#F25022" d="M1 1h9v9H1z"/><path fill="#7FBA00" d="M11 1h9v9h-9z"/><path fill="#00A4EF" d="M1 11h9v9H1z"/><path fill="#FFB900" d="M11 11h9v9h-9z"/></svg>Connect with Microsoft</button><button class="btn btn-ghost btn-sm" type="button" id="tmaLink" title="Alternative sign-in with a code (microsoft.com/devicelogin)">Sign in with a code</button>'}</div></div>
    <div class="tma-chk" id="tmaChk"><div class="tma-chk-h"><strong>Check &amp; fix</strong><span class="form-note" id="tmaChkSum">Microsoft connection, calendar, sign-in</span><span style="flex:1"></span><button class="btn btn-outline btn-sm" type="button" id="tmaChkGo">Check now</button><button class="btn btn-dark btn-sm" type="button" id="tmaChkFix" disabled>Fix everything</button></div><div id="tmaChkList"></div></div>
    <div class="tma-cols"><div class="tma-left">
    <div class="br-tabs" role="tablist">${[['offen', `Open requests (${open.length})`], ['kommend', `Confirmed (${next.length})`], ['verlauf', 'History']].map(([k, l]) => `<button type="button" role="tab" data-t="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
    <div class="tma-list">${list.length ? list.map(card).join('') : `<p class="form-note tma-empty">${S.tab === 'offen' ? 'No open requests.' : S.tab === 'kommend' ? 'No confirmed meetings.' : 'No history yet.'}</p>`}</div></div>
    <div class="tma-cal" id="tmaCal"></div></div></section>`;
  v.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { S.tab = b.dataset.t; draw(v); });
  $('#tmaCopy', v).onclick = () => navigator.clipboard?.writeText('https://leaserun.com/book').then(() => toast('Link copied.'));
  $('#tmaCfg', v).onclick = () => config(v);
  $('#tmaIcs', v).onclick = () => icsDialog();
  const t = $('#tmaTest', v); if (t) t.onclick = async () => { t.disabled = true; const rr = await api('/api/admin/termine?test=1'); t.disabled = false; if (rr.ok) { $('#tmaMs', v).textContent = rr.data.graph.message; toast(rr.data.graph.ok ? 'Connection OK.' : 'Connection failed.', !rr.data.graph.ok); } };
  // Default is sign-in via link: many Microsoft 365 organizations block code sign-in (devicelogin) by policy –
  // Microsoft then shows "You don't have access to this". Code sign-in stays as an alternative.
  const lo = $('#tmaLogin', v); if (lo) lo.onclick = () => msLink(v);
  const lk = $('#tmaLink', v); if (lk) lk.onclick = () => msLogin(v, lk);
  $('#tmaChkGo', v).onclick = () => runCheck(v);
  // Is a sign-in still running (e.g. after a reload)? Then keep waiting automatically instead of starting over.
  if (!graph.ok && graph.pending && !S.resumed) { S.resumed = true; msLogin(v, null, graph.pending); }
  else if (!graph.ok) runCheck(v);
  const out = $('#tmaOut', v); if (out) out.onclick = async () => { if (!confirm('Disconnect Microsoft? New meetings will no longer get a Teams link.')) return; await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLogout' }) }); termine(v); };
  v.querySelectorAll('[data-act]').forEach((b) => b.onclick = () => act(v, b.dataset.act, b.dataset.id, b));
  drawCal(v);
}

function card(b) {
  const actions = b.status === 'angefragt' && Date.parse(b.ends_at) > Date.now()
    ? `<button class="btn btn-dark btn-sm" type="button" data-act="accept" data-id="${b.id}">Accept</button><button class="btn btn-outline btn-sm" type="button" data-act="decline" data-id="${b.id}">Decline</button>`
    : b.status === 'bestaetigt' && Date.parse(b.ends_at) > Date.now() ? `${b.teams_url ? `<a class="btn btn-sm tma-teams" href="${esc(b.teams_url)}" target="_blank" rel="noopener">Open Teams</a>` : ''}<button class="btn btn-outline btn-sm" type="button" data-act="cancel" data-id="${b.id}">Cancel</button>` : '';
  return `<article class="tma-card"><div class="tma-when"><strong>${esc(fFull(b.starts_at))}</strong><span>until ${fTime(b.ends_at)} · guest: ${fEt(b.starts_at)}</span><em class="tma-st tma-${b.status}">${LAB[b.status]}</em></div>
    <div class="tma-who"><strong>${esc(b.name)}</strong>${b.company ? ` · ${esc(b.company)}` : ''}<br><a href="mailto:${esc(b.email)}">${esc(b.email)}</a>${b.phone ? ` · <a href="tel:${esc(b.phone)}">${esc(b.phone)}</a>` : ''}</div>
    ${b.topic ? `<p class="tma-topic">${esc(b.topic)}</p>` : ''}${b.message ? `<p class="tma-msg">${esc(b.message)}</p>` : ''}${b.note ? `<p class="form-note">Note: ${esc(b.note)}</p>` : ''}
    ${actions ? `<div class="tma-acts">${actions}</div>` : ''}</article>`;
}

async function act(v, a, id, btn) {
  let body = { action: a, id };
  if (a === 'accept' && !S.data.graph.ok) {
    const u = prompt('Microsoft Teams isn’t connected yet. Optionally paste a Teams link (leave empty = confirm without a link):', '');
    if (u === null) return; if (u.trim()) body.teamsUrl = u.trim();
  }
  if (a === 'decline' || a === 'cancel') {
    const n = prompt(a === 'decline' ? 'Short message to the guest (optional):' : 'Reason for canceling (shared with the guest, optional):', '');
    if (n === null) return; body.note = n.trim();
  }
  btn.disabled = true; const label = btn.textContent; btn.textContent = a === 'accept' ? 'Creating Teams meeting …' : 'Please wait …';
  const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) { btn.disabled = false; btn.textContent = label; toast(r.data?.error || 'Failed.', true); return; }
  toast(r.data.message + (r.data.mailed === false ? ' (email to the guest failed)' : ''), r.data.mailed === false);
  const i = S.data.bookings.findIndex((x) => x.id === id); if (i >= 0) S.data.bookings[i] = r.data.booking;
  S.cal = {}; draw(v);
}

function config(v) {
  const c = S.data.config;
  let d = $('#tmaDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'tmaDlg'; d.className = 'wa-dlg'; document.body.append(d); }
  const rows = (k) => (c.days[k] || []).map(([a, b]) => `<span class="tma-rng"><input type="time" value="${a}" data-k="${k}" data-p="a">–<input type="time" value="${b}" data-k="${k}" data-p="b"><button type="button" class="tma-x" data-rm aria-label="Remove time range">×</button></span>`).join('');
  d.innerHTML = `<form class="wa-dlg-in" id="tmaF"><div class="wa-dlg-h"><h2>Working hours &amp; booking</h2><button class="stage-x" type="button" data-x aria-label="Close">×</button></div>
    <label class="chk"><input type="checkbox" id="cAct"${c.active ? ' checked' : ''}> Online booking active</label>
    <div class="wa-grid3"><label>Length (min)<input id="cDur" type="number" min="10" max="240" value="${c.durationMin}"></label><label>Buffer (min)<input id="cBuf" type="number" min="0" max="120" value="${c.bufferMin}"></label><label>Lead time (hours)<input id="cLead" type="number" min="0" max="336" value="${c.leadHours}"></label><label>Days ahead<input id="cAhead" type="number" min="1" max="120" value="${c.daysAhead}"></label></div>
    <label>Your calendar time zone<select id="cTz">${(S.data.zones || Object.keys(ZN)).map((z) => `<option value="${esc(z)}"${z === (c.timeZone || TZ) ? ' selected' : ''}>${esc(ZN[z] || z)}</option>`).join('')}</select></label>
    <fieldset class="cat-box"><legend>Weekdays (in your calendar time zone)</legend>${DAYS.map(([k, l]) => `<div class="tma-day" data-day="${k}"><strong>${l}</strong><div class="tma-rngs">${rows(k) || '<span class="form-note">off</span>'}</div><button type="button" class="btn btn-ghost btn-sm" data-add="${k}">+ Time range</button></div>`).join('')}</fieldset>
    <label>Additional request types (one per line; Business partnership, Product demo, Support and Press are always offered)<textarea id="cTop" rows="4">${esc(c.topics.join('\n'))}</textarea></label>
    <label>Intro on the booking page<input id="cIntro" maxlength="400" value="${esc(c.intro)}"></label>
    <p class="form-note">Busy times from your Outlook calendar are hidden automatically once Microsoft is connected. US federal holidays are always blocked. Visitors see the times in their own US time zone.</p>
    <div class="pt-row"><button class="btn btn-ghost" type="button" id="cReset">Default</button><span style="flex:1"></span><button class="btn btn-dark" type="submit">Save</button></div><p class="form-note" id="cMsg" role="status"></p></form>`;
  if (!d.open) d.showModal();
  d.querySelector('[data-x]').onclick = () => d.close();
  const collect = () => { const days = {}; DAYS.forEach(([k]) => { days[k] = [...d.querySelectorAll(`[data-day="${k}"] .tma-rng`)].map((s) => [s.querySelector('[data-p=a]').value, s.querySelector('[data-p=b]').value]).filter(([a, b]) => a && b); }); return days; };
  const rebind = () => {
    d.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { const k = b.closest('[data-day]').dataset.day; b.parentElement.remove(); c.days = collect(); config(v); });
    d.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { c.days = collect(); const k = b.dataset.add; c.days[k] = [...(c.days[k] || []), ['09:00', '12:00']]; config(v); });
  };
  rebind();
  d.querySelector('#cReset').onclick = async () => { if (!confirm('Reset working hours to the default?')) return; const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'config', config: null }) }); if (r.ok) { S.data.config = r.data.config; TZ = r.data.config.timeZone || TZ; config(v); } };
  d.querySelector('#tmaF').onsubmit = async (e) => {
    e.preventDefault();
    const n = (id) => Number(d.querySelector(id).value) || 0;
    const cfg = { active: d.querySelector('#cAct').checked, durationMin: n('#cDur'), bufferMin: n('#cBuf'), leadHours: n('#cLead'), daysAhead: n('#cAhead'), days: collect(), topics: d.querySelector('#cTop').value.split('\n').map((x) => x.trim()).filter(Boolean), intro: d.querySelector('#cIntro').value.trim(), timeZone: d.querySelector('#cTz').value };
    const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'config', config: cfg }) });
    const m = d.querySelector('#cMsg');
    if (r.ok) { S.data.config = r.data.config; TZ = r.data.config.timeZone || TZ; S.cal = {}; m.textContent = 'Saved – applies immediately on leaserun.com/book.'; draw(v); } else m.textContent = r.data?.error || 'Saving failed.';
  };
}

// Device-code sign-in: show the code, open the Microsoft page, wait for confirmation in the background.
async function msLogin(v, btn, resume) {
  let data = resume;
  if (!data) {
    btn.disabled = true; btn.textContent = 'Preparing …';
    const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLogin' }) });
    if (!r.ok) { toast(r.data?.error || 'Sign-in not possible.', true); termine(v); return; }
    data = r.data;
  }
  const { userCode, url, interval, expiresIn } = data;
  const box = $('#tmaMsBox', v);
  box.className = 'tma-ms tma-login'; box.dataset.busy = '1';
  box.innerHTML = `<div class="tma-login-in"><strong>Sign in with Microsoft</strong><ol><li>Copy the code: <button type="button" class="tma-code" id="tmaCode" title="Copy">${esc(userCode)}</button></li><li>Paste the code and sign in with your Microsoft 365 account: <a class="btn btn-dark btn-sm tma-go" href="${esc(url)}" target="_blank" rel="noopener" id="tmaGo">Open microsoft.com/devicelogin<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a></li><li>Click “Accept” for calendar access – this window detects the sign-in automatically.</li></ol>
    <div class="lr-ld tma-wait" role="status">Waiting for your Microsoft sign-in …</div><button type="button" class="btn btn-ghost btn-sm" id="tmaStop">Cancel</button> <button type="button" class="btn btn-ghost btn-sm" id="tmaAlt">Not working? Sign in via link</button></div>`;
  $('#tmaAlt', v).onclick = () => { stop = true; msLink(v); };
  const copy = () => navigator.clipboard?.writeText(userCode).then(() => toast('Code copied.')).catch(() => {});
  $('#tmaCode', v).onclick = copy; $('#tmaGo', v).addEventListener('click', copy);
  let stop = false; $('#tmaStop', v).onclick = () => { stop = true; termine(v); };
  const until = Date.now() + expiresIn * 1000;
  while (!stop && Date.now() < until && document.body.contains(box)) {
    await new Promise((res) => setTimeout(res, interval * 1000));
    if (stop || !document.body.contains(box)) return;
    const p = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msPoll' }) });
    const st = p.data?.status;
    if (st === 'done') { toast(`Connected to ${p.data.account}.`); termine(v); return; }
    if (st === 'expired' || st === 'error') { toast(p.data.message || 'Sign-in failed.', true); termine(v); return; }
  }
}

// Sign-in via link: open the Microsoft page, then paste the address from the address bar (http://localhost/?code=…).
// Also works when an organization blocks code sign-in (microsoft.com/devicelogin) by policy.
async function msLink(v) {
  const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLink' }) });
  if (!r.ok) { toast(r.data?.error || 'Not possible.', true); return; }
  const box = $('#tmaMsBox', v);
  box.className = 'tma-ms tma-login'; box.dataset.busy = '1';
  box.innerHTML = `<form class="tma-login-in" id="tmaLinkF"><strong>Sign in via link</strong><ol>
    <li><a class="btn btn-dark btn-sm" href="${esc(r.data.url)}" target="_blank" rel="noopener">Sign in with Microsoft</a> – with your Microsoft 365 account, click “Accept” (as an administrator, check “Consent on behalf of your organization”).</li>
    <li>The browser then shows “This site can’t be reached” – that’s expected. Copy the complete address from the address bar (it starts with <code>http://localhost/?code=</code>).</li>
    <li><label class="tma-paste">Paste it here<input name="url" required autocomplete="off" placeholder="http://localhost/?code=…"></label></li></ol>
    <p class="form-note">If Microsoft shows “You don’t have access to this” instead: tap “More details”, copy the text with the error code (AADSTS…) and paste it here – LeaseRun will show you exactly what to do.</p>
    <div class="tma-btns"><button class="btn btn-dark btn-sm" type="submit">Connect</button><button type="button" class="btn btn-ghost btn-sm" id="tmaLinkX">Cancel</button></div><p class="form-note" id="tmaLinkMsg" role="status"></p></form>`;
  $('#tmaLinkX', v).onclick = () => termine(v);
  $('#tmaLinkF', v).onsubmit = async (e) => {
    e.preventDefault(); const b = e.target.querySelector('[type=submit]'); b.disabled = true; $('#tmaLinkMsg', v).textContent = 'Checking …';
    const rr = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msLinkDone', url: new FormData(e.target).get('url') }) });
    b.disabled = false;
    if (rr.data?.ok) { toast(rr.data.message); termine(v); } else $('#tmaLinkMsg', v).textContent = rr.data?.message || rr.data?.error || 'Failed.';
  };
}

// Check & fix: short status, details only when expanded; "Fix everything" fixes what can be fixed automatically.
async function runCheck(v, fix) {
  const list = $('#tmaChkList', v), go = $('#tmaChkGo', v), fx = $('#tmaChkFix', v); if (!list) return;
  go.disabled = true; fx.disabled = true; $('#tmaChkSum', v).textContent = fix ? 'Fixing …' : 'Checking …';
  const r = fix ? await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'msFix', ids: fix }) }) : await api('/api/admin/termine?check=1');
  go.disabled = false; if (!document.body.contains(list)) return;
  if (!r.ok) { $('#tmaChkSum', v).textContent = r.data?.error || 'Check not possible.'; return; }
  if (r.data.done?.length) toast(r.data.done.join(' · '));
  const cks = r.data.checks || [], bad = cks.filter((c) => !c.ok), auto = bad.filter((c) => c.fix).map((c) => c.id);
  $('#tmaChkSum', v).textContent = bad.length ? `${bad.length} item(s) open` : 'All good';
  fx.disabled = !auto.length; fx.textContent = auto.length ? 'Fix everything' : 'Nothing to fix automatically';
  fx.onclick = () => runCheck(v, auto);
  list.innerHTML = cks.map((c) => `<details class="tma-ck ${c.ok ? (c.warn ? 'warn' : 'ok') : 'bad'}"><summary><span class="tma-dot"></span>${esc(c.label)}${c.fix && !c.ok ? `<em>can be fixed automatically</em>` : ''}</summary><p>${esc(c.detail)}</p>${c.how ? `<p class="form-note">${esc(c.how)}</p>` : ''}</details>`).join('');
  if (fix && cks.some((c) => c.id === 'ms:conn' && c.ok) && !S.data.graph.ok) termine(v);
}

// ---------- Calendar (week/month): Outlook events + LeaseRun bookings (US weeks start on Sunday) ----------
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const monday = (s) => { const wd = new Date(s + 'T12:00:00Z').getUTCDay(); return addDays(s, -wd); }; // start of week (Sunday)
const dayLab = (s) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' });

async function drawCal(v, force) {
  const el = $('#tmaCal', v); if (!el) return;
  S.week = S.week || monday(ymd(new Date()));
  const month = S.mode === 'monat', today = ymd(new Date());
  // Month: grid from the Sunday of the week containing the 1st, 6 weeks (42 days).
  const mRef = month ? (S.mref || S.week.slice(0, 7)) : null;
  const wk = month ? monday(mRef + '-01') : S.week;
  const n = month ? 42 : 7, days = [...Array(n)].map((_, i) => addDays(wk, i));
  const range = month ? new Date(mRef + '-15T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }) : `${dayLab(days[0])} – ${new Date(days[6] + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric', year: 'numeric' })}`;
  el.innerHTML = `<div class="tmc-head"><div class="tmc-nav"><button type="button" class="btn btn-outline btn-sm" data-w="-1" aria-label="${month ? 'Previous month' : 'Previous week'}">‹</button><button type="button" class="btn btn-outline btn-sm" data-w="0">Today</button><button type="button" class="btn btn-outline btn-sm" data-w="1" aria-label="${month ? 'Next month' : 'Next week'}">›</button></div><strong>${range}</strong>
    <div class="seg tmc-mode" role="tablist" aria-label="View"><button type="button" data-m="woche" aria-selected="${!month}">Week</button><button type="button" data-m="monat" aria-selected="${month}">Month</button></div></div>
    <div class="tmc-body">${S.cal[wk + ':' + n] && !force ? '' : '<div class="lr-ld" role="status">Loading calendar …</div>'}</div>`;
  const key = wk + ':' + n;
  el.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => {
    const k = +b.dataset.w;
    if (month) { if (k === 0) S.mref = today.slice(0, 7); else { const d = new Date(mRef + '-15T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); S.mref = d.toISOString().slice(0, 7); } }
    else S.week = k === 0 ? monday(today) : addDays(S.week, 7 * k);
    drawCal(v);
  });
  el.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { S.mode = b.dataset.m; if (S.mode === 'monat') S.mref = S.week.slice(0, 7); try { localStorage.setItem('lr-tm-mode', S.mode); } catch { /* no storage */ } drawCal(v); });
  if (!S.cal[key] || force) {
    const from = new Date(Date.parse(wk + 'T00:00:00Z') - 14 * 3600_000), to = new Date(Date.parse(addDays(wk, n) + 'T00:00:00Z') + 14 * 3600_000);
    const r = await api(`/api/admin/termine?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`);
    if ((month ? monday((S.mref || S.week.slice(0, 7)) + '-01') : S.week) !== wk || S.mode !== (month ? 'monat' : 'woche') || !document.body.contains(el)) return;
    if (!r.ok) { $('.tmc-body', el).innerHTML = `<p class="form-note">${esc(r.data?.error || 'Calendar not available.')}</p>`; return; }
    S.cal[key] = r.data;
  }
  const d = S.cal[key];
  const items = [
    ...d.events.map((e) => ({ k: 'ol', start: e.start, end: e.end, allDay: e.allDay, title: e.subject, sub: e.location, href: e.teams || e.link, tip: e.showAs === 'free' ? 'free' : e.showAs === 'tentative' ? 'tentative' : '' })),
    ...d.bookings.map((b) => ({ k: b.status === 'bestaetigt' ? 'ok' : 'req', start: b.starts_at, end: b.ends_at, title: `${b.name}${b.company ? ` · ${b.company}` : ''}`, sub: b.topic || '', href: b.teams_url, id: b.id })),
  ].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const byDay = Object.fromEntries(days.map((x) => [x, []]));
  for (const it of items) { const k = it.allDay ? it.start.slice(0, 10) : ymd(new Date(it.start)); if (byDay[k]) byDay[k].push(it); }
  const chip = (it) => `<${it.href ? `a href="${esc(it.href)}" target="_blank" rel="noopener"` : it.id ? `button type="button" data-goto="${it.id}"` : 'div'} class="tmc-ev tmc-${it.k}" title="${esc(it.title)}${it.sub ? ' – ' + esc(it.sub) : ''}"><span class="tmc-t">${it.allDay ? 'all day' : `${fTime(it.start)}–${fTime(it.end)}`}${it.tip ? ` · ${it.tip}` : ''}</span><span class="tmc-s">${esc(it.title)}</span>${it.sub ? `<span class="tmc-l">${esc(it.sub)}</span>` : ''}</${it.href ? 'a' : it.id ? 'button' : 'div'}>`;
  $('.tmc-body', el).innerHTML = `${d.calError ? `<p class="form-note tmc-err">Outlook: ${esc(d.calError)}</p>` : ''}${!d.connected ? '<p class="form-note tmc-err">Outlook isn’t connected – only LeaseRun bookings are shown.</p>' : ''}
    ${month ? `<div class="tmc-month"><div class="tmc-wd">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => `<span>${w}</span>`).join('')}</div><div class="tmc-mgrid">${days.map((x) => `<div class="tmc-mday${x === today ? ' now' : ''}${x.slice(0, 7) !== mRef ? ' out' : ''}"><span class="tmc-mn">${+x.slice(8)}</span>${byDay[x].slice(0, 3).map(chip).join('')}${byDay[x].length > 3 ? `<button type="button" class="tmc-more" data-day="${x}">+${byDay[x].length - 3} more</button>` : ''}</div>`).join('')}</div></div>`
      : `<div class="tmc-grid">${days.map((x) => `<div class="tmc-day${x === today ? ' now' : ''}${byDay[x].length ? '' : ' empty'}"><div class="tmc-dh">${dayLab(x)}</div>${byDay[x].map(chip).join('') || '<span class="tmc-none">free</span>'}</div>`).join('')}</div>`}
    ${items.length ? '' : `<p class="form-note tmc-free">${month ? 'No events this month.' : 'No events this week.'}</p>`}<div class="tmc-legend"><span class="tmc-ol">Outlook</span><span class="tmc-ok">LeaseRun confirmed</span><span class="tmc-req">Request open</span></div>`;
  el.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { S.mode = 'woche'; S.week = monday(b.dataset.day); try { localStorage.setItem('lr-tm-mode', 'woche'); } catch { /* no storage */ } drawCal(v); });
  el.querySelectorAll('[data-goto]').forEach((b) => b.onclick = () => { const bk = S.data.bookings.find((x) => x.id === b.dataset.goto); if (!bk) return; S.tab = bk.status === 'angefragt' ? 'offen' : 'kommend'; draw(v); setTimeout(() => { const c = v.querySelector(`[data-id="${bk.id}"]`)?.closest('.tma-card'); c?.scrollIntoView({ behavior: 'smooth', block: 'center' }); c?.classList.add('flash'); setTimeout(() => c?.classList.remove('flash'), 1600); }, 50); });
}

// Calendar subscription: all LeaseRun meetings automatically in the iPhone/iPad, Outlook or Google calendar.
async function icsDialog(renew = false) {
  const r = await api('/api/admin/termine', { method: 'POST', body: JSON.stringify({ action: 'icsToken', renew }) });
  if (!r.ok) { toast(r.data?.error || 'Not available.', true); return; }
  const url = r.data.url, web = url.replace(/^https:/, 'webcal:');
  let d = document.getElementById('tmIcs'); if (!d) { d = document.createElement('dialog'); d.id = 'tmIcs'; d.className = 'wa-dlg'; document.body.append(d); }
  d.innerHTML = `<div class="wa-dlg-in tm-ics"><div class="wa-dlg-h"><h2>Calendar subscription</h2><button class="stage-x" type="button" data-x aria-label="Close">×</button></div>
    <p>All LeaseRun meetings (requests, confirmations, cancellations) show up in your calendar automatically and stay up to date.</p>
    <a class="btn btn-dark" href="${esc(web)}">Subscribe on this iPhone/iPad/Mac</a>
    <label class="pf-fld"><span>Link</span><input value="${esc(url)}" readonly id="tmIcsUrl"></label>
    <div class="tma-btns"><button class="btn btn-outline btn-sm" type="button" id="tmIcsCopy">Copy link</button><button class="btn btn-ghost btn-sm" type="button" id="tmIcsNew">Create new link</button></div>
    <p class="form-note">Outlook: Add calendar → Subscribe from web → paste the link. Google Calendar: Other calendars → From URL. The link is secret – don’t share it. “Create new link” immediately invalidates the old one.</p></div>`;
  if (!d.open) d.showModal();
  d.querySelector('[data-x]').onclick = () => d.close();
  d.querySelector('#tmIcsCopy').onclick = () => navigator.clipboard?.writeText(url).then(() => toast('Link copied.'));
  d.querySelector('#tmIcsNew').onclick = () => { if (confirm('Create a new link? Existing subscriptions using the old link will stop updating.')) icsDialog(true); };
}
