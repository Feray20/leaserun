// Steuer-Bereich der Anwendung, gegliedert nach Phasen: Kauf · Halten/Vermieten · Verkauf.
// Rein informatorisch und rechnerisch – KEINE Steuerberatung (§ 34i GewO / StBerG). Alle Angaben: Stand Oktober 2026.
// Pro-Werkzeuge erscheinen im Profi-Modus; die Rechenlogik liegt in calc.mjs und ist per node:test geprüft.
import { GREST, verbilligteMiete, dreiObjektGrenze, verkaufSteuerfrei, grenze15 } from './calc.mjs';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (x) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
const E2 = (x) => (x == null || Number.isNaN(x) ? '–' : x.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
const num = (id) => { const v = $(id)?.value; return v === '' || v == null ? 0 : Number(v); };
const val = (id) => $(id)?.value || '';
const LAND_OPTS = (sel) => Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${g.name} (${g.pct} %)</option>`).join('');
const KEY = 'ia-steuer-v1';

let root = null;

// Werbungskosten bei Vermietung (laufend, Beispiele). AfA wird separat in der Objekt-Analyse berechnet.
const WK = [
  ['wk_zins', 'Schuldzinsen (Finanzierung)'],
  ['wk_haus', 'Hausgeld – nicht umlagefähiger Teil (z. B. Verwaltergebühr)'],
  ['wk_grundst', 'Grundsteuer'],
  ['wk_vers', 'Gebäude-/Haftpflichtversicherung'],
  ['wk_verw', 'Hausverwaltung (bei Häusern, falls nicht im Hausgeld)'],
  ['wk_erhalt', 'Erhaltungsaufwand (Reparaturen, Wartung)'],
  ['wk_fahrt', 'Fahrtkosten zum Objekt'],
  ['wk_konto', 'Kontoführung, Porto, Telefon'],
  ['wk_beratung', 'Steuerberatung (Anlage V)'],
  ['wk_makler', 'Makler bei Neuvermietung'],
];

function render(mode, phase = 'kauf') {
  const pro = mode === 'profi';
  const proCard = (title, inner) => pro
    ? `<article class="dash-card st-tool"><h3>${title} <span class="st-badge">Profi</span></h3>${inner}</article>`
    : `<article class="dash-card st-lock"><h3>${title} <span class="st-badge">Profi</span></h3><p class="form-note">Diese Auswertung gehört zum Profi-Bereich. Oben rechts auf „Einsteiger ⇄ Profi“ in den Profi-Modus wechseln.</p></article>`;
  const SEC = {
    kauf: `  <h2 class="st-phase">Kauf</h2>
  <div class="an-grid">
    <article class="dash-card st-tool"><h3>Welche Kaufkosten wie wirken</h3>
      <ul class="st-list">
        <li><strong>Grunderwerbsteuer, Notar, Grundbuch, Makler</strong> → gehören zu den Anschaffungskosten. Nicht sofort absetzbar, sondern nur über die AfA (Gebäudeanteil) über viele Jahre.</li>
        <li><strong>Finanzierungskosten</strong> (Bereitstellungszinsen, Disagio/Damnum, Wertgutachten der Bank, Kontoführung) → sofort als Werbungskosten absetzbar.</li>
        <li><strong>Renovierung kurz nach Kauf</strong> → Vorsicht 15-%-Grenze (§ 6 Abs. 1 Nr. 1a EStG), siehe „Halten &amp; Vermieten“.</li>
        <li><strong>Gebäudeanteil</strong> möglichst hoch (sauber) ansetzen → höhere AfA. Aufteilung in der Objekt-Analyse.</li>
      </ul></article>

    <article class="dash-card st-tool"><h3>Grunderwerbsteuer senken: Inventar herausrechnen</h3>
      <div class="obj-grid">
        <label>Bundesland<select id="s_inv_land">${LAND_OPTS('hessen')}</select></label>
        <label>Mitgekauftes Inventar (€)<input id="s_inv_wert" type="number" min="0" step="500" placeholder="z. B. Einbauküche 8000"></label>
      </div>
      <div class="st-out" id="s_inv_out" aria-live="polite"></div>
      <p class="form-note">Bewegliches, mitverkauftes Inventar (Einbauküche, Möbel, Sauna) kann im Kaufvertrag gesondert und angemessen ausgewiesen werden; darauf fällt keine Grunderwerbsteuer an. Finanziert die Bank, akzeptiert sie den Inventaranteil oft nur begrenzt.</p>
    </article>
  </div>

`,
    halten: `  <h2 class="st-phase">Halten &amp; Vermieten</h2>
  <div class="an-grid">
    <article class="dash-card st-tool"><h3>Werbungskosten-Checkliste (pro Jahr)</h3>
      <div class="st-wk">${WK.map(([id, label]) => `<label class="st-wk-row"><span>${label}</span><input id="${id}" type="number" min="0" step="10" placeholder="€"></label>`).join('')}</div>
      <div class="st-out" id="s_wk_out" aria-live="polite"></div>
      <p class="form-note">Summe ohne AfA – die Gebäudeabschreibung kommt aus der Objekt-Analyse zusätzlich obendrauf. Eingaben gehören in die Anlage V der Steuererklärung. Die Zuführung zur Erhaltungsrücklage im Hausgeld ist erst absetzbar, wenn die Gemeinschaft das Geld tatsächlich für Reparaturen ausgibt (Jahresabrechnung).</p>
    </article>

    <article class="dash-card st-tool"><h3>66-%-Check: verbilligte Vermietung</h3>
      <div class="obj-grid">
        <label>Ihre Kaltmiete (€/Monat)<input id="s_vm_ist" type="number" min="0" step="10" placeholder="z. B. 700"></label>
        <label>Ortsübliche Kaltmiete (€/Monat)<input id="s_vm_markt" type="number" min="0" step="10" placeholder="z. B. 1000"></label>
      </div>
      <div class="st-out" id="s_vm_out" aria-live="polite"></div>
      <p class="form-note">Relevant vor allem bei Vermietung an Angehörige. Ortsübliche Miete aus dem Mietspiegel (Kaltmiete × Fläche).</p>
    </article>

    <article class="dash-card st-tool"><h3>Erhaltungsaufwand auf mehrere Jahre verteilen (§ 82b EStDV)</h3>
      <div class="obj-grid">
        <label>Größere Erhaltungsaufwendung (€)<input id="s_eh_betrag" type="number" min="0" step="100" placeholder="z. B. 24000"></label>
        <label>Verteilung auf Jahre<select id="s_eh_jahre"><option>2</option><option>3</option><option>4</option><option selected>5</option></select></label>
      </div>
      <div class="st-out" id="s_eh_out" aria-live="polite"></div>
      <p class="form-note">Bei vermieteten Wohngebäuden im Privatvermögen kann größerer Erhaltungsaufwand gleichmäßig auf 2 bis 5 Jahre verteilt werden – nützlich zur Steuerglättung. Keine anschaffungsnahen Herstellungskosten (siehe Profi-Tracker).</p>
    </article>

    ${proCard('15-%-Grenze-Tracker (erste 3 Jahre)', `
      <div class="obj-grid">
        <label>Kaufpreis (€)<input id="s_15_price" type="number" min="0" step="1000" placeholder="z. B. 300000"></label>
        <label>Kaufnebenkosten (%)<input id="s_15_nk" type="number" min="0" step="0.1" value="10"></label>
        <label>Gebäudeanteil (%)<input id="s_15_geb" type="number" min="0" max="100" step="1" value="75"></label>
        <label>Bisher ausgegeben, netto (€)<input id="s_15_spent" type="number" min="0" step="500" placeholder="Renovierung ohne USt"></label>
      </div>
      <div class="st-out" id="s_15_out" aria-live="polite"></div>
      <p class="form-note">Überschreiten Instandsetzungen in den ersten drei Jahren nach Kauf 15 % der Gebäude-Anschaffungskosten (netto), gelten sie als anschaffungsnahe Herstellungskosten – dann nur über die AfA absetzbar statt sofort.</p>`)}
  </div>

`,
    verkauf: `  <h2 class="st-phase">Verkauf</h2>
  <div class="an-grid">
    <article class="dash-card st-tool"><h3>Verkauf steuerfrei? (Spekulationsfrist &amp; Eigennutzung)</h3>
      <div class="obj-grid">
        <label>Kaufdatum (Notarvertrag)<input id="s_sp_kauf" type="date"></label>
        <label>Geplanter Verkauf (optional)<input id="s_sp_verkauf" type="date"></label>
      </div>
      <label class="consent"><input type="checkbox" id="s_sp_eigen"> Selbst bewohnt – seit dem Kauf oder im Verkaufsjahr und den beiden Kalenderjahren davor</label>
      <div class="st-out" id="s_sp_out" aria-live="polite"></div>
      <p class="form-note">Privater Verkauf ist nach 10 Jahren steuerfrei (§ 23 EStG). Früher steuerfrei bei Eigennutzung: entweder ausschließlich selbst bewohnt seit dem Kauf oder im Verkaufsjahr und den beiden vorangegangenen Kalenderjahren (das Verkaufsjahr muss nicht voll sein – in der Praxis reichen oft gut ein Jahr plus zwei Tage über drei Kalenderjahre).</p>
    </article>

    ${proCard('Drei-Objekt-Grenze', `
      <label>Verkaufsdaten (ein Datum je Zeile, Format JJJJ-MM-TT)<textarea id="s_3o_dates" rows="4" placeholder="2023-05-01&#10;2024-02-15&#10;2025-09-01"></textarea></label>
      <div class="st-out" id="s_3o_out" aria-live="polite"></div>
      <p class="form-note">Werden in engem zeitlichem Zusammenhang (i. d. R. 5 Jahre) mehr als drei Objekte verkauft, droht gewerblicher Grundstückshandel: Gewerbesteuer und kein steuerfreier Verkauf. Keine starre Grenze – Einzelfall mit der Steuerberatung klären.</p>`)}
  </div>
`,
  };
  const order = phase === 'halten' ? ['halten', 'verkauf', 'kauf'] : phase === 'verkauf' ? ['verkauf', 'halten', 'kauf'] : ['kauf', 'halten', 'verkauf'];
  const mark = (k, html) => (k === order[0] ? html.replace('</h2>', ' <span class="st-badge st-badge-ph">Passend zu Ihrer Phase</span></h2>') : html);
  return `<section class="st-view" aria-label="Steuer">
  <p class="faq-disclaimer">Informations- und Rechenhilfe, <strong>keine Steuerberatung</strong> (§ 34i GewO / StBerG). Für Ihre konkrete Situation fragen Sie Ihre Steuerberatung. Stand: Oktober 2026.</p>

${order.map((k) => mark(k, SEC[k])).join('')}
</section>`;
}

const ampel = (cls, text) => `<span class="st-tag ${cls}">${esc(text)}</span>`;

function updateInv() {
  if (!$('s_inv_out')) return;
  const wert = num('s_inv_wert'), pct = GREST[val('s_inv_land')]?.pct ?? 0;
  const spar = wert * pct / 100;
  $('s_inv_out').innerHTML = wert > 0
    ? `<div class="st-res"><span>Ersparnis Grunderwerbsteuer</span><strong>${E(spar)}</strong></div><p class="form-note">= ${E(wert)} × ${pct} %. Inventar muss angemessen bewertet und im Vertrag ausgewiesen sein.</p>`
    : '<p class="form-note">Inventarwert eingeben.</p>';
}

function updateWk() {
  if (!$('s_wk_out')) return;
  const summe = WK.reduce((s, [id]) => s + num(id), 0);
  $('s_wk_out').innerHTML = `<div class="st-res"><span>Summe Werbungskosten pro Jahr (ohne AfA)</span><strong>${E2(summe)}</strong></div>`;
}

function updateVm() {
  if (!$('s_vm_out')) return;
  const r = verbilligteMiete({ ist: num('s_vm_ist'), ortsueblich: num('s_vm_markt') });
  if (!r) { $('s_vm_out').innerHTML = '<p class="form-note">Beide Mieten eingeben.</p>'; return; }
  const cls = r.stufe === 'voll' ? 'ok' : r.stufe === 'prognose' ? 'warn' : 'bad';
  $('s_vm_out').innerHTML = `<div class="st-res"><span>Ihre Miete entspricht</span><strong>${r.quote.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</strong> ${ampel(cls, r.stufe === 'voll' ? 'voller Abzug' : r.stufe === 'prognose' ? 'Prognose nötig' : 'nur anteilig')}</div>
    <p class="form-note">${esc(r.hinweis)} Für vollen Abzug mindestens ${E2(r.mindestMiete66)}/Monat (66 %).</p>`;
}

function updateEh() {
  if (!$('s_eh_out')) return;
  const betrag = num('s_eh_betrag'), jahre = Number(val('s_eh_jahre')) || 5;
  $('s_eh_out').innerHTML = betrag > 0
    ? `<div class="st-res"><span>Abzug pro Jahr über ${jahre} Jahre</span><strong>${E2(betrag / jahre)}</strong></div>`
    : '<p class="form-note">Betrag eingeben.</p>';
}

function update15() {
  if (!$('s_15_out')) return;
  const price = num('s_15_price');
  if (!(price > 0)) { $('s_15_out').innerHTML = '<p class="form-note">Kaufpreis eingeben.</p>'; return; }
  const g = grenze15({ price, purchaseCostPct: num('s_15_nk'), buildingSharePct: num('s_15_geb'), spentNet: num('s_15_spent') });
  const cls = g.exceeded ? 'bad' : g.headroom < g.limit * 0.2 ? 'warn' : 'ok';
  $('s_15_out').innerHTML = `<div class="st-res"><span>15-%-Grenze (Gebäude-AK ${E(g.akGebaeude)})</span><strong>${E(g.limit)}</strong></div>
    <div class="st-res"><span>Noch möglich bis zur Grenze</span><strong>${E(g.headroom)}</strong> ${ampel(cls, g.exceeded ? 'überschritten' : cls === 'warn' ? 'fast erreicht' : 'im Rahmen')}</div>
    ${g.exceeded ? '<p class="form-note">Über der Grenze: Aufwand gilt als anschaffungsnahe Herstellungskosten – nur über die AfA absetzbar. Ggf. Maßnahmen über das dritte Jahr hinaus strecken.</p>' : ''}`;
}

function updateSp() {
  if (!$('s_sp_out')) return;
  const r = verkaufSteuerfrei({ anschaffung: val('s_sp_kauf'), verkauf: val('s_sp_verkauf') || null, eigengenutzt: $('s_sp_eigen')?.checked });
  if (!r) { $('s_sp_out').innerHTML = '<p class="form-note">Kaufdatum eingeben.</p>'; return; }
  const d = new Date(r.fristEnde).toLocaleDateString('de-DE'), ab = new Date(r.steuerfreiAb).toLocaleDateString('de-DE');
  let line;
  if (r.steuerfrei) line = `<div class="st-res"><span>Veräußerung</span><strong>steuerfrei</strong> ${ampel('ok', 'steuerfrei')}</div><p class="form-note">${esc(r.grund)}</p>`;
  else if (r.spekulationVorbei === false) line = `<div class="st-res"><span>Zum geplanten Verkauf</span><strong>steuerpflichtig</strong> ${ampel('bad', 'noch in der Frist')}</div><p class="form-note">Steuerfrei (ohne Eigennutzung) erst bei Notarvertrag ab ${esc(ab)}. Der Gewinn wird sonst mit Ihrem persönlichen Steuersatz besteuert (Freigrenze 1.000 € je Jahr für alle privaten Veräußerungen zusammen).</p>`;
  else line = `<div class="st-res"><span>Steuerfrei verkaufen ab</span><strong>${esc(ab)}</strong></div><p class="form-note">Maßgeblich ist das Datum des Notarvertrags, nicht der Übergabe. Frist endet am ${esc(d)}. Verkaufsdatum eintragen für ein konkretes Ergebnis.</p>`;
  $('s_sp_out').innerHTML = line;
}

function update3o() {
  if (!$('s_3o_out')) return;
  const dates = val('s_3o_dates').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  const r = dreiObjektGrenze(dates);
  if (!r.anzahl) { $('s_3o_out').innerHTML = '<p class="form-note">Verkaufsdaten eingeben.</p>'; return; }
  const cls = r.risiko ? 'bad' : r.maxImFenster === 3 ? 'warn' : 'ok';
  $('s_3o_out').innerHTML = `<div class="st-res"><span>Meiste Verkäufe in 5 Jahren</span><strong>${r.maxImFenster}</strong> ${ampel(cls, r.risiko ? 'Risiko gewerblich' : r.maxImFenster === 3 ? 'Grenze erreicht' : 'unkritisch')}</div>
    ${r.risiko ? `<p class="form-note">Mehr als drei Verkäufe zwischen ${esc(new Date(r.fenster.von).toLocaleDateString('de-DE'))} und ${esc(new Date(r.fenster.bis).toLocaleDateString('de-DE'))}. Bitte mit der Steuerberatung prüfen.</p>` : '<p class="form-note">Bis zu drei Objekte gelten in der Regel als unkritisch.</p>'}`;
}

const ALL = [updateInv, updateWk, updateVm, updateEh, update15, updateSp, update3o];
function updateAll() { ALL.forEach((f) => { try { f(); } catch { /* Werkzeug im Einsteiger-Modus ausgeblendet */ } }); }

export function mountSteuer(container, { mode = 'einsteiger', phase = 'kauf' } = {}) {
  root = container;
  root.innerHTML = render(mode, phase);
  const ids = [...root.querySelectorAll('input, select, textarea')].map((e) => e.id).filter(Boolean);
  try { const s = JSON.parse(localStorage.getItem(KEY) || '{}'); ids.forEach((id) => { const el = $(id); if (el && s[id] !== undefined) { if (el.type === 'checkbox') el.checked = s[id]; else el.value = s[id]; } }); } catch { /* ohne Speicher */ }
  const save = () => { try { const o = {}; ids.forEach((id) => { const el = $(id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }); localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* ohne Speicher */ } };
  root.addEventListener('input', () => { updateAll(); save(); });
  root.addEventListener('change', () => { updateAll(); save(); });
  updateAll();
}
