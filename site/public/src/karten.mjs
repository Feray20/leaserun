// LeaseRun Card – Startseite und Preisverzeichnis. Keine echten Kartendaten; Beispiele sind gekennzeichnet.
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Geld in Cent, deutsche Anzeige (gleiche Regeln wie lib/cards/money.ts).
export const eur = (c) => (c == null ? 'Noch nicht festgelegt' : `${c < 0 ? '−' : ''}${Math.floor(Math.abs(c) / 100).toLocaleString('de-DE')},${String(Math.abs(c) % 100).padStart(2, '0')} €`);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// 3D-Neigung der Kartenbilder (Maus oder Finger), ohne Einfluss auf die Bedienung.
export function tilt(root = document) {
  if (reduced) return;
  root.querySelectorAll('[data-tilt]').forEach((card) => {
    let raf = 0;
    const move = (x, y) => { const r = card.getBoundingClientRect(); const px = (x - r.left) / r.width - 0.5, py = (y - r.top) / r.height - 0.5; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { card.classList.add('tilting'); card.style.setProperty('--ry', `${(px * 16).toFixed(2)}deg`); card.style.setProperty('--rx', `${(-py * 12).toFixed(2)}deg`); }); };
    const reset = () => { cancelAnimationFrame(raf); card.classList.remove('tilting'); card.style.setProperty('--ry', '0deg'); card.style.setProperty('--rx', '0deg'); };
    card.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
    card.addEventListener('pointerleave', reset); card.addEventListener('pointercancel', reset); card.addEventListener('pointerup', reset);
  });
}

// Nächster Monatsanfang (Europe/Berlin) zur Anzeige.
function resetLabel() {
  const now = new Date(), p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const y = +p.find((x) => x.type === 'year').value, m = +p.find((x) => x.type === 'month').value;
  return new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1, 12)).toLocaleDateString('de-DE');
}

async function landing() {
  tilt();
  // Designauswahl: scrollt zur passenden Karte.
  const car = $('#kCarousel'), cards = [...car.children];
  document.querySelectorAll('[data-design]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-design]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    const c = cards.find((k) => k.classList.contains(b.dataset.design));
    c?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
  }));
  // Debit / Charge
  const tabs = [['#tDebit', '#pDebit'], ['#tCharge', '#pCharge']];
  tabs.forEach(([t, p]) => $(t).addEventListener('click', () => tabs.forEach(([t2, p2]) => { const on = t2 === t; $(t2).setAttribute('aria-selected', String(on)); $(p2).hidden = !on; })));
  // Rechenbeispiel Limit (rein im Browser, gleiche Regel wie der Server)
  const LIMIT = 75000, USED = 42000;
  $('#ldReset').textContent = resetLabel();
  const amt = $('#ldAmt'), out = $('#ldMsg');
  const upd = () => {
    const a = Number(amt.value) * 100;
    $('#ldAmtL').textContent = eur(a);
    const ok = USED + a <= LIMIT;
    out.className = 'k-msg ' + (ok ? 'ok' : 'err');
    out.textContent = ok ? `Freigegeben – danach verfügbar: ${eur(LIMIT - USED - a)}` : `Abgelehnt – Limit überschritten (verfügbar: ${eur(LIMIT - USED)})`;
  };
  amt.addEventListener('input', upd); upd();
  // Status vom Server (ehrlich: In Vorbereitung, solange kein Partner angeschlossen ist)
  $('#kApply').addEventListener('click', () => { $('#kApplyMsg').textContent = 'Noch nicht möglich – die LeaseRun Card ist in Vorbereitung. Es wurden keine Daten gespeichert.'; });
  try {
    const r = await fetch('/api/karten', { headers: { accept: 'application/json' } });
    const d = r.ok ? await r.json() : null;
    if (d && d.program === 'LIVE') { $('#kStatus').hidden = true; $('#kApply').removeAttribute('aria-disabled'); }
    if (d && d.program === 'SANDBOX') $('#kStatus').innerHTML = '<span class="k-dot"></span><span><strong>Testbetrieb.</strong> Es werden keine echten Karten ausgegeben.</span>';
  } catch { /* Hinweis bleibt stehen */ }
}

async function preise() {
  const meta = $('#pvMeta'), list = $('#pvList');
  let d;
  try { const r = await fetch('/api/karten/preise'); if (!r.ok) throw 0; d = await r.json(); if (!d || !Array.isArray(d.chapters)) throw 0; }
  catch { list.innerHTML = '<div class="k-empty"><strong>Das Preisverzeichnis konnte nicht geladen werden.</strong><span>Bitte laden Sie die Seite neu oder nutzen Sie den PDF-Download.</span><button class="k-btn ghost" type="button" id="pvRetry">Erneut versuchen</button></div>'; meta.hidden = true; $('#pvRetry').onclick = () => location.reload(); return; }
  const draft = d.status !== 'PUBLISHED';
  meta.innerHTML = `<div class="k-rows"><div><span>Dokument-ID</span><b>${esc(d.documentId)}</b></div><div><span>Version</span><b>${esc(d.version)}</b></div><div><span>Status</span><b>${draft ? '<span class="k-chip warn">Entwurf – noch nicht gültig</span>' : '<span class="k-chip ok">Veröffentlicht</span>'}</b></div><div><span>Gültig ab</span><b>${d.effectiveFrom ? new Date(d.effectiveFrom).toLocaleDateString('de-DE') : 'noch nicht festgelegt'}</b></div><div><span>Prüfsumme (SHA-256)</span><b class="k-mask" style="letter-spacing:0;font-size:12.5px;word-break:break-all">${esc(String(d.hash || "").slice(0, 32))}…</b></div></div>`;
  const prod = { all: 'Debit & Charge', debit: 'Debit', charge: 'Charge' };
  list.innerHTML = d.chapters.map((c) => `<details id="kap-${c.no}"${c.no <= 2 || location.hash === `#kap-${c.no}` ? ' open' : ''}><summary>${c.no}. ${esc(c.title)}</summary><div class="k-acc-in">${c.intro ? `<p>${esc(c.intro)}</p>` : ''}${c.items.length ? `<table class="k-ptable"><thead><tr><th>Leistung</th><th>Produkt</th><th style="text-align:right">Preis</th></tr></thead><tbody>${c.items.map((i) => `<tr><td>${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</td><td class="prod">${prod[i.product]}</td><td class="p${i.amount == null ? ' open' : ''}">${i.amount == null ? 'Noch nicht festgelegt' : esc(eur(i.amount)) + (i.unit ? `<small>${esc(i.unit)}</small>` : '')}</td></tr>`).join('')}</tbody></table>` : ''}</div></details>`).join('');
}

const page = document.body.dataset.page;
if (page === 'landing') landing();
else if (page === 'preise') preise();
