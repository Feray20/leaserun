// „Jetzt buchen“: Kauf-Dialog mit Produkt, Preis, Zustimmung (§ 356 Abs. 4/5 BGB) und Zahlarten – danach direkt
// zur sicheren Bezahlseite (Stripe Checkout; Zahlarten steuert Stripe).
// Nicht angemeldet: Kaufwunsch wird 30 Minuten gemerkt; nach der Anmeldung geht es automatisch weiter zur Bezahlung.
const SESSION = 'leaserun-auth-session-v1';
const INTENT = 'lr-buy-intent';
const TTL = 30 * 60 * 1000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

// Zahlarten-Leiste (Akzeptanzhinweise als Schriftzüge – welche angezeigt werden, steuert das Stripe-Konto).
// Farbige Symbole je Angebot (Kreditmappe, Käufer-Pass, Investor Pro) für Angebotskarten und Kaufdialog.
const IC = {
  'credit-map': ['#0369A1', '#E0F2FE', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>'],
  'buyer-pass': ['#047857', '#D1FAE5', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><circle cx="12" cy="14" r="2"/><path d="M12 16v2"/>'],
  'pro-monthly': ['#0F2C59', '#E2E8F0', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
};
export const planIcon = (id) => { const i = IC[id] || ['#0F2C59', '#E2E8F0', '<circle cx="12" cy="12" r="8"/>']; return `<span class="offer-ic" style="--ic:${i[0]};--icbg:${i[1]}" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${i[2]}</svg></span>`; };

const token = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null')?.access_token || ''; } catch { return ''; } };
export function takeIntent() {
  try {
    const x = JSON.parse(localStorage.getItem(INTENT) || 'null');
    localStorage.removeItem(INTENT);
    return x && Date.now() - x.at < TTL ? x : null;
  } catch { return null; }
}
export function peekIntent() {
  try { const x = JSON.parse(localStorage.getItem(INTENT) || 'null'); return x && Date.now() - x.at < TTL ? x : null; } catch { return null; }
}

let cfgP = null;
const config = () => (cfgP ||= fetch('/api/billing/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false })));

// Ladeanzeige über der Seite, während die Bezahlseite vorbereitet wird.
function overlay(text) {
  let o = document.getElementById('buyOverlay');
  if (!o) { o = document.createElement('div'); o.id = 'buyOverlay'; o.className = 'buy-overlay'; o.setAttribute('role', 'status'); document.body.append(o); }
  o.innerHTML = `<div class="buy-ov-box"><span class="buy-spin" aria-hidden="true"></span><strong>${esc(text)}</strong><small>Verschlüsselte Verbindung · Zahlungsabwicklung über Stripe</small></div>`;
  return o;
}

// Zurück von der Bezahlseite (ohne zu zahlen): Der Browser stellt die Seite aus dem Zwischenspeicher wieder her –
// samt Ladeanzeige und gesperrtem Knopf. Dann alles zurücksetzen, damit die Seite sofort wieder bedienbar ist.
function resetAfterBack() {
  document.getElementById('buyOverlay')?.remove();
  const d = document.getElementById('buyDlg'); if (d?.open) { try { d.close(); } catch { d.removeAttribute('open'); } }
  document.querySelectorAll('#buyGo, .btn-pay[disabled], [data-plan][disabled]').forEach((b) => { b.disabled = false; b.classList.remove('is-busy'); });
  document.documentElement.classList.remove('buy-busy');
}
addEventListener('pageshow', (e) => {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (e.persisted || nav?.type === 'back_forward') resetAfterBack();
});

// Bezahlseite öffnen (angemeldet). Liefert eine Fehlermeldung oder leitet weiter.
export async function goCheckout(plan, addon = null, reviewOk = false) {
  const t = token();
  if (!t) return 'login';
  const o = overlay('Sichere Bezahlseite wird geöffnet …');
  try { window.iaTrack?.('checkout_start', { plan }); } catch { /* ignore */ }
  try {
    // Nie endlos warten: nach 30 s abbrechen und eine verständliche Meldung zeigen.
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 30000);
    const r = await fetch('/api/billing/checkout', { method: 'POST', signal: ac.signal, headers: { Authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ plan, consent: true, embedded: true, back: (location.pathname + location.hash).slice(0, 200), ...(addon ? { addon } : {}), ...(reviewOk ? { reviewOk: true } : {}) }) }).finally(() => clearTimeout(tm));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { o.remove(); return 'login'; }
    if (r.ok && j.clientSecret) { sessionStorage.setItem('lr-kasse', JSON.stringify({ ...j, at: Date.now() })); location.href = '/checkout'; return null; }
    if (!r.ok || !j.url) throw Error(j.error || 'Die Bezahlseite konnte nicht geöffnet werden.');
    location.href = j.url;
    // Falls der Browser die Weiterleitung blockiert (z. B. Inhaltsblocker): nach 8 s einen Link zum Antippen anbieten.
    setTimeout(() => { if (!document.hidden && document.body.contains(o)) { const box = o.querySelector('.buy-ov-box'); if (box && !box.querySelector('a')) box.insertAdjacentHTML('beforeend', `<a class="btn btn-dark" href="${esc(j.url)}">Bezahlseite öffnen</a><button type="button" class="btn btn-ghost" data-ovx>Abbrechen</button>`); box?.querySelector('[data-ovx]')?.addEventListener('click', () => o.remove()); } }, 8000);
    return null;
  } catch (e) { o.remove(); return e.name === 'AbortError' ? 'Die Bezahlseite antwortet gerade nicht. Bitte in einer Minute erneut versuchen.' : (e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'Keine Verbindung. Bitte Internetverbindung prüfen und erneut versuchen.' : e.message); }
}

// Zusatzprodukt (aus preise.json) – wird nie vorausgewählt.
let ADDON = null;
fetch('/data/preise.json').then((r) => r.json()).then((P) => { ADDON = (P?.privat?.addons || []).find((a) => a.id === 'leitfaden') || null; }).catch(() => {});

// Zinskosten in 10 Jahren für ein Annuitätendarlehen (2 % Anfangstilgung).
function interest10(loan, z, t = 0.02) { const rate = (loan * (z + t)) / 12; let s = loan, sum = 0; for (let m = 0; m < 120 && s > 0; m++) { const i = (s * z) / 12; sum += i; s -= rate - i; } return sum; }
const roundTo = (x, k = 100) => Math.round(x / k) * k;

// Entscheidungshilfe im Kaufdialog – nur mit echten Zahlen: aus dem Konto des Kunden (ctx) oder klar als Beispiel gekennzeichnet.
// ctx = { loan, ratePct, gaps: [..], finPct, mappePct }
function insights(offer, ctx = {}) {
  const loan = Number(ctx.loan) || 0, z = (Number(ctx.ratePct) || 3.6) / 100;
  const own = loan > 0;
  const L = own ? loan : 300000;
  const diff = roundTo(interest10(L, z + 0.002) - interest10(L, z));
  const anchor = `<p class="buy-anchor"><b>${own ? 'Für Ihr Darlehen' : 'Beispiel'}:</b> ${own ? '' : `${eur(L * 100).replace(',00', '')} Darlehen, `}schon 0,2 Prozentpunkte schlechterer Zins kosten in 10 Jahren rund <b>${eur(diff * 100).replace(',00', '')}</b> mehr Zinsen. Eine vollständige, bankfertige Mappe hilft, Konditionen zu vergleichen und nachzuverhandeln – für einmalig ${eur(offer.cents)}.</p>`;
  const gaps = Array.isArray(ctx.gaps) ? ctx.gaps.filter(Boolean) : [];
  const gapBox = gaps.length ? `<p class="buy-gaps"><b>Ihr Fall hat ${gaps.length} offene ${gaps.length === 1 ? 'Angabe' : 'Angaben'}, die Banken typischerweise nachfordern:</b> ${gaps.slice(0, 4).map(esc).join(', ')}${gaps.length > 4 ? ' …' : ''}. Sie können diese auch nach dem Kauf noch ergänzen.</p>` : '';
  const fin = Number.isFinite(ctx.finPct) ? Math.round(ctx.finPct) : null, mappe = Number.isFinite(ctx.mappePct) ? Math.round(ctx.mappePct) : null;
  const steps = fin == null && mappe == null ? '' : `<ol class="buy-steps"><li class="${fin >= 100 ? 'done' : ''}"><span>Finanzdaten</span><b>${fin ?? '–'} %</b></li><li class="${mappe >= 100 ? 'done' : ''}"><span>Mappe vollständig</span><b>${mappe ?? '–'} %</b></li><li class="on"><span>Download freischalten</span><b>jetzt</b></li></ol>`;
  return steps + anchor + gapBox;
}

// Kauf-Dialog. offer = { id, name, cents, intervall, features }
// Eigene Styles des Kaufdialogs laden (auch auf Seiten, deren Stylesheet-Bündel sie nicht enthält, z. B. Startseite).
let cssReady = null;
function buyCss() {
  if (cssReady) return cssReady;
  if ([...document.styleSheets].some((s) => /\/buy\.css/.test(s.href || ''))) return (cssReady = Promise.resolve());
  cssReady = new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./buy.css' + new URL(import.meta.url).search, import.meta.url).href;
    l.onload = l.onerror = () => res(); document.head.append(l); setTimeout(res, 2500);
  });
  return cssReady;
}
buyCss();

export async function openBuy(offer, opts = {}) {
  const [cfg] = await Promise.all([config(), buyCss()]);
  try { window.iaTrack?.('checkout_open', { plan: offer.id }); } catch { /* ignore */ }
  let d = document.getElementById('buyDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'buyDlg'; d.className = 'buy-dlg'; document.body.append(d); }
  const loggedIn = Boolean(token());
  const sub = /monat/i.test(offer.intervall || '');
  d.innerHTML = `<form method="dialog" class="buy-in">
    <div class="buy-head">${IC[offer.id] ? planIcon(offer.id) : '<img src="/logo-icon.svg" alt="" width="34" height="29">'}<div><span class="buy-kick">LeaseRun · Bestellung</span><h2>${esc(offer.name)}</h2></div><button class="buy-x" value="x" aria-label="Schließen">×</button></div>
    <div class="buy-price"><strong id="buyTotal">${eur(offer.cents)}</strong><span>${esc(offer.intervall || '')}</span></div>
    <p class="buy-tax">inkl. 19&nbsp;% USt.${sub ? ' · monatlich kündbar' : ''}</p>
    ${offer.features?.length ? `<ul class="buy-feat">${offer.basis ? `<li class="offer-basis">${esc(offer.basis)}</li>` : ''}${offer.features.slice(0, offer.basis ? 2 : 3).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${cfg.enabled ? `
    ${/credit-map|buyer-pass/.test(offer.id) ? `<details class="buy-why"><summary>Warum sich das lohnt</summary>${insights(offer, opts.ctx)}</details>` : ''}
    ${/credit-map|buyer-pass/.test(offer.id) && ADDON ? `<label class="buy-bump"><input type="checkbox" id="buyAddon"> <span><strong>${esc(ADDON.name)} hinzufügen · + ${eur(ADDON.cents)}</strong><small>${esc(ADDON.beschreibung || '')}</small></span></label>` : ''}
    ${cfg.testMode ? '<p class="buy-test">Testmodus – es wird nichts berechnet. Testkarte 4242 4242 4242 4242, beliebiges Ablaufdatum in der Zukunft, beliebige Prüfziffer.</p>' : ''}
    <label class="consent buy-consent"><input type="checkbox" id="buyOk"> <span>${sub
      ? 'Ich verlange, dass LeaseRun vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass ich bei einem Widerruf für die bis dahin erbrachte Leistung anteilig Wertersatz zahle.'
      : offer.id === 'buyer-pass'
        ? 'Ich verlange, dass LeaseRun vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass mein Widerrufsrecht für die enthaltene Kreditmappe mit deren Bereitstellung erlischt und ich bei einem Widerruf des Zugangs anteilig Wertersatz zahle.'
        : 'Ich stimme ausdrücklich zu, dass LeaseRun vor Ablauf der Widerrufsfrist mit der Bereitstellung beginnt. Mir ist bekannt, dass ich dadurch mein Widerrufsrecht verliere.'}</span></label>
    <button class="btn btn-pay buy-go" type="button" id="buyGo"><svg class="pay-lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>${loggedIn ? 'Weiter zur sicheren Bezahlung' : 'Anmelden und weiter zur Bezahlung'} <span aria-hidden="true">→</span></button>
    <p class="buy-legal">Es gelten die <a href="/terms" target="_blank" rel="noopener">AGB</a> mit <a href="/terms#widerruf" target="_blank" rel="noopener">Widerrufsbelehrung</a>.${/credit-map|buyer-pass/.test(offer.id) ? ' <a href="/terms#garantie" target="_blank" rel="noopener">Geld zurück</a>, wenn Ihre Bank das Format ablehnt.' : ''}</p>
    <label class="chk buy-rvok"><input type="checkbox" id="buyReview"> <span>Später einmal per E-Mail um eine kurze Bewertung bitten (freiwillig).</span></label>
    ${loggedIn ? '' : '<p class="buy-note">Noch kein Konto? Wird im nächsten Schritt in einer Minute angelegt.</p>'}
    <p class="buy-msg" id="buyMsg" role="alert"></p>` : `
    <p class="buy-soon"><strong>Buchung startet in Kürze.</strong> Die Zahlungsabwicklung wird gerade freigeschaltet. Bis dahin können Sie alles kostenlos ausprobieren.</p>
    <a class="btn btn-dark buy-go" href="/auth/register">Kostenlos starten</a>`}
    <p class="buy-secure"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg> SSL-verschlüsselt · Zahlung sicher über Stripe</p>
  </form>`;
  const go = d.querySelector('#buyGo');
  if (go) go.onclick = async () => {
    const ok = d.querySelector('#buyOk');
    if (!ok.checked) { ok.closest('label').classList.add('consent-missing'); d.querySelector('#buyMsg').textContent = 'Bitte zuerst der sofortigen Bereitstellung zustimmen.'; ok.focus(); return; }
    go.disabled = true;
    if (!token()) {
      try { localStorage.setItem(INTENT, JSON.stringify({ plan: offer.id, name: offer.name, addon: d.querySelector('#buyAddon')?.checked ? 'leitfaden' : null, reviewOk: Boolean(d.querySelector('#buyReview')?.checked), consentAt: new Date().toISOString(), at: Date.now() })); } catch { /* ignore */ }
      location.href = '/auth/login';
      return;
    }
    const addon = d.querySelector('#buyAddon')?.checked ? 'leitfaden' : null;
    const reviewOk = Boolean(d.querySelector('#buyReview')?.checked);
    // Den Verlaufseintrag des Dialogs zuerst sauber entfernen und erst dann zur Kasse wechseln – sonst kann ein
    // verspätetes history.back() (v. a. Safari/iPad) die Weiterleitung abbrechen oder „Zurück“ landet im Nichts.
    d._leaving = true;
    if (history.state && history.state.iaBuy) await new Promise((ok) => { const t = setTimeout(ok, 450); addEventListener('popstate', () => { clearTimeout(t); ok(); }, { once: true }); history.back(); });
    d.close();
    const err = await goCheckout(offer.id, addon, reviewOk);
    if (err === 'login') { try { localStorage.setItem(INTENT, JSON.stringify({ plan: offer.id, name: offer.name, addon: d.querySelector('#buyAddon')?.checked ? 'leitfaden' : null, reviewOk: Boolean(d.querySelector('#buyReview')?.checked), consentAt: new Date().toISOString(), at: Date.now() })); } catch { /* ignore */ } location.href = '/auth/login'; return; }
    if (err) { (opts.onError || alert)(err); }
  };
  d.querySelector('#buyAddon')?.addEventListener('change', (e) => { const t = d.querySelector('#buyTotal'); if (t) t.textContent = eur(offer.cents + (e.target.checked ? ADDON.cents : 0)); });
  d.querySelector('#buyOk')?.addEventListener('change', (e) => { if (e.target.checked) { e.target.closest('label').classList.remove('consent-missing'); d.querySelector('#buyMsg').textContent = ''; } });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  // Zurück-Taste schließt den Dialog statt die Seite zu verlassen.
  try {
    history.pushState({ iaBuy: 1 }, '', location.href);
    const pop = () => { removeEventListener('popstate', pop); if (d.open && !d._leaving) d.close(); };
    addEventListener('popstate', pop);
    d.addEventListener('close', () => { removeEventListener('popstate', pop); if (!d._leaving && history.state && history.state.iaBuy) history.back(); d._leaving = false; }, { once: true });
  } catch { /* ignore */ }
}

// Nach der Anmeldung: gemerkten Kaufwunsch fortsetzen (nur mit erteilter Zustimmung, höchstens 30 Minuten alt).
export async function resumeIntent(onError) {
  const x = peekIntent();
  if (!x || !token()) return false;
  const cfg = await config();
  if (!cfg.enabled) { takeIntent(); return false; }
  takeIntent();
  const err = await goCheckout(x.plan, x.addon || null, Boolean(x.reviewOk));
  if (err && err !== 'login') (onError || alert)(err);
  return !err;
}
