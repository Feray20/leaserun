// App-Rahmen für das Konto: Handy wie eine App (Tab-Leiste unten), Desktop wie ein Investment-Tool (Seitenleiste).
// Ansichten über #hash; vorhandene Karten werden den Ansichten zugeordnet. Modus Einsteiger/Profi frei wählbar.
import { openBuy, PAY_BADGES, planIcon, resumeIntent } from './buy.mjs';
import { rank, GREST } from './calc.mjs';
const GREST_KEYS = Object.keys(GREST);

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (cents) => (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const ICON = {
  start: '<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  suche: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  objekte: '<path d="M4 21V9l8-6 8 6v12"/><path d="M9 21v-6h6v6"/>',
  lernen: '<path d="M2 8l10-5 10 5-10 5z"/><path d="M6 10v5c0 2 3 4 6 4s6-2 6-4v-5"/>',
  angebot: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  konto: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  werkzeuge: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  steuer: '<line x1="19" y1="5" x2="5" y2="19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const VIEWS = {
  einsteiger: [['start', 'Übersicht'], ['suche', 'Suche'], ['objekte', 'Objekte'], ['werkzeuge', 'Werkzeuge'], ['steuer', 'Steuer'], ['lernen', 'Wissen'], ['angebot', 'Angebot'], ['konto', 'Konto']],
  profi: [['start', 'Cockpit'], ['suche', 'Suche & Analyse'], ['objekte', 'Objekte'], ['werkzeuge', 'Werkzeuge'], ['steuer', 'Steuer'], ['lernen', 'Wissen'], ['angebot', 'Tarif'], ['konto', 'Konto']],
};
const TABS = ['start', 'suche', 'objekte', 'werkzeuge', 'lernen', 'konto'];

// Lernbereich: Themen frei wählbar (keine feste Reihenfolge). Wissen aus /data/faq.json (Kurz- und Detailantwort).
// [id, Titel, Kurzbeschreibung, FAQ-Indizes, [Werkzeug-Text, Link], Bereich]
const LERN = [
  ['geld', 'Wie funktioniert Geld?', 'Wie Geld entsteht, was Inflation mit Ihrem Geld macht, warum sich Investieren lohnt und wie Vermögen wächst.', [37, 38, 39, 40, 41, 42, 43], ['Kaufen oder mieten?', '/rechner/kaufen-mieten'], 'Geld & Vermögen'],
  ['budget', 'Was kann ich mir leisten?', 'Rate, Darlehen und Kaufpreis aus Einkommen und Eigenkapital.', [0, 5, 6], ['Budget-Rechner', '/rechner/budget'], 'Leisten & Finanzieren'],
  ['eigenkapital', 'Eigenkapital und Kaufnebenkosten', 'Wie viel eigenes Geld nötig ist und was zum Kaufpreis dazukommt.', [1, 2], ['Kaufnebenkosten-Rechner', '/rechner/kaufnebenkosten'], 'Leisten & Finanzieren'],
  ['annuitaet', 'Zins, Tilgung, Zinsbindung', 'Wie sich die Rate zusammensetzt.', [3], ['Tilgungsplan', '/rechner/tilgungsplan'], 'Leisten & Finanzieren'],
  ['fristen', 'Wenn die Zinsbindung endet', 'Anschlussfinanzierung, Kipp-Punkt und wichtige Fristen.', [23, 24], ['Fristen-Rechner', '/fristen'], 'Leisten & Finanzieren'],
  ['beruf', 'Was die Bank je nach Beruf prüft', 'Angestellt, selbstständig, verbeamtet – und welche Unterlagen.', [4], ['Erwerbsstatus im Detail', '/wissen/erwerbsstatus'], 'Leisten & Finanzieren'],
  ['beleihung', 'Beleihungswert: wie die Bank rechnet', 'Warum die Bank anders bewertet als der Verkäufer.', [7], ['Deal-Scorecard', '/rechner/scorecard'], 'Leisten & Finanzieren'],
  ['suche', 'Objekte suchen und vergleichen', 'Vom Inserat zur Kennzahl – und mehrere Angebote nebeneinander.', [10], ['Suche & Analyse', '#suche'], 'Objekt finden & prüfen'],
  ['etw', 'Eigentumswohnung richtig prüfen', 'Teilungserklärung, Protokolle, Rücklage.', [8, 9], ['Unterlagen-Checkliste', '/checkliste'], 'Objekt finden & prüfen'],
  ['cashflow', 'Rendite und Cashflow', 'Brutto, netto, vor und nach Steuern.', [12, 13, 14], ['Cashflow-Rechner', '/rechner/cashflow'], 'Rendite, Steuer & Miete'],
  ['steuer', 'Steuern: AfA, 15-%-Grenze, steuerfreier Verkauf', 'Was die Steuer beim Kauf, Vermieten und Verkaufen bedeutet.', [15, 16, 17], ['Steuer-Bereich', '#steuer'], 'Rendite, Steuer & Miete'],
  ['miete', 'Mietrecht für Vermieter', 'Mietpreisbremse, Kappungsgrenze, Staffelmiete, Mietausfall.', [18, 19, 20, 21], ['Mieterhöhung prüfen', '/rechner/mieterhoehung'], 'Rendite, Steuer & Miete'],
  ['unterlagen', 'Unterlagen und Kreditmappe', 'Was die Bank sehen will und wie Sie es vollständig machen.', [11, 25, 26, 27], ['Unterlagen-Checkliste', '/checkliste'], 'Bank & Unterlagen'],
  ['mahnung', 'Mieter zahlt nicht: Mahnung, Mahnverfahren, Kündigung', 'So sichern Sie sich rechtlich ab – Schritt für Schritt.', [33, 34, 35, 36], ['Online-Mahnantrag der Justiz', 'https://www.online-mahnantrag.de'], 'Vermieten & Absicherung'],
];
// Phasen = die vier Stufen von „Ihr Weg“. Frei wählbar (profile.phase 0–3), sonst automatisch erkannt.
// Die gewählte Phase steuert Startaktionen, Reihenfolge im Steuer-Bereich und empfohlene Wissensthemen.
export const PHASES = [
  { name: 'Orientieren', plan: 'Erst verstehen, wie Geld, Eigenkapital und Finanzierung funktionieren – dann wissen Sie, was Sie sich leisten können.', steuer: 'kauf', lern: ['geld', 'budget', 'eigenkapital', 'annuitaet', 'beruf'],
    actions: [['/rechner/budget', 'Budget berechnen', 'Was kann ich mir leisten?'], ['#lernen', 'Grundlagen auffrischen', 'Eigenkapital, Zins, Tilgung'], ['#suche', 'Immobilien ansehen', 'Suche bei den großen Portalen']] },
  { name: 'Objekte prüfen', plan: 'Lernen Sie, Angebote wie ein Profi zu lesen: Rendite, Cashflow, Zustand und was die Bank vom Objekt hält.', steuer: 'kauf', lern: ['suche', 'etw', 'cashflow', 'beleihung'],
    actions: [['#suche', 'Objekt analysieren', 'Inserat übernehmen, Kennzahlen sehen'], ['#objekte', 'Objekte im Konto', 'Anlegen, vergleichen, Bankreife'], ['#steuer', 'Steuern beim Kauf', 'Kaufkosten, Inventar, AfA']] },
  { name: 'Bankgespräch', plan: 'Bereiten Sie sich auf die Bank vor: Unterlagen, Beleihungswert und wie Ihr Beruf bewertet wird.', steuer: 'kauf', lern: ['unterlagen', 'beruf', 'beleihung', 'annuitaet'],
    actions: [['#objekte', 'Kreditmappe erstellen', 'Objekt wählen → Vorschau → PDF'], ['/checkliste', 'Unterlagen vollständig machen', 'Bankreife auf 90 % bringen'], ['#lernen', 'Was die Bank prüft', 'Beleihungswert, Unterlagen']] },
  { name: 'Bestand', plan: 'Ihre Immobilie gut führen: Steuern, Mietrecht, Fristen und was tun, wenn die Miete ausbleibt.', steuer: 'halten', lern: ['steuer', 'miete', 'mahnung', 'fristen'],
    actions: [['/fristen', 'Fristen im Blick', 'Zinsbindung, 15-%-Grenze, Spekulationsfrist'], ['#steuer', 'Steuern & Werbungskosten', 'Anlage V, 66-%-Check, Verkauf'], ['#lernen', 'Mieter zahlt nicht?', 'Mahnung, Mahnverfahren, Kündigung']] },
];
export function phaseOf(d) {
  const p = d.profile?.phase;
  if (Number.isInteger(p) && p >= 0 && p < PHASES.length) return { idx: p, chosen: true };
  try { return { idx: Math.max(0, Math.min(3, rank(d.profile || {}, Array.isArray(d.objects) ? d.objects : [], []).level - 1)), chosen: false }; } catch { return { idx: 0, chosen: false }; }
}
// „Ihre Stufe“ als Einstellung: eine Zeile mit der aktuellen Stufe, Knopf öffnet die Auswahl (siehe openStage).
const STAGE_EFFECT = [
  'Cockpit zeigt Budget und Grundlagen · Lernplan: Geld, Eigenkapital, Zins und Tilgung · Steuern: Kaufphase',
  'Cockpit zeigt Objektanalyse und Vergleich · Lernplan: Exposé lesen, Cashflow, Beleihung · Steuern: Kaufphase',
  'Cockpit zeigt Kreditmappe und Unterlagen · Lernplan: Unterlagen, Beruf, Beleihungswert · Steuern: Kaufphase',
  'Cockpit zeigt Fristen und Steuern · Lernplan: Steuern, Mietrecht, Mahnung, Fristen · Steuern: Bestand halten',
];
const phasePicker = (idx, chosen) => `<div class="stage-row" role="group" aria-label="Ihre Stufe"><div class="stage-cur"><span class="stage-k">Ihre Stufe${chosen ? '' : ' · automatisch erkannt'}</span><strong><b class="stage-n">${idx + 1}</b>${PHASES[idx].name}</strong><small>${PHASES[idx].plan}</small></div><button type="button" class="btn btn-outline stage-open">Stufe ändern</button></div>`;
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
  dlg.innerHTML = `<form method="dialog" class="stage-in"><div class="stage-head"><div><span class="stage-k">Einstellung</span><h2>Ihre Stufe</h2></div><button class="stage-x" value="x" aria-label="Schließen">×</button></div>
    <p class="form-note">Wählen Sie, wo Sie gerade stehen. Die ganze Anwendung stellt sich darauf ein: Startseite, Lernplan, Reihenfolge im Wissen und der Steuer-Bereich. Sie können jederzeit wechseln.</p>
    <div class="stage-opts">${PHASES.map((p, i) => `<button type="button" class="stage-opt${cur.chosen && cur.idx === i ? ' on' : ''}" data-stage="${i}"><b class="stage-n">${i + 1}</b><span><strong>${p.name}</strong><small>${p.plan}</small><em>${STAGE_EFFECT[i]}</em></span></button>`).join('')}
    <button type="button" class="stage-opt stage-auto${cur.chosen ? '' : ' on'}" data-stage="auto"><b class="stage-n">A</b><span><strong>Automatisch</strong><small>ImmoAdv erkennt die Stufe aus Ihren Daten (Finanzprofil, Objekte, Bankreife) und stellt sie selbst um.</small></span></button></div>
    <p class="form-note wiz-again">Ziel geändert? <button type="button" class="link-btn wiz-open">Einrichtung neu starten</button> – Ziel, Stufe und Ansicht in drei Fragen.</p></form>`;
  dlg.querySelectorAll('[data-stage]').forEach((b) => b.onclick = () => {
    const v = b.dataset.stage === 'auto' ? null : Number(b.dataset.stage);
    dlg.close();
    try { sessionStorage.setItem('ia-stage-msg', v == null ? 'auto' : String(v)); } catch { /* ignore */ }
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
const recLern = (d) => [...new Set([...PHASES[phaseOf(d).idx].lern, ...(GOALS[d.profile?.goal]?.lern || [])])];
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
    if (step === 1) body = `<h2>Wo stehen Sie gerade?</h2><div class="stage-opts">${WIZ_STAND.map((t, i) => `<button type="button" class="stage-opt${st.phase === i ? ' on' : ''}" data-ph="${i}"><b class="stage-n">${i + 1}</b><span><strong>${t}</strong><small>Stufe ${i + 1} · ${PHASES[i].name}</small></span></button>`).join('')}</div>`;
    if (step === 2) body = `<h2>Ihre Zahlen <small class="wiz-opt">optional</small></h2><p class="form-note">Damit rechnet ImmoAdv Budget und Bankreife für Sie. Sie können das auch später im Konto eintragen.</p>
      <label class="wiz-f">Nettoeinkommen im Monat (Haushalt)<input id="wizInc" type="number" inputmode="decimal" min="0" step="50" placeholder="z. B. 4200" value="${st.income}"></label>
      <label class="wiz-f">Eigenkapital<input id="wizEq" type="number" inputmode="decimal" min="0" step="1000" placeholder="z. B. 60000" value="${st.equity}"></label>`;
    if (step === 3) {
      const m = st.mode || autoMode();
      body = `<h2>So stellen wir ImmoAdv für Sie ein</h2><ul class="wiz-sum"><li><span>Ziel</span><strong>${GOALS[st.goal]?.name || '–'}</strong></li><li><span>Stufe</span><strong>${st.phase + 1} · ${PHASES[st.phase].name}</strong></li><li><span>Lernplan</span><strong>${[...new Set([...PHASES[st.phase].lern, ...(GOALS[st.goal]?.lern || [])])].length} passende Themen</strong></li>${st.income ? `<li><span>Finanzprofil</span><strong>wird ausgefüllt</strong></li>` : ''}</ul>
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
      try { sessionStorage.setItem('ia-stage-msg', 'wiz'); } catch { /* ignore */ }
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
  try { x = JSON.parse(localStorage.getItem('ia-berater') || 'null'); } catch { x = null; }
  if (!x || Date.now() - x.at > 14 * 864e5) { try { localStorage.removeItem('ia-berater'); } catch { /* ignore */ } return; }
  const tok = (() => { try { return JSON.parse(localStorage.getItem('immoadv-auth-session-v1') || 'null')?.access_token; } catch { return null; } })();
  if (!tok) return;
  const H = { Authorization: 'Bearer ' + tok };
  const r = await fetch('/api/me/berater?token=' + encodeURIComponent(x.t), { headers: H, cache: 'no-store' }).catch(() => null);
  const j = r ? await r.json().catch(() => ({})) : {};
  try { localStorage.removeItem('ia-berater'); } catch { /* ignore */ }
  if (!r || !r.ok) { stageToast(esc(j.error || 'Die Einladung konnte nicht geladen werden.')); return; }
  let dlg = document.getElementById('berDlg');
  if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'berDlg'; dlg.className = 'stage-dlg'; document.body.append(dlg); }
  dlg.innerHTML = `<form method="dialog" class="stage-in"><div class="stage-head"><div><span class="stage-k">Einladung</span><h2>${esc(j.invite.company)}</h2></div><button class="stage-x" value="x" aria-label="Schließen">×</button></div>
    <p>${esc(j.invite.company)}${j.invite.city ? ` aus ${esc(j.invite.city)}` : ''} begleitet Sie bei Ihrer Finanzierung und möchte Ihren Fortschritt in ImmoAdv sehen.${j.invite.verified ? ' <span class="st ok">geprüftes Unternehmen</span>' : ''}</p>
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


const PROFI = [
  ['Szenarien: Anschlusszins und Verkauf', '/szenarien'], ['AfA-Plan inkl. Sonder-AfA § 7b', '/rechner/afa'], ['Mieterhöhung mit Briefentwurf', '/rechner/mieterhoehung'],
  ['Angebotsvergleich', '/rechner/vergleich'], ['Kaufen oder mieten', '/rechner/kaufen-mieten'], ['Investment-Cockpit (Stresstest)', '/cockpit'],
  ['Mietrecht- und Steuerrechner', '/rechner'], ['Glossar', '/wissen/glossar'],
];

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
    const m = sessionStorage.getItem('ia-stage-msg');
    if (m != null) {
      sessionStorage.removeItem('ia-stage-msg');
      const ph = phaseOf(d);
      setTimeout(() => stageToast(m === 'wiz' ? `<strong>ImmoAdv ist eingerichtet: ${GOALS[d.profile?.goal]?.name || ''} · Stufe ${ph.idx + 1} · ${d.profile?.mode === 'profi' ? 'Profi' : 'Einsteiger'}.</strong> ${d.profile?.mode === 'profi' ? 'Werkzeuge, Lernplan und Steuer-Bereich' : 'Startseite, Fahrplan, Lernplan und Steuer-Bereich'} sind angepasst.` : `<strong>Auf Stufe ${ph.idx + 1} · ${PHASES[ph.idx].name} umgestellt${m === 'auto' ? ' (automatisch)' : ''}.</strong> Startseite, Lernplan und Steuer-Bereich sind angepasst.`), 250);
    }
  } catch { /* ignore */ }
  // Kaufwunsch von der Angebotsseite (vor der Anmeldung gemerkt): direkt weiter zur Bezahlseite.
  resumeIntent((t) => alert(t));
  const reloadFull = reload;
  reload = () => { document.body.classList.add('ia-switching'); reloadFull({ u, d }); };
  APP = { u, d, saveData, reload };
  setTimeout(() => { checkBerater().catch(() => { /* still */ }); }, 400);
  requestAnimationFrame(() => document.body.classList.remove('ia-switching'));
  const app = $('app'), grid = document.querySelector('.dashboard-grid');
  if (!app || !grid) return;
  try { if (sessionStorage.getItem('ia-import') && !location.hash.startsWith('#suche')) history.replaceState(null, '', location.pathname + location.search + '#suche'); } catch { /* ohne Speicher */ }
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
  main.insertAdjacentHTML('afterbegin', `<div class="app-top"><a class="brand app-top-brand" href="/"><img class="brand-logo" src="/logo-icon.svg" alt="" width="30" height="26"><span>Immo<span>Adv</span></span></a><h1 id="appTitle"></h1>
    <button class="mode-chip" id="modeChip" type="button" aria-label="Modus wechseln">${mode === 'profi' ? 'Profi' : 'Einsteiger'} <span aria-hidden="true">⇄</span></button></div>`);
  app.insertAdjacentHTML('beforeend', `<nav class="app-tabs" aria-label="Schnellnavigation">${TABS.map((k) => `<a class="app-tab" data-go="${k}" href="#${k}">${svg(k)}<span>${views.find((v) => v[0] === k)[1].split(' ')[0]}</span></a>`).join('')}</nav>`);
  $('appLogout').onclick = () => document.getElementById('logout')?.click();
  $('modeChip').onclick = async () => {
    d.profile = { ...(d.profile || {}), mode: mode === 'profi' ? 'einsteiger' : 'profi' };
    saveData(u, d).catch(() => { /* wird beim nächsten Speichern nachgeholt */ });
    history.replaceState(null, '', location.pathname + location.hash);
    reload();
  };

  // Eigene Karten: Start, Suche, Lernpfad, Angebot
  grid.insertAdjacentHTML('afterbegin', kmCard());
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide fin-card" data-view="konto" id="finCard"><h3>Tarif &amp; Rechnungen</h3><div id="finBody"><p class="form-note">Wird geladen …</p></div></article>`);
  // Berater-Freigaben: nur sichtbar, wenn der Kunde mit einem Unternehmen verbunden ist; jederzeit trennbar.
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide ber-card" data-view="konto" id="berCard" hidden><h3>Berater-Freigaben</h3><div id="berBody"></div></article>`);
  (async () => {
    const tok = (() => { try { return JSON.parse(localStorage.getItem('immoadv-auth-session-v1') || 'null')?.access_token; } catch { return null; } })();
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
    const note = () => { const n = $('sessNote'); if (n) n.textContent = $('sessRem').checked ? 'Sie bleiben angemeldet, bis Sie sich abmelden oder 30 Tage nicht aktiv waren. Nur auf eigenen Geräten verwenden.' : 'Automatische Abmeldung nach 30 Minuten ohne Aktivität.'; };
    note();
    $('sessRem').onchange = () => { if (A) { A.setRemember($('sessRem').checked); try { localStorage.setItem('ia-last-active', String(Date.now())); } catch { /* ignore */ } } note(); };
    $('sessOut').onclick = () => document.getElementById('logout')?.click();
    bindPw(u);
  }
  personalCard(grid);
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="suche" id="sucheView"></article>`);
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="werkzeuge" id="toolsView"><p class="form-note">Werkzeuge werden geladen …</p></article>`);
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="steuer" id="steuerView"></article>`);
  Promise.all([import('/src/b2c-tools.mjs'), getAccess()]).then(([m, ac]) => { m.mountTools($('toolsView'), { d, tier: ac.tier || 'free', b2b: Boolean(ac.b2b), mode: mode || 'einsteiger' }); import('/src/field-help.mjs').then((f) => f.attachHelp?.($('toolsView'))).catch(() => {}); }).catch(() => { const v = $('toolsView'); if (v) v.innerHTML = '<p class="form-note">Werkzeuge konnten nicht geladen werden.</p>'; });
  grid.insertAdjacentHTML('beforeend', lernCard(mode, d));
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide" data-view="angebot" id="angebotView"><h3>${mode === 'profi' ? 'Tarif' : 'Angebot'}</h3><div id="offerBody"><p class="form-note">Wird geladen …</p></div></article>`);
  bindStart(mode, d, u, saveData, reload);
  bindKm(d, u, saveData, reload);
  renderFin();
  bindLern(d, u, saveData);
  import('/src/field-help.mjs').then((m) => m.watchHelp(grid)).catch(() => {});
  import('/src/retention.mjs').then(async (m) => { const ac = await getAccess(); m.mountRetention(grid, { mode, d, u, saveData, paid: ac.tier === 'pro' || ac.b2b }); if (typeof window.__iaApplyView === 'function') window.__iaApplyView(); }).catch(() => {});

  const apply = () => {
    const v = (location.hash.slice(1) || 'start').split('?')[0];
    const cur = views.some((x) => x[0] === v) ? v : 'start';
    const sc = grid.querySelector('.start-card'); if (sc && grid.firstElementChild !== sc) grid.prepend(sc);
    [...grid.children].forEach((el) => { el.dataset.view = classify(el); el.classList.toggle('v-show', el.dataset.view.split(' ').includes(cur)); });
    document.querySelectorAll('[data-go]').forEach((a) => a.classList.toggle('on', a.dataset.go === cur));
    $('appTitle').textContent = views.find((x) => x[0] === cur)[1];
    if (cur === 'suche' && !$('sucheView').dataset.ready) {
      $('sucheView').dataset.ready = '1';
      import('/src/objekt-ui.mjs').then((m) => m.mountObjekt($('sucheView'), { pdf: true })).catch(() => { $('sucheView').innerHTML = '<p class="auth-message error">Suche konnte nicht geladen werden.</p>'; });
    }
    if (cur === 'steuer' && !$('steuerView').dataset.ready) {
      $('steuerView').dataset.ready = '1';
      import('/src/steuer.mjs').then((m) => m.mountSteuer($('steuerView'), { mode, phase: PHASES[phaseOf(d).idx].steuer })).catch(() => { $('steuerView').innerHTML = '<p class="auth-message error">Steuer-Bereich konnte nicht geladen werden.</p>'; });
    }
    if (cur === 'angebot' && !$('angebotView').dataset.ready) { $('angebotView').dataset.ready = '1'; renderOffers(mode); }
  };
  if (window.__iaHash) window.removeEventListener('hashchange', window.__iaHash);
  window.__iaHash = () => { apply(); window.scrollTo(0, 0); };
  window.addEventListener('hashchange', window.__iaHash);
  window.__iaApplyView = apply;
  new MutationObserver(apply).observe(grid, { childList: true });
  apply();
}

// ImmoAdv Studio (Bereich Objekte): Produkt wählen – BankReady (Kreditmappe) oder RenditeRadar (Objekt-Analyse) –
// und wie die Daten kommen: AutoPilot (Exposé-PDF hochladen, Link eintragen oder gespeichertes Objekt – ImmoAdv
// rechnet alles automatisch) oder Manuell (online eintragen oder PDF-Formular herunterladen, ausfüllen, wieder hochladen).
// Das Ergebnis erscheint zuerst als PDF auf dem Bildschirm und kann dann heruntergeladen werden.
let KM = { doc: 'km', way: 'auto' };
// Rückkehr aus dem Checkout (wird beim Laden des Moduls gelesen, bevor die Adresse bereinigt wird).
const CHECKOUT = new URLSearchParams(location.search).get('checkout');
// Nach einem Kauf den Navigationsstatus neu laden (Zur Anwendung / App-Leiste).
if (CHECKOUT === 'success') { try { localStorage.removeItem('ia-access'); } catch { /* ignore */ } }
const PROD = {
  km: { name: 'BankReady', sub: 'Kreditmappe für die Bank', form: 'kreditmappe' },
  an: { name: 'RenditeRadar', sub: 'Objekt-Analyse in Sekunden', form: 'analyse' },
};
// Zahlender Kunde? (Tarif, Unternehmenskonto, Admin) – sonst kostenlose Demo mit Wasserzeichen auf PDFs.
let ACCESS = null;
const getAccess = () => (ACCESS ||= fetch('/api/me/access', { headers: { Authorization: 'Bearer ' + sessToken() }, cache: 'no-store' }).then((r) => (r.ok ? r.json() : { paid: false })).catch(() => ({ paid: false })));
const DEMO_NOTE = 'Kostenlose Demo: PDFs tragen ein ImmoAdv-Wasserzeichen. Mit einem Abo bzw. gebuchten Tarif entfällt es.';
const sessToken = () => { try { return JSON.parse(localStorage.getItem('immoadv-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } };
// Darlehen, wenn nicht angegeben: Kaufpreis + Nebenkosten − Eigenkapital (mindestens 0).
const autoLoan = (o) => Math.max(0, Math.round(Number(o.price) * (1 + (Number(o.purchaseCostPct) || 0) / 100) - (Number(o.equity) || 0)));
const newObjId = () => { const b = new Uint8Array(6); crypto.getRandomValues(b); return 'o' + [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
// Analyse-Modul (Suche) bei Bedarf laden – AutoPilot nutzt denselben Rechenweg wie die Analyse.
async function objektModule() {
  const v = $('sucheView');
  const m = await import('/src/objekt-ui.mjs');
  if (v && !v.dataset.ready) { v.dataset.ready = '1'; m.mountObjekt(v, { pdf: true }); }
  return m;
}
const fileName = (r, fallback) => { const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/.exec(r.headers.get('content-disposition') || ''); return m ? decodeURIComponent(m[1] || m[2]) : fallback; };

function kmCard() {
  return `<article class="dash-card wide km-card" data-view="objekte" id="kmCard">
    <div class="studio-head"><h3>ImmoAdv Studio</h3><p class="form-note">Produkt wählen – und entscheiden, ob ImmoAdv alles automatisch erledigt oder Sie selbst eintragen.</p></div>
    <div class="studio-prod" role="tablist" aria-label="Produkt">${Object.entries(PROD).map(([k, p]) => `<button type="button" role="tab" data-kmdoc="${k}"><strong>${p.name}</strong><small>${p.sub}</small></button>`).join('')}</div>
    <div class="seg studio-way" role="tablist" aria-label="Weg"><button type="button" role="tab" data-kmway="auto"><strong>AutoPilot</strong><small>Exposé oder Link – ImmoAdv rechnet</small></button><button type="button" role="tab" data-kmway="man"><strong>Manuell</strong><small>Online oder per PDF-Formular</small></button></div>
    <p class="demo-hint" id="kmDemo" hidden></p><div id="kmBody"></div><p class="km-msg" id="kmMsg" role="status" aria-live="polite"></p><div id="kmRes"></div></article>`;
}

function kmBody(d) {
  const os = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.id);
  const km = KM.doc === 'km', P = PROD[KM.doc];
  if (KM.way === 'man') {
    return `<div class="km-grid">
      <div class="km-box"><strong>Online eintragen</strong><span>${km ? 'Alle Angaben direkt auf der Website eintragen (Objekt und „Angaben für die Kreditmappe“). Danach erstellt BankReady die Kreditmappe per AutoPilot aus dem gespeicherten Objekt.' : 'Kaufpreis, Miete, Kosten und Finanzierung im Analyse-Formular eintragen – RenditeRadar rechnet jede Kennzahl sofort mit.'}</span>
        <div class="km-actions"><button class="btn btn-dark" type="button" id="kmManual">${km ? 'Formular öffnen' : 'Analyse-Formular öffnen'}</button></div></div>
      <div class="km-box"><strong>PDF-Formular</strong><span>Formular herunterladen, am Handy oder Computer ausfüllen (z. B. Acrobat Reader, Dateien-App, Vorschau), speichern und hier wieder hochladen – ${P.name} übernimmt alle Werte automatisch.</span>
        <div class="km-actions"><button class="btn btn-dark" type="button" id="kmFormGet">Formular ansehen &amp; herunterladen</button><label class="btn btn-outline km-file">Ausgefülltes PDF hochladen<input type="file" accept="application/pdf,.pdf" id="kmFormUp" hidden></label></div>
        <small class="form-note">Handschriftlich ausgefüllte Scans können nicht automatisch gelesen werden.</small></div>
    </div>`;
  }
  return `<div class="km-grid">
    <div class="km-box"><strong>Exposé hochladen</strong><span>PDF vom Makler oder Portal – ${P.name} liest Kaufpreis, Miete, Fläche, Baujahr und mehr aus und ${km ? 'erstellt die Kreditmappe' : 'rechnet alle Kennzahlen'} automatisch.</span>
      <div class="km-actions"><label class="btn btn-dark km-file">Exposé-PDF wählen<input type="file" accept="application/pdf,.pdf" id="kmPdf" hidden></label></div></div>
    <div class="km-box"><strong>Link eintragen</strong><span>Link zum Exposé-PDF oder zur Seite des Anbieters. Für ImmoScout24, Immowelt und Kleinanzeigen nutzen Sie die <a class="ck-link" href="#suche">Ein-Klick-Übernahme</a> oder das Exposé-PDF.</span>
      <form class="km-link" id="kmLinkF"><input type="url" id="kmLink" inputmode="url" autocomplete="off" placeholder="https://…" aria-label="Link zum Exposé" required><button class="btn btn-dark" type="submit">Auswerten</button></form></div>
    ${os.length ? `<div class="km-box"><strong>Aus meinen Objekten</strong><span>Gespeichertes Objekt wählen – ${P.name} erstellt das Dokument aus Ihren Angaben.</span>
      <label class="km-pick">Objekt<select id="kmObj">${os.map((o) => `<option value="${esc(o.id)}">${esc(o.name || 'Objekt')}</option>`).join('')}</select></label>
      <div class="km-actions"><button class="btn btn-dark" type="button" id="kmGo">${km ? 'Kreditmappe erstellen' : 'Analyse erstellen'}</button></div></div>` : ''}
  </div>
  ${km && !(Number(d.profile?.netIncome) > 0) ? '<p class="form-note">Tipp: Für die Haushaltsrechnung der Kreditmappe im Finanzprofil das Nettoeinkommen eintragen.</p>' : ''}`;
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
  const land = () => { try { const s = JSON.parse(localStorage.getItem('ia-objekt-v1') || '{}'); return GREST_KEYS.includes(s.a_land) ? s.a_land : GREST_KEYS.includes(s.s_land) ? s.s_land : 'hessen'; } catch { return 'hessen'; } };
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
    const { showPdf } = await import('/src/pdf-view.mjs');
    const o = (d.objects || []).find((x) => x.id === objectId);
    showPdf(blob, {
      filename: fileName(r, preview ? 'ImmoAdv_BankReady_Vorschau.pdf' : `ImmoAdv_BankReady${ver ? '_v' + ver : ''}.pdf`),
      title: `BankReady · ${o?.name || 'Kreditmappe'}`,
      note: (preview ? 'Kostenlose Demo: Vorschau mit Wasserzeichen. Mit einem Abo bzw. gebuchten Tarif erhalten Sie die Fassung für die Bank – ohne Wasserzeichen und mit Echtheits-QR. <a class="ck-link" href="#angebot">Tarife ansehen</a>. ' : '') + extraNote,
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
      const { showPdf } = await import('/src/pdf-view.mjs');
      const demo = !(await getAccess()).paid ? DEMO_NOTE + ' ' : '';
      showPdf(out.blob, { filename: out.filename, title: `RenditeRadar · ${sum.name}`, note: demo + (sum.missing.length ? `Nicht im Exposé gefunden: ${esc(sum.missing.join(', '))} – in der Analyse ergänzen.` : '') });
      return;
    }
    const { parseListing } = await import('/src/listing-parse.mjs');
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
      <div class="km-actions"><a class="btn btn-outline" href="#suche">In der Analyse ansehen &amp; anpassen</a></div></div>`);
  }

  const wire = () => {
    $('kmManual')?.addEventListener('click', () => { if (KM.doc === 'km') openForm(); else location.hash = 'suche'; });

    // Exposé-PDF (AutoPilot)
    $('kmPdf')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
      if (f.size > 40 * 1024 * 1024) { msg('Die Datei ist größer als 40 MB.', 'bad'); return; }
      msg(''); busy(true);
      const { work } = await import('/src/loader.mjs');
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
      const { work } = await import('/src/loader.mjs');
      const w = work(`${PROD[KM.doc].name} AutoPilot`, ['Link abrufen', 'Inhalt erkennen', 'Eckdaten übernehmen', KM.doc === 'km' ? 'Kreditmappe erstellen' : 'Kennzahlen & PDF erstellen']);
      try {
        await w.step(0);
        const r = await fetch('/api/expose-link', { method: 'POST', headers: { Authorization: 'Bearer ' + sessToken(), 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw Object.assign(Error(j.error || 'Der Link konnte nicht ausgewertet werden.'), { more: j.code === 'portal' ? ' <a class="ck-link" href="#suche">Zur Ein-Klick-Übernahme</a>' : '' });
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
      const { work } = await import('/src/loader.mjs');
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
          const { showPdf } = await import('/src/pdf-view.mjs');
          showPdf(out.blob, { filename: out.filename, title: `RenditeRadar · ${sum.name}`, note: (await getAccess()).paid ? '' : DEMO_NOTE });
        }
      } catch (err) { w.close(); msg(esc(err.message), 'bad'); }
      finally { busy(false); }
    });

    // PDF-Formular ansehen und herunterladen (zahlende Kunden ohne Wasserzeichen)
    $('kmFormGet')?.addEventListener('click', async () => {
      busy(true); msg('');
      const { work } = await import('/src/loader.mjs');
      const w = work('Formular wird vorbereitet', ['Felder anlegen', 'PDF erzeugen']);
      try {
        await w.step(0);
        const r = await fetch(`/api/formular/${PROD[KM.doc].form}`, { headers: { Authorization: 'Bearer ' + sessToken() } });
        if (!r.ok) throw Error('Das Formular konnte nicht erstellt werden.');
        await w.step(1);
        const blob = await r.blob(); const clean = r.headers.get('X-Form-Clean') === '1';
        await w.done('Formular bereit');
        const { showPdf } = await import('/src/pdf-view.mjs');
        showPdf(blob, { filename: fileName(r, `ImmoAdv_${PROD[KM.doc].name}_Formular.pdf`), title: `${PROD[KM.doc].name} · Formular zum Ausfüllen`,
          note: `Herunterladen, ausfüllen, speichern – dann unter „Ausgefülltes PDF hochladen“ wieder einlesen.${clean ? '' : ' ' + DEMO_NOTE}` });
      } catch (err) { w.close(); msg(esc(err.message), 'bad'); }
      finally { busy(false); }
    });

    // Ausgefülltes PDF-Formular hochladen (Manuell)
    $('kmFormUp')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
      msg(''); busy(true);
      const { work } = await import('/src/loader.mjs');
      const kind = PROD[KM.doc].form;
      const w = work(`${PROD[KM.doc].name}: Formular wird eingelesen`, ['PDF öffnen', 'Eingaben lesen', 'Daten übernehmen', KM.doc === 'km' ? 'Kreditmappe erstellen' : 'Kennzahlen & PDF erstellen']);
      try {
        await w.step(0);
        const [{ readPdfForm, showPdf }, spec] = await Promise.all([import('/src/pdf-view.mjs'), import('/src/form-spec.mjs')]);
        const raw = await readPdfForm(f);
        await w.step(1);
        const other = kind === 'analyse' ? 'kreditmappe' : 'analyse';
        if (raw.id === spec.FORMS[other].id) throw Error(`Das ist das ${spec.FORMS[other].product}-Formular. Bitte oben „${spec.FORMS[other].product}“ wählen und erneut hochladen.`);
        const { values, filled } = spec.readForm(kind, raw.values);
        if (!filled) throw Error(raw.id === spec.FORMS[kind].id ? 'Das Formular ist noch leer. Bitte ausfüllen, speichern und erneut hochladen.' : 'In dieser Datei wurden keine ImmoAdv-Formularfelder gefunden. Bitte das Formular über „Formular ansehen & herunterladen“ verwenden.');
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
  getAccess().then((a) => { const h = $('kmDemo'); if (h && !a.paid) { h.hidden = false; h.innerHTML = `${DEMO_NOTE} <a class="ck-link" href="#angebot">Tarife ansehen</a>`; } });
  box.querySelectorAll('[data-kmdoc]').forEach((b) => b.onclick = () => { KM.doc = b.dataset.kmdoc; draw(); });
  box.querySelectorAll('[data-kmway]').forEach((b) => b.onclick = () => { KM.way = b.dataset.kmway; draw(); });
  draw();
}

// Konto: Tarif, Rechnungen (PDF, beliebig oft), Tarif wechseln, Zahlungsmittel, Kündigen.
async function renderFin() {
  const box = $('finBody'); if (!box) return;
  const token = (() => { try { return JSON.parse(localStorage.getItem('immoadv-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } })();
  const H = { Authorization: 'Bearer ' + token };
  let cfg = { enabled: false }, st = { tier: 'free' }, inv = { invoices: [] };
  const acc = await getAccess();
  try { cfg = await fetch('/api/billing/config', { cache: 'no-store' }).then((r) => r.json()); } catch { /* aus */ }
  if (cfg.enabled) {
    [st, inv] = await Promise.all([
      fetch('/api/billing/status', { headers: H, cache: 'no-store' }).then((r) => r.json()).catch(() => ({ tier: 'free' })),
      fetch('/api/billing/invoices', { headers: H, cache: 'no-store' }).then((r) => r.json()).catch(() => ({ invoices: [] })),
    ]);
  }
  const tierName = acc.paid && (st.tier || 'free') === 'free' ? (acc.b2b ? 'Unternehmenskonto' : 'Voller Zugang') : ({ free: 'Kostenlose Demo', starter: 'Käufer-Pass', pro: 'Investor Pro' }[st.tier || 'free'] || 'Kostenlose Demo');
  const demoBox = acc.paid ? '' : `<div class="demo-box"><strong>Sie nutzen die kostenlose Demo</strong><p>Probieren Sie alles aus: RenditeRadar-Analysen, BankReady-Vorschau, PDF-Formulare und den Lernbereich. In der Demo tragen alle PDFs ein ImmoAdv-Wasserzeichen. Sobald Sie ein Abo besitzen bzw. einen Tarif gebucht haben, entfallen die Wasserzeichen – Ihre Dokumente sind dann fertig für Bank und Weitergabe.</p><a class="btn btn-dark" href="#angebot">Tarife ansehen</a></div>`;
  const until = st.pro ? st.proUntil : st.starter ? st.starterUntil : null;
  const money = (c, cur = 'eur') => (Number(c || 0) / 100).toLocaleString('de-DE', { style: 'currency', currency: String(cur).toUpperCase() });
  const dte = (x) => (x ? new Date(x).toLocaleDateString('de-DE') : '–');
  const list = Array.isArray(inv.invoices) ? inv.invoices : [];
  box.innerHTML = `${demoBox}${CHECKOUT === 'success' ? '<p class="auth-message success">Vielen Dank – Ihre Zahlung wurde übermittelt. Die Rechnung erscheint unten und kommt per E-Mail.</p>' : CHECKOUT === 'cancel' ? '<p class="form-note">Bezahlung abgebrochen – es wurde nichts berechnet.</p>' : ''}<div class="fin-grid">
    <div class="fin-box"><small>Ihr Tarif</small><strong>${tierName}</strong><span>${until ? `aktiv bis ${dte(until)}` : st.tier === 'free' ? (acc.paid ? 'Alle Funktionen, PDFs ohne Wasserzeichen' : 'Alles ausprobieren · PDFs mit Wasserzeichen') : ''}${st.creditMaps ? ` · Kreditmappen: ${Math.max(0, (st.creditMaps || 0) - (st.creditMapsUsed || 0))} frei` : ''}</span></div>
    <div class="fin-actions">
      <a class="btn btn-dark" href="#angebot">${st.tier === 'free' ? 'Tarif buchen' : 'Upgrade / Tarife ansehen'}</a>
      <button class="btn btn-outline" type="button" data-flow="update"${cfg.enabled && st.tier !== 'free' ? '' : ' disabled'}>Tarif wechseln</button>
      <button class="btn btn-outline" type="button" data-flow="payment"${cfg.enabled && st.hasCustomer ? '' : ' disabled'}>Zahlungsmittel ändern</button>
      <button class="btn btn-outline fin-cancel" type="button" data-flow="cancel"${cfg.enabled && st.tier !== 'free' ? '' : ' disabled'}>Abo kündigen</button>
    </div></div>
    ${cfg.enabled ? '' : '<p class="form-note">Die Zahlungsabwicklung startet in Kürze. Danach können Sie hier Tarife wechseln, Zahlungsmittel ändern, kündigen und alle Rechnungen herunterladen.</p>'}
    <h4 class="fin-h">Rechnungen</h4>
    ${list.length ? `<ul class="fin-list">${list.map((i) => `<li><div><strong>${esc(i.number || 'Rechnung')}</strong><span>${dte(i.date)} · ${money(i.total, i.currency)}${i.status === 'open' ? ' · <b class="st warn">offen</b>' : ' · bezahlt'}${i.description ? ` · ${esc(i.description.slice(0, 60))}` : ''}</span></div>${i.pdf ? `<a class="btn btn-outline" href="${esc(i.pdf)}" target="_blank" rel="noopener noreferrer">PDF herunterladen</a>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">Noch keine Rechnungen.</p>'}
    <p class="form-note">Rechnungen können Sie jederzeit erneut herunterladen. Kündigen geht auch ohne Anmeldung über <a class="ck-link" href="/kuendigen">„Verträge hier kündigen“</a>.</p>
    <p class="fin-msg" id="finMsg" role="status" aria-live="polite"></p>`;
  box.querySelectorAll('[data-flow]').forEach((b) => b.onclick = async () => {
    b.disabled = true; const m = $('finMsg'); m.textContent = 'Wird geöffnet …';
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ flow: b.dataset.flow }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.url) throw Error(j.error || 'Konnte nicht geöffnet werden.');
      location.href = j.url;
    } catch (e) { m.textContent = e.message; b.disabled = false; }
  });
}

// Fahrplan je Stufe (Einsteiger): Aufgaben mit Status aus den eigenen Daten. done: true/false, null = ohne Status.
function fahrplan(idx, d) {
  const pr = d.profile || {}, objs = Array.isArray(d.objects) ? d.objects : [], L = d.progress?.lern || {};
  const prof = Number(pr.netIncome) > 0 && pr.equity !== undefined && pr.equity !== '';
  const learned = (ids) => ids.every((i) => L[i]);
  const owned = objs.some((o) => o.purchaseDate && Number(o.fixedYears) > 0);
  return [
    [['Finanzprofil ausfüllen', 'Nettoeinkommen und Eigenkapital – daraus ergibt sich Ihr Budget.', '#konto', prof],
      ['Budget berechnen', 'Welche Rate und welcher Kaufpreis zu Ihnen passen.', '/rechner/budget', null],
      ['Grundlagen lernen', 'Geld, Eigenkapital, Zins und Tilgung – je wenige Minuten.', '#lernen', learned(['geld', 'eigenkapital', 'annuitaet'])]],
    [['Erstes Objekt anlegen', 'Inserat übernehmen oder Eckdaten eintragen.', '#suche', objs.length > 0],
      ['Kennzahlen prüfen', 'Rendite, Cashflow und Bankreife mit RenditeRadar.', '#objekte', null],
      ['Exposé lesen lernen', 'Was hinter Cashflow und Beleihung steckt.', '#lernen', learned(['cashflow', 'beleihung'])]],
    [['Finanzprofil vollständig', 'Die Bank prüft Einkommen und Eigenkapital zuerst.', '#konto', prof],
      ['Unterlagen vollständig machen', 'Bankreife Ihres Objekts auf 90 % bringen.', '/checkliste', null],
      ['Kreditmappe erstellen', 'BankReady: Objekt wählen → Vorschau → PDF.', '#objekte', null],
      ['Wissen für das Bankgespräch', 'Beleihungswert, Unterlagen, Bewertung Ihres Berufs.', '#lernen', learned(['unterlagen', 'beleihung'])]],
    [['Kaufdatum und Zinsbindung eintragen', 'Dann überwacht ImmoAdv alle Fristen für Sie.', '#objekte', owned],
      ['Fristen-Erinnerung einschalten', 'E-Mail vor Ende der Zinsbindung und weiteren Fristen.', '#konto', null],
      ['Steuern und Mietrecht', 'Anlage V, Werbungskosten, wenn die Miete ausbleibt.', '#lernen', learned(['steuer', 'miete'])]],
  ][idx];
}

function startCard(mode, d) {
  const done = Object.values(d.progress?.lern || {}).filter(Boolean).length;
  if (!d.profile?.mode && !new URLSearchParams(location.search).get('modus')) {
    return `<article class="dash-card wide start-card wiz-card" data-view="start"><span class="stage-k">Willkommen bei ImmoAdv</span><h3>In drei kurzen Fragen auf Sie eingestellt</h3>
      <p class="form-note">Ziel, Stand und – wenn Sie möchten – Ihre Zahlen. Danach passt sich alles an: Startseite, Fahrplan, Lernplan und Steuer-Bereich. Jederzeit änderbar.</p>
      <div class="wiz-start"><button class="btn btn-dark wiz-open" type="button">Los geht's – 1 Minute</button><button class="btn btn-outline" type="button" data-pick="einsteiger">Überspringen</button></div></article>`;
  }
  const ph = phaseOf(d);
  if (mode === 'profi') {
    // Profi: nur Auswahl und Werkzeuge – keine Erklärtexte.
    const tools = [...PHASES[ph.idx].actions.map(([h, t]) => [t, h]), ['Angebote vergleichen', '/rechner/vergleich'], ...PROFI.filter(([t]) => !/Angebotsvergleich|Glossar/.test(t))];
    return `<article class="dash-card wide start-card start-pro" data-view="start">
      <div class="stage-mini"><span class="stage-k">Stufe</span><strong><b class="stage-n">${ph.idx + 1}</b>${PHASES[ph.idx].name}</strong><button type="button" class="link-btn stage-open">ändern</button><div id="rankSlot" class="rank-slot mini"></div></div>
      <div class="tool-grid">${tools.map(([t, h]) => `<a class="tool-a" href="${h}">${t}</a>`).join('')}</div></article>`;
  }
  const tasks = fahrplan(ph.idx, d);
  const nextI = tasks.findIndex((x) => x[3] === false);
  const extra = [['#lernen', 'Wissen auffrischen', `${done} von ${LERN.length} Themen verstanden`]];
  const inPlan = new Set(tasks.map((x) => x[2]));
  const actions = [...PHASES[ph.idx].actions.filter(([h]) => !inPlan.has(h)), ['#suche', 'Immobilien suchen', 'Inserate der großen Portale'], ...extra].filter((a, i, all) => all.findIndex((x) => x[0] === a[0]) === i);
  return `<article class="dash-card wide start-card" data-view="start">${phasePicker(ph.idx, ph.chosen)}
    <div id="rankSlot" class="rank-slot"></div>
    <h4 class="sc-h">Ihr Fahrplan für Stufe ${ph.idx + 1}</h4>
    <ol class="fp">${tasks.map(([t, sub, h, st], i) => `<li class="fp-i${st === true ? ' done' : ''}${i === nextI ? ' next' : ''}"><span class="fp-dot" aria-hidden="true">${st === true ? '✓' : i + 1}</span><span class="fp-t"><strong>${t}</strong><small>${sub}</small></span>${st === true ? '<span class="fp-st">erledigt</span>' : `<a class="btn ${i === nextI ? 'btn-dark' : 'btn-outline'} fp-go" href="${h}">${i === nextI ? 'Jetzt erledigen' : 'Öffnen'}</a>`}</li>`).join('')}</ol>
    <h4 class="sc-h">Schnellzugriff</h4>
    <div class="quick">${actions.map(([h, t, s2]) => `<a class="quick-a" href="${h}"><strong>${t}</strong><span>${s2}</span></a>`).join('')}</div></article>`;
}

function bindStart(mode, d, u, saveData, reload) {
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
      <div class="lt-body" data-body="${id}"><p class="form-note">Wird geladen …</p></div>
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
    <div class="lt-list">${lernTopics(st, recLern(d), PHASES[phaseOf(d).idx].name + (GOALS[d.profile?.goal] ? ' · ' + GOALS[d.profile.goal].name : ''), PHASES[phaseOf(d).idx].plan)}</div></article>`;
}

let FAQ = null;
const escH = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lnk = (t) => escH(t).replace(/https:\/\/[^\s<]*[^\s<.,;)]/g, (u) => `<a class="ck-link" href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https:\/\/(www\.)?/, '')}</a>`);
const slugQ = (q) => { let t = q.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (t.length > 70) { t = t.slice(0, 70); t = t.slice(0, t.lastIndexOf('-') > 30 ? t.lastIndexOf('-') : 70); } return t; };

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
      <div class="lt-more" id="more-${id}-${k}"${document.body.dataset.mode === 'profi' ? '' : ' hidden'}><p>${lnk(q.level2)}</p>${q.nextStep ? `<p class="lt-next"><strong>Nächster Schritt:</strong> ${lnk(q.nextStep)}</p>` : ''}<a class="ck-link" href="/wissen/${slugQ(q.question)}">Ganze Seite öffnen →</a></div>
      ${document.body.dataset.mode === 'profi' ? '' : `<button class="lt-mini" type="button" data-more="more-${id}-${k}" aria-expanded="false" aria-controls="more-${id}-${k}">Mehr erklären</button>`}
    </div>`).join('')}
    <div class="lt-actions"><a class="btn btn-outline" href="${toolHref}"${/^https:/.test(toolHref) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${toolText}${/^https:/.test(toolHref) ? ' öffnen ↗' : ' ausprobieren'}</a>
      <button class="btn ${done ? 'btn-outline' : 'btn-dark'}" type="button" data-done="${id}">${done ? 'Als offen markieren' : '✓ Verstanden'}</button></div>`;
}

function bindLern(d, u, saveData) {
  const ensure = async () => { if (FAQ) return; try { FAQ = (await fetch('/data/faq.json').then((r) => r.json())).entries; } catch { FAQ = []; } };
  document.querySelectorAll('details.lt').forEach((det) => det.addEventListener('toggle', async () => { if (!det.open) return; await ensure(); fillTopic(det.dataset.topic, d); }));
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
      hits.innerHTML = n ? `${n} passende${n === 1 ? 's Thema' : ' Themen'} – antippen zum Auffrischen. <a class="ck-link" href="/suche?q=${encodeURIComponent(q.value.trim())}">Auch in der Wissenszentrale suchen</a>` : `Kein Lernthema gefunden. <a class="ck-link" href="/suche?q=${encodeURIComponent(q.value.trim())}">In der Wissenszentrale nach „${escH(q.value.trim())}“ suchen</a>`;
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
  const token = (() => { try { return JSON.parse(localStorage.getItem('immoadv-auth-session-v1') || 'null')?.access_token || ''; } catch { return ''; } })();
  let P, st, cfg;
  try {
    [P, cfg] = await Promise.all([fetch('/data/preise.json').then((r) => r.json()), fetch('/api/billing/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false }))]);
    st = cfg.enabled ? await fetch('/api/billing/status', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' }).then((r) => r.json()) : { tier: 'free' };
  } catch { box.innerHTML = '<p class="auth-message error">Angebote konnten nicht geladen werden.</p>'; return; }
  const tier = st.tier || (st.pro ? 'pro' : 'free');
  // Nächster sinnvoller Schritt: Vermieter (Profi-Ansicht) → Investor Pro, Käufer → Käufer-Pass bzw. Kreditmappe.
  const next = tier === 'pro' ? null : tier === 'starter' ? 'credit-map' : mode === 'profi' ? 'pro-monthly' : 'buyer-pass';
  const tierName = { free: 'Kostenlos', starter: 'Käufer-Pass', pro: 'Investor Pro' }[tier];
  const left = Math.max(0, (st.creditMaps || 0) - (st.creditMapsUsed || 0));
  const draw = () => {
    const m = P.privat;
    box.innerHTML = `<div class="offer-head"><div><span class="form-note">Ihr Tarif</span><strong>${tierName}</strong></div>${st.starterUntil ? `<span class="form-note">Käufer-Pass aktiv bis ${new Date(st.starterUntil).toLocaleDateString('de-DE')}</span>` : ''}</div>
      <p class="form-note">${esc(m.zielgruppe)}</p>
      ${tier === 'pro' ? '<p class="auth-message">Investor Pro ist aktiv – alle Funktionen und Kreditmappen sind enthalten.</p>' : left ? `<p class="auth-message">Sie haben ${left} Kreditmappe${left === 1 ? '' : 'n'} frei.</p>` : ''}
      <div class="offers">${m.plans.map((p) => `<div class="offer${p.id === next ? ' rec' : ''}">${p.id === next ? '<span class="offer-rec">Empfohlener nächster Schritt</span>' : p.badge ? `<span class="offer-badge">${esc(p.badge)}</span>` : ''}<div class="offer-top">${planIcon(p.id)}<h4>${esc(p.name)}</h4></div><div class="offer-price">${E(p.cents)} <small>${esc(p.intervall)}</small></div><ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${cfg.enabled ? `<button class="btn btn-pay" type="button" data-buy="${p.id}"${tier === 'pro' ? ' disabled' : ''}>${tier === 'pro' ? 'In Investor Pro enthalten' : 'Jetzt buchen'}</button>` : '<button class="btn btn-outline" type="button" disabled>Buchung startet in Kürze</button>'}</div>`).join('')}</div>
      <div class="offer-free"><strong>Immer kostenlos:</strong> ${P.kostenlos.features.map(esc).join(' · ')}</div>
      <div class="offer-pay"><p class="form-note">Bezahlen Sie auf der sicheren Bezahlseite mit:</p>${PAY_BADGES}</div>
      <p class="form-note">${esc(P.hinweis)} Es gelten die <a class="ck-link" href="/nutzungsbedingungen">Nutzungsbedingungen mit Widerrufsbelehrung</a>. Kündigung jederzeit über <a class="ck-link" href="/kuendigen">„Verträge hier kündigen“</a>.</p>`;
    const want = new URLSearchParams(location.search).get('buy');
    if (want) { const card = box.querySelector(`[data-buy="${CSS.escape(want)}"]`)?.closest('.offer'); if (card) { card.classList.add('offer-want'); card.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }
    box.querySelectorAll('[data-buy]').forEach((b) => b.onclick = () => {
      const offer = m.plans.find((x) => x.id === b.dataset.buy);
      if (offer) openBuy(offer, { onError: (t) => alert(t) });
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
        const { supa, token } = await import('/src/sess.mjs');
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
  grid.insertAdjacentHTML('beforeend', `<article class="dash-card wide pers-card" data-view="konto" id="persCard"><h3>Persönliche Daten</h3><div id="persBody"><p class="form-note">Wird geladen …</p></div></article>`);
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
    <div class="buy-head"><img src="/logo-icon.svg" alt="" width="34" height="29"><div><span class="buy-kick">Willkommen bei ImmoAdv</span><h2>Eigenes Passwort festlegen</h2></div></div>
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
      const { supa, token } = await import('/src/sess.mjs');
      const r = await supa('/auth/v1/user', { method: 'PUT', headers: { Authorization: 'Bearer ' + token() }, body: JSON.stringify({ password: a, data: { must_change_password: false, onboarded_at: new Date().toISOString() } }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw Error(/same|different/i.test(String(j.msg || j.message || '')) ? 'Bitte ein anderes Passwort als das Startpasswort wählen.' : 'Passwort konnte nicht gespeichert werden.'); }
      d.close(); d.remove();
    } catch (er) { say(er.message); sb.disabled = false; }
  };
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}
