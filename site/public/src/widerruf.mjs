// Widerrufsfunktion nach § 356a BGB: dauerhaft erreichbar, ohne Anmeldung, zwei Schritte
// (1. „Vertrag widerrufen“ → Angaben, 2. „Widerruf bestätigen“), Eingangsbestätigung per E-Mail mit Inhalt und Zeitpunkt.
const root = document.getElementById('wdr');
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ts = Date.now();
const CONTRACTS = ['BankReady Kreditmappe (Einmalkauf)', 'Käufer-Pass', 'Investor Pro (Abo)', 'Früherer Tarif (Einsteiger, Profi)', 'Sonstiger Vertrag'];
let data = { name: '', email: '', contract: CONTRACTS[0], ref: '', date: '' };

function step1() {
  root.innerHTML = `<form id="wdrF" class="cancel-form" novalidate><h2>Widerrufserklärung – Schritt 1 von 2</h2>
    <p class="form-note">Als Verbraucherin oder Verbraucher können Sie einen bei LeaseRun online geschlossenen Vertrag innerhalb der Widerrufsfrist hier widerrufen. Ein Grund ist nicht nötig.</p>
    <label>Vor- und Nachname<input name="name" required autocomplete="name" value="${esc(data.name)}"></label>
    <label>E-Mail-Adresse (für die Eingangsbestätigung)<input name="email" type="email" required autocomplete="email" value="${esc(data.email)}"></label>
    <label>Vertrag<select name="contract">${CONTRACTS.map((c) => `<option${c === data.contract ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label>Rechnungs- oder Bestellnummer (falls zur Hand)<input name="ref" maxlength="80" value="${esc(data.ref)}"></label>
    <label>Bestellt am (falls bekannt)<input name="date" type="date" value="${esc(data.date)}"></label>
    <div class="pp-hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <p class="form-note" id="wdrMsg" role="alert"></p>
    <button class="btn btn-dark btn-lg" type="submit">Weiter zur Bestätigung</button>
    <p class="form-note">Alternativ können Sie formlos per E-Mail an <a href="mailto:support@leaserun.com">support@leaserun.com</a> oder per Brief widerrufen. Für Kündigungen von Abos: <a href="/cancel">Verträge hier kündigen</a>.</p></form>`;
  const f = root.querySelector('#wdrF');
  f.onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    if (String(d.name).trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(d.email).trim())) { root.querySelector('#wdrMsg').textContent = 'Bitte Name und eine gültige E-Mail-Adresse angeben.'; return; }
    data = { ...data, ...d, name: String(d.name).trim(), email: String(d.email).trim() };
    step2();
  };
}

function step2() {
  root.innerHTML = `<div class="cancel-form"><h2>Widerruf bestätigen – Schritt 2 von 2</h2>
    <p>Hiermit widerrufe ich den von mir abgeschlossenen Vertrag:</p>
    <dl class="wdr-sum"><dt>Name</dt><dd>${esc(data.name)}</dd><dt>E-Mail</dt><dd>${esc(data.email)}</dd><dt>Vertrag</dt><dd>${esc(data.contract)}</dd>${data.ref ? `<dt>Rechnungs-/Bestellnummer</dt><dd>${esc(data.ref)}</dd>` : ''}${data.date ? `<dt>Bestellt am</dt><dd>${esc(new Date(data.date).toLocaleDateString('de-DE'))}</dd>` : ''}</dl>
    <p class="form-note" id="wdrMsg" role="alert"></p>
    <div class="pt-row"><button class="btn btn-dark btn-lg" type="button" id="wdrGo">Widerruf bestätigen</button><button class="btn btn-ghost" type="button" id="wdrBack">Angaben ändern</button></div></div>`;
  root.querySelector('#wdrBack').onclick = step1;
  root.querySelector('#wdrGo').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const r = await fetch('/api/widerruf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...data, ts }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Error(j.error || 'Der Widerruf konnte nicht übermittelt werden.');
      root.innerHTML = `<div class="cancel-form"><h2>Widerruf eingegangen</h2><p>Eingang: <strong>${esc(j.receivedAt)}</strong></p>
        <dl class="wdr-sum"><dt>Name</dt><dd>${esc(data.name)}</dd><dt>Vertrag</dt><dd>${esc(data.contract)}</dd>${data.ref ? `<dt>Nummer</dt><dd>${esc(data.ref)}</dd>` : ''}</dl>
        <p>Eine Eingangsbestätigung mit Inhalt und Zeitpunkt Ihres Widerrufs haben wir an <strong>${esc(data.email)}</strong> gesendet. Steht Ihnen ein Widerrufsrecht zu, erstatten wir bereits gezahlte Beträge nach den gesetzlichen Regeln binnen 14 Tagen über das ursprüngliche Zahlungsmittel.</p>
        <button class="btn btn-ghost" type="button" id="wdrPrint">Bestätigung drucken</button></div>`;
      root.querySelector('#wdrPrint').onclick = () => print();
    } catch (err) { root.querySelector('#wdrMsg').textContent = err.message; b.disabled = false; }
  };
}

if (root) step1();
