// Public booking portal (/book): pick an open time → request → confirmation with a Microsoft Teams link by email.
// With ?b=<token> (link from the email): view and cancel your own request.
// Times are shown in the visitor's US time zone (detected via Intl, changeable); the owner's calendar stays in her zone.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ZONES = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']];
// Common IANA aliases → one of the six US zones above.
const ALIAS = { 'America/Detroit': 'America/New_York', 'America/Indiana/Indianapolis': 'America/New_York', 'America/Kentucky/Louisville': 'America/New_York', 'US/Eastern': 'America/New_York', 'US/Central': 'America/Chicago', 'America/Indiana/Knox': 'America/Chicago', 'America/Menominee': 'America/Chicago', 'US/Mountain': 'America/Denver', 'America/Boise': 'America/Denver', 'US/Pacific': 'America/Los_Angeles', 'US/Alaska': 'America/Anchorage', 'America/Juneau': 'America/Anchorage', 'America/Sitka': 'America/Anchorage', 'America/Nome': 'America/Anchorage', 'US/Hawaii': 'Pacific/Honolulu' };
const okTz = (z) => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }).format(0); return true; } catch { return false; } };
const detected = (() => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return ALIAS[z] || z; } catch { return ''; } })();
let TZ = (() => { try { const s = localStorage.getItem('lr-tz'); if (s && okTz(s)) return s; } catch { /* no storage */ } return detected && okTz(detected) ? detected : 'America/New_York'; })();
const abbr = (t) => (new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' }).formatToParts(new Date(t)).find((p) => p.type === 'timeZoneName') || {}).value || '';
const ymd = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
const fDay = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
const fNum = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
const fLong = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' });
const fTime = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fFull = (t) => `${new Date(t).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${fTime(t)} ${abbr(t)}`;
const loading = (t) => `<div class="lr-ld" role="status">${esc(t)}</div>`;
const ICON = { ok: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>', cal: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2Zm12 8H5v9h14v-9Z"/></svg>' };
const STATUS = { angefragt: ['Requested', 'We’re reviewing your request and will get back to you shortly with a confirmation.'], bestaetigt: ['Confirmed', 'You’re all set. The Teams link is below and in your email.'], abgelehnt: ['Not available', 'Unfortunately, this time doesn’t work. Please pick a new one.'], abgesagt: ['Canceled', 'This meeting has been canceled.'] };
// US request types (value = stored topic; hint = shown under the label).
const TYPES = [['Business partnership', 'Lenders, mortgage brokers, property managers'], ['Product demo', 'See LeaseRun in action'], ['Support', 'Help with your account or tools'], ['Press', 'Media and interview requests'], ['Other', '']];
const OTHER = 'Other';
// ?thema= / ?topic= from our emails (also older German values) → request type.
const WISH = { press: 'Press', presse: 'Press', media: 'Press', partnership: 'Business partnership', kooperation: 'Business partnership', partner: 'Business partnership', lender: 'Business partnership', broker: 'Business partnership', demo: 'Product demo', zugang: 'Product demo', trial: 'Product demo', test: 'Product demo', support: 'Support', help: 'Support', other: OTHER, sonstiges: OTHER };

async function call(url, body) {
  try {
    const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, status: 0, data: { error: 'No connection. Please check your internet connection.' } }; }
}

// Time zone picker: six US zones; a detected zone outside that list is offered as "Your time zone".
function tzPicker() {
  const opts = [...ZONES];
  if (!ZONES.some(([z]) => z === TZ)) opts.unshift([TZ, `Your time zone (${TZ.split('/').pop().replace(/_/g, ' ')})`]);
  return `<label class="tm-tz">Time zone<select id="tmTz">${opts.map(([z, n]) => `<option value="${esc(z)}"${z === TZ ? ' selected' : ''}>${esc(n)}${ZONES.some(([x]) => x === z) ? ` (${esc(new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || '')})` : ''}</option>`).join('')}</select></label>`;
}
function bindTz(root, redraw) {
  const s = $('#tmTz', root); if (!s) return;
  s.onchange = () => { TZ = s.value; try { localStorage.setItem('lr-tz', TZ); } catch { /* no storage */ } redraw(); };
}

function start() {
  const root = document.getElementById('terminApp');
  if (!root) return;
  const token = new URLSearchParams(location.search).get('b');
  if (token) manage(root, token); else book(root);
}

async function manage(root, token, cached) {
  let r = cached;
  if (!r) { root.innerHTML = loading('Loading your meeting …'); r = await call(`/api/termin?b=${encodeURIComponent(token)}`); }
  if (!r.ok) { root.innerHTML = `<div class="tm-card tm-center"><h2>Meeting not found</h2><p>This link is invalid or has expired.</p><a class="btn btn-dark" href="/book">Pick a new time</a></div>`; return; }
  const b = r.data.booking, [lab, txt] = STATUS[b.status] || ['', ''];
  const open = b.status === 'angefragt' || b.status === 'bestaetigt';
  root.innerHTML = `<div class="tm-card"><span class="tm-badge tm-${b.status}">${lab}</span><h2>${esc(b.topic || 'Meeting with LeaseRun')}</h2>
    <p class="tm-when">${ICON.cal}${esc(fFull(b.starts_at))}</p>${tzPicker()}<p>${esc(txt)}</p>${b.note ? `<p class="tm-note">${esc(b.note)}</p>` : ''}
    ${b.teams_url ? `<a class="btn tm-teams" href="${esc(b.teams_url)}" target="_blank" rel="noopener">Join the Teams meeting</a>` : ''}
    ${open ? `<details class="tm-cancel"><summary>Cancel meeting</summary><form id="tmCancel"><label>Reason (optional)<textarea name="reason" rows="2" maxlength="500"></textarea></label><button class="btn btn-ghost" type="submit">Cancel this meeting</button></form></details>` : `<a class="btn btn-dark" href="/book">Pick a new time</a>`}
    <p class="tm-msg" role="status"></p></div>`;
  bindTz(root, () => manage(root, token, r));
  const f = $('#tmCancel', root);
  if (f) f.onsubmit = async (e) => {
    e.preventDefault(); const btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Canceling …';
    const rr = await call('/api/termin', { action: 'cancel', token, reason: f.reason.value });
    if (rr.ok) manage(root, token); else { btn.disabled = false; btn.textContent = 'Cancel this meeting'; $('.tm-msg', root).textContent = rr.data.error || 'Cancellation failed.'; }
  };
}

async function book(root) {
  root.innerHTML = loading('Loading open times …');
  const r = await call('/api/termin');
  if (!r.ok || r.data.active === false) { root.innerHTML = `<div class="tm-card tm-center"><h2>Online booking is unavailable right now</h2><p>Just email us at <a href="mailto:support@leaserun.com?subject=Meeting%20request">support@leaserun.com</a> and we’ll suggest a few times.</p></div>`; return; }
  const { slots: raw = {}, topics = [], intro = '', durationMin = 30 } = r.data;
  // From an email (button "Suggest a time"): preselect the matching request type.
  const q = new URLSearchParams(location.search);
  const wish = (q.get('topic') || q.get('thema') || '').toLowerCase();
  // Request types (multiple allowed): fixed US types plus topics configured in the Web-Admin.
  const reasons = [...new Set([...TYPES.map(([t]) => t).filter((t) => t !== OTHER), ...topics, OTHER])];
  const hint = Object.fromEntries(TYPES);
  const pre = wish ? reasons.filter((t) => t.toLowerCase() === wish || wish.split(/\s*[&,+]\s*|\s+and\s+/).some((w) => w && (WISH[w.trim()] === t || t.toLowerCase().includes(w.trim())))) : [];
  const linkToken = q.get('t') || '';
  const all = Object.values(raw).flat().sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  if (!all.length) { root.innerHTML = `<div class="tm-card tm-center"><h2>Fully booked right now</h2><p>There are no open times in the coming weeks. Email us at <a href="mailto:support@leaserun.com?subject=Meeting%20request">support@leaserun.com</a>.</p></div>`; return; }
  let pick = null, day = null; const t0 = Date.now();
  // Group slots by date in the visitor's time zone (recomputed when the zone changes).
  let slots = {}, days = [];
  const regroup = () => { slots = {}; for (const s of all) (slots[ymd(s.start)] ||= []).push(s); days = Object.keys(slots).sort(); if (!slots[day]) day = pick ? ymd(pick.start) : days[0]; };
  regroup();
  root.innerHTML = `<div class="tm-grid"><div class="tm-card"><div class="tm-step"><span>1</span>Pick a time</div><p class="tm-intro">${esc(intro)}</p>
      <div class="tm-meta"><span>${durationMin} minutes</span><span>Microsoft Teams</span><span>Free</span></div>
      <div id="tmTzBox"></div>
      <div class="tm-days" role="tablist" aria-label="Choose a day" id="tmDays"></div>
      <h3 class="tm-dayh" id="tmDayH"></h3><div class="tm-slots" id="tmSlots"></div><p class="tm-hint">US federal holidays are not bookable.</p></div>
    <form class="tm-card tm-form" id="tmForm" novalidate><div class="tm-step"><span>2</span>Your details</div>
      <p class="tm-chosen" id="tmChosen">Please pick a time first.</p>
      <label>Name *<input name="name" autocomplete="name" required maxlength="120"></label>
      <label>Email *<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
      <div class="tm-two"><label>Company<input name="company" autocomplete="organization" maxlength="160"></label><label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="40"></label></div>
      <fieldset class="tm-why"><legend>What is this about? * <small>(choose all that apply)</small></legend><div class="tm-chips">${reasons.map((t) => `<label class="tm-chip"${hint[t] ? ` title="${esc(hint[t])}"` : ''}><input type="checkbox" name="topics" value="${esc(t)}"${pre.includes(t) ? ' checked' : ''}><span>${esc(t)}${hint[t] ? ` <small>· ${esc(hint[t])}</small>` : ''}</span></label>`).join('')}</div></fieldset>
      <label>A few words about your request <small class="tm-opt">(required for “Other”)</small><textarea name="message" rows="3" maxlength="2000" placeholder="e.g. partnership with our lending team, demo for our property management firm, press inquiry about …"></textarea></label>
      <div class="tm-verify" hidden><label>Verification code from your email *<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="\\d{6}" maxlength="6" placeholder="6 digits"></label><p class="tm-hint">We sent you a 6-digit code (please check your spam folder, too). This makes sure meetings are only requested by real people.</p></div>
      <label class="tm-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="tm-consent"><input type="checkbox" name="consent" required><span>I agree that LeaseRun may use my details to schedule this meeting (<a href="/privacy" target="_blank">Privacy Policy</a>).</span></label>
      <button class="btn btn-dark tm-submit" type="submit" disabled>Request meeting</button><p class="tm-msg" role="status"></p></form></div>`;
  const form = $('#tmForm', root), submit = $('.tm-submit', root);
  const drawTz = () => { $('#tmTzBox', root).innerHTML = tzPicker(); bindTz(root, () => { regroup(); drawTz(); drawDays(); drawDay(); choose(true); }); };
  const drawDays = () => {
    $('#tmDays', root).innerHTML = days.map((d) => `<button type="button" role="tab" data-d="${d}"><small>${fDay(d)}</small><strong>${fNum(d)}</strong><em>${slots[d].length} open</em></button>`).join('');
    root.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { day = b.dataset.d; drawDay(); });
  };
  const drawDay = () => {
    root.querySelectorAll('[data-d]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.d === day)));
    $('#tmDayH', root).textContent = fLong(day);
    $('#tmSlots', root).innerHTML = slots[day].map((s) => `<button type="button" data-s="${s.start}" aria-pressed="${pick?.start === s.start}">${fTime(s.start)}</button>`).join('');
    root.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { pick = slots[day].find((s) => s.start === b.dataset.s); const vv = $('.tm-verify', root); if (vv && !vv.hidden) { vv.hidden = true; form.email.readOnly = false; submit.textContent = 'Request meeting'; } drawDay(); choose(); });
  };
  const choose = (quiet) => {
    $('#tmChosen', root).innerHTML = pick ? `${ICON.cal}<strong>${esc(fFull(pick.start))}</strong>` : 'Please pick a time first.';
    $('#tmChosen', root).classList.toggle('on', !!pick); submit.disabled = !pick;
    if (!quiet && pick && matchMedia('(max-width: 860px)').matches) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  drawTz(); drawDays(); drawDay();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const msg = $('.tm-msg', form), fd = new FormData(form), v = Object.fromEntries(fd), chosen = fd.getAll('topics');
    if (!pick) { msg.textContent = 'Please pick a time.'; return; }
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (!chosen.length) { msg.textContent = 'Please choose what your request is about.'; return; }
    if (chosen.includes(OTHER) && String(v.message || '').trim().length < 15) { msg.textContent = 'Please briefly describe your request.'; form.message.focus(); return; }
    const ver = $('.tm-verify', form);
    if (!ver.hidden && !/^\d{6}$/.test(String(v.code || ''))) { msg.textContent = 'Please enter the 6-digit code from the email.'; form.code.focus(); return; }
    submit.disabled = true; submit.classList.add('busy'); submit.textContent = 'Sending …'; msg.textContent = '';
    const rr = await call('/api/termin', { name: v.name, email: v.email, company: v.company || '', phone: v.phone || '', topics: chosen, message: v.message || '', start: pick.start, consent: true, website: v.website || '', t0, tz: TZ, ...(linkToken ? { t: linkToken } : {}), ...(!ver.hidden && v.code ? { code: String(v.code) } : {}) });
    if (rr.ok && rr.data.verify) {
      ver.hidden = false; form.email.readOnly = true;
      submit.classList.remove('busy'); submit.textContent = 'Confirm code & request'; submit.disabled = false;
      msg.textContent = `Code sent to ${v.email}.`; form.code.focus();
      return;
    }
    if (rr.ok) {
      root.innerHTML = `<div class="tm-card tm-center tm-done"><span class="tm-ok">${ICON.ok}</span><h2>Request sent</h2><p class="tm-when">${ICON.cal}${esc(fFull(pick.start))}</p>
        <p>Thanks, ${esc(String(v.name).split(' ')[0])}! You’ll get a confirmation of receipt at <strong>${esc(v.email)}</strong> in a moment. As soon as the meeting is confirmed, we’ll email you the Microsoft Teams link.</p>
        ${rr.data.token ? `<a class="btn btn-ghost" href="/book?b=${encodeURIComponent(rr.data.token)}">View request</a>` : ''}</div>`;
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    submit.classList.remove('busy'); submit.textContent = ver.hidden ? 'Request meeting' : 'Confirm code & request'; submit.disabled = false;
    msg.textContent = rr.data.error || 'Sending failed. Please try again.';
    if (rr.data.taken) { setTimeout(() => book(root), 1800); }
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
