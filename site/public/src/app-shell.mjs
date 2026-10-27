// App-Rahmen für das Konto: Handy wie eine App (Tab-Leiste unten), Desktop wie ein Investment-Tool (Seitenleiste).
// Ansichten über #hash; vorhandene Karten werden den Ansichten zugeordnet. Modus Einsteiger/Profi frei wählbar.
import { openBuy, planIcon, resumeIntent } from './buy.mjs?v=892f3666';
import { rank, GREST, portfolio, upcoming, readiness } from './calc.mjs?v=892f3666';
const GREST_KEYS = Object.keys(GREST);

const $ = (id) => document.getElementById(id);
// Zurück von Stripe (oder einer anderen fremden Seite) mit der Browser-Zurück-Taste: Safari zeigt sonst den alten
// Bildschirm mit gesperrten Knöpfen. Dann den Kontobereich frisch laden – mit aktuellem Tarif und Zahlungsmittel.
// Nach einem Wechsel auf eine eigene Seite (z. B. „Ganze Seite öffnen“) bleibt die Seite dagegen exakt so stehen, wie man sie verlassen hat.
addEventListener('pageshow', (e) => { if (e.persisted && (!window.__iaNeedReload || window.__iaNeedReload())) { try { sessionStorage.setItem('lr-ret-back', '1'); } catch { /* ignore */ } location.reload(); } });
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (cents) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
// Leistungsvergleich der Tarife als Tabelle (Spalte hl hervorgehoben).
const cmpTable = (v, hl = -1) => (v?.zeilen?.length ? `<details class="cmp" open><summary>Tarife im Vergleich</summary><div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th>${v.spalten.map((s, i) => `<th${i === hl ? ' class="hl"' : ''}>${esc(s)}</th>`).join('')}</tr></thead><tbody>${v.zeilen.map(([l, ...c]) => `<tr><th scope="row">${esc(l)}</th>${c.map((x, i) => `<td class="${x === '✓' ? 'y' : x === '–' ? 'n' : ''}${i === hl ? ' hl' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '');


const ICON = {
  start: '<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.5"/><rect x="3" y="15" width="7.5" height="6" rx="1.5"/>',
  suche: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5"/>',
  objekte: '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6h6v6"/>',
  lernen: '<path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c0 2 3 4 6 4s6-2 6-4v-5"/>',
  angebot: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  konto: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  werkzeuge: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  steuer: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  support: '<path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const VIEWS = {
  einsteiger: [['start', 'Übersicht'], ['objekte', 'Objekte'], ['werkzeuge', 'Software-Tools'], ['steuer', 'Steuer'], ['lernen', 'Wissen'], ['angebot', 'Angebot'], ['konto', 'Konto'], ['support', 'Hilfe & Support']],
  profi: [['start', 'Übersicht'], ['objekte', 'Objekte'], ['werkzeuge', 'Software-Tools'], ['steuer', 'Steuer & AfA'], ['lernen', 'Fachwissen'], ['angebot', 'Tarif'], ['konto', 'Konto'], ['support', 'Hilfe & Support']],
};
const TABS = ['start', 'objekte', 'werkzeuge', 'lernen', 'konto'];

// Lernbereich: Themen frei wählbar (keine feste Reihenfolge). Wissen aus /data/faq.json (Kurz- und Detailantwort).
// [id, Titel, Kurzbeschreibung, FAQ-Indizes, [Werkzeug-Text, Link], Bereich]
const LERN = [
  ['geld', 'Wie funktioniert Geld?', 'Wie Geld entsteht, was Inflation mit Ihrem Geld macht, warum sich Investieren lohnt und wie Vermögen wächst.', [37, 38, 39, 40, 41, 42, 43], ['Kaufen oder mieten?', '/calculators/rent-vs-buy'], 'Geld & Vermögen'],
  ['budget', 'Was kann ich mir leisten?', 'Rate, Darlehen und Kaufpreis aus Einkommen und Eigenkapital.', [0, 5, 6], ['Budget-Rechner', '/calculators/budget'], 'Leisten & Finanzieren'],
  ['eigenkapital', 'Eigenkapital und Kaufnebenkosten', 'Wie viel eigenes Geld nötig ist und was zum Kaufpreis dazukommt.', [1, 2], ['Kaufnebenkosten-Rechner', '/calculators/closing-costs'], 'Leisten & Finanzieren'],
  ['annuitaet', 'Zins, Tilgung, Zinsbindung', 'Wie sich die Rate zusammensetzt.', [3], ['Tilgungsplan', '/calculators/amortization'], 'Leisten & Finanzieren'],
  ['fristen', 'Wenn die Zinsbindung endet', 'Anschlussfinanzierung, Kipp-Punkt und wichtige Fristen.', [23, 24], ['Fristen-Rechner', '/deadlines'], 'Leisten & Finanzieren'],
  ['beruf', 'Was die Bank je nach Beruf prüft', 'Angestellt, selbstständig, verbeamtet – und welche Unterlagen.', [4], ['Erwerbsstatus im Detail', '/learn/erwerbsstatus'], 'Leisten & Finanzieren'],
  ['beleihung', 'Beleihungswert: wie die Bank rechnet', 'Warum die Bank anders bewertet als der Verkäufer.', [7], ['Deal-Scorecard', '/calculators/scorecard'], 'Leisten & Finanzieren'],
  ['suche', 'Exposés prüfen und vergleichen', 'Vom Exposé zur Kennzahl – und mehrere Angebote nebeneinander.', [10], ['Import & Analyse', '#objekte'], 'Objekt finden & prüfen'],
  ['etw', 'Eigentumswohnung richtig prüfen', 'Teilungserklärung, Protokolle, Rücklage.', [8, 9], ['Unterlagen-Checkliste', '/checklist'], 'Objekt finden & prüfen'],
  ['cashflow', 'Rendite und Cashflow', 'Brutto, netto, vor und nach Steuern.', [12, 13, 14], ['Cashflow-Rechner', '/calculators/cash-flow'], 'Rendite, Steuer & Miete'],
  ['steuer', 'Steuern: AfA, 15-%-Grenze, steuerfreier Verkauf', 'Was die Steuer beim Kauf, Vermieten und Verkaufen bedeutet.', [15, 16, 17], ['Steuer-Bereich', '#steuer'], 'Rendite, Steuer & Miete'],
  ['miete', 'Mietrecht für Vermieter', 'Mietpreisbremse, Kappungsgrenze, Staffelmiete, Mietausfall.', [18, 19, 20, 21], ['Mieterhöhung prüfen', '/calculators/rent-increase'], 'Rendite, Steuer & Miete'],
  ['unterlagen', 'Unterlagen und Kreditmappe', 'Was die Bank sehen will und wie Sie es vollständig machen.', [11, 25, 26, 27], ['Unterlagen-Checkliste', '/checklist'], 'Bank & Unterlagen'],
  ['mahnung', 'Mieter zahlt nicht: Mahnung, Mahnverfahren, Kündigung', 'So sichern Sie sich rechtlich ab – Schritt für Schritt.', [33, 34, 35, 36], ['Online-Mahnantrag der Justiz', 'https://www.online-mahnantrag.de'], 'Vermieten & Absicherung'],
];
// Phasen = die vier Stufen von „Ihr Weg“. Frei wählbar (profile.phase 0–3), sonst automatisch erkannt.
// Die gewählte Phase steuert Startaktionen, Reihenfolge im Steuer-Bereich und empfohlene Wissensthemen.
export const PHASES = [
  { name: 'Orientieren', plan: 'Erst verstehen, wie Geld, Eigenkapital und Finanzierung funktionieren – dann wissen Sie, was Sie sich leisten können.', steuer: 'kauf', lern: ['geld', 'budget', 'eigenkapital', 'annuitaet', 'beruf'],
    actions: [['/calculators/budget', 'Budget berechnen', 'Was kann ich mir leisten?'], ['#lernen', 'Grundlagen auffrischen', 'Eigenkapital, Zins, Tilgung'], ['#objekte', 'Exposé prüfen', 'PDF oder Link hochladen – Kennzahlen sofort']] },
  { name: 'Objekte prüfen', plan: 'Lernen Sie, Angebote wie ein Profi zu lesen: Rendite, Cashflow, Zustand und was die Bank vom Objekt hält.', steuer: 'kauf', lern: ['suche', 'etw', 'cashflow', 'beleihung'],
    actions: [['#objekte', 'Objekt analysieren', 'Inserat übernehmen, Kennzahlen sehen'], ['#objekte', 'Objekte im Konto', 'Anlegen, vergleichen, Bankreife'], ['#steuer', 'Steuern beim Kauf', 'Kaufkosten, Inventar, AfA']] },
  { name: 'Bankgespräch', plan: 'Bereiten Sie sich auf die Bank vor: Unterlagen, Beleihungswert und wie Ihr Beruf bewertet wird.', steuer: 'kauf', lern: ['unterlagen', 'beruf', 'beleihung', 'annuitaet'],
    actions: [['#objekte', 'Kreditmappe erstellen', 'Objekt wählen → Vorschau → PDF'], ['/checklist', 'Unterlagen vollständig machen', 'Bankreife auf 90 % bringen'], ['#lernen', 'Was die Bank prüft', 'Beleihungswert, Unterlagen']] },
  { name: 'Bestand', plan: 'Ihre Immobilie gut führen: Steuern, Mietrecht, Fristen und was tun, wenn die Miete ausbleibt.', steuer: 'halten', lern: ['steuer', 'miete', 'mahnung', 'fristen'],
    actions: [['/deadlines', 'Fristen im Blick', 'Zinsbindung, 15-%-Grenze, Spekulationsfrist'], ['#steuer', 'Steuern & Werbungskosten', 'Anlage V, 66-%-Check, Verkauf'], ['#lernen', 'Mieter zahlt nicht?', 'Mahnung, Mahnverfahren, Kündigung']] },
];
// Profi-Stufen: gleiche Nummerierung (profile.phase 0–3), aber eigene Ziele, Werkzeuge und Fachthemen –
// für Investoren mit Erfahrung statt Erklärtext für den ersten Kauf.
export const PHASES_PRO = [
  { name: 'Ankauf prüfen', plan: 'Deal-Screening nach harten Kennzahlen: Kaufpreisfaktor, Nettomietrendite, DSCR, Kipp-Zins und Cashflow nach Steuern – bevor Sie ein Angebot abgeben.', steuer: 'kauf', lern: ['cashflow', 'beleihung', 'etw', 'steuer'],
    actions: [['/calculators/scorecard', 'Deal-Scorecard', 'Faktor, Rendite, DSCR auf einen Blick'], ['#objekte', 'Exposé-Analyse', 'Inserat übernehmen, Kennzahlen rechnen'], ['/calculators/cash-flow', 'Cashflow nach Steuern', 'AfA, Grenzsteuersatz, Zinsanteil']] },
  { name: 'Finanzierung strukturieren', plan: 'Beleihungsauslauf, Zinsbindung, Tilgungsstrategie und Forward optimieren – Bankangebote auf gleicher Basis vergleichen und verhandeln.', steuer: 'kauf', lern: ['beleihung', 'unterlagen', 'annuitaet', 'beruf'],
    actions: [['/calculators/loan-comparison', 'Bankangebote vergleichen', 'Effektivzins, Restschuld, Gesamtkosten'], ['/scenarios', 'Anschluss & Forward', 'Kipp-Zins und Zinsszenarien'], ['#objekte', 'Kreditmappe', 'BankReady mit Prüfsumme']] },
  { name: 'Portfolio aufbauen', plan: 'Weitere Objekte hebeln: Eigenkapital-Recycling, Zinsschock auf den Gesamtbestand und die Drei-Objekt-Grenze (gewerblicher Grundstückshandel) im Blick.', steuer: 'halten', lern: ['steuer', 'fristen', 'cashflow', 'beleihung'],
    actions: [['/cockpit', 'Portfolio-Stresstest', 'Zinsschock und Mietausfall auf den Bestand'], ['#werkzeuge', 'Portfolio-Kennzahlen', 'LTV, DSCR und Cashflow je Objekt'], ['/deadlines', 'Fristen & Grenzen', '§ 23 EStG, Drei-Objekt-Grenze']] },
  { name: 'Bestand optimieren', plan: 'Rendite im Bestand heben: Mieterhöhung nach Mietspiegel, Anlage V, 15-%-Grenze bei Sanierungen und Exit-Planung nach zehn Jahren.', steuer: 'halten', lern: ['miete', 'steuer', 'mahnung', 'fristen'],
    actions: [['/calculators/rent-increase', 'Mieterhöhung', 'Kappungsgrenze und Briefentwurf'], ['#steuer', 'Anlage V & AfA', '15-%-Grenze, Erhaltungsaufwand'], ['/scenarios', 'Exit-Szenario', 'Verkauf, Restschuld, Steuer']] },
];
const STAGE_EFFECT_PRO = [
  'Übersicht: Scorecard, Exposé-Analyse, Cashflow nach Steuern · Fachwissen: Beleihung, ETW-Prüfung · Steuer: Kaufpreisaufteilung',
  'Übersicht: Angebotsvergleich, Anschluss & Forward, Kreditmappe · Fachwissen: Beleihungswert, Unterlagen · Steuer: Kaufphase',
  'Übersicht: Portfolio-Stresstest und Kennzahlen je Objekt · Fachwissen: Steuern, Fristen · Steuer: Bestand',
  'Übersicht: Mieterhöhung, Anlage V, Exit · Fachwissen: Mietrecht, Mahnverfahren · Steuer: Bestand und Verkauf',
];
// Stufen passend zur Ansicht (Einsteiger oder Profi).
const isPro = () => document.body?.dataset?.mode === 'profi';
const PH = () => (isPro() ? PHASES_PRO : PHASES);
export function phaseOf(d) {
  const p = d.profile?.phase;
  if (Number.isInteger(p) && p >= 0 && p < PHASES.length) return { idx: p, chosen: true };
  try { return { idx: Math.max(0, Math.min(3, rank(d.profile || {}, Array.isArray(d.objects) ? d.objects : [], []).level - 1)), chosen: false }; } catch { return { idx: 0, chosen: false }; }
}
// „Ihre Stufe“ als Einstellung: eine Zeile mit der aktuellen Stufe, Knopf öffnet die Auswahl (siehe openStage).
const STAGE_EFFECT = [
  'Übersicht zeigt Budget und Grundlagen · Lernplan: Geld, Eigenkapital, Zins und Tilgung · Steuern: Kaufphase',
  'Übersicht zeigt Objektanalyse und Vergleich · Lernplan: Exposé lesen, Cashflow, Beleihung · Steuern: Kaufphase',
  'Übersicht zeigt Kreditmappe und Unterlagen · Lernplan: Unterlagen, Beruf, Beleihungswert · Steuern: Kaufphase',
  'Übersicht zeigt Fristen und Steuern · Lernplan: Steuern, Mietrecht, Mahnung, Fristen · Steuern: Bestand halten',
];
const phasePicker = (idx, chosen) => `<div class="stage-row" role="group" aria-label="Ihre Stufe"><div class="stage-cur"><span class="stage-k">Ihre Stufe${chosen ? '' : ' · automatisch erkannt'}</span><strong><b class="stage-n">${idx + 1}</b>${PH()[idx].name}</strong><small>${PH()[idx].plan}</small></div><button type="button" class="btn btn-outline stage-open">Stufe ändern</button></div>`;
let STAGE_D = null;
function stageToast(t) {
  let el = document.getElementById('stageToast');
  if (!el) { el = document.createElement('div'); el.id = 'stageToast'; el.className = 'stage-toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.innerHTML = t; el.classList.add('on'); clearTimeout(stageToast.t); stageToast.t = setTimeout(() => el.classList.remove('on'), 4200);
}
function openStage() {
  if (!STAGE_D) return;
  const cur = phaseOf(STAGE_D);
  let dlg = document.getElementById('stageDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'stageDlg'; dlg.className = 'stage-dlg'; document.body.append(dlg); }
  dlg.innerHTML = `<form method="dialog" class="stage-in"><div class="stage-head"><div><span class="stage-k">Einstellung</span><h2>${isPro() ? 'Ihr Schwerpunkt' : 'Ihre Stufe'}</h2></div><button class="stage-x" value="x" aria-label="Schließen">×</button></div>
    <p class="form-note">${isPro() ? 'Profi-Ansicht: Wählen Sie Ihren aktuellen Investitions-Schwerpunkt. Werkzeuge der Übersicht, Fachwissen und Steuer-Bereich werden danach priorisiert.' : 'Wählen Sie, wo Sie gerade stehen. Die ganze Anwendung stellt sich darauf ein: Startseite, Lernplan, Reihenfolge im Wissen und der Steuer-Bereich. Sie können jederzeit wechseln.'}</p>
    <div class="stage-opts${isPro() ? ' pro' : ''}">${PH().map((p, i) => `<button type="button" class="stage-opt${cur.chosen && cur.idx === i ? ' on' : ''}" data-stage="${i}"><b class="stage-n">${i + 1}</b><span><strong>${p.name}</strong><small>${p.plan}</small><em>${(isPro() ? STAGE_EFFECT_PRO : STAGE_EFFECT)[i]}</em>${isPro() ? `<span class="stage-tools">${p.actions.map(([, t]) => `<i>${t}</i>`).join('')}</span>` : ''}</span></button>`).join('')}
    <button type="button" class="stage-opt stage-auto${cur.chosen ? '' : ' on'}" data-stage="auto"><b class="stage-n">A</b><span><strong>Automatisch</strong><small>${isPro() ? 'LeaseRun leitet den Schwerpunkt aus Ihrem Bestand ab (Objekte, Finanzierungen, Fristen).' : 'LeaseRun erkennt die Stufe aus Ihren Daten (Finanzprofil, Objekte, Bankreife) und stellt sie selbst um.'}</small></span></button></div>
    <p class="form-note wiz-again">Ziel geändert? <button type="button" class="link-btn wiz-open">Einrichtung neu starten</button> – Ziel, Stufe und Ansicht in drei Fragen.</p></form>`;
  dlg.querySelectorAll('[data-stage]').forEach((b) => b.onclick = () => {
    const v = b.dataset.stage === 'auto' ? null : Number(b.dataset.stage);
    dlg.close();
    try { sessionStorage.setItem('lr-stage-msg', v == null ? 'auto' : String(v)); } catch { /* ignore */ }
    if (window.__iaSetPhase) window.__iaSetPhase(v);
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}
document.addEventListener('click', (e) => { if (e.target.closest?.('.stage-open')) { e.preventDefault(); openStage(); } });
// ---------- Einstiegs-Assistent: Ziel, Stand, Zahlen → Modus, Stufe, Lernplan, Finanzprofil ----------
let APP = null; // { u, d, saveData, reload } – wird in setupApp gesetzt
const GOALS = {
  selbst: { name: 'Selbst einziehen', sub: 'Eigene Wohnung oder eigenes Haus kaufen', lern: ['budget', 'eigenkapital'] },
  anlage: { name: 'Kapitalanlage', sub: 'Kaufen und vermieten, Vermögen aufbauen', lern: ['cashflow', 'steuer'] },
  bestand: { name: 'Schon Eigentümer', sub: 'Bestehende Immobilien gut führen', lern: ['steuer', 'fristen'] },
};
const WIZ_STAND = ['Ich informiere mich erst', 'Ich prüfe konkrete Objekte', 'Ich bereite das Bankgespräch vor', 'Ich habe bereits gekauft'];
// Empfohlene Lernthemen: Stufe plus Ziel (ohne Dopplung).
const recLern = (d) => [...new Set([...PH()[phaseOf(d).idx].lern, ...(GOALS[d.profile?.goal]?.lern || [])])];
function openWizard() {
  if (!APP) return;
  const pr = APP.d.profile || {};
  const st = { goal: pr.goal || '', phase: Number.isInteger(pr.phase) ? pr.phase : null, income: pr.netIncome || '', equity: pr.equity ?? '', mode: pr.mode || '' };
  let step = 0;
  let dlg = document.getElementById('wizDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'wizDlg'; dlg.className = 'stage-dlg wiz-dlg'; document.body.append(dlg); }
  const autoMode = () => (st.goal === 'bestand' || (st.goal === 'anlage' && st.phase >= 2) ? 'profi' : 'einsteiger');
  const draw = () => {
    const dots = `<div class="wiz-dots" aria-label="Schritt ${step + 1} von 4">${[0, 1, 2, 3].map((i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
    let body = '';
    if (step === 0) body = `<h2>Was haben Sie vor?</h2><div class="stage-opts">${Object.entries(GOALS).map(([k, g]) => `<button type="button" class="stage-opt${st.goal === k ? ' on' : ''}" data-goal="${k}"><b class="stage-n">${{ selbst: '⌂', anlage: '€', bestand: '✓' }[k]}</b><span><strong>${g.name}</strong><small>${g.sub}</small></span></button>`).join('')}</div>`;
    if (step === 1) body = `<h2>Wo stehen Sie gerade?</h2><div class="stage-opts">${WIZ_STAND.map((t, i) => `<button type="button" class="stage-opt${st.phase === i ? ' on' : ''}" data-ph="${i}"><b class="stage-n">${i + 1}</b><span><strong>${t}</strong><small>Stufe ${i + 1} · ${PH()[i].name}</small></span></button>`).join('')}</div>`;
    if (step === 2) body = `<h2>Ihre Zahlen <small class="wiz-opt">optional</small></h2><p class="form-note">Damit rechnet LeaseRun Budget und Bankreife für Sie. Sie können das auch später im Konto eintragen.</p>
      <label class="wiz-f">Nettoeinkommen im Monat (Haushalt)<input id="wizInc" type="number" inputmode="decimal" min="0" step="50" placeholder="z. B. 4200" value="${st.income}"></label>
      <label class="wiz-f">Eigenkapital<input id="wizEq" type="number" inputmode="decimal" min="0" step="1000" placeholder="z. B. 60000" value="${st.equity}"></label>`;
    if (step === 3) {
      const m = st.mode || autoMode();
      body = `<h2>So stellen wir LeaseRun für Sie ein</h2><ul class="wiz-sum"><li><span>Ziel</span><strong>${GOALS[st.goal]?.name || '–'}</strong></li><li><span>Stufe</span><strong>${st.phase + 1} · ${PH()[st.phase].name}</strong></li><li><span>Lernplan</span><strong>${[...new Set([...PH()[st.phase].lern, ...(GOALS[st.goal]?.lern || [])])].length} passende Themen</strong></li>${st.income ? `<li><span>Finanzprofil</span><strong>wird ausgefüllt</strong></li>` : ''}</ul>
        <p class="form-note">Ansicht:</p><div class="seg wiz-mode" role="group"><button type="button" data-mode="einsteiger" aria-pressed="${m === 'einsteiger'}">Einsteiger – mit Fahrplan und Erklärungen</button><button type="button" data-mode="profi" aria-pressed="${m === 'profi'}">Profi – nur Werkzeuge</button></div>
        <p class="form-note">Alles bleibt jederzeit änderbar: Stufe über „Stufe ändern“, Ansicht oben rechts, den Assistenten können Sie neu starten.</p>`;
    }
    const can = step === 0 ? Boolean(st.goal) : step === 1 ? st.phase !== null : true;
    dlg.innerHTML = `<form method="dialog" class="stage-in"><div class="stage-head"><div><span class="stage-k">Einrichtung · Schritt ${step + 1} von 4</span>${dots}</div><button class="stage-x" value="x" aria-label="Schließen">×</button></div>${body}
      <div class="wiz-nav">${step > 0 ? '<button type="button" class="btn btn-outline" data-nav="back">Zurück</button>' : '<span></span>'}${step < 3 ? `<button type="button" class="btn btn-dark" data-nav="next"${can ? '' : ' disabled'}>${step === 2 ? (st.income || st.equity ? 'Weiter' : 'Überspringen') : 'Weiter'}</button>` : '<button type="button" class="btn btn-dark" data-nav="save">Übernehmen</button>'}</div></form>`;
    dlg.querySelectorAll('[data-goal]').forEach((b) => b.onclick = () => { st.goal = b.dataset.goal; if (st.goal === 'bestand' && st.phase === null) st.phase = 3; step = 1; draw(); });
    dlg.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => { st.phase = Number(b.dataset.ph); step = 2; draw(); });
    dlg.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { st.mode = b.dataset.mode; draw(); });
    const keep = () => { const i = dlg.querySelector('#wizInc'), e = dlg.querySelector('#wizEq'); if (i) st.income = i.value; if (e) st.equity = e.value; };
    dlg.querySelector('[data-nav="back"]')?.addEventListener('click', () => { keep(); step--; draw(); });
    dlg.querySelector('[data-nav="next"]')?.addEventListener('click', () => { keep(); step++; draw(); });
    dlg.querySelector('[data-nav="save"]')?.addEventListener('click', async () => {
      const { d, u, saveData, reload } = APP;
      const prof = { ...(d.profile || {}), goal: st.goal, phase: st.phase, mode: st.mode || autoMode(), onboardedAt: new Date().toISOString() };
      if (st.income !== '' && Number(st.income) > 0) prof.netIncome = Number(st.income);
      if (st.equity !== '' && Number(st.equity) >= 0) prof.equity = Number(st.equity);
      d.profile = prof;
      dlg.close();
      try { sessionStorage.setItem('lr-stage-msg', 'wiz'); } catch { /* ignore */ }
      saveData(u, d).catch(() => { /* wird nachgeholt */ });
      reload();
    });
  };
  draw();
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}
document.addEventListener('click', (e) => { if (e.target.closest?.('.wiz-open')) { e.preventDefault(); document.getElementById('stageDlg')?.close?.(); openWizard(); } });

// ---------- Einladung eines Beraters annehmen (ausdrückliche Einwilligung) ----------
async function checkBerater() {
  let x = null;
  try { x = JSON.parse(localStorage.getItem('lr-berater') || 'null'); } catch { x = null; }
  if (!x || Date.now() - x.at > 14 * 864e5) { try { localStorage.removeItem('lr-berater'); } catch { /* ignore */ } return; }
  const tok = (() => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token; } catch { return null; } })();
  if (!tok) return;
  const H = { Authorization: 'Bearer ' + tok };
  const r = await fetch('/api/me/berater?token=' + encodeURIComponent(x.t), { headers: H, cache: 'no-store' }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  try { localStorage.removeItem('lr-berater'); } catch { /* ignore */ }
  if (!r || !r.ok) { stageToast(esc(j.error || 'Die Einladung konnte nicht geladen werden.')); return; }
  let dlg = document.getElementById('berDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'berDlg'; dlg.className = 'stage-dlg'; document.body.append(dlg); }
  dlg.innerHTML = `<form method="dialog" class="stage-in"><div class="stage-head"><div><span class="stage-k">Einladung</span><h2>${esc(j.invite.company)}</h2></div><button class="stage-x" value="x" aria-label="Schließen">×</button></div>
    <p>${esc(j.invite.company)}${j.invite.city ? ` aus ${esc(j.invite.city)}` : ''} begleitet Sie bei Ihrer Finanzierung und möchte Ihren Fortschritt in LeaseRun sehen.${j.invite.verified ? ' <span class="st ok">geprüftes Unternehmen</span>' : ''}</p>
    <div class="ber-grid"><div><strong>Sichtbar</strong><ul><li>Ihre Stufe</li><li>Bankreife in Prozent</li><li>Anzahl Objekte und Unterlagen</li><li>welche Unterlagen-Arten fehlen</li><li>letzte Aktivität</li></ul></div><div><strong>Nicht sichtbar</strong><ul><li>Dokumente und Inhalte</li><li>Einkommen und Zahlen</li><li>Objektadressen</li></ul></div></div>
    <label class="consent"><input type="checkbox" id="berOk"> ${esc(j.consent)}</label>
    <div class="wiz-nav"><button type="button" class="btn btn-outline" value="x" id="berNo">Ablehnen</button><button type="button" class="btn btn-dark" id="berYes">Zustimmen und verbinden</button></div></form>`;
  dlg.querySelector('#berNo').onclick = () => dlg.close();
  dlg.querySelector('#berYes').onclick = async () => {
    if (!dlg.querySelector('#berOk').checked) { dlg.querySelector('#berOk').closest('label').classList.add('consent-missing'); return; }
    const p = await fetch('/api/me/berater', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ token: x.t, consent: true }) }).catch(() => null);
    const pj = p ? await p.json().catch(() => ({})) : {};
    dlg.close();
    stageToast(p && p.ok ? `<strong>Verbunden mit ${esc(pj.company)}.</strong> Trennen jederzeit im Konto unter „Berater-Freigaben“.` : esc(pj.error || 'Verbinden fehlgeschlagen.'));
  };
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
}



function classify(el) {
  if (el.dataset.view) return el.dataset.view;
  const id = el.id || '', h = el.querySelector('h3')?.textContent || '', mode = document.body.dataset.mode;
  if (id === 'rankCard') return 'start';
  if (['termineCard', 'pendingCard'].includes(id) || el.classList.contains('req-card')) return 'start';
  if (id === 'portfolioCard') return mode === 'profi' ? 'start objekte' : 'objekte';
  if (['docsCard', 'bankreifeCard'].includes(id) || h === 'Objekte') return 'objekte';
  if (id === 'billingCard') return 'none'; // ersetzt durch „Tarif & Rechnungen“ (finCard)
  if (id === 'accountCard' || h === 'Finanzprofil') return 'konto';
  if (h === 'Weiter') return 'none';
  return 'start';
}

export function setupApp({ u, d, saveData, reload }) {
  STAGE_D = d;
  if (u.user_metadata?.must_change_password && u.user_metadata?.area === 'app') firstPassword(u);
  // Bestätigung nach dem Umstellen der Stufe.
  try {
    const m = sessionStorage.getItem('lr-stage-msg');
    if (m != null) {
      sessionStorage.removeItem('lr-stage-msg');
      const ph = phaseOf(d);
      setTimeout(() => stageToast(m === 'wiz' ? `<strong>LeaseRun ist eingerichtet: ${GOALS[d.profile?.goal]?.name || ''} · Stufe ${ph.idx + 1} · ${d.profile?.mode === 'profi' ? 'Profi' : 'Einsteiger'}.</strong> ${d.profile?.mode === 'profi' ? 'Werkzeuge, Lernplan und Steuer-Bereich' : 'Startseite, Fahrplan, Lernplan und Steuer-Bereich'} sind angepasst.` : `<strong>Auf Stufe ${ph.idx + 1} · ${PH()[ph.idx].name} umgestellt${m === 'auto' ? ' (automatisch)' : ''}.</strong> Startseite, Lernplan und Steuer-Bereich sind angepasst.`), 250);
    }
  } catch { /* ignore */ }
  // Kaufwunsch von der Angebotsseite (vor der Anmeldung gemerkt): direkt weiter zur Bezahlseite.
  resumeIntent((t) => alert(t));
  const reloadFull = reload;
  reload = () => { document.body.classList.add('lr-switching'); reloadFull({ u, d }); };
  APP = { u, d, saveData, reload };
  setTimeout(() => { checkBerater().catch(() => { /* still */ }); }, 400);
  requestAnimationFrame(() => document.body.classList.remove('lr-switching'));
  const app = $('app'), grid = document.querySelector('.dashboard-grid');
  if (!app || !grid) return;
  try { if (sessionStorage.getItem('lr-import') && !location.hash.startsWith('#objekte')) history.replaceState(null, '', location.pathname + location.search + '#objekte'); } catch { /* ohne Speicher */ }
  const q = new URLSearchParams(location.search);
  const qm = q.get('modus');
  let mode = qm === 'profi' || qm === 'einsteiger' ? qm : d.profile?.mode;
  if (qm && qm !== d.profile?.mode) { d.profile = { ...(d.profile || {}), mode: qm }; saveData(u, d).catch(() => {}); }
  document.body.classList.add('is-app');
  document.body.dataset.mode = mode || 'einsteiger';
  const views = VIEWS[mode || 'einsteiger'];

  // Seitenleiste (Desktop), obere Leiste und Tab-Leiste (Handy)
  app.insertAdjacentHTML('afterbegin', `<nav class="app-side" aria-label="Anwendung"><a class="brand" href="/"><img class="brand-logo" src="/logo-icon.svg" alt="" width="34" height="29"><span>Immo<span>Adv</span></span></a>
    ${views.map(([k, l]) => `<a class="app-nav" data-go="${k}" href="#${k}">${svg(k)}<span>${l}</span></a>`).join('')}
    <div class="app-side-foot"><span class="app-user">${esc(u.email)}</span><button class="text-btn" id="appLogout" type="button">Abmelden</button></div></nav>`);
  const main = app.querySelector('main');
  main.insertAdjacentHTML('afterbegin', `<div class="app-top"><a class="brand app-top-brand" href="/"><img class="brand-logo" src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><div class="app-top-t"><small class="app-top-k">Privatbereich</small><h1 id="appTitle"></h1></div>
    <button class="mode-chip" id="modeChip" type="button" aria-label="Modus wechseln (aktuell ${mode === 'profi' ? 'Profi' : 'Einsteiger'})"><b>${mode === 'profi' ? 'Profi' : 'Einsteiger'}</b> <span aria-hidden="true">⇄</span></button><button class="app-logout-m" id="appLogoutM" type="button" aria-label="Abmelden" title="Abmelden"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg><span>Abmelden</span></button></div>`);
  import('./legal-foot.mjs?v=892f3666').then((m) => { if (!main.querySelector('.ia-legal')) main.insertAdjacentHTML('beforeend', m.legalFoot('b2c')); }).catch(() => {});
  app.insertAdjacentHTML('beforeend', `<nav class="app-tabs" aria-label="Schnellnavigation">${TABS.map((k) => `<a class="app-tab" data-go="${k}" href="#${k}">${svg(k)}<span>${k === 'werkzeuge' ? 'Tools' : k === 'start' ? 'Start' : views.find((v) => v[0] === k)[1].split(' ')[0]}</span></a>`).join('')}</nav>`);
  $('appLogout').onclick = () => document.getElementById('logout')?.click();
  $('appLogoutM').onclick = () => document.getElementById('logout')?.click();
  $('modeChip').onclick = async () => {
    d.profile = { ...(d.profile || {}), mode: mode === 'profi' ? 'einsteiger' : 'profi' };
    saveData(u, d).catch(() => { /* wird beim nächsten Speichern nachgeholt */ });
    history.replaceState(null, '', location.pathname + location.hash);
    reload();
  };

  // Eigene Karten: Start, Suche, Lernpfad, Angebot
  grid.insertAdjacentHTML('afterbegin', kmCard());
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide fin-card" data-view="konto" id="finCard"><h3>Tarif &amp; Rechnungen</h3><div id="finBody"><p class="lr-ld" role="status">Wird geladen …</p></div></article>`);
  // Berater-Freigaben: nur sichtbar, wenn der Kunde mit einem Unternehmen verbunden ist; jederzeit trennbar.
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide ber-card" data-view="konto" id="berCard" hidden><h3>Berater-Freigaben</h3><div id="berBody"></div></article>`);
  (async () => {
    const tok = (() => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token; } catch { return null; } })();
    if (!tok) return;
    const H = { Authorization: 'Bearer ' + tok };
    const load = async () => {
      const r = await fetch('/api/me/berater', { headers: H, cache: 'no-store' }).catch(() => null);
      const jj = r && r.ok ? await r.json().catch(() => ({})) : {};
      const list = jj.connections || [], card = $('berCard'), body = $('berBody');
      if (!card || !body) return;
      card.hidden = !list.length;
      // Bitte eines Beraters um fehlende Unterlagen: Hinweis oben in der Übersicht.
      document.getElementById('reqBanner')?.remove();
      const req = list.find((c) => c.request);
      if (req) {
        const miss = (d.progress?.summary?.missing || []).slice(0, 6);
        grid.insertAdjacentHTML('afterbegin', `<article class="dash-card wide req-banner" data-view="start" id="reqBanner"><span class="stage-k">Bitte Ihres Beraters</span><h3>${esc(req.company)} bittet um Ihre fehlenden Unterlagen</h3>${req.note ? `<p class="req-note">„${esc(req.note)}“</p>` : ''}${miss.length ? `<ul class="req-miss">${miss.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '<p class="form-note">Öffnen Sie Ihr Objekt und ergänzen Sie die Unterlagen, die bei „Bankreife“ als offen markiert sind.</p>'}<div class="wiz-start"><a class="btn btn-dark" href="#objekte" id="reqGo">Unterlagen ergänzen</a><button type="button" class="btn btn-outline" id="reqSeen">Ausblenden</button></div></article>`);
        const seen = () => fetch('/api/me/berater', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ seen: req.id }) }).catch(() => null);
        $('reqSeen').onclick = async () => { await seen(); document.getElementById('reqBanner')?.remove(); };
        $('reqGo').onclick = () => { seen(); };
        if (typeof window.__iaApplyView === 'function') window.__iaApplyView();
      }
      body.innerHTML = `<p class="form-note">Diese Unternehmen sehen Ihren Fortschritt (Stufe, Bankreife, Anzahl Unterlagen, fehlende Unterlagen-Arten) – keine Dokumente und keine Inhalte.</p><ul class="ber-list">${list.map((c) => `<li><span><strong>${esc(c.company)}</strong><small>${c.city ? esc(c.city) + ' · ' : ''}verbunden seit ${c.since ? new Date(c.since).toLocaleDateString('de-DE') : '–'}</small><label class="chk ber-radar"><input type="checkbox" data-ber-radar="${esc(c.id)}"${c.radar ? ' checked' : ''}> Rechtzeitig vor Ende meiner Zinsbindung ansprechen lassen</label></span><button type="button" class="btn btn-outline" data-ber-end="${esc(c.id)}">Trennen</button></li>`).join('')}</ul><p class="form-note ber-radar-t">${esc(jj.radarText || '')}</p>`;
      body.querySelectorAll('[data-ber-radar]').forEach((cb) => cb.onchange = async () => {
        cb.disabled = true;
        const rr = await fetch('/api/me/berater', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ id: cb.dataset.berRadar, radar: cb.checked }) }).catch(() => null);
        cb.disabled = false;
        if (!rr || !rr.ok) cb.checked = !cb.checked;
      });
      body.querySelectorAll('[data-ber-end]').forEach((b) => b.onclick = async () => {
        if (!confirm('Verbindung trennen? Das Unternehmen sieht Ihren Fortschritt danach nicht mehr.')) return;
        b.disabled = true;
        await fetch('/api/me/berater', { method: 'DELETE', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ id: b.dataset.berEnd }) }).catch(() => null);
        load();
      });
    };
    load();
  })();
  grid.insertAdjacentHTML('afterbegin', startCard(mode, d));
  // Sitzung: Angemeldet bleiben, automatische Abmeldung, Abmelden (auch auf dem Handy erreichbar).
  {
    const A = window.iaAuth;
    grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide sess-card" data-view="konto" id="sessCard"><h3>Anmeldung &amp; Sicherheit</h3>
      <p class="form-note">Angemeldet als <strong>${esc(u.email)}</strong></p>
      <label class="chk sess-rem"><input type="checkbox" id="sessRem"${A && A.remembered() ? ' checked' : ''}> Auf diesem Gerät angemeldet bleiben</label>
      <p class="form-note" id="sessNote"></p>
      <div class="sess-act"><button class="btn btn-dark" type="button" id="sessOut">Abmelden</button><button class="btn btn-outline" type="button" id="pwOpen" aria-expanded="false">Passwort ändern</button></div><div id="pwBox" hidden></div>
      <p class="form-note">Ihr Passwort können Sie im Browser bzw. im iPhone-Schlüsselbund speichern lassen – beim Anmelden einfach „Passwort sichern“ bestätigen.</p></article>`);
    const note = () => { const n = $('sessNote'); if (n) n.textContent = $('sessRem').checked ? 'Sie bleiben angemeldet, bis Sie sich abmelden oder 30 Tage nicht aktiv waren. Nur auf eigenen Geräten verwenden.' : 'Automatische Abmeldung nach 12 Stunden ohne Aktivität.'; };
    note();
    $('sessRem').onchange = () => { if (A) { A.setRemember($('sessRem').checked); try { localStorage.setItem('lr-last-active', String(Date.now())); } catch { /* ignore */ } } note(); };
    $('sessOut').onclick = () => document.getElementById('logout')?.click();
    bindPw(u);
  }
  personalCard(grid);
  // Hilfe & Support: Problem, Verbesserungsvorschlag und E-Mail an einem Ort (Bereich Privatkunden).
  // Technisches Problem melden (mit Screenshot) – direkt im Konto, Antwort innerhalb von 12 Stunden.
  // Technischer Support als eigener Bereich wie im Unternehmensportal; im Konto ein klarer Einstieg dorthin.
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide sp-entry" data-view="konto" id="spEntryB2C"><a class="sp-entry-a" href="#support">${svg('support')}<span><strong>Hilfe &amp; Support</strong><small>Problem melden, Verbesserung vorschlagen oder E-Mail schreiben.</small></span><svg class="sp-entry-go" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a></article>`);
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide sp-card-b2c" data-view="support" id="spCardB2C"><div id="spBodyB2C"></div></article>`);
  import('/src/hilfe-ui.mjs?v=892f3666').then((m) => m.mountHilfe($('spBodyB2C'), { area: 'b2c', start: /vorschlag/.test(location.hash) ? 'vorschlag' : 'problem' })).catch(() => {});
  // Bitte um eine echte Google-Bewertung (an alle Kunden gleich, ohne Anreiz); nach einem Kauf zusätzlich auf der Startseite.
  import('/src/reviews.mjs?v=892f3666').then(async (m) => {
    const h = await m.askHtml('b2c'); if (!h) return;
    grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="konto" id="rvCard">${h}</article>`);
    if (CHECKOUT === 'success') grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="start" id="rvCardStart">${h}</article>`);
    window.__iaApplyView?.();
  }).catch(() => {});
  // Gekaufter Leitfaden (Zusatzprodukt): nur sichtbar, wenn erworben.
  fetch('/api/me/leitfaden', { headers: { Authorization: 'Bearer ' + sessToken() }, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((L) => {
    if (!L?.owned) return;
    grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide lf-card" data-view="konto" id="lfCard"><h3>${esc(L.titel)}</h3><p class="form-note">${esc(L.hinweis)} · Stand ${esc(L.version)}</p>
      ${L.abschnitte.map((a) => `<details class="lf-sec"><summary>${esc(a.titel)}</summary>${a.einleitung ? `<p>${esc(a.einleitung)}</p>` : ''}<ul class="lf-list">${a.punkte.map(([t, x]) => `<li><label class="chk"><input type="checkbox"> <span><b>${esc(t)}</b> – ${esc(x)}</span></label></li>`).join('')}</ul></details>`).join('')}
      <p><button class="btn btn-outline" type="button" id="lfPrint">Drucken / als PDF speichern</button></p></article>`);
    $('lfPrint').onclick = () => { document.querySelectorAll('#lfCard details').forEach((x) => { x.open = true; }); document.body.classList.add('lf-printing'); addEventListener('afterprint', () => document.body.classList.remove('lf-printing'), { once: true }); window.print(); };
    window.__iaApplyView?.();
  }).catch(() => {});
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide obj-new" data-view="objekte" id="sucheView"><div class="obj-step"><span aria-hidden="true">1</span><div><h3>Neues Objekt prüfen</h3><small>Exposé hochladen, Link eintragen oder selbst eingeben – die Analyse rechnet sofort mit.</small></div></div><div id="sucheMount"></div></article>`);
  grid.insertAdjacentHTML('beforeend', `<article class="obj-step-card" data-view="objekte" id="objStep2"><div class="obj-step"><span aria-hidden="true">2</span><div><h3>Meine Objekte</h3><small>Gespeicherte Objekte, Unterlagen, Fristen – und daraus die Kreditmappe für die Bank.</small></div></div></article>`);
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="werkzeuge" id="toolsView"><p class="lr-ld" role="status">Software-Tools werden geladen …</p></article>`);
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="steuer" id="steuerView"></article>`);
  Promise.all([import('/src/b2c-tools.mjs?v=892f3666'), getAccess()]).then(([m, ac]) => { m.mountTools($('toolsView'), { d, tier: ac.tier || 'free', b2b: Boolean(ac.b2b), mode: mode || 'einsteiger', features: ac.features || {} }); import('/src/field-help.mjs?v=892f3666').then((f) => f.attachHelp?.($('toolsView'))).catch(() => {}); }).catch(() => { const v = $('toolsView'); if (v) v.innerHTML = '<p class="form-note">Software-Tools konnten nicht geladen werden.</p>'; });
  grid.insertAdjacentHTML('beforeend', lernCard(mode, d));
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="angebot" id="angebotView"><h3>${mode === 'profi' ? 'Tarif' : 'Angebot'}</h3><div id="offerBody"><p class="lr-ld" role="status">Wird geladen …</p></div></article>`);
  bindStart(mode, d, u, saveData, reload);
  bindKm(d, u, saveData, reload);
  renderFin();
  bindLern(d, u, saveData);
  import('/src/field-help.mjs?v=892f3666').then((m) => m.watchHelp(grid)).catch(() => {});
  import('/src/retention.mjs?v=892f3666').then(async (m) => { const ac = await getAccess(); m.mountRetention(grid, { mode, d, u, saveData, paid: ac.tier === 'pro' || ac.b2b }); if (typeof window.__iaApplyView === 'function') window.__iaApplyView(); }).catch(() => {});

  // Objekte: oben eine Auswahl; der jeweilige Bereich öffnet sich erst beim Antippen (vorher nichts darunter).
  const OBJ_OPS = [
    ['pruefen', 'Neues Objekt prüfen', 'Exposé hochladen, Link eintragen oder selbst eingeben', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M12 17v-6M9.5 13.5 12 11l2.5 2.5"/>'],
    ['meine', 'Meine Objekte', 'Gespeicherte Objekte, Unterlagen und Fristen', '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6h6v6"/>'],
    ['mappe', 'Kreditmappe', 'BankReady-Mappe für die Bank erstellen', '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'],
  ];
  const opOf = (el) => (el.id === 'sucheView' ? 'pruefen' : el.id === 'kmCard' ? 'mappe' : 'meine');
  let objSel = null, lastCur = null;
  if (!grid.querySelector('.obj-pick')) grid.insertAdjacentHTML('afterbegin', `<div class="obj-pick" data-view="objekte" role="group" aria-label="Bereich wählen">${OBJ_OPS.map(([k, t, s2, ic]) => `<button type="button" class="obj-op" data-op="${k}" aria-expanded="false"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg><span><strong>${t}</strong><small>${s2}</small></span><svg class="obj-op-c" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div>`);
  const paintOps = () => {
    grid.querySelectorAll(':scope>[data-view~="objekte"]:not(.obj-pick)').forEach((el) => el.classList.toggle('op-hide', opOf(el) !== objSel));
    grid.querySelectorAll('.obj-op').forEach((b) => { const on = b.dataset.op === objSel; b.classList.toggle('on', on); b.setAttribute('aria-expanded', String(on)); });
  };
  const openOp = (k, scroll) => {
    objSel = k || null; paintOps();
    if (!scroll || !objSel) return;
    const first = [...grid.querySelectorAll(':scope>[data-view~="objekte"]:not(.obj-pick)')].find((el) => opOf(el) === objSel);
    if (first) requestAnimationFrame(() => window.scrollTo({ top: first.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-top')?.offsetHeight || 0) - 10, behavior: 'smooth' }));
  };
  grid.querySelector('.obj-pick').onclick = (e) => { const b = e.target.closest('.obj-op'); if (b) openOp(objSel === b.dataset.op ? null : b.dataset.op, true); };
  // Springt anderer Code zu einem Element in einem zugeklappten Bereich (z. B. „Zu Neues Objekt prüfen“), diesen Bereich öffnen.
  window.__iaObjReveal = (el) => { const c = el.closest?.('.dashboard-grid>.op-hide'); if (c && document.body.dataset.cur === 'objekte') openOp(opOf(c), false); const dt = el.closest?.('details.an-sec:not([open])'); if (dt) dt.open = true; };
  if (!window.__iaSivPatched) {
    window.__iaSivPatched = true;
    const siv = Element.prototype.scrollIntoView, foc = HTMLElement.prototype.focus;
    Element.prototype.scrollIntoView = function (...a) { try { window.__iaObjReveal?.(this); } catch { /* ignore */ } return siv.apply(this, a); };
    HTMLElement.prototype.focus = function (...a) { try { window.__iaObjReveal?.(this); } catch { /* ignore */ } return foc.apply(this, a); };
  }

  const CLASSIFIED = new WeakSet();
  const normT = (t) => String(t || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-zäöüß0-9&]+/g, ' ').trim();
  const dedupeTitles = () => {
    const t = normT($('appTitle')?.textContent);
    grid.querySelectorAll('.dup-title').forEach((h) => h.classList.remove('dup-title'));
    if (!t) return;
    for (const card of grid.querySelectorAll(':scope > .v-show')) {
      for (const h of card.querySelectorAll('h2, h3')) { if (h.offsetParent !== null && normT(h.textContent) === t) h.classList.add('dup-title'); }
    }
  };
  const apply = () => {
    if ((location.hash.slice(1) || '').split('?')[0] === 'suche') { history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/^#suche/, '#objekte')); window.__iaToAnalyse = true; }
    const v = (location.hash.slice(1) || 'start').split('?')[0];
    const cur = views.some((x) => x[0] === v) ? v : 'start';
    const sc = grid.querySelector('.start-card'); if (sc && grid.firstElementChild !== sc) grid.prepend(sc);
    // Einordnung je Karte nur einmal berechnen (vorher bei jedem Wechsel für alle Karten → spürbare Hänger).
    [...grid.children].forEach((el) => { if (!CLASSIFIED.has(el)) { el.dataset.view = classify(el); CLASSIFIED.add(el); } el.classList.toggle('v-show', el.dataset.view.split(' ').includes(cur)); });
    document.querySelectorAll('[data-go]').forEach((a) => a.classList.toggle('on', a.dataset.go === cur || (cur === 'support' && a.dataset.go === 'konto' && a.classList.contains('app-tab'))));
    $('appTitle').textContent = views.find((x) => x[0] === cur)[1];
    dedupeTitles();
    document.body.dataset.cur = cur;
    if (cur === 'objekte' && lastCur !== 'objekte') {
      let imp = false; try { imp = !!sessionStorage.getItem('lr-import'); } catch { /* ohne Speicher */ }
      objSel = window.__iaToAnalyse || imp ? 'pruefen' : null;
    }
    lastCur = cur;
    paintOps();
    if (cur === 'objekte') objektModule().then(() => { if (window.__iaToAnalyse) { window.__iaToAnalyse = false; $('sucheView')?.scrollIntoView({ block: 'start' }); } }).catch(() => { const x = $('sucheMount'); if (x) x.innerHTML = '<p class="auth-message error">Import konnte nicht geladen werden.</p>'; });
    if (cur === 'steuer' && !$('steuerView').dataset.ready) {
      $('steuerView').dataset.ready = '1';
      import('/src/steuer.mjs?v=892f3666').then((m) => m.mountSteuer($('steuerView'), { mode, phase: PH()[phaseOf(d).idx].steuer })).catch(() => { $('steuerView').innerHTML = '<p class="auth-message error">Steuer-Bereich konnte nicht geladen werden.</p>'; });
    }
    if (cur === 'angebot' && !$('angebotView').dataset.ready) { $('angebotView').dataset.ready = '1'; renderOffers(mode); }
  };
  if (window.__iaHash) window.removeEventListener('hashchange', window.__iaHash);
  // Bereichswechsel beginnt immer ganz oben – auch beim erneuten Tippen auf den aktiven Bereich und ohne
  // Scroll-Animation oder vom Browser wiederhergestellte Position.
  const toTop = () => { if (window.__iaRestoring) return; window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); };
  try { history.scrollRestoration = 'manual'; } catch { /* ältere Browser */ }
  // Nicht blockierender Wechsel: aktiven Reiter sofort markieren (sichtbare Rückmeldung beim Tippen),
  // die eigentliche Umschaltung im nächsten Frame – entspricht useTransition in React.
  let pend = 0;
  const schedule = () => { if (pend) return; pend = requestAnimationFrame(() => { pend = 0; apply(); }); };
  window.__iaHash = () => {
    if ((location.hash.slice(1) || '').split('?')[0] === 'suche') { history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/^#suche/, '#objekte')); window.__iaToAnalyse = true; }
    const v = (location.hash.slice(1) || 'start').split('?')[0];
    const isView = v === '' || views.some((x) => x[0] === v);
    if (isView) {
      try { const ae = document.activeElement; if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) ae.blur(); } catch { /* ignore */ }
      const cur = views.some((x) => x[0] === v) ? v : 'start';
      document.querySelectorAll('[data-go]').forEach((a) => a.classList.toggle('on', a.dataset.go === cur || (cur === 'support' && a.dataset.go === 'konto' && a.classList.contains('app-tab'))));
      toTop();
    }
    schedule();
    if (isView) requestAnimationFrame(toTop);
  };
  window.addEventListener('hashchange', window.__iaHash);
  if (!window.__iaTopBound) { window.__iaTopBound = true; document.addEventListener('click', (e) => { const a = e.target.closest?.('a[data-go], .app-tab, .app-nav'); if (a && a.getAttribute('href') === location.hash) toTop(); }); }
  window.__iaApplyView = apply;
  // Keine doppelte Überschrift: trägt die erste Karte eines Bereichs denselben Titel wie die Seitenüberschrift
  // (z. B. „Tarif“ unter „Tarif“), wird die Kartenüberschrift ausgeblendet. Auch für nachgeladene Inhalte.
  let ddT = 0;
  new MutationObserver(() => { if (ddT) return; ddT = requestAnimationFrame(() => { ddT = 0; dedupeTitles(); }); }).observe(grid, { childList: true, subtree: true });
  new MutationObserver(() => schedule()).observe(grid, { childList: true });
  // Nach Anmeldung / erstem Laden immer mit der Übersicht beginnen – kein Rücksprung in den zuletzt
  // offenen Bereich (z. B. Konto). Ausnahmen nur für ausdrückliche Absichten: Kauf (?buy/?want → #angebot),
  // Inserat-Übernahme (#objekte mit Import) und Rückkehr aus der Bezahlung.
  // Zurück von einer anderen Seite (z. B. „Ganze Seite öffnen“): genau dort weitermachen, wo man war –
  // gleicher Bereich, gleiche geöffnete Themen, gleiche Scrollposition.
  const RET = !window.__iaBooted ? (() => {
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0]?.type;
      const flag = sessionStorage.getItem('lr-ret-back');
      sessionStorage.removeItem('lr-ret-back');
      if (nav !== 'back_forward' && !flag) return null;
      const r = JSON.parse(sessionStorage.getItem('lr-ret:' + location.pathname + location.search) || 'null');
      return r && Date.now() - r.at < 2 * 3600_000 ? r : null;
    } catch { return null; }
  })() : null;
  if (RET) { window.__iaRetDone = true; if (RET.hash && RET.hash !== location.hash) history.replaceState(null, '', location.pathname + location.search + RET.hash); }
  if (!window.__iaBooted && !RET) {
    const h0 = (location.hash.slice(1) || '').split('?')[0];
    let imp = false; try { imp = !!sessionStorage.getItem('lr-import'); } catch { /* ohne Speicher */ }
    const keep = (h0 === 'angebot' && (q.get('buy') || q.get('want'))) || (h0 === 'objekte' && imp) || q.get('checkout');
    if (h0 && h0 !== 'start' && !keep) history.replaceState(null, '', location.pathname + location.search + '#start');
  }
  apply();
  // Erster Aufbau nach Login/Neuladen: immer ganz oben beginnen (kein vom Browser wiederhergestellter Scrollstand,
  // kein Herunterscrollen durch Fokus auf Eingabefelder weiter unten, z. B. im Bereich Konto).
  if (!window.__iaBooted) {
    window.__iaBooted = true;
    try { if (document.activeElement && document.activeElement !== document.body && main.contains(document.activeElement)) document.activeElement.blur(); } catch { /* ignore */ }
    if (!RET) toTop();
    else {
      // Bis zu 12 s nachführen: Themen wieder öffnen (Inhalte laden nach), „Mehr erklären“ wieder aufklappen und
      // das zuletzt angetippte Element exakt an dieselbe Höhe bringen. Eigenes Scrollen/Tippen beendet das sofort.
      window.__iaRestoring = true;
      let stop = false, ok = 0;
      const end = () => { stop = true; window.__iaRestoring = false; };
      ['touchstart', 'wheel', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, end, { once: true, passive: true, capture: true }));
      const t0 = Date.now();
      const go = () => {
        if (stop) return;
        if (Date.now() - t0 > 12000) { end(); return; }
        (RET.open || []).forEach((id) => { const det = document.querySelector(`details[data-topic="${CSS.escape(id)}"]`); if (det && !det.open) det.open = true; });
        (RET.more || []).forEach((id) => { const el = document.getElementById(id); if (el && el.hidden) { el.hidden = false; const b = document.querySelector(`[data-more="${CSS.escape(id)}"]`); if (b) { b.setAttribute('aria-expanded', 'true'); b.textContent = 'Weniger'; } } });
        const a = RET.aid && document.getElementById(RET.aid);
        const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
        const vis = !!(a && a.getClientRects().length);
        const want = vis ? Math.round(a.getBoundingClientRect().top + scrollY - (RET.ay || 0)) : (RET.y || 0);
        const top = Math.max(0, Math.min(want, maxY));
        if (Math.abs(scrollY - top) > 1) window.scrollTo({ top, left: 0, behavior: 'instant' });
        // fertig, wenn das Ziel erreicht ist und vier Durchläufe lang stabil bleibt (Anker sichtbar bzw. Seite hoch genug)
        ok = ((RET.aid ? vis : maxY >= want) && Math.abs(scrollY - top) <= 2) ? ok + 1 : 0;
        if (ok >= 4) { end(); return; }
        setTimeout(go, 120);
      };
      requestAnimationFrame(() => go());
    }
  }
}

// Kreditmappe (Bereich Objekte): BankReady. Die Objekt-Analyse liegt nur noch unter „Objekt prüfen“ (ein Ort fürs Durchrechnen) –
// und wie die Daten kommen: AutoPilot (Exposé-PDF hochladen, Link eintragen oder gespeichertes Objekt – LeaseRun
// rechnet alles automatisch) oder Manuell (online eintragen oder PDF-Formular herunterladen, ausfüllen, wieder hochladen).
// Das Ergebnis erscheint zuerst als PDF auf dem Bildschirm und kann dann heruntergeladen werden.
let KM = { doc: 'km', way: 'auto' };
// Rückkehr aus dem Checkout (wird beim Laden des Moduls gelesen, bevor die Adresse bereinigt wird).
const CHECKOUT = new URLSearchParams(location.search).get('checkout');
// Nach einem Kauf den Navigationsstatus neu laden (Zur Anwendung / App-Leiste).
if (CHECKOUT === 'success') { try { localStorage.removeItem('lr-access'); } catch { /* ignore */ } }
const PROD = {
  km: { name: 'BankReady', sub: 'Kreditmappe für die Bank', form: 'kreditmappe' },
  an: { name: 'RenditeRadar', sub: 'Objekt-Analyse in Sekunden', form: 'analyse' },
};
// Zahlender Kunde? (Tarif, Unternehmenskonto, Admin) – sonst kostenlose Demo mit Wasserzeichen auf PDFs.
let ACCESS = null;
const getAccess = () => (ACCESS ||= fetch('/api/me/access', { headers: { Authorization: 'Bearer ' + sessToken() }, cache: 'no-store' }).then((r) => (r.ok ? r.json() : { paid: false })).catch(() => ({ paid: false })));
const DEMO_NOTE = '<strong>Transparenter Entwurf:</strong> So sieht Ihre Kreditmappe für die Bank aus – noch mit Wasserzeichen. Beim Freischalten entfällt es, die Echtheitsprüfung per QR-Code kommt dazu, und Ihre Eingaben bleiben erhalten.';
const UNLOCK = '<button type="button" class="btn btn-pay unlock-btn" data-unlock="credit-map">Kreditmappe freischalten · 39 €</button>';
// Kontext für den Kaufdialog – nur echte Werte aus dem Konto (gewähltes bzw. erstes Objekt, Finanzprofil).
function buyCtx() {
  const d = APP?.d; if (!d) return {};
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => Number(o.price) > 0);
  const sel = document.getElementById('kmObj')?.value;
  const o = objs.find((x) => x.id === sel) || objs[0];
  const p = d.profile || {};
  const fin = [Number(p.netIncome) > 0, p.equity !== undefined && p.equity !== '', Boolean(p.employment), Number(p.householdSize) > 0];
  const ctx = { finPct: (fin.filter(Boolean).length / fin.length) * 100 };
  if (o) {
    const r = readiness(o, []);
    const g = r.groups.filter((x) => x.key !== 'unterlagen');
    const done = g.reduce((a, x) => a + x.done, 0), total = g.reduce((a, x) => a + x.total, 0);
    Object.assign(ctx, { loan: Number(o.loan) || autoLoan(o), ratePct: Number(o.interestPct) || null, gaps: g.flatMap((x) => x.missing), mappePct: total ? (done / total) * 100 : null });
  }
  return ctx;
}
// Ein-Klick-Freischaltung aus dem Entwurf: öffnet direkt den Kaufdialog der Kreditmappe.
document.addEventListener('click', async (e) => {
  const b = e.target.closest?.('[data-unlock]');
  if (!b) return;
  e.preventDefault();
  const P = await fetch('/data/preise.json').then((r) => r.json()).catch(() => null);
  const o = P?.privat?.plans?.find((x) => x.id === b.dataset.unlock);
  if (o) openBuy(o, { onError: (t) => alert(t), ctx: buyCtx() }); else location.hash = '#angebot';
});
const sessToken = () => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } };
// Darlehen, wenn nicht angegeben: Kaufpreis + Nebenkosten − Eigenkapital (mindestens 0).
const autoLoan = (o) => Math.max(0, Math.round(Number(o.price) * (1 + (Number(o.purchaseCostPct) || 0) / 100) - (Number(o.equity) || 0)));
const newObjId = () => { const b = new Uint8Array(6); crypto.getRandomValues(b); return 'o' + [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
// „Unter Meine Objekte speichern“ aus der Analyse: direkt ins Konto, danach zur Liste.
async function saveFromAnalyse(o) {
  if (!APP) return false;
  const { u, d, saveData, reload } = APP;
  d.objects = Array.isArray(d.objects) ? d.objects : [];
  d.objects.push({ ...o, id: newObjId(), createdVia: 'analyse' });
  await saveData(u, d);
  reload();
  setTimeout(() => document.getElementById('objStep2')?.scrollIntoView({ block: 'start' }), 400);
  return true;
}
// Analyse-Modul (Suche) bei Bedarf laden – AutoPilot nutzt denselben Rechenweg wie die Analyse.
async function objektModule() {
  const v = $('sucheMount');
  const m = await import('/src/objekt-ui.mjs?v=892f3666');
  if (v && !v.dataset.ready) { v.dataset.ready = '1'; m.mountObjekt(v, { pdf: true, app: true, profile: APP?.d?.profile, onSave: saveFromAnalyse }); }
  return m;
}
const fileName = (r, fallback) => { const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(r.headers.get('content-disposition') || ''); return m ? decodeURIComponent(m[1] || m[2]) : fallback; };

function kmCard() {
  return `<article class="dash-card wide km-card" data-view="objekte" id="kmCard">
    <div class="studio-head"><h3>BankReady Kreditmappe</h3><p class="form-note">Ihre Unterlagen für die Bank – erstellt aus einem gespeicherten Objekt und Ihrem Finanzprofil.</p></div>
    <div class="demo-hint" id="kmDemo" hidden></div><div id="kmBody"></div><p class="km-msg" id="kmMsg" role="status" aria-live="polite"></p><div id="kmRes"></div></article>`;
}

function kmBody(d) {
  // Kreditmappe nur aus gespeicherten Objekten (Exposé/Link laufen oben unter „Neues Objekt prüfen“ – nichts doppelt).
  const os = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.id);
  return `<div class="km-grid">
    ${os.length ? `<div class="km-box km-main"><strong>Kreditmappe aus meinem Objekt</strong><span>Objekt wählen – BankReady erstellt die Mappe aus Ihren Angaben und Ihrem Finanzprofil.</span>
      <label class="km-pick">Objekt<select id="kmObj">${os.map((o) => `<option value="${esc(o.id)}">${esc(o.name || 'Objekt')}</option>`).join('')}</select></label>
      <div class="km-actions"><button class="btn btn-dark" type="button" id="kmGo">Kreditmappe erstellen</button></div></div>`
    : `<div class="km-box km-main"><strong>Noch kein Objekt gespeichert</strong><span>Prüfen Sie oben ein Objekt und tippen Sie auf „Unter ‚Meine Objekte‘ speichern“ – dann erstellen Sie hier die Kreditmappe.</span>
      <div class="km-actions"><button class="btn btn-dark" type="button" id="kmToNew">Zu „Neues Objekt prüfen“</button></div></div>`}
    <div class="km-box"><strong>Selbst eintragen</strong><span>Alle Angaben für die Kreditmappe direkt auf der Website eintragen.</span>
      <div class="km-actions"><button class="btn btn-outline" type="button" id="kmManual">Formular öffnen</button></div></div>
    <div class="km-box"><strong>PDF-Formular</strong><span>Herunterladen, am Handy oder Computer ausfüllen und hier wieder hochladen – BankReady übernimmt alle Werte.</span>
      <div class="km-actions"><button class="btn btn-outline" type="button" id="kmFormGet">Formular herunterladen</button><label class="btn btn-outline km-file">Ausgefülltes PDF hochladen<input type="file" accept="application/pdf,.pdf" id="kmFormUp" hidden></label></div>
      <small class="form-note">Handschriftlich ausgefüllte Scans können nicht automatisch gelesen werden.</small></div>
  </div>
  ${!(Number(d.profile?.netIncome) > 0) ? '<p class="form-note">Tipp: Für die Haushaltsrechnung der Kreditmappe im Finanzprofil das Nettoeinkommen eintragen.</p>' : ''}`;
}

function bindKm(d, u, saveData, reload) {
  const box = $('kmCard'); if (!box) return;
  const msg = (t, cls = '') => { const m = $('kmMsg'); if (m) { m.className = `km-msg ${cls}`; m.innerHTML = t; } };
  const res = (h) => { const r = $('kmRes'); if (r) r.innerHTML = h; };
  const draw = () => {
    box.querySelectorAll('[data-kmdoc]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kmdoc === KM.doc)));
    box.querySelectorAll('[data-kmway]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kmway === KM.way)));
    $('kmBody').innerHTML = kmBody(d); msg(''); res('');
    wire();
  };
  const openForm = () => {
    const det = document.querySelector('#objectForm .obj-more'); if (det) det.open = true;
    const f = document.getElementById('objName'); if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => f.focus({ preventScroll: true }), 300); }
  };
  const land = () => { try { const s = JSON.parse(localStorage.getItem('lr-objekt-v1') || '{}'); return GREST_KEYS.includes(s.a_land) ? s.a_land : GREST_KEYS.includes(s.s_land) ? s.s_land : 'hessen'; } catch { return 'hessen'; } };
  const mainBtns = () => box.querySelectorAll('button, .km-file, input');
  const busy = (on) => mainBtns().forEach((x) => { if ('disabled' in x) x.disabled = on; x.classList?.toggle('is-busy', on); });

  // ---------- Kreditmappe (BankReady) für ein gespeichertes Objekt erzeugen und anzeigen ----------
  async function mappeFor(objectId, w, extraNote = '') {
    const H = { Authorization: 'Bearer ' + sessToken(), 'content-type': 'application/json' };
    let r = await fetch('/api/kreditmappe', { method: 'POST', headers: H, body: JSON.stringify({ objectId }) });
    let preview = false;
    if (!r.ok) {
      const j = await r.clone().json().catch(() => ({}));
      if (r.status === 402 || r.status === 503 || j.code === 'not_yet') {
        preview = true;
        r = await fetch('/api/kreditmappe/preview', { method: 'POST', headers: H, body: JSON.stringify({ objectId }) });
        if (!r.ok) { const k = await r.json().catch(() => ({})); throw Error(k.error || 'Die Kreditmappe konnte nicht erstellt werden.'); }
      } else throw Error(j.error || 'Die Kreditmappe konnte nicht erstellt werden.');
    }
    const ver = r.headers.get('X-Document-Version');
    const blob = await r.blob();
    await w.done('Kreditmappe fertig');
    const { showPdf } = await import('/src/pdf-view.mjs?v=892f3666');
    const o = (d.objects || []).find((x) => x.id === objectId);
    showPdf(blob, {
      filename: fileName(r, preview ? 'LeaseRun_BankReady_Vorschau.pdf' : `LeaseRun_BankReady${ver ? '_v' + ver : ''}.pdf`),
      title: `BankReady · ${o?.name || 'Kreditmappe'}`,
      note: (preview ? DEMO_NOTE + ' ' + UNLOCK + ' ' : '') + extraNote,
      onClose: () => reload?.(),
    });
    msg(preview ? 'BankReady-Vorschau erstellt. Fehlende Angaben ergänzen Sie beim Objekt unter „Bearbeiten“.' : `BankReady-Kreditmappe${ver ? ' Version ' + esc(ver) : ''} erstellt.`, 'ok');
  }

  // ---------- Objekt aus Exposé-/Link-Daten anlegen ----------
  function objectFromListing(r) {
    const l = land(), g = GREST[l];
    const area = Number(r.area) || 0;
    const o = {
      id: newObjId(), name: String(r.name || r.title || 'Objekt aus Exposé').slice(0, 160), price: Math.round(r.price), rent: Number(r.rent) || 0, area,
      yearBuilt: Number(r.year) || 0, efficiencyClass: r.energyClass || '', brokerPct: r.brokerPct != null ? Number(r.brokerPct) : 3.57, grestPct: g.pct, notaryPct: 2,
      purchaseCostPct: Math.round((g.pct + 2 + (r.brokerPct != null ? Number(r.brokerPct) : 3.57)) * 100) / 100,
      equity: Number(d.profile?.equity) || 0, interestPct: 3.5, repaymentPct: 2, fixedYears: 10, vacancyPct: 2, maintenance: area ? Math.round(area * 100) / 100 : 0,
      source: r.url || '', createdVia: 'autopilot',
    };
    o.loan = autoLoan(o);
    return o;
  }

  // ---------- Gemeinsamer Ablauf für AutoPilot (Exposé-Text) ----------
  async function runListing(listing, w) {
    if (KM.doc === 'an') {
      const mod = await objektModule();
      await w.step(2);
      const sum = mod.autoAnalyse({ listing });
      await w.step(3);
      const out = await mod.analysePdf(false);
      await w.done('RenditeRadar fertig');
      showResult(sum);
      const { showPdf } = await import('/src/pdf-view.mjs?v=892f3666');
      const demo = !(await getAccess()).paid ? DEMO_NOTE + ' ' : '';
      showPdf(out.blob, { filename: out.filename, title: `RenditeRadar · ${sum.name}`, note: demo + (sum.missing.length ? `Nicht im Exposé gefunden: ${esc(sum.missing.join(', '))} – in der Analyse ergänzen.` : '') });
      return;
    }
    const { parseListing } = await import('/src/listing-parse.mjs?v=892f3666');
    await w.step(2);
    const r = parseListing(listing);
    if (r.price == null) throw Error('Im Exposé wurde kein Kaufpreis gefunden. Bitte ein einzelnes Kaufangebot verwenden oder die Werte manuell eintragen.');
    const o = objectFromListing(r);
    d.objects = [...(Array.isArray(d.objects) ? d.objects : []), o];
    await saveData(u, d);
    await w.step(3);
    const miss = [...r.missing, ...(Number(d.profile?.netIncome) > 0 ? [] : ['Nettoeinkommen im Finanzprofil'])];
    await mappeFor(o.id, w, `Objekt „${esc(o.name)}“ wurde angelegt (Bundesland ${esc(GREST[land()].name)}, Zins 3,5 %, Tilgung 2 % als Annahme – bitte prüfen).${miss.length ? ' Noch offen: ' + esc(miss.join(', ')) + '.' : ''}`);
  }

  function showResult(sum) {
    const E0 = (x) => (x == null ? '–' : Number(x).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
    const Pc = (x) => (x == null ? '–' : `${Number(x).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`);
    res(`<div class="km-result"><strong>RenditeRadar: ${esc(sum.name)}</strong>
      <div class="km-kpis"><span><small>Kaufpreis</small>${E0(sum.price)}</span><span><small>Bruttorendite</small>${Pc(sum.grossYield)}</span><span><small>Cashflow / Monat</small>${E0(sum.cashflow)}</span><span><small>DSCR</small>${sum.dscr == null ? '–' : Number(sum.dscr).toLocaleString('de-DE', { maximumFractionDigits: 2 })}</span></div>
      <div class="km-actions"><a class="btn btn-outline" href="#objekte">In der Analyse oben ansehen &amp; anpassen</a></div></div>`);
  }

  const wire = () => {
    $('kmToNew')?.addEventListener('click', () => $('sucheView')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    $('kmManual')?.addEventListener('click', () => { if (KM.doc === 'km') openForm(); else location.hash = 'objekte'; });

    // Exposé-PDF (AutoPilot)
    $('kmPdf')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
      if (f.size > 40 * 1024 * 1024) { msg('Die Datei ist größer als 40 MB.', 'bad'); return; }
      msg(''); busy(true);
      const { work } = await import('/src/loader.mjs?v=892f3666');
      const w = work(`${PROD[KM.doc].name} AutoPilot`, ['Exposé öffnen', 'Text erkennen', 'Eckdaten übernehmen', KM.doc === 'km' ? 'Kreditmappe erstellen' : 'Kennzahlen & PDF erstellen']);
      try {
        await w.step(0);
        const mod = await objektModule();
        await w.step(1);
        const t = await mod.exposeText(f);
        if (t.replace(/\s+/g, '').length < 150) throw Error('In diesem PDF ist kein lesbarer Text (vermutlich ein Scan). Bitte die Werte manuell eintragen.');
        await runListing({ u: '', t, ti: f.name.replace(/\.pdf$/i, '') }, w);
      } catch (err) { w.close(); msg(esc(err.message), 'bad'); }
      finally { busy(false); }
    });

    // Link (AutoPilot)
    $('kmLinkF')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = $('kmLink').value.trim(); if (!url) return;
      msg(''); busy(true);
      const { work } = await import('/src/loader.mjs?v=892f3666');
      const w = work(`${PROD[KM.doc].name} AutoPilot`, ['Link abrufen', 'Inhalt erkennen', 'Eckdaten übernehmen', KM.doc === 'km' ? 'Kreditmappe erstellen' : 'Kennzahlen & PDF erstellen']);
      try {
        await w.step(0);
        const r = await fetch('/api/expose-link', { method: 'POST', headers: { Authorization: 'Bearer ' + sessToken(), 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw Object.assign(Error(j.error || 'Der Link konnte nicht ausgewertet werden.'), { more: j.code === 'portal' ? ' <a class="ck-link" href="#objekte">Zur Ein-Klick-Übernahme</a>' : '' });
        }
        await w.step(1);
        let listing;
        if ((r.headers.get('content-type') || '').includes('application/pdf')) {
          const mod = await objektModule();
          const t = await mod.exposeText(await r.blob());
          if (t.replace(/\s+/g, '').length < 150) throw Error('Das verlinkte PDF enthält keinen lesbaren Text (vermutlich ein Scan).');
          listing = { u: url, t, ti: '' };
        } else {
          const j = await r.json();
          listing = { u: j.u || url, t: j.t, ti: j.ti, j: j.j };
        }
        await runListing(listing, w);
        $('kmLink').value = '';
      } catch (err) { w.close(); msg(esc(err.message) + (err.more || ''), 'bad'); }
      finally { busy(false); }
    });

    // Gespeichertes Objekt (AutoPilot)
    $('kmGo')?.addEventListener('click', async () => {
      const id = $('kmObj')?.value; const o = (d.objects || []).find((x) => x.id === id); if (!o) return;
      msg(''); busy(true);
      const { work } = await import('/src/loader.mjs?v=892f3666');
      const w = work(`${PROD[KM.doc].name} wird erstellt`, KM.doc === 'km' ? ['Objekt und Finanzprofil laden', 'Kennzahlen und Stresstest rechnen', 'Kreditmappe erzeugen'] : ['Objekt laden', 'Kennzahlen berechnen', 'PDF erzeugen']);
      try {
        await w.step(0);
        if (KM.doc === 'km') { await w.step(1); await w.step(2); await mappeFor(id, w); }
        else {
          const mod = await objektModule();
          mod.loadFromObject(o);
          await w.step(1);
          const sum = mod.autoAnalyse({});
          await w.step(2);
          const out = await mod.analysePdf(false);
          await w.done('RenditeRadar fertig');
          showResult(sum);
          const { showPdf } = await import('/src/pdf-view.mjs?v=892f3666');
          showPdf(out.blob, { filename: out.filename, title: `RenditeRadar · ${sum.name}`, note: (await getAccess()).paid ? '' : DEMO_NOTE });
        }
      } catch (err) { w.close(); msg(esc(err.message), 'bad'); }
      finally { busy(false); }
    });

    // PDF-Formular ansehen und herunterladen (zahlende Kunden ohne Wasserzeichen)
    $('kmFormGet')?.addEventListener('click', async () => {
      busy(true); msg('');
      const { work } = await import('/src/loader.mjs?v=892f3666');
      const w = work('Formular wird vorbereitet', ['Felder anlegen', 'PDF erzeugen']);
      try {
        await w.step(0);
        const r = await fetch(`/api/formular/${PROD[KM.doc].form}`, { headers: { Authorization: 'Bearer ' + sessToken() } });
        if (!r.ok) throw Error('Das Formular konnte nicht erstellt werden.');
        await w.step(1);
        const blob = await r.blob(); const clean = r.headers.get('X-Form-Clean') === '1';
        await w.done('Formular bereit');
        const { showPdf } = await import('/src/pdf-view.mjs?v=892f3666');
        showPdf(blob, { filename: fileName(r, `LeaseRun_${PROD[KM.doc].name}_Formular.pdf`), title: `${PROD[KM.doc].name} · Formular zum Ausfüllen`,
          note: `Herunterladen, ausfüllen, speichern – dann unter „Ausgefülltes PDF hochladen“ wieder einlesen.${clean ? '' : ' ' + DEMO_NOTE}` });
      } catch (err) { w.close(); msg(esc(err.message), 'bad'); }
      finally { busy(false); }
    });

    // Ausgefülltes PDF-Formular hochladen (Manuell)
    $('kmFormUp')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
      msg(''); busy(true);
      const { work } = await import('/src/loader.mjs?v=892f3666');
      const kind = PROD[KM.doc].form;
      const w = work(`${PROD[KM.doc].name}: Formular wird eingelesen`, ['PDF öffnen', 'Eingaben lesen', 'Daten übernehmen', KM.doc === 'km' ? 'Kreditmappe erstellen' : 'Kennzahlen & PDF erstellen']);
      try {
        await w.step(0);
        const [{ readPdfForm, showPdf }, spec] = await Promise.all([import('/src/pdf-view.mjs?v=892f3666'), import('/src/form-spec.mjs?v=892f3666')]);
        const raw = await readPdfForm(f);
        await w.step(1);
        const other = kind === 'analyse' ? 'kreditmappe' : 'analyse';
        if (raw.id === spec.FORMS[other].id) throw Error(`Das ist das ${spec.FORMS[other].product}-Formular. Bitte oben „${spec.FORMS[other].product}“ wählen und erneut hochladen.`);
        const { values, filled } = spec.readForm(kind, raw.values);
        if (!filled) throw Error(raw.id === spec.FORMS[kind].id ? 'Das Formular ist noch leer. Bitte ausfüllen, speichern und erneut hochladen.' : 'In dieser Datei wurden keine LeaseRun-Formularfelder gefunden. Bitte das Formular über „Formular ansehen & herunterladen“ verwenden.');
        await w.step(2);
        if (kind === 'analyse') {
          const mod = await objektModule();
          const sum = mod.autoAnalyse({ values });
          await w.step(3);
          const out = await mod.analysePdf(false);
          await w.done('RenditeRadar fertig');
          showResult(sum);
          showPdf(out.blob, { filename: out.filename, title: `RenditeRadar · ${sum.name}`, note: `${filled} Angaben aus dem Formular übernommen.${(await getAccess()).paid ? '' : ' ' + DEMO_NOTE}` });
          return;
        }
        // BankReady: Finanzprofil und Objekt aus dem Formular übernehmen
        if (!(values.o_price > 0)) throw Error('Im Formular fehlt der Kaufpreis.');
        const prof = { ...(d.profile || {}) };
        if (values.p_employment) prof.employment = values.p_employment;
        for (const k of ['netIncome', 'householdSize', 'equity']) if (values['p_' + k] != null) prof[k] = values['p_' + k];
        d.profile = prof;
        const l = values.o_land || land(), g = GREST[l];
        const o = { id: newObjId(), name: values.o_name || 'Objekt aus Formular', createdVia: 'formular', grestPct: g.pct, notaryPct: 2, brokerPct: 0, interestPct: 3.5, repaymentPct: 2, fixedYears: 10, vacancyPct: 2, equity: Number(prof.equity) || 0, rent: 0 };
        for (const [k, v] of Object.entries(values)) if (k.startsWith('o_') && k !== 'o_land' && k !== 'o_name') o[k.slice(2)] = v;
        o.purchaseCostPct = Math.round((g.pct + (Number(o.notaryPct) || 0) + (Number(o.brokerPct) || 0)) * 100) / 100;
        if (!(Number(o.loan) > 0)) o.loan = autoLoan(o);
        d.objects = [...(Array.isArray(d.objects) ? d.objects : []), o];
        await saveData(u, d);
        await w.step(3);
        await mappeFor(o.id, w, `${filled} Angaben aus dem Formular übernommen; Objekt „${esc(o.name)}“ und Finanzprofil wurden gespeichert.`);
      } catch (err) { w.close(); msg(esc(err.message), 'bad'); }
      finally { busy(false); }
    });
  };
  getAccess().then((a) => { const h = $('kmDemo'); if (h && !a.paid) { h.hidden = false; h.innerHTML = `<p class="km-demo-t">${DEMO_NOTE}</p><div class="km-demo-a">${UNLOCK}<a class="ck-link" href="#angebot">Alle Tarife</a></div>`; } });
  box.querySelectorAll('[data-kmdoc]').forEach((b) => b.onclick = () => { KM.doc = b.dataset.kmdoc; draw(); });
  box.querySelectorAll('[data-kmway]').forEach((b) => b.onclick = () => { KM.way = b.dataset.kmway; draw(); });
  draw();
}

// Konto: Tarif, Rechnungen (PDF, beliebig oft), Tarif wechseln, Zahlungsmittel, Kündigen.
async function renderFin() {
  const box = $('finBody'); if (!box) return;
  const token = (() => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } })();
  const H = { Authorization: 'Bearer ' + token };
  let cfg = { enabled: false }, st = { tier: 'free' }, inv = { invoices: [] };
  // Alles gleichzeitig anfragen statt nacheinander (spart auf dem Handy mehrere Sekunden).
  const pSt = fetch('/api/billing/status' + (CHECKOUT === 'success' ? '?fresh=1' : ''), { headers: H, cache: 'no-store' }).then((r) => r.json()).catch(() => ({ tier: 'free' }));
  const pInv = fetch('/api/billing/invoices', { headers: H, cache: 'no-store' }).then((r) => r.json()).catch(() => ({ invoices: [] }));
  const [acc, cfg0] = await Promise.all([getAccess(), fetch('/api/billing/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false }))]);
  cfg = cfg0 || cfg;
  if (cfg.enabled) [st, inv] = await Promise.all([pSt, pInv]);
  const tierName = acc.paid && (st.tier || 'free') === 'free' ? (acc.b2b ? 'Unternehmenskonto' : 'Voller Zugang') : ({ free: 'Kostenlose Demo', starter: 'Käufer-Pass', pro: 'Investor Pro' }[st.tier || 'free'] || 'Kostenlose Demo');
  const demoBox = acc.paid ? '' : `<div class="demo-box"><strong>Sie nutzen die kostenlose Demo</strong><p>Probieren Sie alles aus: RenditeRadar-Analysen, BankReady-Vorschau, PDF-Formulare und den Lernbereich. In der Demo tragen alle PDFs ein LeaseRun-Wasserzeichen. Sobald Sie ein Abo besitzen bzw. einen Tarif gebucht haben, entfallen die Wasserzeichen – Ihre Dokumente sind dann fertig für Bank und Weitergabe.</p><a class="btn btn-dark" href="#angebot">Tarife ansehen</a></div>`;
  const until = st.pro ? st.proUntil : st.starter ? st.starterUntil : null;
  const money = (c, cur = 'eur') => (Number(c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: String(cur).toUpperCase() });
  const dte = (x) => (x ? new Date(x).toLocaleDateString('de-DE') : '–');
  const list = Array.isArray(inv.invoices) ? inv.invoices : [];
  box.innerHTML = `${demoBox}${CHECKOUT === 'success' ? '<p class="auth-message success">Vielen Dank – Ihre Zahlung wurde übermittelt. Die Rechnung erscheint unten und kommt per E-Mail.</p>' : CHECKOUT === 'cancel' ? '<p class="form-note">Bezahlung abgebrochen – es wurde nichts berechnet.</p>' : CHECKOUT === 'test' ? '<p class="auth-message success">Testkauf erfolgreich – die Bezahlung lief im Stripe-Testmodus. Es wurde nichts berechnet und nichts freigeschaltet.</p>' : ''}<div class="fin-grid">
    <div class="fin-box"><small>Ihr Tarif</small><strong>${tierName}</strong><span>${until ? `aktiv bis ${dte(until)}` : st.tier === 'free' ? (acc.paid ? 'Alle Funktionen, PDFs ohne Wasserzeichen' : 'Alles ausprobieren · PDFs mit Wasserzeichen') : ''}${st.creditMaps ? ` · Kreditmappen: ${Math.max(0, (st.creditMaps || 0) - (st.creditMapsUsed || 0))} frei` : ''}</span></div>
    <div class="fin-actions">${(() => {
      // Nur Knöpfe zeigen, die für den aktuellen Tarif wirklich gehen – keine ausgegrauten Doppelungen.
      const paidTier = st.tier && st.tier !== 'free', sub = st.proSource === 'subscription';
      const b = [];
      b.push(paidTier ? '<a class="btn btn-pay" href="#angebot">Tarif wechseln / upgraden</a>' : '<a class="btn btn-pay" href="#angebot">Tarif buchen</a>');
      if (cfg.enabled && st.hasCustomer) b.push('<button class="btn btn-outline" type="button" data-flow="payment">Zahlungsmittel verwalten</button>');
      if (cfg.enabled && sub) b.push('<button class="btn btn-outline fin-cancel" type="button" data-flow="cancel">Abo kündigen</button>');
      return b.join('');
    })()}
    </div></div>
    ${cfg.enabled ? '' : '<p class="form-note">Die Zahlungsabwicklung startet in Kürze. Danach können Sie hier Tarife wechseln, Zahlungsmittel ändern, kündigen und alle Rechnungen herunterladen.</p>'}
    <h4 class="fin-h">Rechnungen</h4>
    ${list.length ? `<ul class="fin-list">${list.map((i) => `<li><div><strong>${esc(i.number || 'Rechnung')}</strong><span>${dte(i.date)} · ${money(i.total, i.currency)}${i.status === 'open' ? ' · <b class="st warn">offen</b>' : ' · bezahlt'}${i.description ? ` · ${esc(i.description.slice(0, 60))}` : ''}</span></div>${i.pdf ? `<a class="btn btn-outline" href="${esc(i.pdf)}" target="_blank" rel="noopener noreferrer">PDF herunterladen</a>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Noch keine Rechnungen.</p>'}
    <p class="form-note">Rechnungen können Sie jederzeit erneut herunterladen. Kündigen geht auch ohne Anmeldung über <a class="ck-link" href="/cancel">„Verträge hier kündigen“</a>.</p>
    <p class="fin-msg" id="finMsg" role="status" aria-live="polite" data-busy-msg></p>`;
  box.querySelectorAll('[data-flow]').forEach((b) => b.onclick = async () => {
    b.disabled = true; b.dataset.busy = '1'; const m = $('finMsg'); m.textContent = 'Wird geöffnet …';
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ flow: b.dataset.flow }) });
      const j = await r.json().catch(() => ({}));
      // Zahlungsmittel ändern: eigene LeaseRun-Seite (/checkout) mit eingebettetem, verschlüsseltem Stripe-Formular.
      if (r.ok && j.clientSecret) { sessionStorage.setItem('lr-kasse', JSON.stringify({ ...j, at: Date.now() })); location.href = '/checkout'; return; }
      if (!r.ok || !j.url) throw Error(j.error || 'Konnte nicht geöffnet werden.');
      location.href = j.url;
    } catch (e) { m.textContent = e.message; b.disabled = false; delete b.dataset.busy; }
  });
  // Rückkehr nach „Zahlungsmittel ändern“: neues Zahlungsmittel als Standard übernehmen und bestätigen.
  const pmq = new URLSearchParams(location.search);
  if (pmq.get('zahlungsmittel') === '1' && pmq.get('session_id')) {
    const m = $('finMsg'); m.textContent = 'Zahlungsmittel wird übernommen …';
    try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ }
    fetch('/api/billing/portal', { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: pmq.get('session_id') }) })
      .then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { m.innerHTML = ok && j.ok ? `<span class="auth-message success">Gespeichert – ${j.label ? `<strong>${esc(j.label)}</strong> ist` : 'das neue Zahlungsmittel ist'} jetzt Ihr Standard für künftige Zahlungen${st.proSource === 'subscription' ? ' und Ihr Abo' : ''}.</span>` : esc(j.error || 'Das Zahlungsmittel konnte nicht übernommen werden.'); })
      .catch(() => { m.textContent = 'Keine Verbindung – bitte Seite neu laden.'; });
  }
}

// Fahrplan je Stufe (Einsteiger): Aufgaben mit Status aus den eigenen Daten. done: true/false, null = ohne Status.
function fahrplan(idx, d) {
  const pr = d.profile || {}, objs = Array.isArray(d.objects) ? d.objects : [], L = d.progress?.lern || {};
  const prof = Number(pr.netIncome) > 0 && pr.equity !== undefined && pr.equity !== '';
  const learned = (ids) => ids.every((i) => L[i]);
  const owned = objs.some((o) => o.purchaseDate && Number(o.fixedYears) > 0);
  return [
    [['Finanzprofil ausfüllen', 'Nettoeinkommen und Eigenkapital – daraus ergibt sich Ihr Budget.', '#konto', prof],
      ['Budget berechnen', 'Welche Rate und welcher Kaufpreis zu Ihnen passen.', '/calculators/budget', null],
      ['Grundlagen lernen', 'Geld, Eigenkapital, Zins und Tilgung – je wenige Minuten.', '#lernen', learned(['geld', 'eigenkapital', 'annuitaet'])]],
    [['Erstes Objekt anlegen', 'Exposé hochladen oder Eckdaten eintragen.', '#objekte', objs.length > 0],
      ['Kennzahlen prüfen', 'Rendite, Cashflow und Bankreife unter „Objekte“.', '#objekte', null],
      ['Exposé lesen lernen', 'Was hinter Cashflow und Beleihung steckt.', '#lernen', learned(['cashflow', 'beleihung'])]],
    [['Finanzprofil vollständig', 'Die Bank prüft Einkommen und Eigenkapital zuerst.', '#konto', prof],
      ['Unterlagen vollständig machen', 'Bankreife Ihres Objekts auf 90 % bringen.', '/checklist', null],
      ['Kreditmappe erstellen', 'BankReady: Objekt wählen → Vorschau → PDF.', '#objekte', null],
      ['Wissen für das Bankgespräch', 'Beleihungswert, Unterlagen, Bewertung Ihres Berufs.', '#lernen', learned(['unterlagen', 'beleihung'])]],
    [['Kaufdatum und Zinsbindung eintragen', 'Dann überwacht LeaseRun alle Fristen für Sie.', '#objekte', owned],
      ['Fristen-Erinnerung einschalten', 'E-Mail vor Ende der Zinsbindung und weiteren Fristen.', '#konto', null],
      ['Steuern und Mietrecht', 'Anlage V, Werbungskosten, wenn die Miete ausbleibt.', '#lernen', learned(['steuer', 'miete'])]],
  ][idx];
}

// Profi-Cockpit: Bestandskennzahlen aus den eigenen Objekten (keine Beispielwerte). Ohne Objekte: kurzer Hinweis.
function proKpis(d) {
  const n = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && n(o.price) > 0)
    .map((o) => ({ ...o, price: n(o.price), loan: n(o.loan), rent: n(o.rent), vacancyPct: n(o.vacancyPct), nonRecoverable: n(o.nonRecoverable), maintenance: n(o.maintenance), interestPct: n(o.interestPct), repaymentPct: n(o.repaymentPct), fixedYears: n(o.fixedYears) }));
  if (!objs.length) return '<p class="form-note pro-empty">Noch keine Objekte mit Kaufpreis – <a href="#objekte">Objekt anlegen</a>, dann erscheinen hier Cashflow, DSCR, LTV und Fristen Ihres Bestands.</p>';
  let pf; try { pf = portfolio(objs, { shockPp: 2 }); } catch { return ''; }
  let next = null; try { next = upcoming(objs, { limit: 1 }).items[0] || null; } catch { /* ohne Fristen */ }
  const t = pf.total, eur = (v) => Number(v || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const dec = (v) => (v == null ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const tone = (v, lo, hi) => (v == null ? '' : v < lo ? ' bad' : v < hi ? ' warn' : ' ok');
  return `<div class="pro-kpis">
    <a href="#werkzeuge" class="pro-kpi${t.cashflow < 0 ? ' bad' : ' ok'}"><small>Cashflow / Monat</small><strong>${eur(t.cashflow)}</strong><span>${objs.length} Objekt${objs.length === 1 ? '' : 'e'} · vor Steuern</span></a>
    <a href="#werkzeuge" class="pro-kpi${tone(t.dscr, 1, 1.2)}"><small>DSCR</small><strong>${dec(t.dscr)}</strong><span>NOI ÷ Kapitaldienst</span></a>
    <a href="#werkzeuge" class="pro-kpi${t.ltv == null ? '' : t.ltv > 90 ? ' bad' : t.ltv > 80 ? ' warn' : ' ok'}"><small>LTV</small><strong>${t.ltv == null ? '–' : dec(t.ltv) + ' %'}</strong><span>${eur(t.loan)} Darlehen</span></a>
    <a href="#werkzeuge" class="pro-kpi${t.afterCashflow == null ? '' : t.afterCashflow < 0 ? ' bad' : ' ok'}"><small>Nach Zinsschock +2 Pkt.</small><strong>${t.afterCashflow == null ? '–' : eur(t.afterCashflow)}</strong><span>Cashflow zum Bindungsende</span></a>
    ${next ? `<a href="/deadlines" class="pro-kpi"><small>Nächste Frist</small><strong>${new Date(next.date).toLocaleDateString('de-DE')}</strong><span>${esc(next.title || next.label || '')} · ${esc(next.object)}</span></a>` : ''}
  </div>`;
}

// Cockpit: zwei klare Hauptpfade statt vieler Einzelkacheln. Einsteiger geführt (nummeriert), Profi kompakt mit Fachbegriffen.
function paths(mode, done) {
  const A = mode === 'profi'
    ? [['#objekte', 'Import & Analyse', 'Rendite, DSCR, Cashflow nach Steuern'], ['#objekte', 'Kreditmappe', 'BankReady für jedes Objekt'], ['/scenarios', 'Anschlusszins & Verkauf', 'Kipp-Zins, Forward, § 23 EStG'], ['/calculators/loan-comparison', 'Bankangebote vergleichen', 'Effektivzins, Restschuld, Gesamtkosten'], ['/cockpit', 'Stresstest-Cockpit', 'Zinsschock und Mietausfall']]
    : [['/calculators/budget', 'Budget berechnen', 'Was kann ich mir leisten?'], ['#objekte', 'Exposé importieren', 'PDF oder Link – Kennzahlen sofort'], ['#objekte', 'Objekt prüfen', 'Exposé oder Link – Rendite und Risiko'], ['#objekte', 'Kreditmappe erstellen', 'Bankfertig für Ihr Gespräch']];
  const B = mode === 'profi'
    ? [['#werkzeuge', 'Software-Tools', 'Portfolio, Betriebskosten, Fristen'], ['#steuer', 'Steuer & AfA', 'Anlage V, 15-%-Grenze, AfA § 7 Abs. 4 / Sonder-AfA § 7b'], ['/calculators/depreciation', 'AfA-Plan', 'linear, degressiv, Sonder-AfA'], ['/calculators/rent-increase', 'Mieterhöhung', 'Kappungsgrenze, Briefentwurf'], ['/calculators', 'Rechner-Bibliothek', 'Mietrecht und Steuern'], ['#lernen', 'Fachwissen', `${done} von ${LERN.length} Themen`]]
    : [['/calculators', 'Rechner-Bibliothek', 'Nebenkosten, Tilgung, Kaufen oder mieten'], ['/learn/glossar', 'Lexikon', 'Fachbegriffe in einfachen Worten'], ['#steuer', 'Steuer-Grundlagen', 'Was Sie absetzen können'], ['#lernen', 'Lernplan', `${done} von ${LERN.length} Themen verstanden`]];
  const list = (xs, num) => `<ul class="path-list">${xs.map(([h, t, sub], i) => `<li><a href="${h}"><i>${num ? i + 1 : '›'}</i><span><b>${t}</b><small>${sub}</small></span><em aria-hidden="true">→</em></a></li>`).join('')}</ul>`;
  return `<div class="paths">
    <section class="path a"><div class="path-h"><span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5 12 4l9 5.5"/><path d="M4 10h16"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/><path d="M3 20h18"/></svg></span><div><strong>${mode === 'profi' ? 'Finanzierung & Objekte' : 'Meine Finanzierung'}</strong><small>${mode === 'profi' ? 'Vom Exposé zur Bankentscheidung' : 'Schritt für Schritt zur Bank'}</small></div></div>${list(A, mode !== 'profi')}</section>
    <section class="path b"><div class="path-h"><span aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M8 7h7M8 11h7"/></svg></span><div><strong>${mode === 'profi' ? 'Werkzeuge & Fachwissen' : 'Wissen & Werkzeuge'}</strong><small>${mode === 'profi' ? 'Steuer, Recht, Bestand' : 'Nachschlagen und nachrechnen'}</small></div></div>${list(B, false)}</section></div>`;
}

// Übersicht wie im Unternehmensportal: zuerst „Heute zu tun“, dann vier Kennzahlen – nur aus echten Kontodaten.
function todayB2C(d) {
  const pr = d.profile || {}, L = d.progress?.lern || {};
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.id);
  const priced = objs.filter((o) => Number(o.price) > 0);
  const prof = Number(pr.netIncome) > 0 && pr.equity !== undefined && pr.equity !== '' && Boolean(pr.employment);
  const fmt = (x) => new Date(x).toLocaleDateString('de-DE');
  let best = null;
  for (const o of priced) {
    try {
      const g = readiness(o, []).groups.filter((x) => x.key !== 'unterlagen');
      const done = g.reduce((a, x) => a + x.done, 0), total = g.reduce((a, x) => a + x.total, 0);
      const pct = total ? Math.round((done / total) * 100) : 0;
      if (!best || pct > best.pct) best = { o, pct, missing: g.flatMap((x) => x.missing) };
    } catch { /* Objekt unvollständig */ }
  }
  let next = null; try { next = priced.length ? upcoming(priced.map((o) => ({ ...o, price: Number(o.price), fixedYears: Number(o.fixedYears) || 0 })), { limit: 1 }).items[0] || null : null; } catch { /* ohne Fristen */ }
  const nextTopic = LERN.find(([id]) => !L[id]);
  const learned = LERN.filter(([id]) => L[id]).length;
  const items = [];
  if (!prof) items.push(['warn', 'Finanzprofil vervollständigen', 'Einkommen, Eigenkapital und Erwerbsstatus – daraus rechnet LeaseRun Ihr Budget.', '#konto']);
  if (!priced.length) items.push(['hot', 'Erstes Objekt analysieren', 'Exposé hochladen, Link eintragen oder Kaufpreis eingeben.', '#objekte']);
  if (best && best.pct < 100) items.push(['warn', `${esc(best.o.name || 'Objekt')}: ${best.missing.length} Angabe${best.missing.length === 1 ? '' : 'n'} fehlen`, 'Für eine bankfertige Kreditmappe ergänzen.', '#objekte']);
  if (best && best.pct >= 90) items.push(['ok', 'Kreditmappe erstellen', `${esc(best.o.name || 'Objekt')} ist zu ${best.pct} % vorbereitet.`, '#objekte']);
  if (next) { const days = Math.round((new Date(next.date) - Date.now()) / 864e5); if (days <= 365) items.push(['hot', `Frist am ${fmt(next.date)}`, `${esc(next.title || next.label || 'Frist')} · ${esc(next.object || '')}`, '/deadlines']); }
  if (nextTopic) items.push(['', `Lernen: ${nextTopic[1]}`, nextTopic[2], '#lernen']);
  const list = items.length
    ? items.map(([c, t, x, h]) => `<li class="${c}"><a href="${h}"><span class="todo-dot" aria-hidden="true"></span><span><strong>${t}</strong><small>${x}</small></span><em aria-hidden="true">›</em></a></li>`).join('')
    : '<li class="empty">Alles erledigt – gut vorbereitet.</li>';
  const kpi = (l, v, a, h) => `<a class="lr-kpi" href="${h}"><small>${l}</small><strong>${v}</strong><span>${a}</span></a>`;
  return `<section class="lr-today"><div class="todo-h"><h3>Heute zu tun</h3><span class="form-note">${items.length ? `${items.length} Punkt${items.length === 1 ? '' : 'e'}` : 'Alles erledigt'}</span></div><ul class="todo-list">${list}</ul></section>
  <div class="lr-kpis">${kpi('Objekte', priced.length, priced.length ? 'Ansehen' : 'Anlegen', priced.length ? '#objekte' : '#objekte')}${kpi('Bankreife', best ? best.pct + ' %' : '–', 'Kreditmappe', '#objekte')}${kpi('Nächste Frist', next ? fmt(next.date) : '–', 'Fristen', '/deadlines')}${kpi('Lernplan', `${learned} / ${LERN.length}`, 'Wissen', '#lernen')}</div>`;
}

function startCard(mode, d) {
  const done = Object.values(d.progress?.lern || {}).filter(Boolean).length;
  if (!d.profile?.mode && !new URLSearchParams(location.search).get('modus')) {
    return `<article class="dash-card wide start-card wiz-card" data-view="start"><span class="stage-k">Willkommen bei LeaseRun</span><h3>In drei kurzen Fragen auf Sie eingestellt</h3>
      <p class="form-note">Ziel, Stand und – wenn Sie möchten – Ihre Zahlen. Danach passt sich alles an: Startseite, Fahrplan, Lernplan und Steuer-Bereich. Jederzeit änderbar.</p>
      <div class="wiz-start"><button class="btn btn-dark wiz-open" type="button">Los geht's – 1 Minute</button><button class="btn btn-outline" type="button" data-pick="einsteiger">Überspringen</button></div></article>`;
  }
  const ph = phaseOf(d);
  if (mode === 'profi') {
    // Profi: Kennzahlen des eigenen Bestands statt Erklärtexte – danach Werkzeuge.
    return `<article class="dash-card wide start-card start-pro" data-view="start">
      ${todayB2C(d)}
      <div class="stage-mini"><span class="stage-k">Stufe</span><strong><b class="stage-n">${ph.idx + 1}</b>${PH()[ph.idx].name}</strong><button type="button" class="link-btn stage-open">ändern</button><div id="rankSlot" class="rank-slot mini"></div></div>
      ${proKpis(d)}
      <div id="cmMode"></div>
      ${paths('profi', done)}</article>`;
  }
  const tasks = fahrplan(ph.idx, d);
  const nextI = tasks.findIndex((x) => x[3] === false);
  return `<article class="dash-card wide start-card" data-view="start">${todayB2C(d)}${phasePicker(ph.idx, ph.chosen)}
    <div id="rankSlot" class="rank-slot"></div>
    <div id="cmMode"></div>
    <h4 class="sc-h">Ihr Fahrplan für Stufe ${ph.idx + 1}</h4>
    <ol class="fp">${tasks.map(([t, sub, h, st], i) => `<li class="fp-i${st === true ? ' done' : ''}${i === nextI ? ' next' : ''}"><span class="fp-dot" aria-hidden="true">${st === true ? '✓' : i + 1}</span><span class="fp-t"><strong>${t}</strong><small>${sub}</small></span>${st === true ? '<span class="fp-st">erledigt</span>' : `<a class="btn ${i === nextI ? 'btn-dark' : 'btn-outline'} fp-go" href="${h}">${i === nextI ? 'Jetzt erledigen' : 'Öffnen'}</a>`}</li>`).join('')}</ol>
    <h4 class="sc-h">Ihre zwei Wege</h4>
    ${paths('einsteiger', done)}</article>`;
}

function bindStart(mode, d, u, saveData, reload) {
  // Modusabhängiges Cockpit (Einsteiger: Budget-Tacho · Profi: RenditeRadar, Vermögenskurve, Szenarien).
  const cm = document.getElementById('cmMode');
  if (cm) import('/src/cockpit-mode.mjs?v=892f3666').then((m) => (mode === 'profi' ? m.mountProfi(cm, { d }) : m.mountEinsteiger(cm, { d, save: (x) => { d.profile = { ...(d.profile || {}), ...x }; saveData(u, d).catch(() => {}); } }))).catch(() => {});
  document.querySelectorAll('[data-phase]').forEach((b) => b.onclick = async () => {
    d.profile = { ...(d.profile || {}), phase: Number(b.dataset.phase) };
    b.closest('.ph-pick')?.querySelectorAll('.ph-btn').forEach((x) => x.classList.toggle('on', x === b));
    saveData(u, d).catch(() => { /* wird nachgeholt */ });
    reload();
  });
  document.querySelectorAll('[data-pick]').forEach((b) => b.onclick = async () => {
    d.profile = { ...(d.profile || {}), mode: b.dataset.pick };
    saveData(u, d).catch(() => { /* wird nachgeholt */ });
    reload();
  });
}

const escQ = (t) => String(t).toLowerCase().replace(/["<>&]/g, ' ');
function lernTopics(st, rec = [], recName = '', plan = '') {
  const one = ([id, t, sub], k = -1, next = false) => `
    <details class="lt${st[id] ? ' done' : ''}${next ? ' next' : ''}" data-topic="${id}" data-q="${escQ(t + ' ' + sub + ' ' + (LERN.find((x) => x[0] === id)?.[5] || ''))}">
      <summary>${k >= 0 ? `<span class="lt-num" aria-hidden="true">${st[id] ? '✓' : k + 1}</span>` : ''}<span class="lt-title">${next ? '<em class="lt-next-tag">Als Nächstes</em>' : ''}<strong>${t}</strong><span>${sub}</span></span><span class="lt-state">${st[id] ? '✓ verstanden' : ''}</span></summary>
      <div class="lt-body" data-body="${id}"><p class="lr-ld" role="status">Wird geladen …</p></div>
    </details>`;
  const recT = rec.map((id) => LERN.find((x) => x[0] === id)).filter(Boolean);
  const nextId = recT.find(([id]) => !st[id])?.[0];
  const doneRec = recT.filter(([id]) => st[id]).length;
  const head = recT.length ? `<div class="lt-plan"><h4 class="lt-group lt-rec">Ihr Lernplan · Phase ${recName}</h4>${plan ? `<p class="form-note">${plan}</p>` : ''}<p class="form-note lt-plan-n">${doneRec} von ${recT.length} Themen Ihres Lernplans verstanden.</p>${recT.map((x, k) => one(x, k, x[0] === nextId)).join('')}</div>` : '';
  // Übrige Gruppen: zuerst die, die zur Phase passen (enthalten empfohlene Themen), dann der Rest.
  const groups = [...new Set(LERN.map((x) => x[5]))];
  const recGroups = new Set(recT.map((x) => x[5]));
  groups.sort((a, b) => Number(recGroups.has(b)) - Number(recGroups.has(a)));
  const rest = groups.map((g) => { const items = LERN.filter((x) => x[5] === g && !rec.includes(x[0])); return items.length ? `<h4 class="lt-group">${g}</h4>${items.map((x) => one(x)).join('')}` : ''; }).join('');
  return head + (rest ? `<h4 class="lt-group lt-more-h">Weitere Themen</h4>${rest}` : '');
}

function lernCard(mode, d) {
  const st = d.progress?.lern || {};
  const n = LERN.filter(([id]) => st[id]).length;
  const search = `<div class="lt-search"><input type="search" id="ltQ" placeholder="Thema eingeben, z. B. Zinsbindung, Inflation, AfA" aria-label="Wissensthema suchen" autocomplete="off"><p class="form-note" id="ltHits" aria-live="polite"></p></div>`;
  const head = mode === 'profi'
    ? `<h3>Wissen auffrischen</h3>${search}`
    : `<h3>Wissen: wählen Sie, was Sie interessiert</h3>
       <p class="form-note">Keine feste Reihenfolge – frischen Sie auf, was Sie gerade brauchen. Thema eingeben oder antippen, Fragen lesen, danach als verstanden markieren.</p>${search}`;
  return `<article class="dash-card wide" data-view="lernen" id="lernView">${head}
    <div class="lp-bar" role="progressbar" aria-label="Verstandene Themen" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="${LERN.length}"><span style="width:${Math.round((n / LERN.length) * 100)}%"></span></div>
    <p class="form-note" id="lpNote">${n} von ${LERN.length} Themen verstanden.</p>
    ${phasePicker(phaseOf(d).idx, phaseOf(d).chosen)}
    <div class="lt-list">${lernTopics(st, recLern(d), PH()[phaseOf(d).idx].name + (GOALS[d.profile?.goal] ? ' · ' + GOALS[d.profile.goal].name : ''), PH()[phaseOf(d).idx].plan)}</div></article>`;
}

let FAQ = null;
const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lnk = (t) => escH(t).replace(/https:\/\/[^\s<]*[^\s<.,;)]/g, (u) => `<a class="ck-link" href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https:\/\/(www\.)?/, '')}</a>`);
const slugQ = (q) => { let t = q.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (t.length > 80) { t = t.slice(0, 80); t = t.slice(0, t.lastIndexOf('-') > 30 ? t.lastIndexOf('-') : 80); } return t; };

function fillTopic(id, d) {
  const box = document.querySelector(`[data-body="${id}"]`);
  const topic = LERN.find((x) => x[0] === id);
  if (!box || !topic || !FAQ || box.dataset.ready) return;
  box.dataset.ready = '1';
  const [, , , idx, [toolText, toolHref]] = topic;
  const done = !!d.progress?.lern?.[id];
  box.innerHTML = `${idx.map((i) => FAQ[i]).filter(Boolean).map((q, k) => `<div class="lt-qa">
      <p class="lt-q">${escH(q.question)}</p>
      <p class="lt-a">${lnk(q.level1)}</p>
      <div class="lt-more" id="more-${id}-${k}"${document.body.dataset.mode === 'profi' ? '' : ' hidden'}>${q.level2 ? `<p>${lnk(q.level2)}</p>` : '<p class="form-note">Die ausführliche Antwort mit Rechenweg und Rechtsgrundlage ist im LeaseRun-Zugang enthalten.</p>'}${q.nextStep ? `<p class="lt-next"><strong>Nächster Schritt:</strong> ${lnk(q.nextStep)}</p>` : ''}<a class="ck-link" href="/learn/${slugQ(q.question)}">Ganze Seite öffnen →</a></div>
      ${document.body.dataset.mode === 'profi' ? '' : `<button class="lt-mini" type="button" data-more="more-${id}-${k}" aria-expanded="false" aria-controls="more-${id}-${k}">Mehr erklären</button>`}
    </div>`).join('')}
    <div class="lt-actions"><a class="btn btn-outline" href="${toolHref}"${/^https:/.test(toolHref) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${toolText}${/^https:/.test(toolHref) ? ' öffnen<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-left:4px;flex:none"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>' : ' ausprobieren'}</a>
      <button class="btn ${done ? 'btn-outline' : 'btn-dark'}" type="button" data-done="${id}">${done ? 'Als offen markieren' : '✓ Verstanden'}</button></div>`;
}

function bindLern(d, u, saveData) {
  // Wissensinhalte gleich im Hintergrund laden – dann öffnet ein Thema sofort mit Inhalt, ohne „Wird geladen …“ dazwischen.
  let faqP = null;
  const ensure = () => { if (FAQ) return Promise.resolve(); return (faqP ||= fetch('/data/faq.json').then((r) => r.json()).then(async (j) => { const list = j.entries || []; try { const r = await fetch('/api/wissen/details', { headers: { Authorization: 'Bearer ' + (() => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } })() }, cache: 'no-store' }); if (r.ok) { const m = new Map(((await r.json()).entries || []).map((e) => [e.q, e])); list.forEach((e) => { const d = m.get(e.question); if (d) { e.level1 = d.l1; e.nextStep = d.next; e.level2 = d.l2; } }); } } catch { /* nur Kernaussagen */ } list.forEach((e) => { if (!e.level1) e.level1 = e.teaser || 'Die Antwort gibt es mit freigeschaltetem Zugang (Angebote).'; }); FAQ = list; }).catch(() => { FAQ = null; faqP = null; })); };
  (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => ensure());
  document.querySelectorAll('details.lt').forEach((det) => {
    det.querySelector('summary')?.addEventListener('click', () => { if (!det.open && FAQ) fillTopic(det.dataset.topic, d); });
    det.addEventListener('toggle', async () => { if (!det.open) return; await ensure(); if (!FAQ) { const b = det.querySelector('.lt-body'); if (b && !b.dataset.ready) b.innerHTML = '<p class="form-note">Inhalt konnte gerade nicht geladen werden – bitte Thema schließen und erneut antippen.</p>'; return; } fillTopic(det.dataset.topic, d); });
  });
  const view = $('lernView');
  if (!view) return;
  // Thema eingeben: Themen nach Titel, Beschreibung, Bereich und den Fragen darin filtern.
  const q = $('ltQ');
  if (q) {
    let faqText = null;
    const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    q.addEventListener('input', async () => {
      const t = norm(q.value.trim());
      if (t && !faqText) { await ensure(); faqText = Object.fromEntries(LERN.map(([id, , , idx]) => [id, norm(idx.map((i) => FAQ[i]?.question || '').join(' '))])); }
      let n = 0;
      view.querySelectorAll('details.lt').forEach((det) => { const ok = !t || norm(det.dataset.q || '').includes(t) || (faqText?.[det.dataset.topic] || '').includes(t); det.hidden = !ok; if (ok) n++; });
      view.querySelectorAll('.lt-group,.lt-plan>.form-note,.lt-more-h').forEach((h) => { h.hidden = Boolean(t); });
      const hits = $('ltHits');
      if (!t) { hits.textContent = ''; return; }
      hits.innerHTML = n ? `${n} passende${n === 1 ? 's Thema' : ' Themen'} – antippen zum Auffrischen. <a class="ck-link" href="/search?q=${encodeURIComponent(q.value.trim())}">Auch in der Wissenszentrale suchen</a>` : `Kein Lernthema gefunden. <a class="ck-link" href="/search?q=${encodeURIComponent(q.value.trim())}">In der Wissenszentrale nach „${escH(q.value.trim())}“ suchen</a>`;
      if (n === 1) { const det = view.querySelector('details.lt:not([hidden])'); if (det && !det.open) det.open = true; }
    });
  }
  view.addEventListener('click', async (e) => {
    const more = e.target.closest('[data-more]');
    if (more) { const el = $(more.dataset.more); const open = el.hidden; el.hidden = !open; more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Weniger' : 'Mehr erklären'; return; }
    const btn = e.target.closest('[data-done]');
    if (!btn) return;
    const id = btn.dataset.done, val = !d.progress?.lern?.[id];
    d.progress = { ...(d.progress || {}), lern: { ...(d.progress?.lern || {}), [id]: val } };
    const det = btn.closest('details.lt');
    det.classList.toggle('done', val);
    det.querySelector('.lt-state').textContent = val ? '✓ verstanden' : '';
    btn.textContent = val ? 'Als offen markieren' : '✓ Verstanden';
    btn.className = `btn ${val ? 'btn-outline' : 'btn-dark'}`;
    if (val) det.open = false;
    const n = LERN.filter(([k]) => d.progress.lern[k]).length;
    const bar = view.querySelector('.lp-bar span'); if (bar) bar.style.width = `${Math.round((n / LERN.length) * 100)}%`;
    view.querySelector('.lp-bar')?.setAttribute('aria-valuenow', String(n));
    $('lpNote').textContent = `${n} von ${LERN.length} Themen verstanden.${n === LERN.length ? ' Stark – der Profi-Modus passt jetzt zu Ihnen.' : ''}`;
    try { await saveData(u, d); } catch { /* nächster Speichervorgang holt es nach */ }
  });
}

async function renderOffers(mode) {
  const box = $('offerBody');
  const token = (() => { try { return JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } })();
  let P, st, cfg;
  // Bis zu 3 Versuche je Abruf (Funknetz, Tab im Hintergrund, Deploy-Wechsel); Status-Fehler blockiert die Angebote nicht.
  const getJ = async (url, opt = {}, n = 0) => { try { const r = await fetch(url, opt); if (!r.ok && r.status >= 500) throw new Error(r.status); return await r.json(); } catch (e) { if (n < 2) { await new Promise((ok) => setTimeout(ok, 500 * (n + 1))); return getJ(url, opt, n + 1); } throw e; } };
  let stErr = false;
  try {
    [P, cfg] = await Promise.all([getJ('/data/preise.json'), getJ('/api/billing/config', { cache: 'no-store' }).catch(() => ({ enabled: false }))]);
    st = cfg.enabled ? await getJ('/api/billing/status', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).catch(() => { stErr = true; return { tier: 'free' }; }) : { tier: 'free' };
  } catch { box.innerHTML = '<p class="auth-message error">Angebote konnten gerade nicht geladen werden. <button type="button" class="btn btn-ghost" id="offRetry">Erneut laden</button></p>'; $('offRetry')?.addEventListener('click', () => renderOffers(mode)); return; }
  const tier = st.tier || (st.pro ? 'pro' : 'free');
  // Nächster sinnvoller Schritt: Vermieter (Profi-Ansicht) → Investor Pro, Käufer → Käufer-Pass bzw. Kreditmappe.
  const next = tier === 'pro' ? null : tier === 'starter' ? 'credit-map' : mode === 'profi' ? 'pro-monthly' : 'buyer-pass';
  const tierName = { free: 'Kostenlos', starter: 'Käufer-Pass', pro: 'Investor Pro' }[tier];
  const left = Math.max(0, (st.creditMaps || 0) - (st.creditMapsUsed || 0));
  const draw = () => {
    const m = { ...P.privat, plans: mode === 'profi' ? [...P.privat.plans].sort((a, b) => (b.id === 'pro-monthly') - (a.id === 'pro-monthly')) : P.privat.plans };
    box.innerHTML = `<div class="offer-head"><div><span class="form-note">Ihr Tarif</span><strong>${tierName}</strong></div>${st.starterUntil ? `<span class="form-note">Käufer-Pass aktiv bis ${new Date(st.starterUntil).toLocaleDateString('de-DE')}</span>` : ''}</div>
      <p class="form-note">${esc(m.zielgruppe)}</p>
      ${stErr ? '<p class="auth-message">Ihr aktueller Tarif konnte gerade nicht abgefragt werden – bitte die Seite neu laden, bevor Sie etwas buchen.</p>' : ''}
      ${tier === 'pro' ? '<p class="auth-message">Investor Pro ist aktiv – alle Funktionen und Kreditmappen sind enthalten.</p>' : left ? `<p class="auth-message">Sie haben ${left} Kreditmappe${left === 1 ? '' : 'n'} frei.</p>` : ''}
      <div class="offers">${m.plans.map((p) => `<div class="offer${p.id === next ? ' rec' : ''}">${p.id === next ? '<span class="offer-rec">Empfohlener nächster Schritt</span>' : p.badge ? `<span class="offer-badge">${esc(p.badge)}</span>` : ''}<div class="offer-top">${planIcon(p.id)}<h4>${esc(p.name)}</h4></div>${p.fuer ? `<p class="offer-for">${esc(p.fuer)}</p>` : ''}<div class="offer-price">${E(p.cents)} <small>${esc(p.intervall)}</small></div><ul>${p.basis ? `<li class="offer-basis">${esc(p.basis)}</li>` : ''}${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${cfg.enabled ? `<button class="btn btn-pay" type="button" data-buy="${p.id}"${tier === 'pro' ? ' disabled' : ''}>${tier === 'pro' ? 'In Investor Pro enthalten' : 'Jetzt buchen'}</button>` : '<button class="btn btn-pay" type="button" disabled>Buchung startet in Kürze</button>'}</div>`).join('')}</div>
      <div class="offer-free"><strong>Immer kostenlos:</strong> ${P.kostenlos.features.map(esc).join(' · ')}</div>
      ${tier === 'free' && m.demo ? `<p class="offer-demo">${esc(m.demo)}</p>` : ''}
      ${cmpTable(m.vergleich, { free: 0, starter: 2, pro: 3 }[tier] ?? -1)}
      <p class="form-note">${esc(P.hinweis)} Es gelten die <a class="ck-link" href="/terms">Nutzungsbedingungen mit Widerrufsbelehrung</a>. Kündigung jederzeit über <a class="ck-link" href="/cancel">„Verträge hier kündigen“</a>.</p>`;
    const want = new URLSearchParams(location.search).get('buy');
    if (want) { const card = box.querySelector(`[data-buy="${CSS.escape(want)}"]`)?.closest('.offer'); if (card) { card.classList.add('offer-want'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    box.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
      const offer = m.plans.find((x) => x.id === b.dataset.buy);
      if (offer) openBuy(offer, { onError: (t) => alert(t), ctx: buyCtx() });
    });
  };
  draw();
}

// Konto → Passwort ändern (direkt im Konto, ohne E-Mail-Umweg). Wer mit E-Mail und Passwort registriert ist,
// bestätigt zuerst das aktuelle Passwort; wer sich nur mit Google anmeldet, legt hier erstmals ein Passwort fest.
function bindPw(u) {
  const btn = $('pwOpen'), box = $('pwBox');
  if (!btn || !box) return;
  const hasPw = (u.app_metadata?.providers || [u.app_metadata?.provider]).includes('email');
  btn.textContent = hasPw ? 'Passwort ändern' : 'Passwort festlegen';
  btn.onclick = () => {
    const open = box.hidden; box.hidden = !open; btn.setAttribute('aria-expanded', String(open));
    if (!open || box.dataset.ready) return; box.dataset.ready = '1';
    box.innerHTML = `<form class="pw-form" id="pwF" autocomplete="on"><input type="email" autocomplete="username" value="${esc(u.email)}" hidden readonly>
      ${hasPw ? '<label>Aktuelles Passwort<input id="pwCur" type="password" autocomplete="current-password" required></label>' : ''}
      <label>Neues Passwort<input id="pwN1" type="password" autocomplete="new-password" minlength="10" required></label>
      <label>Neues Passwort wiederholen<input id="pwN2" type="password" autocomplete="new-password" minlength="10" required></label>
      <p class="form-note">Mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl. Andere angemeldete Geräte bleiben bis zur nächsten Anmeldung aktiv.</p>
      <p class="form-note" id="pwMsg" role="status"></p>
      <div class="sess-act"><button class="btn btn-dark" type="submit">Neues Passwort speichern</button><a class="btn btn-ghost" href="/auth/forgot">Passwort vergessen?</a></div></form>`;
    $('pwF').onsubmit = async (e) => {
      e.preventDefault();
      const m = $('pwMsg'), n1 = $('pwN1').value, n2 = $('pwN2').value, sb = e.target.querySelector('button[type=submit]');
      const say = (t, ok) => { m.textContent = t; m.className = 'form-note ' + (ok ? 'ok' : 'err'); };
      if (n1 !== n2) return say('Die beiden neuen Passwörter stimmen nicht überein.');
      if (n1.length < 10 || !/[A-Z]/.test(n1) || !/[a-z]/.test(n1) || !/[0-9]/.test(n1)) return say('Bitte mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.');
      sb.disabled = true; say('Wird gespeichert …', true);
      try {
        const { supa, token } = await import('/src/sess.mjs?v=892f3666');
        if (hasPw) {
          const v = await supa('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: u.email, password: $('pwCur').value }) });
          if (!v.ok) throw Error(v.status === 429 ? 'Zu viele Versuche. Bitte einige Minuten warten.' : 'Das aktuelle Passwort stimmt nicht.');
        }
        const r = await supa('/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ password: n1 }) });
        if (!r.ok) {
          const j = await r.json().catch(() => ({})), t = String(j.msg || j.error_description || j.message || j.error_code || '');
          throw Error(/same|different/i.test(t) ? 'Das neue Passwort muss sich vom bisherigen unterscheiden.' : /weak|pwned|leaked/i.test(t) ? 'Dieses Passwort ist zu schwach oder bereits in Datenlecks aufgetaucht. Bitte ein anderes wählen.' : /reauth/i.test(t) ? 'Aus Sicherheitsgründen bitte kurz ab- und wieder anmelden, dann erneut ändern – oder „Passwort vergessen?“ nutzen.' : 'Passwort konnte nicht geändert werden.');
        }
        e.target.reset(); say('Neues Passwort gespeichert.', true);
      } catch (er) { say(er.message); } finally { sb.disabled = false; }
    };
  };
}

// Konto → Persönliche Daten (nach einer Buchung): Name und Rechnungsanschrift. Änderungen gelten ab der nächsten Rechnung.
const COUNTRIES = [['DE', 'Deutschland'], ['AT', 'Österreich'], ['CH', 'Schweiz'], ['LU', 'Luxemburg'], ['NL', 'Niederlande'], ['BE', 'Belgien'], ['FR', 'Frankreich'], ['IT', 'Italien'], ['ES', 'Spanien'], ['PL', 'Polen'], ['DK', 'Dänemark']];
async function personalCard(grid) {
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide pers-card" data-view="konto" id="persCard"><h3>Persönliche Daten</h3><div id="persBody"><p class="lr-ld" role="status">Wird geladen …</p></div></article>`);
  const body = $('persBody'), H = { Authorization: 'Bearer ' + sessToken() };
  const [acc, r] = await Promise.all([getAccess(), fetch('/api/me/personal', { headers: H, cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null)]);
  const p = r?.personal || null;
  if (!acc?.paid && !p) {
    body.innerHTML = `<p class="form-note">Nach Ihrer ersten Buchung legen Sie hier Ihren Namen und Ihre Rechnungsanschrift an und können sie jederzeit ändern. Bis dahin brauchen Sie keine persönlichen Angaben.</p><p><a class="btn btn-outline" href="#angebot">Angebote ansehen</a></p>`;
    return;
  }
  const show = (x) => {
    if (!x) return form(null);
    body.innerHTML = `<dl class="pers-dl"><div><dt>Name</dt><dd>${esc([x.salutation, x.firstName, x.lastName].filter(Boolean).join(' '))}</dd></div>${x.company ? `<div><dt>Firma</dt><dd>${esc(x.company)}</dd></div>` : ''}
      <div><dt>Rechnungsanschrift</dt><dd>${esc(x.street)}${x.addressExtra ? '<br>' + esc(x.addressExtra) : ''}<br>${esc(x.postalCode)} ${esc(x.city)}${x.country && x.country !== 'DE' ? '<br>' + esc((COUNTRIES.find((c) => c[0] === x.country) || [, x.country])[1]) : ''}</dd></div>
      ${x.phone ? `<div><dt>Telefon</dt><dd>${esc(x.phone)}</dd></div>` : ''}<div><dt>E-Mail</dt><dd>${esc(r?.email || '')}</dd></div></dl>
      <p class="form-note">Änderungen gelten ab der nächsten Rechnung. Bereits ausgestellte Rechnungen bleiben unverändert.${x.updatedAt ? ' Zuletzt geändert am ' + new Date(x.updatedAt).toLocaleDateString('de-DE') + '.' : ''}</p>
      <div class="sess-act"><button class="btn btn-outline" type="button" id="persEdit">Daten ändern</button></div>`;
    $('persEdit').onclick = () => form(x);
  };
  const form = (x) => {
    const v = (k) => esc(x?.[k] || '');
    body.innerHTML = `<form id="persF" class="pers-form" autocomplete="on">
      <label>Anrede<select name="salutation">${['', 'Frau', 'Herr', 'Divers'].map((a) => `<option value="${a}"${(x?.salutation || '') === a ? ' selected' : ''}>${a || 'keine Angabe'}</option>`).join('')}</select></label>
      <label>Firma (optional)<input name="company" maxlength="120" autocomplete="organization" value="${v('company')}"></label>
      <label>Vorname*<input name="firstName" required maxlength="80" autocomplete="given-name" value="${v('firstName')}"></label>
      <label>Nachname*<input name="lastName" required maxlength="80" autocomplete="family-name" value="${v('lastName')}"></label>
      <label class="full">Straße und Hausnummer*<input name="street" required maxlength="120" autocomplete="address-line1" value="${v('street')}"></label>
      <label class="full">Adresszusatz<input name="addressExtra" maxlength="120" autocomplete="address-line2" value="${v('addressExtra')}"></label>
      <label>PLZ*<input name="postalCode" required maxlength="10" inputmode="numeric" autocomplete="postal-code" value="${v('postalCode')}"></label>
      <label>Ort*<input name="city" required maxlength="80" autocomplete="address-level2" value="${v('city')}"></label>
      <label>Land<select name="country" autocomplete="country">${COUNTRIES.map(([c, n]) => `<option value="${c}"${(x?.country || 'DE') === c ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <label>Telefon (optional)<input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${v('phone')}"></label>
      <p class="form-note full">Diese Angaben erscheinen auf Ihren Rechnungen. Änderungen gelten ab der nächsten Rechnung; bereits ausgestellte Rechnungen bleiben unverändert.</p>
      <p class="form-note full" id="persMsg" role="status"></p>
      <div class="sess-act full"><button class="btn btn-dark" type="submit">Speichern</button>${x ? '<button class="btn btn-ghost" type="button" id="persCancel">Abbrechen</button>' : ''}</div></form>`;
    $('persCancel')?.addEventListener('click', () => show(x));
    import('/src/address-check.mjs?v=892f3666').then((m) => m.attachAddress($('persF'))).catch(() => {});
    $('persF').onsubmit = async (e) => {
      e.preventDefault();
      const m = $('persMsg'), sb = e.target.querySelector('button[type=submit]');
      sb.disabled = true; m.className = 'form-note full'; m.textContent = 'Wird gespeichert …';
      try {
        const res = await fetch('/api/me/personal', { method: 'PUT', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(j.error || 'Speichern fehlgeschlagen.');
        show(j.personal);
        const note = { updated: 'Gespeichert. Ihre nächste Rechnung wird mit diesen Angaben erstellt.', 'no-customer': 'Gespeichert.', off: 'Gespeichert.', failed: 'Gespeichert. Die Rechnungsdaten werden beim nächsten Speichern erneut übertragen – oder ändern Sie sie unter „Tarif & Rechnungen“ im Kundenportal.' }[j.invoice] || 'Gespeichert.';
        body.insertAdjacentHTML('afterbegin', `<p class="auth-message ${j.invoice === 'failed' ? 'info' : 'success'}" role="status">${esc(note)}</p>`);
      } catch (er) { m.className = 'form-note full err'; m.textContent = er.message; sb.disabled = false; }
    };
  };
  show(p);
}

// Vom Web-Admin angelegtes Privatkonto: Startpasswort muss bei der ersten Anmeldung ersetzt werden.
function firstPassword(u) {
  const d = document.createElement('dialog'); d.className = 'buy-dlg fp-dlg'; document.body.append(d);
  d.innerHTML = `<form class="buy-in pw-form" id="fpF"><input type="email" autocomplete="username" value="${esc(u.email)}" hidden readonly>
    <div class="buy-head"><img src="/logo-icon.svg" alt="" width="34" height="29"><div><span class="buy-kick">Willkommen bei LeaseRun</span><h2>Eigenes Passwort festlegen</h2></div></div>
    <p class="form-note">Ihr Konto wurde für Sie eingerichtet. Bitte ersetzen Sie das Startpasswort durch ein eigenes – danach ist es ungültig.</p>
    <label>Neues Passwort<input id="fp1" type="password" autocomplete="new-password" minlength="10" required></label>
    <label>Neues Passwort wiederholen<input id="fp2" type="password" autocomplete="new-password" minlength="10" required></label>
    <p class="form-note">Mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.</p>
    <p class="form-note" id="fpMsg" role="status"></p>
    <button class="btn btn-dark buy-go" type="submit">Passwort speichern</button></form>`;
  d.addEventListener('cancel', (e) => e.preventDefault());
  d.querySelector('#fpF').onsubmit = async (e) => {
    e.preventDefault();
    const m = d.querySelector('#fpMsg'), a = d.querySelector('#fp1').value, b = d.querySelector('#fp2').value, sb = e.target.querySelector('button');
    const say = (t, ok) => { m.textContent = t; m.className = 'form-note ' + (ok ? 'ok' : 'err'); };
    if (a !== b) return say('Die beiden Passwörter stimmen nicht überein.');
    if (a.length < 10 || !/[A-Z]/.test(a) || !/[a-z]/.test(a) || !/[0-9]/.test(a)) return say('Bitte mindestens 10 Zeichen mit Groß- und Kleinbuchstaben und einer Zahl.');
    sb.disabled = true;
    try {
      const { supa, token } = await import('/src/sess.mjs?v=892f3666');
      const r = await supa('/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ password: a, data: { must_change_password: false, onboarded_at: new Date().toISOString() } }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(/same|different/i.test(String(j.msg || j.message || '')) ? 'Bitte ein anderes Passwort als das Startpasswort wählen.' : 'Passwort konnte nicht gespeichert werden.'); }
      d.close(); d.remove();
    } catch (er) { say(er.message); sb.disabled = false; }
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}
