// Objekt- & Dokumenten-Import mit Metrics Engine und Objekt-Analyse – gemeinsam genutzt von Anwendung und internem Bereich.
// Es gibt keine Immobiliensuche: Objekte kommen per Exposé-PDF (Dropzone), Link, Ein-Klick-Übernahme im eigenen
// Browser oder Eingabe. Große Portale werden nicht automatisiert abgerufen (deren Nutzungsbedingungen).
import { GREST, kaufnebenkosten, analyse, exposeMetrics } from './calc.mjs?v=892f3666';
import { parseListing, bookmarklet } from './listing-parse.mjs?v=892f3666';
import { work } from './loader.mjs?v=892f3666';
import { showPdf } from './pdf-view.mjs?v=892f3666';

const SESSION = 'leaserun-auth-session-v1';
const $ = (id) => document.getElementById(id);
let root = null;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (x) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
const E2 = (x) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const P = (x, d = 2) => (x == null || Number.isNaN(x) ? '–' : `${x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const D = (x, d = 2) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }));
const num = (id) => { const v = $(id)?.value; return v === '' || v == null ? 0 : Number(v); };
const val = (id) => $(id)?.value || '';
const table = (rows) => `<table class="bill-table"><tbody>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table>`;
const tone = (v, good, warn) => (v == null ? 'na' : v >= good ? 'ok' : v >= warn ? 'warn' : 'bad');

// Angemeldet: Startwerte aus dem eigenen Finanzprofil statt Beispielzahlen (gesetzt in mountObjekt).
let PROF = {};
const pv = (v) => (Number(v) > 0 ? Number(v) : '');
const landOpts = () => { const sel = GREST[PROF.land] ? PROF.land : 'hessen'; return Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${g.name}</option>`).join(''); };
const F = (id, label, value = '', step = 'any', type = 'number') => `<label>${label}<input id="${id}" type="${type}" ${type === 'number' ? `step="${step}" min="0"` : ''} value="${esc(value)}"></label>`;

function renderImport() {
  return `<section class="ox" aria-label="Objekt- und Dokumenten-Import">
  <div class="ox-grid">
    <label class="ox-drop" id="ox_drop" tabindex="0"><input id="imp_pdf" type="file" accept="application/pdf" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5"/></svg>
      <strong>Exposé-PDF hierher ziehen</strong><span>oder antippen, um eine Datei zu wählen · bis 40 MB · die Datei bleibt auf Ihrem Gerät</span></label>
    <form class="ox-link" id="ox_link"><label for="ox_url"><strong>Link zum Exposé</strong><span>Exposé-PDF oder Seite eines Anbieters (https://…)</span></label>
      <div class="ox-row"><input id="ox_url" type="url" inputmode="url" placeholder="https://…" autocomplete="off"><button class="btn btn-dark" type="submit">Übernehmen</button></div>
      <p class="form-note">ImmoScout24- und Immowelt-Links werden aus rechtlichen Gründen nicht automatisch abgerufen. Dafür: Ein-Klick-Übernahme unten oder im Portal „Exposé als PDF“ speichern und hier hochladen.</p></form>
  </div>
  <p class="imp-msg" id="imp_msg" role="status" aria-live="polite"></p>
  <details class="ox-more"><summary>Weitere Wege: Ein-Klick-Übernahme oder Text einfügen</summary>
  ${''}<article class="imp-card" id="imp">
    <div class="imp-head"><div><h3>Ein-Klick-Übernahme aus ImmoScout24, Immowelt & Co.</h3>
      <p>Inserat im Portal öffnen, auf den Button klicken – Kaufpreis, Fläche, Zimmer, Miete, Baujahr, Hausgeld und Provision landen mit dem Link in Ihrer Objektliste, alle Kennzahlen werden sofort berechnet.</p></div>
      <a class="btn btn-dark imp-bm" id="imp_bm" href="#" draggable="true" title="In die Lesezeichenleiste ziehen">＋ Zu LeaseRun</a></div>
    <ol class="imp-steps"><li><strong>Einmalig:</strong> den Button „＋ Zu LeaseRun“ mit der Maus in die Lesezeichenleiste ziehen (Leiste einblenden: Strg+Umschalt+B, am Mac ⌘+Umschalt+B).</li>
      <li>Im Portal ein <strong>einzelnes Inserat</strong> öffnen und in der Lesezeichenleiste auf „＋ Zu LeaseRun“ klicken.</li>
      <li>Für jedes weitere Inserat wiederholen – alle erscheinen untereinander in der Trefferliste.</li></ol>
    <details class="imp-paste"><summary>Am Handy oder ohne Lesezeichen: Inseratstext einfügen</summary>
      <p class="form-note">Im Inserat den Text markieren und kopieren (am Handy: lange tippen → „Alle auswählen“ → „Kopieren“), hier einfügen und die Adresse des Inserats dazusetzen.</p>
      <label>Link zum Inserat<input id="imp_url" type="url" placeholder="https://…" autocomplete="off"></label>
      <label>Text des Inserats<textarea id="imp_text" rows="5" maxlength="30000" placeholder="Kaufpreis 349.000 € · Wohnfläche 72 m² · Zimmer 3 …"></textarea></label>
      <button class="btn btn-dark" id="imp_go" type="button">Übernehmen</button></details>
        <p class="form-note">Die Übernahme läuft nur in Ihrem Browser: Gelesen wird ausschließlich das Inserat bzw. Exposé, das Sie selbst öffnen oder auswählen, und nur Zahlen und Fakten für Ihre eigene Berechnung (Kaufpreis, Fläche, Miete, Baujahr, Hausgeld, Energieklasse). Namen, Telefonnummern, E-Mail-Adressen und Fotos von Maklern oder Verkäufern werden sofort verworfen und nirgends gespeichert. Die Exposé-Datei wird nicht hochgeladen; an LeaseRun wird dabei nichts übertragen.</p>
  </article>
  </details>
  <div id="ox_metrics" class="ox-metrics" aria-live="polite"></div>
</section>`;
}

// ---------- Objekt-Analyse ----------
function renderAnalyse() {
  return `<section class="an" aria-label="Objekt-Analyse">
  <h2>Objekt-Analyse</h2>
  <div class="an-bar" id="a_bar" aria-live="polite"></div>
  <div class="an-grid">
  <details class="dash-card an-sec"><summary><h3>Inserat und Lage</h3></summary><div class="obj-grid">
    ${F('a_url', 'Link zum Inserat (wird nur verlinkt)', '', 'any', 'url')}${F('a_addr', 'Adresse oder Lagebezeichnung', '', 'any', 'text')}
    <label>Bundesland<select id="a_land">${landOpts()}</select></label>
    <label>Objektart<select id="a_art"><option value="ETW">Eigentumswohnung</option><option value="EFH">Einfamilienhaus</option><option value="MFH">Mehrfamilienhaus</option></select></label>
  </div></details>
  <details class="dash-card an-sec"><summary><h3>Kernfakten</h3></summary><div class="obj-grid">
    ${F('a_price', 'Kaufpreis (€)', '', '1000')}${F('a_area', 'Wohnfläche (m²)', '', '0.5')}${F('a_rooms', 'Zimmer', '', '0.5')}${F('a_year', 'Baujahr', '', '1')}
    <label>Effizienzklasse<select id="a_ec"><option value="">unbekannt</option>${['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((c) => `<option>${c}</option>`).join('')}</select></label>
    ${F('a_broker', 'Makler, Käuferanteil (%)', 3.57, '0.01')}<div class="an-etw">${F('a_hg', 'Hausgeld gesamt (€/Monat)', '', '1')}${F('a_rl', 'davon Instandhaltungsrücklage (€/Monat)', '', '1')}</div>${F('a_kwh', 'Energiekennwert (kWh/m²·a)', '', '1')}
  </div></details>
  <details class="dash-card an-sec"><summary><h3>Miete und Mietspiegel</h3></summary><div class="obj-grid">
    ${F('a_rent', 'Ist-Nettokaltmiete (€/Monat, leer bei Leerstand)', '')}${F('a_vq', 'Ortsübliche Vergleichsmiete laut Mietspiegel (€/m²)', '', '0.01')}
    <label class="consent"><input type="checkbox" id="a_mpb"> Gebiet mit Mietpreisbremse</label>
    ${F('a_vac', 'Mietausfall (%)', 2, '0.5')}${F('a_nonrec', 'Nicht umlagefähige Kosten (€/Monat, z. B. Verwaltung)', '', '1')}${F('a_mqm', 'Instandhaltung (€/m² und Monat)', 1, '0.05')}
  </div><p class="form-note" id="a_mslink"></p></details>
  <details class="dash-card an-sec"><summary><h3>Finanzierung</h3></summary><div class="obj-grid">
    ${F('a_eq', 'Eigenkapital (€)', pv(PROF.equity))}${F('a_z', 'Sollzins p. a. (%)', 3.5, '0.01')}${F('a_t', 'Anfängliche Tilgung p. a. (%)', 2, '0.1')}${F('a_fix', 'Zinsbindung (Jahre)', 10, '1')}
  </div></details>
  <details class="dash-card an-sec"><summary><h3>Steuer und Wert (für Spezialisten)</h3></summary><div class="obj-grid">
    ${F('a_bs', 'Gebäudeanteil (%)', 75, '1')}<label>AfA-Satz<select id="a_afa"><option value="2">2 % (1925–2022)</option><option value="2.5">2,5 % (vor 1925)</option><option value="3">3 % (ab 2023)</option></select></label>${F('a_tax', 'Grenzsteuersatz (%)', pv(PROF.marginalTaxPct), '1')}
    ${F('a_lv', 'Bodenwert (€, für Ertragswert)', '')}${F('a_lz', 'Liegenschaftszins (%)', '', '0.1')}${F('a_rnd', 'Restnutzungsdauer (Jahre)', '', '1')}
  </div><p class="form-note">Bodenwert: Bodenrichtwert × Grundstücksanteil (BORIS des Landes). Liegenschaftszins und Restnutzungsdauer: Grundstücksmarktbericht des Gutachterausschusses.</p></details>
  </div>
  <div class="an-jump" id="a_jump" hidden><span id="a_jump_t"></div><button class="btn btn-dark" type="button" id="a_jump_b">Analyse ansehen ↓</button></div>
  <div class="an-out" id="a_out"></div>
  <p class="an-actions" id="a_actions" hidden><button class="btn btn-dark" id="a_keep" type="button"${APPMODE ? ' hidden' : ''}>In Objektliste</button> <button class="btn btn-outline" id="a_pdf" type="button">Analyse als PDF</button> <button class="btn btn-outline" id="a_mail" type="button">Per E-Mail</button> <button class="btn ${APPMODE ? 'btn-dark' : 'btn-outline'}" id="a_save" type="button">${APPMODE ? 'Unter „Meine Objekte“ speichern' : 'Als Objekt im Konto speichern'}</button> <button class="btn btn-ghost" id="a_print" type="button">Drucken</button> <span class="form-note" id="a_msg" role="status"></span></p>
</section>`;
}

const PENDING = 'lr-pending-object';
let APPMODE = false, ONSAVE = null; // Privatbereich: keine eigene Trefferliste, Speichern direkt unter „Meine Objekte“
const LIST = 'lr-intern-list-v1';
let last = null;
const token = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null')?.access_token || ''; } catch { return ''; } };
function updateAnalyse() {
  const ort = val('a_addr');
  $('a_mslink').innerHTML = `Mietspiegel: Wert aus dem offiziellen Mietspiegel der Gemeinde übernehmen${ort ? ` – <a class="ck-link" href="https://www.google.com/search?q=${encodeURIComponent('Mietspiegel ' + ort)}" target="_blank" rel="noopener noreferrer">Mietspiegel ${esc(ort)} suchen<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a>` : ''}. Ohne Wert rechnet die Analyse mit der Ist-Miete.`;
  const a = analyse({ price: num('a_price'), area: num('a_area'), land: val('a_land'), brokerPct: num('a_broker'), rent: num('a_rent'), vergleichQm: num('a_vq'), mietpreisbremse: $('a_mpb').checked,
    vacancyPct: num('a_vac'), nonRecoverable: num('a_nonrec'), maintenanceQm: num('a_mqm'), equity: num('a_eq'), ratePct: num('a_z'), repaymentPct: num('a_t'), fixedYears: num('a_fix'),
    buildingSharePct: num('a_bs'), afaPct: Number(val('a_afa')), taxPct: num('a_tax'), landValue: num('a_lv'), capRatePct: num('a_lz'), remainingLife: num('a_rnd'), yearBuilt: num('a_year'), energyClass: val('a_ec') });
  const url = val('a_url').trim();
  const okUrl = /^https:\/\/[^\s]+$/i.test(url);
  if (!a) { $('a_bar').innerHTML = '<p class="form-note">Kaufpreis eintragen – die Leiste füllt sich sofort.</p>'; $('a_out').innerHTML = ''; $('a_actions').hidden = true; last = null; jumpUpd(null); renderMetrics(); return; }
  const chip = (label, v, cls = '') => `<div class="an-chip ${cls}"><small>${label}</small><strong>${v}</strong></div>`;
  $('a_bar').innerHTML = `<div class="an-head"><div><strong>${esc(ort || 'Objekt ohne Adresse')}</strong><span>${esc(val('a_art'))}${num('a_area') ? ` · ${D(num('a_area'), 0)} m²` : ''}${num('a_rooms') ? ` · ${D(num('a_rooms'), 1)} Zi.` : ''}${num('a_year') ? ` · Bj. ${num('a_year')}` : ''}</span></div>${okUrl ? `<a class="btn btn-outline" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">Inserat öffnen<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a>` : ''}</div>
  <div class="an-chips">${chip('Kaufpreis', E(a.price))}${chip('€/m²', a.pricePerQm ? E(a.pricePerQm) : '–')}${chip('Kaufpreisfaktor', a.factor == null ? '–' : D(a.factor, 1), a.factor == null ? 'na' : a.factor <= 22 ? 'ok' : a.factor <= 28 ? 'warn' : 'bad')}
  ${chip('Bruttorendite', P(a.grossYield), a.grossYield == null ? 'na' : '')}${chip('Cashflow v. St.', E2(a.cashflow), a.rent ? (a.cashflow >= 0 ? 'ok' : 'bad') : 'na')}${chip('Cashflow n. St.', E2(a.cashflowAfterTax), a.rent ? (a.cashflowAfterTax >= 0 ? 'ok' : 'warn') : 'na')}
  ${chip('DSCR', a.dscr == null ? '–' : D(a.dscr), tone(a.dscr, 1.2, 1))}${chip('Mindestkapital', E(a.nebenkosten), num('a_eq') >= a.nebenkosten ? 'ok' : 'bad')}</div>
  <p class="form-note an-src">Miete: ${a.rentSource === 'ist' ? 'Ist-Miete' : a.rentSource === 'mietspiegel' ? 'Mietspiegel × Fläche (keine Ist-Miete angegeben)' : 'nicht angegeben – Rendite und Cashflow nicht aussagekräftig'}. Ampelgrenzen beim Faktor (≤ 22 grün, ≤ 28 gelb) sind LeaseRun-Annahmen.</p>`;
  const SECTIONS = [
    { title: 'Kosten und Kapital', rows: [['Kaufnebenkosten', `${E(a.nebenkosten)} (${P(a.nkPct)})`], ['Gesamtkosten', E(a.allIn)], ['Gesamtkosten je m²', a.allInPerQm ? E(a.allInPerQm) : '–'],
      ['Mindestkapital (Nebenkosten)', E(a.nebenkosten)], ['Empfohlen (+ 10 % Kaufpreis)', E(a.nebenkosten + a.price * 0.1)], ['Darlehen / Beleihung', `${E(a.loan)} · ${P(a.ltv, 1)} vom Kaufpreis`]] },
    { title: 'Miete und Mietrecht', rows: [['Angesetzte Miete', `${E2(a.rent)} (${a.rentPerQm ? E2(a.rentPerQm) + '/m²' : '–'})`], ['Miete laut Mietspiegel', a.rentMarket ? E2(a.rentMarket) : 'kein Wert eingetragen'],
      ['Abstand Ist zu Mietspiegel', a.rentGapPct == null ? '–' : `${a.rentGapPct > 0 ? '+' : ''}${D(a.rentGapPct, 1)} % Potenzial`], ['Obergrenze Mietpreisbremse', a.rentCap ? E2(a.rentCap) : 'nicht relevant / keine Angabe'],
      ['Break-even-Miete (Cashflow 0)', E2(a.rentBreakEven)], ['Miete für DSCR 1,2', E2(a.rentDscr12)], ['Miete für 5 % Nettorendite', E2(a.rentYield5)]] },
    { title: 'Rendite', rows: [['Bruttomietrendite', P(a.grossYield)], ['Nettomietrendite (auf Gesamtkosten)', P(a.netYield)], ['Kaufpreisfaktor', a.factor == null ? '–' : D(a.factor, 1)], ['Cash-on-Cash (Cashflow / EK)', P(a.cashOnCash)],
      ['Eigenkapitalrendite inkl. Tilgung', P(a.equityReturn)], ['Reinertrag (NOI) pro Monat', E2(a.noi)]] },
    { title: 'Finanzierung und Risiko', rows: [['Monatsrate', `${E2(a.rate)} (Zins ${E2(a.interestM)}, Tilgung ${E2(a.principalM)})`], ['DSCR (Kapitaldienstdeckung)', a.dscr == null ? '–' : D(a.dscr)], ['ICR (Zinsdeckung)', a.icr == null ? '–' : D(a.icr)],
      ['Debt Yield', P(a.debtYield)], ['Kipp-Zins (Cashflow 0 nach Zinsbindung)', P(a.kippZins)], ['Rate bei +2 Prozentpunkten', E2(a.rateStress)], ['Restschuld nach Zinsbindung', E(a.restAfterFixed)], ['Volltilgung nach (gleicher Zins)', a.payoffYears ? `${D(a.payoffYears, 1)} Jahren` : '–']] },
    { title: 'Steuer (Jahr 1, Modell)', rows: [['AfA pro Jahr', E(a.afa)], ['Steuerliches Ergebnis', E(a.taxable)], [a.tax < 0 ? 'Steuervorteil (Erstattung)' : 'Steuerlast', E(Math.abs(a.tax))], ['Steuereffekt pro Monat', E2(-a.tax / 12)], ['Cashflow nach Steuern pro Monat', E2(a.cashflowAfterTax)]] },
    { title: 'Wert', rows: [['Ertragswert (vereinfacht, ImmoWertV)', a.ertragswert ? E(a.ertragswert) : 'Bodenwert, Liegenschaftszins und RND fehlen'], ['Kaufpreis zum Ertragswert', a.ertragswertGapPct == null ? '–' : `${a.ertragswertGapPct > 0 ? '+' : ''}${D(a.ertragswertGapPct, 1)} %`]] },
  ];
  last = { a, ort, url: okUrl ? url : '', sections: SECTIONS,
    chips: [['Kaufpreis', E(a.price)], ['€/m²', a.pricePerQm ? E(a.pricePerQm) : '–'], ['Kaufpreisfaktor', a.factor == null ? '–' : D(a.factor, 1)], ['Bruttorendite', P(a.grossYield)],
      ['Cashflow v. St.', E2(a.cashflow)], ['Cashflow n. St.', E2(a.cashflowAfterTax)], ['DSCR', a.dscr == null ? '–' : D(a.dscr)], ['Mindestkapital', E(a.nebenkosten)]],
    subtitle: `${val('a_art')}${num('a_area') ? ` · ${D(num('a_area'), 0)} m²` : ''}${num('a_rooms') ? ` · ${D(num('a_rooms'), 1)} Zimmer` : ''}${num('a_year') ? ` · Baujahr ${num('a_year')}` : ''} · ${GREST[val('a_land')].name}` };
  $('a_out').innerHTML = `<h3 class="an-res-h" id="a_res">Ergebnis der Analyse</h3><div class="an-grid">${SECTIONS.map((x) => `<article class="dash-card"><h3>${x.title}</h3>${table(x.rows.map((r) => [esc(r[0]), esc(r[1])]))}</article>`).join('')}</div>
  ${a.hints.length ? `<article class="dash-card"><h3>Hinweise</h3><ul class="plain-list">${a.hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></article>` : ''}
  `;
  $('a_actions').hidden = false;
  jumpUpd(a);
  renderMetrics();
}

// Schnellzugriff: Sobald ein Kaufpreis eingetragen ist, zeigt eine Leiste am unteren Rand die wichtigsten Werte
// und springt mit „Analyse ansehen“ direkt zum Ergebnis (das unter den Eingaben steht).
let jumpObs = null, outVisible = false;
function jumpUpd(a) {
  const j = $('a_jump'); if (!j) return;
  if (!jumpObs && 'IntersectionObserver' in window) {
    jumpObs = new IntersectionObserver((es) => { outVisible = es.some((e) => e.isIntersecting); j.hidden = !last || outVisible; }, { rootMargin: '0px 0px -30% 0px' });
    jumpObs.observe($('a_out')); jumpObs.observe($('a_actions'));
    $('a_jump_b').onclick = () => $('a_res')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  if (!a) { j.hidden = true; return; }
  $('a_jump_t').innerHTML = `<b>${a.rent ? 'Cashflow ' + E2(a.cashflow) : 'Kaufpreis ' + E(a.price)}</b><small>${a.grossYield == null ? 'Miete eintragen für Rendite' : 'Bruttorendite ' + P(a.grossYield)}</small>`;
  j.hidden = outVisible;
}

// Dropzone (Ziehen & Ablegen) und Link-Import für den Objekt- & Dokumenten-Import.
function bindImport() {
  const drop = $('ox_drop'), input = $('imp_pdf'), msg = () => $('imp_msg');
  if (drop && input) {
    ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('on'); }));
    ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('on'); }));
    drop.addEventListener('drop', (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name));
      if (!f) { msg().className = 'imp-msg bad'; msg().textContent = 'Bitte ein Exposé als PDF ablegen.'; return; }
      const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; input.dispatchEvent(new Event('change'));
    });
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  }
  $('ox_link')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('ox_url').value.trim(), m = msg();
    if (!/^https:\/\/\S+$/i.test(url)) { m.className = 'imp-msg bad'; m.textContent = 'Bitte einen vollständigen Link mit https:// eintragen.'; return; }
    if (/(^|\.)(immobilienscout24|immowelt|immonet)\.|kleinanzeigen\.de/i.test(new URL(url).hostname)) {
      m.className = 'imp-msg'; m.innerHTML = 'Dieses Portal erlaubt keinen automatischen Abruf. So geht es trotzdem schnell: im Inserat „Exposé drucken/als PDF speichern“ wählen und die Datei oben ablegen – oder die <strong>Ein-Klick-Übernahme</strong> unter „Weitere Wege“ nutzen.';
      const d = root.querySelector('.ox-more'); if (d) d.open = true; return;
    }
    if (!token()) { m.className = 'imp-msg bad'; m.innerHTML = 'Für den Link-Import bitte <a class="ck-link" href="/auth/login">anmelden</a> – oder das Exposé als PDF hochladen.'; return; }
    const w = work('Link wird ausgewertet', ['Link abrufen', 'Text erkennen', 'Eckdaten übernehmen', 'Kennzahlen berechnen']);
    try {
      await w.step(0);
      const r = await fetch('/api/expose-link', { method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(j.error || 'Der Link konnte nicht ausgewertet werden.'); }
      await w.step(1);
      let listing;
      if ((r.headers.get('content-type') || '').includes('application/pdf')) {
        const t = await exposeText(await r.blob());
        if (t.replace(/\s+/g, '').length < 150) throw Error('Das verlinkte PDF enthält keinen lesbaren Text (vermutlich ein Scan).');
        listing = { u: url, t, ti: '' };
      } else { const j = await r.json(); listing = { u: j.u || url, t: j.t, ti: j.ti, j: j.j }; }
      await w.step(2);
      const ok = importListing(listing);
      await w.step(3);
      if (ok) { $('ox_url').value = ''; await w.done('Kennzahlen berechnet'); } else w.close();
    } catch (err) { w.close(); m.className = 'imp-msg bad'; m.textContent = err.message; }
  });
}

// Metrics Engine: typisiertes Ergebnis (ExposeMetricsResult) aus den aktuellen Eckdaten.
function renderMetrics() {
  const box = $('ox_metrics'); if (!box) return;
  const hg = num('a_hg'), rl = num('a_rl'), ec = val('a_ec');
  const r = exposeMetrics({
    title: val('a_addr') || 'Objekt', address: { zip: (val('a_addr').match(/\b\d{5}\b/) || [''])[0], city: val('a_addr').replace(/\b\d{5}\b/, '').trim(), state: val('a_land') },
    purchasePrice: num('a_price'), livingAreaSqm: num('a_area'), monthlyColdRent: num('a_rent'), monthlyHausgeld: hg, monthlyMaintenanceReserve: rl,
    nonAllocatableCosts: num('a_nonrec'), constructionYear: num('a_year'), energyClass: ec, energyValueKwh: num('a_kwh'),
  }, { equity: num('a_eq'), ratePct: num('a_z'), repaymentPct: num('a_t'), fixedYears: num('a_fix'), brokerPct: num('a_broker') });
  if (!r) { box.innerHTML = ''; return; }
  const m = r.metrics, ic = m.incidentalCosts, fq = m.financingQuickCheck, sr = m.sanitationRisk;
  const k = (l, v, cls = '') => `<div class="an-chip ${cls}"><small>${l}</small><strong>${v}</strong></div>`;
  const risk = { LOW: ['ok', 'niedrig'], MEDIUM: ['warn', 'mittel'], HIGH: ['bad', 'hoch'] }[sr.riskLevel];
  box.innerHTML = `<h3>Kennzahlen aus dem Exposé</h3>
    <div class="an-chips">${k('Kaufpreis je m²', m.pricePerSqm ? E(m.pricePerSqm) : '–')}${k('Miete je m²', m.rentPerSqm ? E2(m.rentPerSqm) : '–')}${k('Kaufpreisfaktor', m.purchaseMultiplier ? D(m.purchaseMultiplier, 1) : '–')}${k('Bruttomietrendite', m.grossRentalYieldPercent ? P(m.grossRentalYieldPercent) : '–')}${k('Nettomietrendite', m.netRentalYieldPercent ? P(m.netRentalYieldPercent) : '–')}
    ${k('Monatsrate', E2(fq.calculatedMonthlyRate))}${k('Cashflow vor Steuern', E2(fq.monthlyPreTaxCashflow), num('a_rent') ? (fq.monthlyPreTaxCashflow >= 0 ? 'ok' : 'bad') : 'na')}${k('DSCR (Soll ≥ 1,20)', fq.dscrValue ? D(fq.dscrValue) : '–', tone(fq.dscrValue || null, 1.2, 1))}${k('Beleihungsauslauf', fq.ltvPercent ? P(fq.ltvPercent, 1) : '–', fq.ltvPercent > 100 ? 'warn' : '')}${k('Rate bei +2 % Zins', fq.stressTestRateDelta ? '+ ' + E2(fq.stressTestRateDelta) : '–', 'warn')}</div>
    ${hg && !num('a_nonrec') ? '<p class="form-note">Hausgeld erkannt: Den nicht umlagefähigen Teil (z. B. Verwaltung) bitte unter „Nicht umlagefähige Kosten“ eintragen – erst dann ist der Cashflow vollständig.</p>' : ''}<div class="ox-two">${table([['Grunderwerbsteuer (' + esc(GREST[val('a_land')]?.name || '') + ')', E(ic.propertyTransferTax)], ['Notar und Grundbuch (ca. 2,0 %)', E(ic.notaryAndRegistry)], ['Makler (Käuferanteil)', E(ic.brokerCommission)], ['<strong>Nebenkosten gesamt</strong>', `<strong>${E(ic.totalIncidentalCosts)}</strong>`], ['<strong>Gesamtinvestition</strong>', `<strong>${E(ic.totalInvestment)}</strong>`]])}
    <div class="ox-risk ${risk[0]}"><small>Sanierungsrisiko</small><strong>${risk[1]}</strong><span>${ec ? `Effizienzklasse ${esc(ec)}` : 'Effizienzklasse unbekannt'}${num('a_year') ? ` · Baujahr ${num('a_year')}` : ''}</span>${sr.recommendedSanitationBuffer ? `<span>Empfohlener Puffer: <b>${E(sr.recommendedSanitationBuffer)}</b> (Annahme je m² bei Klasse E–H, kein Gutachten)</span>` : '<span>Kein Sanierungspuffer nötig laut Effizienzklasse.</span>'}</div></div>`;
}

// RenditeRadar-PDF erzeugen: liefert { blob, filename } bzw. bei E-Mail { sentTo }.
export async function analysePdf(mail = false) {
  if (!last) throw Error('Noch keine Analyse – bitte zuerst einen Kaufpreis eintragen.');
  const { a } = last;
  const body = { title: last.ort || 'Objekt-Analyse', subtitle: last.subtitle, url: last.url, chips: last.chips, sections: last.sections, hints: a.hints, email: mail };
  const r = await fetch('/api/analyse-pdf', { method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(j.error || 'PDF konnte nicht erstellt werden.'); }
  if (mail) return r.json();
  const cd = r.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(cd);
  return { blob: await r.blob(), filename: m ? decodeURIComponent(m[1] || m[2]) : 'LeaseRun_RenditeRadar.pdf' };
}

// AutoPilot: Daten aus Exposé/Link (listing) oder aus einem ausgefüllten Formular (values) übernehmen und rechnen.
// Gibt eine kurze Zusammenfassung zurück; wirft einen Fehler, wenn kein Kaufpreis erkennbar ist.
export function autoAnalyse({ listing, values } = {}) {
  let r = null;
  if (listing) {
    r = importListing(listing);
    if (!r) throw Error('Im Exposé wurde kein Kaufpreis gefunden. Bitte ein einzelnes Kaufangebot verwenden oder die Werte manuell eintragen.');
  } else if (values) {
    ['a_url', 'a_addr', 'a_price', 'a_area', 'a_rooms', 'a_year', 'a_ec', 'a_rent', 'a_vq', 'a_nonrec'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
    for (const [id, v] of Object.entries(values)) {
      const el = $(id); if (!el) continue;
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else if (el.tagName === 'SELECT') { const opt = [...el.options].find((o) => o.value === String(v) || o.textContent.trim() === String(v)); if (opt) el.value = opt.value; }
      else el.value = v;
    }
    updateAnalyse();
    if (!last) throw Error('Im Formular fehlt der Kaufpreis.');
    keepCurrent({});
  }
  if (!last) throw Error('Keine Analyse möglich.');
  const { a } = last;
  return { name: last.ort || 'Objekt', price: a.price, rent: a.rent, grossYield: a.grossYield, netYield: a.netYield, cashflow: a.cashflow, cashflowAfterTax: a.cashflowAfterTax, dscr: a.dscr,
    nebenkosten: a.nebenkosten, found: r?.found || [], missing: r?.missing || (a.rent ? [] : ['Miete (Ist)']), land: GREST[val('a_land')]?.name || '' };
}

function bindActions() {
  $('a_print').onclick = () => window.print();
  $('a_keep').onclick = () => { if (keepCurrent()) $('a_msg').textContent = ' In der Trefferliste gespeichert (nur in diesem Browser).'; };
  const sendPdf = async (mail) => {
    if (!last) return;
    const b = $(mail ? 'a_mail' : 'a_pdf'); b.disabled = true; $('a_msg').textContent = '';
    const w = work(mail ? 'RenditeRadar wird gesendet' : 'RenditeRadar wird erstellt', ['Kennzahlen zusammenstellen', 'PDF erzeugen', mail ? 'E-Mail senden' : 'Dokument anzeigen']);
    try {
      await w.step(0); await w.step(1);
      const out = await analysePdf(mail);
      await w.step(2);
      if (mail) { await w.done('Gesendet'); $('a_msg').textContent = ` Gesendet an ${out.sentTo || 'Ihre E-Mail-Adresse'}.`; }
      else { await w.done('Fertig'); showPdf(out.blob, { filename: out.filename, title: 'RenditeRadar · ' + (last?.ort || 'Objekt-Analyse') }); }
    } catch (e) { w.close(); $('a_msg').textContent = ' ' + e.message; }
    b.disabled = false;
  };
  if ($('a_mail')) $('a_mail').onclick = () => sendPdf(true);
  if ($('a_pdf')) $('a_pdf').onclick = () => sendPdf(false);
  $('a_save').onclick = () => {
    if (!last) return; const { a, ort } = last;
    const nk = kaufnebenkosten({ price: a.price, land: val('a_land'), brokerPct: num('a_broker') });
    const o = { name: (ort || 'Objekt aus Analyse').slice(0, 160), price: a.price, rent: a.rent, area: num('a_area'), yearBuilt: num('a_year'), equity: num('a_eq'), interestPct: num('a_z'), repaymentPct: num('a_t'),
      fixedYears: num('a_fix'), loan: Math.round(a.loan), nonRecoverable: num('a_nonrec'), maintenance: Math.round(num('a_mqm') * num('a_area') * 100) / 100, vacancyPct: num('a_vac'),
      purchaseCostPct: nk.totalPct, grestPct: GREST[val('a_land')].pct, notaryPct: 2, brokerPct: num('a_broker'), buildingSharePct: num('a_bs'), marginalTaxPct: num('a_tax'),
      vergleichsmieteQm: num('a_vq'), mietpreisbremse: $('a_mpb').checked, efficiencyClass: val('a_ec'), liegenschaftszinsPct: num('a_lz'), restnutzungsdauer: num('a_rnd') };
    if (ONSAVE) { const b = $('a_save'); b.disabled = true; $('a_msg').textContent = ' Wird gespeichert …'; Promise.resolve(ONSAVE({ ...o, source: last.url || '' })).then((ok) => { $('a_msg').textContent = ok ? ' Gespeichert – unten unter „Meine Objekte“.' : ' Speichern fehlgeschlagen.'; }).catch(() => { $('a_msg').textContent = ' Speichern fehlgeschlagen – bitte erneut versuchen.'; }).finally(() => { b.disabled = false; }); return; }
    try { localStorage.setItem(PENDING, JSON.stringify({ ...o, source: '/internal/web-admin', at: Date.now() })); location.href = '/app/dashboard'; } catch { alert('Speichern im Browser nicht möglich.'); }
  };
}

// Aktuelle Analyse in die Trefferliste; gleiches Inserat (gleiche URL) wird aktualisiert statt doppelt angelegt.
function keepCurrent(meta = {}) {
  if (!last) return false; const { a, ort } = last;
  const inputs = {}; root.querySelectorAll('.an input, .an select').forEach((el) => { inputs[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  const list = readList();
  const prev = last.url ? list.find((x) => x.url === last.url) : null;
  const item = { id: prev?.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: new Date().toISOString(), name: meta.name || ort || prev?.name || 'Objekt ohne Adresse', url: last.url,
    portal: meta.portal ?? prev?.portal ?? '', title: meta.title ?? prev?.title ?? '', missing: meta.missing ?? (a.rent ? [] : ['Miete (Ist)']), inputs,
    k: { price: a.price, area: num('a_area') || null, rooms: num('a_rooms') || null, rent: a.rent || null, pqm: a.pricePerQm, factor: a.factor, gross: a.grossYield, net: a.netYield, cf: a.cashflow, cfat: a.cashflowAfterTax, dscr: a.dscr, minCap: a.nebenkosten, rate: a.rate } };
  writeList([item, ...list.filter((x) => x.id !== item.id)].slice(0, 100)); renderList();
  return true;
}

// Inserat übernehmen: nur objektbezogene Felder werden ersetzt, Finanzierung und Steuer bleiben wie eingestellt.
const OBJ_FIELDS = ['a_url', 'a_addr', 'a_hg', 'a_rl', 'a_kwh', 'a_price', 'a_area', 'a_rooms', 'a_year', 'a_ec', 'a_rent', 'a_vq', 'a_nonrec', 'a_lv', 'a_lz', 'a_rnd'];
function importListing(d) {
  const msg = $('imp_msg');
  const r = parseListing(d);
  if (r.price == null) {
    msg.className = 'imp-msg bad';
    msg.innerHTML = `Kein Kaufpreis gefunden${r.url ? ` auf <a class="ck-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer nofollow">dieser Seite</a>` : ''}. Bitte ein <strong>einzelnes Kaufinserat</strong> öffnen (nicht die Trefferliste) – oder die Werte unten in der Analyse eintragen.`;
    return null;
  }
  OBJ_FIELDS.forEach((id) => { const el = $(id); if (el) el.value = ''; });
  if ($('a_mpb')) $('a_mpb').checked = false;
  const set = (id, v) => { if (v != null && v !== '' && $(id)) $(id).value = v; };
  set('a_url', r.url); set('a_addr', [r.plz, r.city].filter(Boolean).join(' ') || r.title); set('a_price', r.price); set('a_area', r.area); set('a_rooms', r.rooms);
  set('a_year', r.year); set('a_ec', r.energyClass); set('a_rent', r.rent); set('a_broker', r.brokerPct); set('a_art', r.art);
  set('a_hg', r.hausgeld);
  updateAnalyse();
  keepCurrent({ name: r.name, portal: r.portal, title: r.title, missing: r.missing });
  msg.className = 'imp-msg ok';
  msg.innerHTML = `<strong>Übernommen${r.portal ? ` von ${esc(r.portal)}` : ''}:</strong> ${esc(r.found.join(', '))}.` +
    (r.missing.length ? ` <strong>Nicht gefunden:</strong> ${esc(r.missing.join(', '))}${r.missing.includes('Miete (Ist)') ? ' – ohne Miete sind Rendite und Cashflow nicht aussagekräftig; in der Zeile auf „Bearbeiten“ klicken und die erwartete Miete eintragen' : ''}.` : '') +
    (r.hausgeld ? ` Hausgeld ${E(r.hausgeld)}/Monat: Den nicht umlagefähigen Teil (meist Verwaltung und Rücklage) bitte unter „Nicht umlagefähige Kosten“ eintragen.` : '') +
    ` Bundesland für die Grunderwerbsteuer: ${esc(GREST[val('a_land')]?.name || '')} – bitte prüfen.` +
    (r.warnings.length ? ` <strong>${esc(r.warnings.join(' '))}</strong>` : '');
  ($('m_list') || $('a_bar'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return r;
}

// Exposé-PDF im Browser auslesen (pdf.js, lokal ausgeliefert). Die Datei verlässt das Gerät nicht.
const PDFJS = '/vendor/pdfjs-4.10.38/';
export async function exposeText(file) {
  const pdfjs = await import(PDFJS + 'pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, disableFontFace: true }).promise;
  const out = [];
  try {
    for (let i = 1; i <= Math.min(doc.numPages, 25); i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      let line = '';
      for (const it of tc.items) { line += it.str || ''; if (it.hasEOL) { out.push(line); line = ''; } else if (it.str) line += ' '; }
      if (line.trim()) out.push(line);
    }
  } finally { await doc.destroy(); }
  return out.join('\n');
}

// Objekt aus dem Konto in die Analyse übernehmen (automatische Objekt-Analyse); optional direkt PDF/E-Mail.
const LOAD_KEY = 'lr-analyse-load';
export function loadFromObject(o) {
  const set = (id, v) => { const el = $(id); if (!el || v === undefined || v === null || v === '') return; if (el.type === 'checkbox') el.checked = Boolean(v); else el.value = v; };
  ['a_url', 'a_addr', 'a_price', 'a_area', 'a_rooms', 'a_year', 'a_ec', 'a_rent', 'a_vq', 'a_nonrec', 'a_lv', 'a_lz', 'a_rnd'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
  set('a_addr', o.name); set('a_price', o.price); set('a_area', o.area); set('a_year', o.yearBuilt); set('a_ec', o.efficiencyClass);
  set('a_rent', o.rent); set('a_vq', o.vergleichsmieteQm); set('a_mpb', o.mietpreisbremse); set('a_vac', o.vacancyPct); set('a_nonrec', o.nonRecoverable);
  if (Number(o.maintenance) > 0 && Number(o.area) > 0) set('a_mqm', Math.round((o.maintenance / o.area) * 100) / 100);
  set('a_eq', o.equity); set('a_z', o.interestPct); set('a_t', o.repaymentPct); set('a_fix', o.fixedYears); set('a_bs', o.buildingSharePct);
  set('a_tax', o.marginalTaxPct); set('a_lz', o.liegenschaftszinsPct); set('a_rnd', o.restnutzungsdauer); set('a_broker', o.brokerPct);
  if (Number(o.grestPct) > 0 && $('a_land') && GREST[$('a_land').value]?.pct !== Number(o.grestPct)) {
    const k = Object.keys(GREST).find((x) => GREST[x].pct === Number(o.grestPct)); if (k) $('a_land').value = k;
  }
  updateAnalyse();
}
function checkAnalyseLoad() {
  let job = null;
  try { job = JSON.parse(sessionStorage.getItem(LOAD_KEY) || 'null'); sessionStorage.removeItem(LOAD_KEY); } catch { job = null; }
  if (!job || !job.o) return;
  loadFromObject(job.o);
  $('a_bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (job.then === 'pdf') $('a_pdf')?.click();
  if (job.then === 'mail') $('a_mail')?.click();
}

const IMPORT_KEY = 'lr-import';
function checkImport() {
  const m = location.hash.match(/[?&]import=([^&]*)/);
  if (m) { try { sessionStorage.setItem(IMPORT_KEY, m[1]); } catch { /* ohne Speicher */ } history.replaceState(null, '', location.pathname + location.search + (location.pathname.startsWith('/app/') ? '#objekte' : '#suche')); }
  let raw = m ? m[1] : null;
  try { raw = raw || sessionStorage.getItem(IMPORT_KEY); sessionStorage.removeItem(IMPORT_KEY); } catch { /* ohne Speicher */ }
  if (!raw) return;
  try { const d = JSON.parse(decodeURIComponent(raw)); if (d && typeof d === 'object') importListing({ u: d.u, ti: d.ti, t: d.t, j: d.j }); }
  catch { $('imp_msg').className = 'imp-msg bad'; $('imp_msg').textContent = 'Die Übernahme war unvollständig. Bitte im Inserat erneut auf „＋ Zu LeaseRun“ klicken.'; }
}

const readList = () => { try { return JSON.parse(localStorage.getItem(LIST) || '[]'); } catch { return []; } };
const writeList = (l) => { try { localStorage.setItem(LIST, JSON.stringify(l)); } catch { /* ohne Speicher */ } };
function renderList() {
  const box = $('m_list'); if (!box) return;
  const l = readList();
  const cnt = $('m_count'); if (cnt) cnt.textContent = l.length ? `${l.length} Objekt${l.length === 1 ? '' : 'e'}` : '';
  if (!l.length) { box.innerHTML = '<p class="form-note">Noch keine Inserate. Oben mit „＋ Zu LeaseRun“ übernehmen oder eine Analyse ausfüllen und „In Trefferliste“ wählen.</p>'; return; }
  const sortKey = box.dataset.sort || 'at', dir = box.dataset.dir === 'asc' ? 1 : -1;
  const val2 = (x) => (sortKey === 'at' ? x.at : x.k?.[sortKey]);
  const rows = [...l].sort((x, y) => { const a = val2(x), b = val2(y); if (a == null) return 1; if (b == null) return -1; return (a > b ? 1 : a < b ? -1 : 0) * dir; });
  const best = (k, hi) => { const v = l.map((x) => x.k?.[k]).filter((x) => x != null); return v.length > 1 ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
  const noRent = (x) => !x.k?.rent;
  const cell = (x, k, f, hi, needsRent) => { if (needsRent && noRent(x)) return '<span class="ml-na">–</span>'; const v = x.k?.[k]; const b = best(k, hi); return v == null ? '–' : v === b ? `<strong class="ml-best">${f(v)}</strong>` : f(v); };
  const tn = (v, good, warn, hi = true) => (v == null ? '' : hi ? (v >= good ? 'ok' : v >= warn ? 'warn' : 'bad') : (v <= good ? 'ok' : v <= warn ? 'warn' : 'bad'));
  const COLS = [['name', 'Objekt'], ['url', 'Inserat'], ['price', 'Kaufpreis'], ['pqm', '€/m²'], ['rent', 'Miete'], ['factor', 'Faktor'], ['gross', 'Brutto'], ['cf', 'CF v. St.'], ['cfat', 'CF n. St.'], ['dscr', 'DSCR'], ['minCap', 'Mindestkapital'], ['', '']];
  const th = COLS.map(([k, t]) => (k && k !== 'name' && k !== 'url' ? `<th><button class="ml-sort${sortKey === k ? ' on' : ''}" data-sort="${k}" type="button">${t}${sortKey === k ? (dir === 1 ? ' ▲' : ' ▼') : ''}</button></th>` : `<th>${t}</th>`)).join('');
  box.innerHTML = `<div class="ml-wrap"><table class="ml-table"><thead><tr>${th}</tr></thead><tbody>${rows.map((x) => `<tr>
    <td class="ml-name" data-l="Objekt"><strong>${esc(x.name)}</strong>${x.title && x.title !== x.name ? `<small>${esc(x.title)}</small>` : ''}<small>${x.portal ? esc(x.portal) + ' · ' : ''}${new Date(x.at).toLocaleDateString('de-DE')}${x.missing?.length ? ` · <span class="ml-na">fehlt: ${esc(x.missing.join(', '))}</span>` : ''}</small></td>
    <td data-l="Inserat" class="ml-url">${x.url ? `<a class="ml-link" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer nofollow" title="${esc(x.url)}">${esc(x.portal || 'Inserat')}<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></a><small>${esc(x.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 42))}${x.url.length > 50 ? '…' : ''}</small>` : '–'}</td>
    <td data-l="Kaufpreis">${cell(x, 'price', E, false)}</td>
    <td data-l="€/m²">${cell(x, 'pqm', E, false)}</td><td data-l="Miete">${x.k?.rent ? E(x.k.rent) : `<button class="text-btn ml-na" data-load="${x.id}" type="button">Miete eintragen</button>`}</td>
    <td data-l="Faktor" class="t-${tn(x.k?.factor, 22, 28, false)}">${cell(x, 'factor', (v) => D(v, 1), false, true)}</td><td data-l="Brutto">${cell(x, 'gross', (v) => P(v), true, true)}</td>
    <td data-l="CF v. St." class="t-${noRent(x) ? '' : tn(x.k?.cf, 0, -100)}">${cell(x, 'cf', E2, true, true)}</td><td data-l="CF n. St." class="t-${noRent(x) ? '' : tn(x.k?.cfat, 0, -100)}">${cell(x, 'cfat', E2, true, true)}</td>
    <td data-l="DSCR" class="t-${noRent(x) ? '' : tn(x.k?.dscr, 1.2, 1)}">${cell(x, 'dscr', (v) => D(v), true, true)}</td><td data-l="Mindestkapital">${cell(x, 'minCap', E, false)}</td>
    <td class="ml-act"><button class="text-btn" data-load="${x.id}" type="button">Bearbeiten</button> <button class="text-btn del" data-drop="${x.id}" type="button" aria-label="${esc(x.name)} entfernen">Entfernen</button></td></tr>`).join('')}</tbody></table></div>
  <p class="form-note">Fett: bester Wert der Liste. Farbe: Faktor ≤ 22 / Cashflow ≥ 0 / DSCR ≥ 1,2 grün (LeaseRun-Annahmen). Spaltenköpfe sortieren. Finanzierung (Eigenkapital, Zins, Tilgung) gilt wie in der Analyse eingestellt. Die Liste liegt nur in diesem Browser.</p>`;
  box.querySelectorAll('[data-sort]').forEach((b) => b.onclick = () => { const k = b.dataset.sort; box.dataset.dir = box.dataset.sort === k && box.dataset.dir !== 'asc' ? 'asc' : 'desc'; box.dataset.sort = k; renderList(); });
  box.querySelectorAll('[data-drop]').forEach((b) => b.onclick = () => { writeList(readList().filter((x) => x.id !== b.dataset.drop)); renderList(); });
  box.querySelectorAll('[data-load]').forEach((b) => b.onclick = () => {
    const x = readList().find((y) => y.id === b.dataset.load); if (!x) return;
    Object.entries(x.inputs).forEach(([id, v]) => { const el = $(id); if (!el) return; if (el.type === 'checkbox') el.checked = v; else el.value = v; });
    updateAnalyse(); $('a_bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// Baut Suche, Analyse und Merkliste in einen Container. opts.pdf: Analyse-PDF anbieten.
export function mountObjekt(container, opts = {}) {
  root = container;
  PROF = opts.profile || {};
  APPMODE = Boolean(opts.app); ONSAVE = opts.onSave || null;
  root.insertAdjacentHTML('beforeend', APPMODE ? `${renderImport()}${renderAnalyse()}` : `<h2 class="is-h">Objekt- &amp; Dokumenten-Import</h2>${renderImport()}${renderAnalyse()}<section class="dash-card ml-card"><div class="ml-head"><h2>Importierte Objekte</h2><span class="form-note" id="m_count"></span></div><div id="m_list"></div></section>`);
  // Abschnitte der Objekt-Analyse: erst beim Antippen öffnen, immer nur einer offen.
  root.querySelectorAll('details.an-sec').forEach((dt) => dt.addEventListener('toggle', () => {
    if (!dt.open) return;
    root.querySelectorAll('details.an-sec[open]').forEach((o) => { if (o !== dt) o.open = false; });
    requestAnimationFrame(() => { const top = dt.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-top,.site-header')?.offsetHeight || 0) - 10; if (dt.getBoundingClientRect().top < 0 || dt.getBoundingClientRect().top > innerHeight * 0.6) window.scrollTo({ top, behavior: 'smooth' }); });
  }));
  // Felder passend zur Objektart: Hausgeld und Rücklage gibt es nur bei Eigentumswohnungen.
  const artFit = () => { const etw = ($('a_art')?.value || 'ETW') === 'ETW'; root.querySelectorAll('.an-etw').forEach((x) => { x.hidden = !etw; }); if (!etw) ['a_hg', 'a_rl'].forEach((id) => { const f = $(id); if (f && f.value) { f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); } }); };
  $('a_art')?.addEventListener('change', artFit); artFit();
  const bm = $('imp_bm');
  if (bm) {
    bm.href = bookmarklet(location.origin);
    bm.addEventListener('click', (e) => { e.preventDefault(); $('imp_msg').className = 'imp-msg'; $('imp_msg').textContent = 'Nicht hier klicken, sondern den Button in die Lesezeichenleiste ziehen. Danach im Portal auf ein Inserat gehen und dort das Lesezeichen anklicken.'; });
  }
  $('imp_pdf')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const msg = $('imp_msg');
    if (f.size > 40 * 1024 * 1024) { msg.className = 'imp-msg bad'; msg.textContent = 'Die Datei ist größer als 40 MB.'; return; }
    msg.className = 'imp-msg'; msg.textContent = '';
    const w = work('Exposé wird ausgewertet', ['Datei öffnen', 'Text erkennen', 'Eckdaten übernehmen', 'Kennzahlen berechnen']);
    try {
      await w.step(0); await w.step(1);
      const t = await exposeText(f);
      if (t.replace(/\s+/g, '').length < 150) { w.close(); msg.className = 'imp-msg bad'; msg.textContent = 'In diesem Exposé ist kein lesbarer Text enthalten (vermutlich ein eingescanntes Dokument). Bitte die Werte unten in der Analyse eintragen.'; return; }
      await w.step(2);
      const ok = importListing({ u: $('imp_url')?.value.trim() || '', t, ti: f.name.replace(/\.pdf$/i, '') });
      await w.step(3);
      if (ok) await w.done('Analyse fertig'); else w.close();
    } catch (err) { w.close(); msg.className = 'imp-msg bad'; msg.textContent = 'Das Exposé konnte nicht gelesen werden (beschädigt oder passwortgeschützt).'; console.warn(err); }
  });
  $('imp_go')?.addEventListener('click', () => {
    const t = $('imp_text').value.trim(), u = $('imp_url').value.trim();
    if (!t) { $('imp_text').focus(); return; }
    if (importListing({ u, t, ti: '' })) { $('imp_text').value = ''; $('imp_url').value = ''; }
  });
  if (window.__iaImport) window.removeEventListener('hashchange', window.__iaImport);
  window.__iaImport = () => { if (/[?&]import=/.test(location.hash)) checkImport(); if (/^#(suche|objekte)/.test(location.hash)) setTimeout(checkAnalyseLoad, 0); };
  window.addEventListener('hashchange', window.__iaImport);
  if (!opts.pdf) { $('a_pdf')?.remove(); $('a_mail')?.remove(); }
  const KEY = 'lr-objekt-v1';
  const ids = [...root.querySelectorAll('.an input, .an select')].map((e) => e.id).filter(Boolean);
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); ids.forEach((id) => { if (s[id] !== undefined) { const el = $(id); if (el.type === 'checkbox') el.checked = s[id]; else el.value = s[id]; } }); } catch { /* ohne Speicher */ }
  const save = () => { try { const o = {}; ids.forEach((id) => { const el = $(id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }); localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ohne Speicher */ } };
  const q = new URLSearchParams(location.search);
  root.addEventListener('input', (e) => { if (!e.target.id) return; if (e.target.id.startsWith('a_')) updateAnalyse(); save(); });
  root.addEventListener('change', (e) => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox') return; updateAnalyse(); save(); });
  bindActions(); bindImport(); updateAnalyse(); renderList(); checkImport(); checkAnalyseLoad();
}
