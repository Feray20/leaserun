// leaserun.com/kasse: Stripe-Zahlformular eingebettet in eine LeaseRun-Seite (Kopf, Bestellübersicht, Vertrauenshinweise).
// Daten (clientSecret, Übersicht) legt der Kaufknopf kurz in sessionStorage ab; ohne Daten → zurück zur Auswahl.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const eur = (c) => (Number(c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const root = $('#kasse');
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>';

function fail(msg, back = '/pricing') {
  root.innerHTML = `<div class="ks-card ks-center"><h1>Bezahlung nicht verfügbar</h1><p>${esc(msg)}</p><a class="btn btn-dark" href="${esc(back)}">Zurück zur Auswahl</a></div>`;
}

let stripeP = null;
function loadStripe() {
  if (stripeP) return stripeP;
  stripeP = new Promise((res, rej) => {
    if (window.Stripe) return res(window.Stripe);
    const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.async = true;
    s.onload = () => (window.Stripe ? res(window.Stripe) : rej(Error('Stripe nicht geladen')));
    s.onerror = () => rej(Error('Die Bezahlung konnte nicht geladen werden. Bitte Werbeblocker für diese Seite deaktivieren oder später erneut versuchen.'));
    document.head.append(s);
  });
  stripeP.catch(() => { stripeP = null; });
  return stripeP;
}
// Tempo: Stripe.js sofort laden, während die Seite aufgebaut wird.
loadStripe().catch(() => {});

// Zurück-Taste auf der Bezahlseite: direkt und sauber zur Auswahl zurück (ohne hängende Zwischenzustände
// des eingebetteten Zahlformulars). Die Bezahlsitzung bleibt bis zu 23 Stunden gültig.
function guardBack(back) {
  try {
    if (!history.state?.ksGuard) { history.replaceState({ ksBase: 1 }, ''); history.pushState({ ksGuard: 1 }, ''); }
    addEventListener('popstate', (e) => { if (!e.state?.ksGuard) location.replace(back); });
  } catch { /* ältere Browser: normales Zurück */ }
}
// Aus dem Zwischenspeicher wiederhergestellt (Vor/Zurück): neu aufbauen, das Zahlformular lässt sich nicht fortsetzen.
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

async function start() {
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem('lr-kasse') || 'null'); } catch { /* ignore */ }
  // Offene Bestellung auch nach Schließen des Tabs fortsetzbar (Stripe-Sitzung gilt bis zu 23 Stunden).
  if (!d) { try { d = JSON.parse(localStorage.getItem('lr-kasse-open') || 'null'); } catch { /* ignore */ } }
  else { try { localStorage.setItem('lr-kasse-open', JSON.stringify(d)); } catch { /* privat */ } }
  // Abbruch (Seite verlassen): Zeitpunkt merken – der Hinweis „Bestellung offen“ erscheint danach einmal und höchstens 4 Minuten.
  addEventListener('pagehide', () => { try { const o = JSON.parse(localStorage.getItem('lr-kasse-open') || 'null'); if (o) { o.left = Date.now(); localStorage.setItem('lr-kasse-open', JSON.stringify(o)); localStorage.removeItem('lr-kasse-hint-seen'); } } catch { /* privat */ } });
  if (!d || !d.clientSecret || !d.publishableKey || Date.now() - (d.at || 0) > 23 * 3600_000) { try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } return fail('Die Bezahlsitzung ist abgelaufen oder wurde schon abgeschlossen. Bitte das Angebot erneut auswählen.', d?.summary?.back || '/pricing'); }
  const s = d.summary || {}, b2b = s.area === 'b2b', setup = s.kind === 'setup';
  guardBack(s.back || '/pricing');
  if (setup) document.title = 'Zahlungsmittel ändern | LeaseRun';
  // Zahlungsmittel ändern (keine Bestellung): eigene Übersicht, nichts wird berechnet.
  const steps = setup ? '' : `<ol class="ks-steps" aria-label="Fortschritt"><li class="done">Auswahl</li><li class="on">Bezahlen</li><li>${b2b ? 'Im Portal nutzen' : 'Sofort nutzen'}</li></ol>`;
  document.querySelector('.ks-main')?.insertAdjacentHTML('afterbegin', `<div class="ks-in ks-hero">${steps}<p class="ks-hero-t">${setup ? 'Zahlungsmittel sicher ändern' : 'Nur noch ein Schritt – sicher bezahlen'}</p></div>`);
  root.innerHTML = setup ? `<aside class="ks-card ks-sum"><p class="ks-kick">${b2b ? 'Unternehmenskonto' : 'Ihr Konto'}</p><h1>Zahlungsmittel ändern</h1>
      <p class="ks-tax">Hinterlegen Sie ein neues Zahlungsmittel. Es wird sofort Ihr Standard für künftige Rechnungen${b2b ? ' und Ihr Abo' : ' und ein laufendes Abo'}. Jetzt wird nichts berechnet.</p>
      <ul class="ks-trust"><li>${CHECK}Verschlüsselt über Stripe – LeaseRun sieht keine Kartendaten</li><li>${CHECK}Gilt sofort für alle künftigen Zahlungen</li><li>${CHECK}Rechnungen weiterhin im Konto und per E-Mail</li></ul>
      <a class="ks-back" href="${esc(s.back || '/')}" data-ksback>← Zurück zum Konto</a></aside>
    <section class="ks-card ks-pay" aria-label="Zahlungsmittel"><div id="ksPay"><div class="lr-ld" role="status">Formular wird geladen …</div></div></section>` : `<aside class="ks-card ks-sum"><p class="ks-kick">Ihre Bestellung</p><h1>${esc(s.title || 'LeaseRun')}</h1>
      <ul class="ks-lines">${(s.lines || []).map((l) => `<li><span>${esc(l.label)}</span><strong>${eur(l.amount)}</strong></li>`).join('')}</ul>
      ${s.total != null ? `<div class="ks-total"><span>Gesamt${s.interval ? ` <small>${esc(s.interval)}</small>` : ''}</span><strong>${eur(s.total)}</strong></div><p class="ks-tax">${b2b ? 'inkl. 19 % USt auf den Nettopreis' : 'inkl. 19 % USt'} · Gutscheincode im Zahlformular einlösbar</p>` : ''}
      <ul class="ks-trust"><li>${CHECK}Verschlüsselte Zahlung über Stripe</li><li>${CHECK}Rechnung automatisch per E-Mail</li><li>${CHECK}${b2b ? 'Abo jederzeit im Portal verwalten' : 'Sofortiger Zugang nach der Zahlung'}</li></ul>
      <p class="ks-help">Fragen zur Bestellung? <a href="mailto:support@leaserun.com">support@leaserun.com</a> – wir helfen gern.</p>
      <a class="ks-back" href="${esc(s.back || '/pricing')}" data-ksback>← Zurück zur Auswahl</a></aside>
    <section class="ks-card ks-pay" aria-label="Zahlung"><div id="ksPay"><div class="lr-ld" role="status">Zahlformular wird geladen …</div></div></section>`;
  // „Zurück zur Auswahl“ ersetzt den Verlaufseintrag – so landet ein späteres Zurück nicht wieder auf der Kasse.
  root.querySelector('[data-ksback]')?.addEventListener('click', (e) => { e.preventDefault(); location.replace(s.back || '/pricing'); });
  try {
    const Stripe = await loadStripe();
    const stripe = Stripe(d.publishableKey, { locale: 'de' });
    const opts = { fetchClientSecret: async () => d.clientSecret, onComplete: () => { try { sessionStorage.removeItem('lr-kasse'); localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } } };
    // Neuere Stripe.js: createEmbeddedCheckoutPage (für ui_mode „embedded_page“), ältere: initEmbeddedCheckout.
    const co = stripe.createEmbeddedCheckoutPage ? await stripe.createEmbeddedCheckoutPage(opts) : await stripe.initEmbeddedCheckout(opts);
    $('#ksPay').innerHTML = '';
    co.mount('#ksPay');
  } catch (e) {
    try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ }
    $('#ksPay').innerHTML = `<div class="ks-err"><p>${esc(e.message || 'Das Zahlformular konnte nicht geladen werden.')}</p><a class="btn btn-dark" href="${esc(s.back || '/pricing')}">Zurück</a></div>`;
  }
}
start();
