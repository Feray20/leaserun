// /b2b: Tarife aus der zentralen Preisliste und Kontaktformular für Demo/Enterprise/Kooperation.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const net = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
// Leistungsvergleich der Tarife als Tabelle (Spalte hl hervorgehoben).
const cmpTable = (v, hl = -1) => (v?.zeilen?.length ? `<details class="cmp" open><summary>Tarife im Vergleich</summary><div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th>${v.spalten.map((s, i) => `<th${i === hl ? ' class="hl"' : ''}>${esc(s)}</th>`).join('')}</tr></thead><tbody>${v.zeilen.map(([l, ...c]) => `<tr><th scope="row">${esc(l)}</th>${c.map((x, i) => `<td class="${x === '✓' ? 'y' : x === '–' ? 'n' : ''}${i === hl ? ' hl' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '');


// Pakete je Branche aus dem B2B-Katalog (im Web-Admin pflegbar). Jede Branche hat eigene Tools und Preise.
const TYPE_OF = { makler: 'REALTOR', vermittler: 'BROKER', finanzberater: 'ADVISOR', allgemein: 'OTHER', bank: 'BANK' };
// Ein Abruf für Tarifkarten und Zeitgewinn-Rechner, damit überall dieselben Preise stehen.
let catalogP = null;
const catalog = () => (catalogP ||= fetch('/api/b2b/catalog').then((r) => r.json()).catch(() => null));
async function offers() {
  const box = document.getElementById('b2bOffers');
  if (!box) return;
  const d = await catalog();
  if (!d?.branchen) { box.innerHTML = '<p class="form-note">Pakete derzeit nicht verfügbar.</p>'; return; }
  let br = new URLSearchParams(location.search).get('branche');
  if (!d.order.includes(br)) br = 'vermittler';
  let ivl = 'month';
  const lim = (p) => [p.seats === 1 ? '1 Berater-Zugang' : `bis ${p.seats} Berater-Zugänge`, p.tier === 'BASIC' ? '20 Kreditmappen pro Monat' : 'Kreditmappen ohne Limit'].join(' · ');
  const draw = () => {
    const c = d.branchen[br];
    const card = (p) => { const cents = ivl === 'year' ? p.yearCents : p.monthCents; return `<div class="offer${p.tier === 'PRO' ? ' rec' : ''}">${p.tier === 'PRO' ? '<span class="offer-rec">Empfohlen</span>' : ''}
      <h4>${esc(p.name)}</h4><div class="offer-price">${net(cents)} <small>netto ${ivl === 'year' ? 'pro Jahr' : 'pro Monat'}</small></div>${ivl === 'year' ? `<p class="offer-for">entspricht ${net(Math.round(cents / 12))} pro Monat</p>` : ''}<p class="offer-lim"><strong>Enthalten:</strong> ${esc(lim(p))}</p>
      <ul>${p.features.map((f) => `<li${/^Alles aus/.test(f) ? ' class="offer-basis"' : ''}>${esc(f)}</li>`).join('')}</ul><a class="btn btn-dark" href="?branche=${br}#anfrage" data-pick-br="${br}">Unternehmenskonto anfragen</a></div>`; };
    const ent = c.enterprise ? `<div class="offer"><h4>${esc(c.enterprise.name)}</h4><div class="offer-price offer-price-txt">${esc(c.enterprise.price)}</div><ul>${c.enterprise.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn ${c.selfService ? 'btn-outline' : 'btn-dark'}" href="?branche=${br}&anliegen=enterprise#anfrage" data-pick-br="${br}">Angebot anfordern</a></div>` : '';
    box.innerHTML = `<div class="br-tabs" role="tablist" aria-label="Branche">${d.order.map((k) => `<button type="button" role="tab" data-br="${k}" aria-selected="${k === br}">${esc(d.branchen[k].short === 'Allgemein' ? 'Sonstige' : d.branchen[k].short)}</button>`).join('')}</div>
      <p class="br-desc"><strong>${esc(c.label)}</strong> – ${esc(c.desc)}</p>
      ${c.selfService && c.plans.length ? `<div class="seg" role="tablist"><button type="button" data-i="month" aria-selected="${ivl === 'month'}">Monatlich</button><button type="button" data-i="year" aria-selected="${ivl === 'year'}">Jährlich (2 Monate geschenkt)</button></div>` : ''}
      <div class="offers">${c.selfService ? c.plans.map(card).join('') : ''}${ent}</div>
      ${d.addon && c.selfService ? `<p class="price-note"><strong>Mehrere Branchen?</strong> ${esc(d.addon.text)} – ${net(d.addon.monthCents)} netto pro Monat je Branche, im Checkout oder später im Portal.</p>` : ''}
      <p class="price-note">Ihre Branche legen Sie bei der Kontoanfrage fest; sie bestimmt Pakete und Software-Tools. Ein Wechsel ist über den Support möglich. Nur für Unternehmer im Sinne des § 14 BGB. Alle Preise netto zzgl. 19 % USt. Monatsabos monatlich kündbar, Jahresabos zum Ende der Laufzeit.</p>`;
    box.querySelectorAll('[data-br]').forEach((b) => b.onclick = () => { br = b.dataset.br; draw(); });
    box.querySelectorAll('[data-i]').forEach((b) => b.onclick = () => { ivl = b.dataset.i; draw(); });
    box.querySelectorAll('[data-pick-br]').forEach((a) => a.addEventListener('click', () => { const sel = document.querySelector('#b2bContact [name=institutionType]'); if (sel) sel.value = TYPE_OF[a.dataset.pickBr] || 'OTHER'; }));
  };
  draw();
}

// „Demo anfragen“ / „Unterlagen per E-Mail anfordern“: bestehendes Formular vorbelegen, keine zusätzlichen Pflichtfelder.
// Unterlagen laufen als Anfrage „Angebot“ mit Betreff in der Nachricht (kein neuer Anfragetyp in der Datenbank).
const UNTERLAGEN = 'Betreff: Unterlagen – bitte senden Sie mir Informationsunterlagen zu LeaseRun für Unternehmen per E-Mail.';
function preset(f, lead) {
  if (!f?.kind) return;
  f.kind.value = lead === 'unterlagen' ? 'enterprise' : 'demo';
  if (lead === 'unterlagen' && f.message && !f.message.value.trim()) f.message.value = UNTERLAGEN;
  f.kind.dispatchEvent(new Event('change'));
}
// Klickzählung über die bestehende cookielose Messung (track.js: nichts bei „Do Not Track“/GPC).
// Zusätzlich nichts zählen, wenn die Statistik im Datenschutz-Hinweis abgelehnt wurde.
const leadClick = (lead) => {
  try { if (localStorage.getItem('lr-ga') === 'no') return; } catch { /* ohne Speicher: wie track.js */ }
  try { window.iaTrack?.(lead === 'unterlagen' ? 'b2b_unterlagen_klick' : 'b2b_demo_klick', { seg: 'b2b' }); } catch { /* nie stören */ }
};

function contact() {
  const f = document.getElementById('b2bContact');
  if (!f) return;
  const ts = Date.now();
  const kind = new URLSearchParams(location.search).get('anliegen');
  if (kind && f.kind.querySelector(`option[value="${kind}"]`)) f.kind.value = kind;
  if (new URLSearchParams(location.search).get('betreff') === 'unterlagen') preset(f, 'unterlagen');
  // Nachweis-Felder nur bei der Kontoanfrage (dort Pflicht).
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
      if (pf && pf.size > 4 * 1024 * 1024) { msg.textContent = 'Der Nachweis ist größer als 4 MB. Bitte verkleinern oder als PDF speichern.'; return; }
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
      if (d.newsletter === 'on') { const x = await fetch('/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: d.email, name: d.name, company: d.company, segment: 'b2b', source: 'b2b-formular', consent: true, ts }) }).catch(() => null); if (x && x.ok) nl = ' Für die Neuigkeiten haben wir Ihnen eine Bestätigungs-E-Mail geschickt.'; }
      f.innerHTML = `<div class="pt-alert full"><strong>Danke!</strong> Ihre Anfrage ist eingegangen. Wir melden uns innerhalb von zwei Werktagen.${nl}</div>`;
    }
    else { msg.textContent = j.error || 'Senden fehlgeschlagen.'; if (j.field === 'email') f.email?.focus(); }
  };
}

// routes.js rendert den Inhalt nach DOMContentLoaded; kurz warten, bis die Container da sind.
function init(tries = 0) {
  if (!document.getElementById('b2bOffers') && tries < 40) { setTimeout(() => init(tries + 1), 50); return; }
  offers().then(() => {
    // Herkunft (z. B. von der Prüfseite) an die Registrierung weitergeben.
    const ref = (new URLSearchParams(location.search).get('ref') || '').replace(/[^a-z0-9-]/gi, '').slice(0, 40);
    if (ref) document.querySelectorAll('a[href="/business-portal"]').forEach((a) => { a.href = '/business-portal?ref=' + encodeURIComponent(ref); });
  });
  contact();
  landing();
}
// Rückmeldung nach Bestätigen/Abmelden der Neuigkeiten.
{ const nl = new URLSearchParams(location.search).get('newsletter'); const t = { bestaetigt: 'Danke – Ihre Anmeldung für die Neuigkeiten ist bestätigt.', abgemeldet: 'Sie sind abgemeldet und erhalten keine Neuigkeiten mehr.', ungueltig: 'Dieser Link ist ungültig oder abgelaufen.' }[nl]; if (t) { const show = () => { const m = document.createElement('div'); m.className = 'nl-banner'; m.setAttribute('role', 'status'); m.textContent = t; document.body.prepend(m); setTimeout(() => m.remove(), 8000); }; if (document.readyState === 'loading') addEventListener('DOMContentLoaded', show); else show(); } }

// Kontoanfrage: eingetragene Gesellschaften → Registernummer genügt; sonst Steuernummer und Nachweis (Datei) Pflicht.
function syncLegal(f) {
  const sel = f.querySelector('[name=legalForm]'); if (!sel) return;
  const on = !f.querySelector('[data-konto]')?.disabled;
  const hr = sel.selectedOptions[0]?.dataset.hr === '1', chosen = Boolean(sel.value);
  f.querySelectorAll('[data-hr-only]').forEach((x) => { x.hidden = !(chosen && hr); });
  f.querySelectorAll('[data-nohr-only]').forEach((x) => { x.hidden = !(chosen && !hr); });
  const req = (n, v) => { const i = f.querySelector(`[name=${n}]`); if (i) i.required = on && v; };
  req('registerNumber', chosen && hr); req('taxId', chosen && !hr); req('proof', chosen && !hr);
}

// ---------- Landingpage: Branchenwahl, Zeitgewinn-Rechner, Demo-Fall, White-Label-Vorschau ----------
const RB = {
  vermittler: { h: 'Vorqualifizierte Fälle statt Unterlagen-Jagd – Ihr Zeitgewinn, offen gerechnet.', p: 'Ihre Kunden laden Unterlagen hoch und füllen die Selbstauskunft aus. LeaseRun prüft Beleihungsauslauf, Haushaltsüberschuss, DSCR und Zins-Stresstest automatisch. Sie übernehmen den Fall, wenn er entscheidungsreif ist.', n: 15, m: 120, type: 'BROKER' },
  makler: { h: 'Kaufinteressenten vorqualifiziert – bevor Sie die Besichtigung planen.', p: 'Per QR-Code am Exposé rechnen Interessenten ihre Finanzierung durch und reichen Unterlagen ein. Sie sehen, wer realistisch kaufen kann, und geben bankfertige Fälle an Ihren Finanzierungspartner weiter.', n: 25, m: 60, type: 'REALTOR' },
  bank: { h: 'Kreditmappen in festem Aufbau – Ihre Berater prüfen statt zu sammeln.', p: 'Kreditmappen kommen in festem Aufbau an: Selbstauskunft, Haushaltsrechnung, Objektkennzahlen und nummerierte Anlagen, jeweils mit SHA-256-Prüfsumme. Ihre Berater prüfen statt zu sammeln.', n: 40, m: 90, type: 'BANK' },
  finanzberater: { h: 'Immobilie als Anlageklasse – durchgerechnet und präsentationsfertig.', p: 'Cashflow nach Steuern, Rendite und Zins-Stresstest für Ihre Mandanten, als Präsentation mit Ihrem Logo. Unterlagen und Kennzahlen liegen strukturiert vor, wenn es zur Finanzierung geht.', n: 8, m: 120, type: 'OTHER' },
};
const x$ = (id) => document.getElementById(id);
function landing() {
  if (!x$('roi_out')) return;
  const nf = (v) => Math.round(v).toLocaleString('de-DE');
  // Pro-Preis der gewählten Branche aus dem Katalog; ohne Katalog oder ohne Pro-Tarif (Bank) kein Vergleich.
  let cur = 'vermittler', cat = null;
  const proNet = () => {
    const p = cat?.branchen?.[cur]?.plans?.find((x) => x.tier === 'PRO' && x.active !== false);
    return p && p.monthCents > 0 ? p.monthCents / 100 : 0;
  };
  const roi = () => {
    const n = +x$('roi_n').value, m = +x$('roi_m').value, sh = +x$('roi_s').value / 100, h = +x$('roi_h').value;
    x$('roi_n_o').textContent = n; x$('roi_m_o').textContent = m + ' Min.'; x$('roi_s_o').textContent = Math.round(sh * 100) + ' %'; x$('roi_h_o').textContent = h + ' €';
    document.querySelectorAll('.roi input[type=range]').forEach((r) => r.style.setProperty('--pct', ((r.value - r.min) / (r.max - r.min)) * 100 + '%'));
    const perCase = m * sh, hours = (n * perCase) / 60, value = hours * h;
    const pro = proNet(), mult = pro ? value / pro : 0;
    x$('roi_out').innerHTML = `<div><strong>${nf(perCase)} Min.</strong><span>weniger je Fall</span></div><div><strong>${hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Std.</strong><span>pro Monat</span></div><div class="roi-v"><strong>${nf(value)} €</strong><span>Arbeitszeit pro Monat${mult >= 1 ? ` · ${mult.toLocaleString('de-DE', { maximumFractionDigits: 1 })}-fach der Pro-Gebühr (${pro.toLocaleString('de-DE', { maximumFractionDigits: 2 })} € netto)` : ''}</span></div>`;
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
    if (save) try { localStorage.setItem('lr-b2b-branche', k); } catch { /* ohne Speicher */ }
  };
  document.querySelectorAll('[data-rb]').forEach((b) => b.onclick = () => setRb(b.dataset.rb));
  let start = 'vermittler';
  try { const s = localStorage.getItem('lr-b2b-branche'); if (RB[s]) start = s; } catch { /* ohne Speicher */ }
  setRb(start, false);
  catalog().then((d) => { cat = d; roi(); });

  // Demo-Fall in drei Schritten (Musterdaten, nichts wird gesendet).
  const sim = (k) => {
    document.querySelectorAll('[data-sim]').forEach((b) => b.setAttribute('aria-selected', String(+b.dataset.sim === k)));
    document.querySelectorAll('[data-simp]').forEach((p) => { p.hidden = +p.dataset.simp !== k; });
    if (k === 3 && crypto?.subtle) {
      const txt = 'LeaseRun Kreditmappe · Familie Muster · Eigentumswohnung · Kaufpreis 380000 · Eigenkapital 70000 · BLA 78,4 % · DSCR 1,24 · ' + new Date().toISOString().slice(0, 10);
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then((b) => { x$('simHash').textContent = 'SHA-256 ' + [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, '0')).join(''); });
    }
  };
  document.querySelectorAll('[data-sim]').forEach((b) => b.onclick = () => sim(+b.dataset.sim));
  document.querySelectorAll('[data-sim-go]').forEach((b) => b.onclick = () => {
    if (b.hasAttribute('data-sim-reset')) {
      // Demo von vorn: Unterlagen-Liste, Balken und Upload-Knopf zurücksetzen.
      document.querySelectorAll('#simDocs li').forEach((l) => l.classList.remove('done', 'miss'));
      if (x$('simBar')) x$('simBar').style.width = '0';
      const up = x$('simUp'); if (up) { up.textContent = 'Upload simulieren'; up.disabled = false; up.onclick = null; }
      if (x$('simNote')) x$('simNote').textContent = 'Der Mandant lädt Unterlagen über Ihren Einladungslink hoch – geführt, am Handy.';
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
      if (i === li.length - 1) { x$('simNote').textContent = '6 von 7 Unterlagen da – der Energieausweis fehlt noch. LeaseRun erinnert den Mandanten automatisch.'; btn.textContent = 'Weiter: Prüfung ansehen'; btn.disabled = false; btn.onclick = () => sim(2); }
    }, 260 * (i + 1)));
  });

  // White-Label-Vorschau der Kundeneinladung.
  const wl = () => {
    const name = x$('wlName').value.trim() || 'Ihr Unternehmen', col = x$('wlCol').value;
    x$('wlFrom').textContent = name; x$('wlCo').textContent = name;
    x$('wlPrev').style.setProperty('--wl', col);
  };
  ['wlName', 'wlCol'].forEach((id) => x$(id)?.addEventListener('input', wl)); wl();

  // Conversion-Ereignisse (cookielose Messung, nur Ereignisname und Ort – keine Eingaben).
  const tr = (ev, where) => { try { window.iaTrack?.(ev, { seg: 'b2b', plan: where }); } catch { /* nie stören */ } };
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
        // Auf derselben Seite ohne Neuladen zum Formular; der Link funktioniert auch ohne JavaScript.
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
