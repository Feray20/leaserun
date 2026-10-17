// „Jetzt buchen“: Kauf-Dialog mit Produkt, Preis, Zustimmung (§ 356 Abs. 4/5 BGB) und Zahlarten – danach direkt
// zur sicheren Bezahlseite (Stripe Checkout mit Karte, PayPal, Apple Pay, Google Pay, Klarna, SEPA).
// Nicht angemeldet: Kaufwunsch wird 30 Minuten gemerkt; nach der Anmeldung geht es automatisch weiter zur Bezahlung.
const SESSION = 'immoadv-auth-session-v1';
const INTENT = 'ia-buy-intent';
const TTL = 30 * 60 * 1000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

// Zahlarten-Leiste (Akzeptanzhinweise als Schriftzüge – welche angezeigt werden, steuert das Stripe-Konto).
// Farbige Symbole je Angebot (Kreditmappe, Käufer-Pass, Investor Pro) für Angebotskarten und Kaufdialog.
const IC = {
  'credit-map': ['#0369A1', '#E0F2FE', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>'],
  'buyer-pass': ['#047857', '#D1FAE5', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><circle cx="12" cy="14" r="2"/><path d="M12 16v2"/>'],
  'pro-monthly': ['#6D28D9', '#EDE9FE', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
};
export const planIcon = (id) => { const i = IC[id] || ['#0F2C59', '#E2E8F0', '<circle cx="12" cy="12" r="8"/>']; return `<span class="offer-ic" style="--ic:${i[0]};--icbg:${i[1]}" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${i[2]}</svg></span>`; };
export const PAY_BADGES = `<div class="pay-badges" aria-label="Zahlarten"><span class="pb pb-card">Kredit-/Debitkarte</span><span class="pb pb-paypal"><b>Pay</b><i>Pal</i></span><span class="pb pb-apple">Apple&nbsp;Pay</span><span class="pb pb-google">Google&nbsp;Pay</span><span class="pb pb-klarna">Klarna</span><span class="pb pb-sepa">SEPA-Lastschrift</span></div>`;

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

// Bezahlseite öffnen (angemeldet). Liefert eine Fehlermeldung oder leitet weiter.
export async function goCheckout(plan) {
  const t = token();
  if (!t) return 'login';
  const o = overlay('Sichere Bezahlseite wird geöffnet …');
  try { window.iaTrack?.('checkout_start', { plan }); } catch { /* ignore */ }
  try {
    const r = await fetch('/api/billing/checkout', { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ plan, consent: true }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { o.remove(); return 'login'; }
    if (!r.ok || !j.url) throw Error(j.error || 'Die Bezahlseite konnte nicht geöffnet werden.');
    location.href = j.url;
    return null;
  } catch (e) { o.remove(); return e.message; }
}

// Kauf-Dialog. offer = { id, name, cents, intervall, features }
export async function openBuy(offer, opts = {}) {
  const cfg = await config();
  try { window.iaTrack?.('checkout_open', { plan: offer.id }); } catch { /* ignore */ }
  let d = document.getElementById('buyDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'buyDlg'; d.className = 'buy-dlg'; document.body.append(d); }
  const loggedIn = Boolean(token());
  const sub = /monat/i.test(offer.intervall || '');
  d.innerHTML = `<form method="dialog" class="buy-in">
    <div class="buy-head">${IC[offer.id] ? planIcon(offer.id) : '<img src="/logo-icon.svg" alt="" width="34" height="29">'}<div><span class="buy-kick">ImmoAdv · Bestellung</span><h2>${esc(offer.name)}</h2></div><button class="buy-x" value="x" aria-label="Schließen">×</button></div>
    <div class="buy-price"><strong>${eur(offer.cents)}</strong><span>${esc(offer.intervall || '')}</span></div>
    <p class="buy-tax">inkl. 19&nbsp;% USt.${sub ? ' · monatlich kündbar' : ''}</p>
    ${offer.features?.length ? `<ul class="buy-feat">${offer.features.slice(0, 5).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${cfg.enabled ? `
    ${cfg.testMode ? '<p class="buy-test">Testmodus – es wird nichts berechnet. Testkarte 4242 4242 4242 4242, beliebiges Ablaufdatum in der Zukunft, beliebige Prüfziffer.</p>' : ''}
    <label class="consent buy-consent"><input type="checkbox" id="buyOk"> <span>Ich verlange ausdrücklich, dass ImmoAdv vor Ablauf der Widerrufsfrist mit der Leistung beginnt. Mir ist bekannt, dass mein Widerrufsrecht bei digitalen Inhalten damit erlischt und ich bei einem Widerruf eines Abos Wertersatz für bereits erbrachte Leistungen schulde.</span></label>
    <p class="buy-legal">Es gelten die <a href="/nutzungsbedingungen" target="_blank" rel="noopener">Nutzungsbedingungen</a> mit <a href="/nutzungsbedingungen#widerruf" target="_blank" rel="noopener">Widerrufsbelehrung</a>. Den kostenpflichtigen Kauf schließen Sie auf der folgenden Bezahlseite ab.</p>
    <button class="btn btn-pay buy-go" type="button" id="buyGo"><svg class="pay-lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>${loggedIn ? 'Weiter zur sicheren Bezahlung' : 'Anmelden und weiter zur Bezahlung'} <span aria-hidden="true">→</span></button>
    ${loggedIn ? '' : '<p class="buy-note">Ihr Kauf wird Ihrem ImmoAdv-Konto zugeordnet. Noch kein Konto? Auf der nächsten Seite in einer Minute kostenlos anlegen – danach geht es direkt weiter zur Bezahlung.</p>'}
    <p class="buy-msg" id="buyMsg" role="alert"></p>` : `
    <p class="buy-soon"><strong>Buchung startet in Kürze.</strong> Die Zahlungsabwicklung wird gerade freigeschaltet. Bis dahin können Sie alles kostenlos ausprobieren.</p>
    <a class="btn btn-dark buy-go" href="/auth/register">Kostenlos starten</a>`}
    ${PAY_BADGES}
    <p class="buy-secure"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg> SSL-verschlüsselt · Zahlungsdaten gehen direkt an Stripe (PCI-DSS Level 1), ImmoAdv sieht keine Karten- oder Kontodaten.</p>
  </form>`;
  const go = d.querySelector('#buyGo');
  if (go) go.onclick = async () => {
    const ok = d.querySelector('#buyOk');
    if (!ok.checked) { ok.closest('label').classList.add('consent-missing'); d.querySelector('#buyMsg').textContent = 'Bitte zuerst der sofortigen Bereitstellung zustimmen.'; ok.focus(); return; }
    go.disabled = true;
    if (!token()) {
      try { localStorage.setItem(INTENT, JSON.stringify({ plan: offer.id, name: offer.name, consentAt: new Date().toISOString(), at: Date.now() })); } catch { /* ignore */ }
      location.href = '/auth/login';
      return;
    }
    d.close();
    const err = await goCheckout(offer.id);
    if (err === 'login') { try { localStorage.setItem(INTENT, JSON.stringify({ plan: offer.id, name: offer.name, consentAt: new Date().toISOString(), at: Date.now() })); } catch { /* ignore */ } location.href = '/auth/login'; return; }
    if (err) { (opts.onError || alert)(err); }
  };
  d.querySelector('#buyOk')?.addEventListener('change', (e) => { if (e.target.checked) { e.target.closest('label').classList.remove('consent-missing'); d.querySelector('#buyMsg').textContent = ''; } });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
}

// Nach der Anmeldung: gemerkten Kaufwunsch fortsetzen (nur mit erteilter Zustimmung, höchstens 30 Minuten alt).
export async function resumeIntent(onError) {
  const x = peekIntent();
  if (!x || !token()) return false;
  const cfg = await config();
  if (!cfg.enabled) { takeIntent(); return false; }
  takeIntent();
  const err = await goCheckout(x.plan);
  if (err && err !== 'login') (onError || alert)(err);
  return !err;
}
