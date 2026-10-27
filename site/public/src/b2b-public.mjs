// /business: plans from the central catalog and contact form for demo / Enterprise / partnership.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const net = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
// Plan comparison as a table (column hl highlighted).
const cmpTable = (v, hl = -1) => (v?.zeilen?.length ? `<details class="cmp" open><summary>Compare plans</summary><div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th>${v.spalten.map((s, i) => `<th${i === hl ? ' class="hl"' : ''}>${esc(s)}</th>`).join('')}</tr></thead><tbody>${v.zeilen.map(([l, ...c]) => `<tr><th scope="row">${esc(l)}</th>${c.map((x, i) => `<td class="${x === '✓' ? 'y' : x === '–' ? 'n' : ''}${i === hl ? ' hl' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '');


// Plans per industry from the business catalog (editable in the Web-Admin). Each industry has its own tools and prices.
const TYPE_OF = { makler: 'REALTOR', vermittler: 'BROKER', finanzberater: 'ADVISOR', allgemein: 'OTHER', bank: 'BANK' };
// One fetch for plan cards and the time-saved calculator, so the same prices show everywhere.
let catalogP = null;
const catalog = () => (catalogP ||= fetch('/api/b2b/catalog').then((r) => r.json()).catch(() => null));
async function offers() {
  const box = document.getElementById('b2bOffers');
  if (!box) return;
  const d = await catalog();
  if (!d?.branchen) { box.innerHTML = '<p class="form-note">Plans are currently unavailable.</p>'; return; }
  let br = new URLSearchParams(location.search).get('branche');
  if (!d.order.includes(br)) br = 'vermittler';
  let ivl = 'month';
  const lim = (p) => [p.seats === 1 ? '1 seat' : `up to ${p.seats} seats`, p.tier === 'BASIC' ? 'up to 25 active clients · 20 lender packages per month' : 'unlimited clients and lender packages'].join(' · ');
  const draw = () => {
    const c = d.branchen[br];
    const card = (p) => { const cents = ivl === 'year' ? p.yearCents : p.monthCents; return `<div class="offer${p.tier === 'PRO' ? ' rec' : ''}">${p.tier === 'PRO' ? '<span class="offer-rec">Recommended</span>' : ''}
      <h4>${esc(p.name)}</h4><div class="offer-price">${net(cents)} <small>${ivl === 'year' ? 'per year' : 'per month'}</small></div>${ivl === 'year' ? `<p class="offer-for">equals ${net(Math.round(cents / 12))} per month</p>` : ''}<p class="offer-lim"><strong>Included:</strong> ${esc(lim(p))}</p>
      <ul>${p.features.map((f) => `<li${/^Everything in/.test(f) ? ' class="offer-basis"' : ''}>${esc(f)}</li>`).join('')}</ul><a class="btn btn-dark" href="?branche=${br}#anfrage" data-pick-br="${br}">Request a business account</a></div>`; };
    const ent = c.enterprise ? `<div class="offer"><h4>${esc(c.enterprise.name)}</h4><div class="offer-price offer-price-txt">${esc(c.enterprise.price)}</div><ul>${c.enterprise.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn ${c.selfService ? 'btn-outline' : 'btn-dark'}" href="?branche=${br}&anliegen=enterprise#anfrage" data-pick-br="${br}">Contact sales</a></div>` : '';
    box.innerHTML = `<div class="br-tabs" role="tablist" aria-label="Industry">${d.order.map((k) => `<button type="button" role="tab" data-br="${k}" aria-selected="${k === br}">${esc(d.branchen[k].short)}</button>`).join('')}</div>
      <p class="br-desc"><strong>${esc(c.label)}</strong> – ${esc(c.desc)}</p>
      ${c.selfService && c.plans.length ? `<div class="seg" role="tablist"><button type="button" data-i="month" aria-selected="${ivl === 'month'}">Monthly</button><button type="button" data-i="year" aria-selected="${ivl === 'year'}">Annual (2 months free)</button></div>` : ''}
      <div class="offers">${c.selfService ? c.plans.map(card).join('') : ''}${ent}</div>
      ${d.addon && c.selfService ? `<p class="price-note"><strong>More than one industry?</strong> ${esc(d.addon.text)} – ${net(d.addon.monthCents)} per month per industry, at checkout or later in the portal.</p>` : ''}
      <p class="price-note">You choose your industry when you request an account; it determines your plans and software tools. You can switch through support. For businesses only. Prices in US dollars; sales tax may apply in some states. Subscriptions renew automatically – cancel monthly plans any time online, annual plans at the end of the term. Enterprise is priced individually.</p>`;
    box.querySelectorAll('[data-br]').forEach((b) => b.onclick = () => { br = b.dataset.br; draw(); });
    box.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { ivl = b.dataset.i; draw(); });
    box.querySelectorAll('[data-pick-br]').forEach((a) => a.addEventListener('click', () => { const sel = document.querySelector('#b2bContact [name=institutionType]'); if (sel) sel.value = TYPE_OF[a.dataset.pickBr] || 'OTHER'; }));
  };
  draw();
}

// "Request a demo" / "Get info by email": prefill the existing form, no extra required fields.
// Info requests are sent as an Enterprise request with a subject in the message (no new request type in the database).
const UNTERLAGEN = 'Subject: Info – please email me information about LeaseRun for Business.';
function preset(f, lead) {
  if (!f?.kind) return;
  f.kind.value = lead === 'unterlagen' ? 'enterprise' : 'demo';
  if (lead === 'unterlagen' && f.message && !f.message.value.trim()) f.message.value = UNTERLAGEN;
  f.kind.dispatchEvent(new Event('change'));
}
// Click counting through the existing cookieless measurement (track.js: nothing with Do Not Track / GPC).
// Additionally nothing is counted if statistics were declined in the privacy notice.
const leadClick = (lead) => {
  try { if (localStorage.getItem('lr-ga') === 'no') return; } catch { /* no storage: same as track.js */ }
  try { window.iaTrack?.(lead === 'unterlagen' ? 'b2b_unterlagen_klick' : 'b2b_demo_klick', { seg: 'b2b' }); } catch { /* never interfere */ }
};

function contact() {
  const f = document.getElementById('b2bContact');
  if (!f) return;
  const ts = Date.now();
  const kind = new URLSearchParams(location.search).get('anliegen');
  if (kind && f.kind.querySelector(`option[value="${kind}"]`)) f.kind.value = kind;
  if (new URLSearchParams(location.search).get('betreff') === 'unterlagen') preset(f, 'unterlagen');
  // Verification fields only for account requests (required there).
  const sync = () => { const on = f.kind.value === 'konto'; f.querySelectorAll('[data-konto]').forEach((x) => { x.hidden = !on; x.disabled = !on; }); f.querySelectorAll('[data-konto-n]').forEach((x) => { x.textContent = on ? '4' : '3'; }); syncLegal(f); };
  f.kind.addEventListener('change', sync); f.legalForm?.addEventListener('change', () => syncLegal(f)); sync();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('b2bMsg');
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const fd = new FormData(f), d = Object.fromEntries(fd);
    const btn = f.querySelector('button[type=submit]');
    let r;
    if (d.kind === 'konto') {
      const pf = fd.get('proof');
      if (pf && pf.size > 4 * 1024 * 1024) { msg.textContent = 'The document is larger than 4 MB. Please reduce its size or save it as a PDF.'; return; }
      fd.set('ts', String(ts)); fd.delete('newsletter'); const cp = new URLSearchParams(location.search).get('utm_campaign'); if (cp && /^[a-z0-9-]{3,40}$/.test(cp)) fd.set('camp', cp); btn.disabled = true;
      r = await fetch('/api/b2b/contact', { method: 'POST', body: fd });
    } else {
      delete d.proof; btn.disabled = true;
      const cp = new URLSearchParams(location.search).get('utm_campaign');
      const { newsletter: _nl, ...rest } = d; // eslint-disable-line no-unused-vars
      r = await fetch('/api/b2b/contact', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...rest, privacy: d.privacy === 'on', ts, ...(cp && /^[a-z0-9-]{3,40}$/.test(cp) ? { camp: cp } : {}) }) });
    }
    const j = await r.json().catch(() => ({}));
    btn.disabled = false;
    if (r.ok) {
      let nl = '';
      if (d.newsletter === 'on') { const x = await fetch('/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: d.email, name: d.name, company: d.company, segment: 'b2b', source: 'b2b-formular', consent: true, ts }) }).catch(() => null); if (x && x.ok) nl = ' We sent you a confirmation email for the updates.'; }
      f.innerHTML = `<div class="pt-alert full"><strong>Thank you!</strong> We received your request and will get back to you within two business days.${nl}</div>`;
    }
    else { msg.textContent = j.error || 'Sending failed.'; if (j.field === 'email') f.email?.focus(); }
  };
}

// routes.js renders the content after DOMContentLoaded; wait briefly until the containers exist.
function init(tries = 0) {
  if (!document.getElementById('b2bOffers') && tries < 40) { setTimeout(() => init(tries + 1), 50); return; }
  offers().then(() => {
    // Pass the source (e.g. from the review page) on to registration.
    const ref = (new URLSearchParams(location.search).get('ref') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
    if (ref) document.querySelectorAll('a[href="/business-portal"]').forEach((a) => { a.href = '/business-portal?ref=' + encodeURIComponent(ref); });
  });
  contact();
  landing();
}
// Feedback after confirming / unsubscribing from updates.
{ const nl = new URLSearchParams(location.search).get('newsletter'); const t = { bestaetigt: 'Thanks – your subscription to updates is confirmed.', abgemeldet: 'You are unsubscribed and will not receive further updates.', ungueltig: 'This link is invalid or has expired.' }[nl]; if (t) { const show = () => { const m = document.createElement('div'); m.className = 'nl-banner'; m.setAttribute('role', 'status'); m.textContent = t; document.body.prepend(m); setTimeout(() => m.remove(), 8000); }; if (document.readyState === 'loading') addEventListener('DOMContentLoaded', show); else show(); } }

// Account request: licensed professionals → NMLS ID / license number is enough; other businesses upload a document (EIN optional).
function syncLegal(f) {
  const sel = f.querySelector('[name=legalForm]'); if (!sel) return;
  const on = !f.querySelector('[data-konto]')?.disabled;
  const hr = sel.selectedOptions[0]?.dataset.hr === '1', chosen = Boolean(sel.value);
  f.querySelectorAll('[data-hr-only]').forEach((x) => { x.hidden = !(chosen && hr); });
  f.querySelectorAll('[data-nohr-only]').forEach((x) => { x.hidden = !(chosen && !hr); });
  const req = (n, v) => { const i = f.querySelector(`[name=${n}]`); if (i) i.required = on && v; };
  req('registerNumber', chosen && hr); req('taxId', false); req('proof', chosen && !hr);
}

// ---------- Landing page: industry choice, time-saved calculator, demo file, white-label preview ----------
const RB = {
  vermittler: { h: 'Pre-qualified files instead of chasing documents – your time saved, calculated in the open.', p: 'Your borrowers upload documents and complete their financial profile. LeaseRun calculates LTV, DTI, DSCR and a rate stress test automatically. You take over when the file is ready for a decision.', n: 15, m: 120, type: 'BROKER' },
  makler: { h: 'Buyers pre-qualified – before you schedule the showing.', p: 'With a QR code on your listing, buyers run their own numbers and upload documents. You see who can realistically buy and hand lender-ready files to your preferred loan officer – no referral fees involved (RESPA Section 8).', n: 25, m: 60, type: 'REALTOR' },
  bank: { h: 'Lender packages in a fixed structure – your loan officers review instead of collecting.', p: 'Packages arrive in a fixed structure: financial profile, DTI, sources and uses, PITIA, DSCR and numbered exhibits, each with a SHA-256 checksum. Your team reviews instead of collecting.', n: 40, m: 90, type: 'BANK' },
  finanzberater: { h: 'Real estate as an asset class – fully calculated and ready to present.', p: 'After-tax cash flow, cap rate, depreciation and a rate stress test for your clients, as a presentation with your logo. Documents and figures are organized when it is time to finance.', n: 8, m: 120, type: 'ADVISOR' },
  allgemein: { h: 'Keep, refinance, sell or 1031 – owner decisions with numbers, not opinions.', p: 'Property managers and investor groups run cash flow, DSCR and refinance scenarios for each owner or deal and share a clean summary with the lender or CPA.', n: 10, m: 90, type: 'OTHER' },
};
const x$ = (id) => document.getElementById(id);
function landing() {
  if (!x$('roi_out')) return;
  const nf = (v) => Math.round(v).toLocaleString('en-US');
  // Pro price of the selected industry from the catalog; no comparison without catalog or Pro plan (lenders).
  let cur = 'vermittler', cat = null;
  const proNet = () => {
    const p = cat?.branchen?.[cur]?.plans?.find((x) => x.tier === 'PRO' && x.active !== false);
    return p && p.monthCents > 0 ? p.monthCents / 100 : 0;
  };
  const roi = () => {
    const n = +x$('roi_n').value, m = +x$('roi_m').value, sh = +x$('roi_s').value / 100, h = +x$('roi_h').value;
    x$('roi_n_o').textContent = n; x$('roi_m_o').textContent = m + ' min'; x$('roi_s_o').textContent = Math.round(sh * 100) + '%'; x$('roi_h_o').textContent = '$' + h;
    document.querySelectorAll('.roi input[type=range]').forEach((r) => r.style.setProperty('--pct', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'));
    const perCase = m * sh, hours = (n * perCase) / 60, value = hours * h;
    const pro = proNet(), mult = pro ? value / pro : 0;
    x$('roi_out').innerHTML = `<div><strong>${nf(perCase)} min</strong><span>less per file</span></div><div><strong>${hours.toLocaleString('en-US', { maximumFractionDigits: 1 })} hrs</strong><span>per month</span></div><div class="roi-v"><strong>$${nf(value)}</strong><span>of work time per month${mult >= 1 ? ` · ${mult.toLocaleString('en-US', { maximumFractionDigits: 1 })}x the Pro fee ($${pro.toLocaleString('en-US', { maximumFractionDigits: 2 })}/mo)` : ''}</span></div>`;
  };
  document.querySelectorAll('.roi input').forEach((i) => i.addEventListener('input', roi));
  const setRb = (k, save = true) => {
    const c = RB[k] || RB.vermittler;
    cur = RB[k] ? k : 'vermittler';
    document.querySelectorAll('[data-rb]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.rb === k)));
    x$('rbH').textContent = c.h; x$('rbP').textContent = c.p;
    x$('roi_n').value = c.n; x$('roi_m').value = c.m; roi();
    const f = document.getElementById('b2bContact');
    if (f?.institutionType) f.institutionType.value = c.type;
    if (save) try { localStorage.setItem('lr-b2b-branche', k); } catch { /* no storage */ }
  };
  document.querySelectorAll('[data-rb]').forEach((b) => b.onclick = () => setRb(b.dataset.rb));
  let start = 'vermittler';
  try { const s = localStorage.getItem('lr-b2b-branche'); if (RB[s]) start = s; } catch { /* no storage */ }
  setRb(start, false);
  catalog().then((d) => { cat = d; roi(); });

  // Demo file in three steps (sample data, nothing is sent).
  const sim = (k) => {
    document.querySelectorAll('[data-sim]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.sim === k)));
    document.querySelectorAll('[data-simp]').forEach((p) => { p.hidden = +p.dataset.simp !== k; });
    if (k === 3 && crypto?.subtle) {
      const txt = 'LeaseRun Lender Package · The Sample Family · Condo · Purchase price 385000 · Down payment 96250 · LTV 75.0% · DSCR 1.24 · ' + new Date().toISOString().slice(0, 10);
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then((b) => { x$('simHash').textContent = 'SHA-256 ' + [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, '0')).join(''); });
    }
  };
  document.querySelectorAll('[data-sim]').forEach((b) => b.onclick = () => sim(+b.dataset.sim));
  document.querySelectorAll('[data-sim-go]').forEach((b) => b.onclick = () => {
    if (b.hasAttribute('data-sim-reset')) {
      // Restart demo: reset document list, progress bar and upload button.
      document.querySelectorAll('#simDocs li').forEach((l) => l.classList.remove('done', 'miss'));
      if (x$('simBar')) x$('simBar').style.width = '0';
      const up = x$('simUp'); if (up) { up.textContent = 'Simulate upload'; up.disabled = false; up.onclick = null; }
      if (x$('simNote')) x$('simNote').textContent = 'The client uploads documents through your invitation link – guided, on their phone.';
      document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    sim(+b.dataset.simGo);
  });
  x$('simUp')?.addEventListener('click', (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    const li = [...document.querySelectorAll('#simDocs li')];
    li.forEach((l) => l.classList.remove('done', 'miss'));
    li.forEach((l, i) => setTimeout(() => {
      l.classList.add(i === li.length - 1 ? 'miss' : 'done');
      x$('simBar').style.width = Math.round(((i + 1) / li.length) * 93) + '%';
      if (i === li.length - 1) { x$('simNote').textContent = '6 of 7 documents received – the lease agreement is still missing. LeaseRun reminds the client automatically.'; btn.textContent = 'Next: view the review'; btn.disabled = false; btn.onclick = () => sim(2); }
    }, 260 * (i + 1)));
  });

  // White-label preview of the client invitation.
  const wl = () => {
    const name = x$('wlName').value.trim() || 'Your company', col = x$('wlCol').value;
    x$('wlFrom').textContent = name; x$('wlCo').textContent = name;
    x$('wlPrev').style.setProperty('--wl', col);
  };
  ['wlName', 'wlCol'].forEach((id) => x$(id)?.addEventListener('input', wl)); wl();

  // Conversion events (cookieless measurement, event name and location only – no inputs).
  const tr = (ev, where) => { try { window.iaTrack?.(ev, { seg: 'b2b', plan: where }); } catch { /* never interfere */ } };
  const seen = new Set(); const once = (ev, w) => { if (!seen.has(ev)) { seen.add(ev); tr(ev, w); } };
  x$('simUp')?.addEventListener('click', () => once('demo_started', 'upload'));
  document.querySelectorAll('[data-sim]').forEach((b) => b.addEventListener('click', () => { once('demo_started', 'tab'); if (b.dataset.sim === '3') once('demo_completed'); }));
  document.querySelectorAll('[data-sim-go="3"]').forEach((b) => b.addEventListener('click', () => once('demo_completed')));
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href="#anfrage"], a[href="#b2bContact"], a[href="#demo"], a[href="/business-portal"], [data-btrack]');
    if (a) tr('business_cta_clicked', (a.dataset.btrack || a.getAttribute('href') || '').replace(/[^a-z0-9_#/-]/gi, '').slice(0, 40));
    const l = e.target.closest?.('a[data-lead]');
    if (l) {
      leadClick(l.dataset.lead);
      const f = document.getElementById('b2bContact'), box = document.getElementById('anfrage');
      if (f?.kind && box) {
        // Jump to the form on the same page without reload; the link also works without JavaScript.
        e.preventDefault(); preset(f, l.dataset.lead);
        history.replaceState(null, '', location.pathname + '?' + (l.dataset.lead === 'unterlagen' ? 'betreff=unterlagen' : 'anliegen=demo') + '#anfrage');
        box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        setTimeout(() => f.querySelector('input[name=name]')?.focus({ preventScroll: true }), 400);
      }
    }
    const w = e.target.closest?.('[data-way="konto"]');
    if (w) { const f = document.getElementById('b2bContact'); if (f?.kind) f.kind.value = 'konto'; setTimeout(() => f?.querySelector('input[name=name]')?.focus({ preventScroll: true }), 400); }
  });
  const pr = document.getElementById('preise');
  if (pr && 'IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { io.disconnect(); once('pricing_viewed'); } }, { threshold: 0.3 }); io.observe(pr); }
}
init();
