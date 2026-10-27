// Bindet Rechner, Fristen und Szenarien an den gemeinsamen Rechenkern (calc.mjs).
import { anschluss, verkauf, indexmiete, staffelmiete, kaufpreisaufteilung, grenze15, fristen, toICS, GREST, kaufnebenkosten, einstieg, tilgungsplan, tilgungsplanCSV, budget, scorecard, cashflowSteuer, angebot, kaufenMieten, afaPlan, mieterhoehung } from './calc.mjs?v=892f3666';

const $ = (id) => document.getElementById(id);
const num = (id) => { const v = $(id)?.value; return v === '' || v == null ? 0 : Number(v); };
const val = (id) => $(id)?.value || '';
const chk = (id) => Boolean($(id)?.checked);
const E = (x) => (x ?? 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const P = (x, d = 2) => `${(x ?? 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
const D = (s) => (s ? new Date(s + 'T00:00:00Z').toLocaleDateString('de-DE', { timeZone: 'UTC' }) : '–');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const table = (rows, head) => `<table class="bill-table">${head ? `<thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const flag = (ok, yes, no) => `<span class="st ${ok ? 'ok' : 'bad'}">${ok ? yes : no}</span>`;
const watch = (ids, fn) => { ids.forEach((id) => $(id)?.addEventListener('input', fn)); ids.forEach((id) => $(id)?.addEventListener('change', fn)); fn(); };
const KEY = (k) => `lr-tool-${k}`;
// Werte aus dem Link (#feld=wert) haben Vorrang, z. B. aus dem Konto übernommene Objektdaten.
const fromHash = new URLSearchParams(location.hash.slice(1));
const remember = (k, ids) => {
  try { const s = JSON.parse(localStorage.getItem(KEY(k)) || '{}'); ids.forEach((id) => { if (s[id] !== undefined && $(id)) { if ($(id).type === 'checkbox') $(id).checked = s[id]; else $(id).value = s[id]; } }); } catch {}
  const save = () => { try { const o = {}; ids.forEach((id) => { if ($(id)) o[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value; }); localStorage.setItem(KEY(k), JSON.stringify(o)); } catch {} };
  ids.forEach((id) => { if (fromHash.has(id) && $(id)) $(id).value = fromHash.get(id); });
  ids.forEach((id) => $(id)?.addEventListener('change', save));
  share(ids);
};
// „Link zum Ergebnis“: Eingaben als #feld=wert im Link, damit Ergebnisse geteilt oder gemerkt werden können.
function share(ids) {
  const first = ids.map($).find(Boolean);
  const card = first?.closest('.dash-card, .wz, #wz, article');
  if (!card || card.querySelector('.share-btn')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-outline share-btn'; b.textContent = 'Link zum Ergebnis kopieren';
  const note = document.createElement('span'); note.className = 'form-note share-note'; note.setAttribute('role', 'status');
  b.onclick = async () => {
    const q = new URLSearchParams();
    ids.forEach((id) => { const el = $(id); if (el && el.type !== 'checkbox' && el.value !== '') q.set(id, el.value); });
    const url = `${location.origin}${location.pathname}#${q.toString()}`;
    try { await navigator.clipboard.writeText(url); note.textContent = ' Link kopiert.'; }
    catch { history.replaceState(null, '', url); note.textContent = ' Link steht jetzt in der Adresszeile.'; }
  };
  const pr = document.createElement('button'); pr.type = 'button'; pr.className = 'btn btn-outline share-btn'; pr.textContent = 'Drucken / als PDF speichern'; pr.onclick = () => window.print();
  const wrap = document.createElement('p'); wrap.className = 'share-row'; wrap.append(b, ' ', pr, note);
  card.append(wrap);
}
document.querySelectorAll('.calc-out').forEach((e) => e.setAttribute('aria-live', 'polite'));

// Indexmiete
if ($('ix_out')) {
  const ids = ['ix_r', 'ix_a', 'ix_b', 'ix_l', 'ix_e'];
  watch(ids, () => {
    const r = indexmiete({ rent: num('ix_r'), indexOld: num('ix_a'), indexNew: num('ix_b'), lastChange: val('ix_l'), effective: val('ix_e') });
    if (!r) { $('ix_out').innerHTML = '<p class="form-note">Bitte beide Indexwerte eintragen (VPI, Basis 2020 = 100).</p>'; return; }
    const rows = [['Veränderung des Index', P(r.changePct)], ['Neue Nettokaltmiete', `<strong>${E(r.newRent)}</strong>`], ['Differenz pro Monat', E(r.diff)]];
    if (r.earliest) rows.push(['Frühestens wirksam ab', `${D(r.earliest)} ${flag(r.timingOk, 'Termin passt', 'zu früh')}`]);
    $('ix_out').innerHTML = table(rows);
  });
}

// Staffelmiete
if ($('st_out')) {
  const ids = ['st_a', 'st_v', 'st_b', ...[0, 1, 2, 3].flatMap((i) => ['st_d' + i, 'st_r' + i])];
  watch(ids, () => {
    const steps = [0, 1, 2, 3].map((i) => ({ date: val('st_d' + i), rent: num('st_r' + i) }));
    const res = staffelmiete({ steps, area: num('st_a'), vergleichsmieteQm: num('st_v'), bremse: chk('st_b') });
    if (!res.length) { $('st_out').innerHTML = '<p class="form-note">Bitte mindestens eine Staffel mit Datum und Betrag eintragen.</p>'; return; }
    const head = ['Ab', 'Miete', 'Erhöhung', 'Abstand ≥ 1 Jahr', ...(res[0].cap !== null ? ['Mietpreisbremse'] : [])];
    const rows = res.map((x) => [D(x.date), E(x.rent), x.increase ? `${E(x.increase)} (${P(x.increasePct)})` : '–', flag(x.gapOk, 'ja', 'nein'), ...(x.cap !== null ? [flag(x.capOk, `≤ ${E(x.cap)}`, `über ${E(x.cap)}`)] : [])]);
    $('st_out').innerHTML = table(rows, head);
  });
}

// Kaufpreisaufteilung und 15-%-Grenze
if ($('kp_out')) {
  const ids = ['kp_p', 'kp_n', 'kp_l', 'kp_b', 'kp_ms', 'kp_mt', 'kp_s'];
  watch(ids, () => {
    const k = kaufpreisaufteilung({ price: num('kp_p'), landArea: num('kp_l'), bodenrichtwert: num('kp_b'), meaShare: num('kp_ms') || 1, meaTotal: num('kp_mt') || 1 });
    const g = grenze15({ price: num('kp_p'), purchaseCostPct: num('kp_n'), buildingSharePct: k.buildingSharePct, spentNet: num('kp_s') });
    $('kp_out').innerHTML = table([
      ['Bodenwert (anteilig)', E(k.land)], ['Gebäudewert', E(k.building)], ['Gebäudeanteil', `<strong>${P(k.buildingSharePct)}</strong>`],
      ['Gebäude-Anschaffungskosten inkl. Nebenkosten', E(g.akGebaeude)], ['15-%-Grenze (netto, 3 Jahre)', `<strong>${E(g.limit)}</strong>`],
      ['Geplante Instandsetzung', `${E(g.spent)} ${flag(!g.exceeded, `${E(g.headroom)} Spielraum`, 'Grenze überschritten')}`],
    ]) + (g.exceeded ? '<p class="form-note">Bei Überschreitung werden die Kosten nicht sofort abgezogen, sondern über die Nutzungsdauer abgeschrieben. Mit Steuerberatung abstimmen.</p>' : '');
  });
}

// Fristen
if ($('fr_out')) {
  const ids = ['fr_p', 'fr_a', 'fr_z', 'fr_m', 'fr_e', 'fr_i'];
  remember('fristen', ids);
  let last = [];
  watch(ids, () => {
    last = fristen({ purchaseDate: val('fr_p'), payoutDate: val('fr_a'), fixedYears: num('fr_z'), lastRentChange: val('fr_m'), indexRent: chk('fr_i'), energyCertDate: val('fr_e') });
    $('fr_ics').disabled = !last.length;
    if (!last.length) { $('fr_out').innerHTML = '<p>Bitte mindestens das Kaufvertragsdatum eintragen.</p>'; return; }
    const today = new Date().toISOString().slice(0, 10);
    $('fr_out').innerHTML = `<ol class="frist-list">${last.map((e) => `<li class="${e.date < today ? 'past' : ''}${e.kind === 'hinweis' ? ' hint' : ''}"><time datetime="${e.date}">${D(e.date)}</time><div><strong>${esc(e.title)}</strong><p>${esc(e.detail)}</p><small>${esc(e.source)}</small></div></li>`).join('')}</ol>`;
  });
  $('fr_ics')?.addEventListener('click', () => {
    if (!last.length) return;
    const blob = new Blob([toICS(last)], { type: 'text/calendar;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'LeaseRun_Fristen.ics' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 120_000);
  });
}

// Anschlussfinanzierung
if ($('an_out')) {
  const ids = ['an_l', 'an_i', 'an_t', 'an_z', 'an_r', 'an_v', 'an_n', 'an_m', 'an_t2'];
  remember('anschluss', ids);
  watch(ids, () => {
    const noi = num('an_r') * (1 - num('an_v') / 100) - num('an_n') - num('an_m');
    const a = anschluss({ loan: num('an_l'), ratePa: num('an_i') / 100, repaymentPa: num('an_t') / 100, fixedYears: num('an_z'), noiMonthly: noi, newRepaymentPa: num('an_t2') / 100 });
    const kipp = a.kippPunktPa === null ? 'nicht berechenbar' : a.kippPunktPa <= 0 ? 'bereits bei 0 % negativ' : P(a.kippPunktPa * 100);
    $('an_out').innerHTML = table([['Rate heute', E(a.oldRate)], ['Überschuss vor Rate / Monat', E(noi)], [`Restschuld nach ${num('an_z')} Jahren`, `<strong>${E(a.rest)}</strong>`], ['Kipp-Punkt (Cashflow = 0)', `<strong>${kipp}</strong>`]])
      + table(a.rows.map((r) => [P(r.ratePa * 100), E(r.rate), (r.diff > 0 ? '+' : '') + E(r.diff), `<span class="${r.cashflow < 0 ? 'neg' : 'pos'}">${(r.cashflow > 0 ? '+' : '') + E(r.cashflow)}</span>`]), ['Anschlusszins', 'Neue Rate', 'Differenz', 'Cashflow v. St.']);
  });
}

// Verkauf
if ($('vk_out')) {
  const ids = ['vk_p', 'vk_n', 'vk_g', 'vk_a', 'vk_y', 'vk_w', 'vk_k', 'vk_l', 'vk_i', 'vk_t', 'vk_s'];
  remember('verkauf', ids);
  watch(ids, () => {
    const v = verkauf({ price: num('vk_p'), purchaseCostPct: num('vk_n'), buildingSharePct: num('vk_g'), afaRatePa: num('vk_a') / 100, years: num('vk_y'), growthPa: num('vk_w') / 100, saleCostPct: num('vk_k'), loan: num('vk_l'), ratePa: num('vk_i') / 100, repaymentPa: num('vk_t') / 100, taxPct: num('vk_s') });
    $('vk_out').innerHTML = table([
      ['Angenommener Verkaufspreis', E(v.value)], ['Erlös nach Verkaufskosten', E(v.saleNet)],
      ['Anschaffungskosten inkl. Nebenkosten', E(v.ak)], ['In Anspruch genommene AfA', E(v.afaTaken)], ['Restbuchwert', E(v.book)],
      ['Veräußerungsgewinn', `<strong>${E(v.gain)}</strong>`],
      ['Spekulationsfrist', v.within10 ? flag(false, '', 'innerhalb von 10 Jahren: steuerpflichtig') : flag(true, 'nach 10 Jahren: steuerfrei', '')],
      ['Einkommensteuer darauf (Modell)', E(v.tax)], ['Restschuld bei Verkauf', E(v.rest)], ['Liquidität nach Verkauf', `<strong>${E(v.cashAfterSale)}</strong>`],
    ]);
  });
}

// Kaufnebenkosten je Bundesland
const landEl = document.querySelector('[data-land]');
if (landEl && $('kn_out')) {
  const land = landEl.dataset.land, g = GREST[land];
  if (g && $('kn_rate')) $('kn_rate').innerHTML = `In ${esc(g.name)} beträgt die Grunderwerbsteuer <strong>${P(g.pct, 1)}</strong> des Kaufpreises${g.since ? ` (gültig seit ${D(g.since)})` : ''}.`;
  watch(['kn_p', 'kn_m', 'kn_n', 'kn_g'], () => {
    const k = kaufnebenkosten({ price: num('kn_p'), land, notaryPct: num('kn_n'), landRegistryPct: num('kn_g'), brokerPct: num('kn_m') });
    if (!k) { $('kn_out').innerHTML = '<p class="form-note">Bitte einen Kaufpreis eintragen.</p>'; return; }
    $('kn_out').innerHTML = table([...k.parts.map((x) => [`${esc(x.label)} (${P(x.pct)})`, E(x.amount)]), ['<strong>Kaufnebenkosten gesamt</strong>', `<strong>${E(k.total)}</strong> (${P(k.totalPct)})`], ['Gesamtkosten inkl. Kaufpreis', E(k.allIn)]]);
  });
}
if ($('kn_table')) {
  const rows = Object.entries(GREST).sort((a, b) => a[1].pct - b[1].pct || a[1].name.localeCompare(b[1].name, 'de'))
    .map(([slug, g]) => [`<a class="ck-link" href="/calculators/closing-costs/${slug}">${esc(g.name)}</a>`, P(g.pct, 1), E(300000 * g.pct / 100)]);
  $('kn_table').innerHTML = table(rows, ['Bundesland', 'Grunderwerbsteuer', 'bei 300.000 €']);
}

// Tilgungsplan
if ($('tp_out')) {
  const ids = ['tp_l', 'tp_z', 'tp_t', 'tp_f', 'tp_s'];
  remember('tilgung', ids);
  let plan = null;
  watch(ids, () => {
    plan = tilgungsplan({ loan: num('tp_l'), ratePa: num('tp_z') / 100, repaymentPa: num('tp_t') / 100, fixedYears: num('tp_f'), specialPa: num('tp_s') });
    if (!plan) { $('tp_sum').innerHTML = '<p class="form-note">Bitte Darlehensbetrag, Zins und Tilgung eintragen.</p>'; $('tp_out').innerHTML = ''; return; }
    const dur = plan.months ? `${Math.floor(plan.months / 12)} Jahre${plan.months % 12 ? ` und ${plan.months % 12} Monate` : ''}` : 'über 60 Jahre';
    $('tp_sum').innerHTML = table([
      ['Monatsrate (Zins + Tilgung)', `<strong>${E(plan.monthly)}</strong>`],
      [`Restschuld nach ${num('tp_f')} Jahren Zinsbindung`, `<strong>${E(plan.restAtFixed ?? 0)}</strong>`],
      ['Laufzeit bis zur Volltilgung (gleicher Zins)', dur],
      ['Zinsen insgesamt', E(plan.totalInterest)],
      ...(plan.totalSpecial > 0 ? [['Sondertilgungen insgesamt', E(plan.totalSpecial)]] : []),
    ]);
    const fy = Math.round(num('tp_f'));
    $('tp_out').innerHTML = table(plan.years.map((r) => [r.year === fy ? `<strong>${r.year}</strong>` : r.year, E(r.interest), E(r.principal), r.special ? E(r.special) : '–', r.year === fy ? `<strong>${E(r.balance)}</strong>` : E(r.balance)]), ['Jahr', 'Zinsen', 'Tilgung', 'Sondertilgung', 'Restschuld']);
  });
  $('tp_csv')?.addEventListener('click', () => {
    if (!plan) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + tilgungsplanCSV(plan)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'LeaseRun_Tilgungsplan.csv'; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}

// Budget-Rechner
if ($('bu_out')) {
  const ids = ['bu_n', 'bu_a', 'bu_p', 'bu_e', 'bu_m', 'bu_s', 'bu_k', 'bu_z', 'bu_t', 'bu_land', 'bu_b'];
  remember('budget', ids);
  watch(ids, () => {
    const b = budget({ netIncome: num('bu_n'), expenses: num('bu_a'), bufferPct: num('bu_p'), equity: num('bu_e'), rent: num('bu_m'), rentSharePct: num('bu_s'), objectCosts: num('bu_k'), ratePa: num('bu_z') / 100, repaymentPa: num('bu_t') / 100, land: val('bu_land'), brokerPct: num('bu_b') });
    if (!b) { $('bu_out').innerHTML = '<p class="form-note">Bitte Zins und Tilgung eintragen.</p>'; return; }
    if (b.rate <= 0) { $('bu_out').innerHTML = '<p class="form-note">Nach Ausgaben und Puffer bleibt kein Betrag für eine Rate. Ausgaben prüfen oder Eigenkapital erhöhen.</p>'; return; }
    const dur = b.months ? `${Math.floor(b.months / 12)} Jahre${b.months % 12 ? ` und ${b.months % 12} Monate` : ''}` : '–';
    $('bu_out').innerHTML = table([
      ['Monatlicher Überschuss (inkl. angerechneter Miete)', E(b.surplus)],
      ['Tragbare Rate nach Puffer', `<strong>${E(b.rate)}</strong>`],
      ['Darlehen bei dieser Rate', `<strong>${E(b.loan)}</strong>`],
      ['Kaufpreis, der damit darstellbar ist', `<strong>${E(b.price)}</strong>`],
      [`Kaufnebenkosten (${P(b.nkPct)})`, E(b.nebenkosten)],
      ['Eigenkapital deckt die Nebenkosten', b.equityCoversNk ? flag(true, 'ja', '') : flag(false, '', 'nein – Banken finanzieren Nebenkosten selten mit')],
      ['Darlehen im Verhältnis zum Kaufpreis', P(b.loanToPrice, 1)],
      ['Restschuld nach 10 Jahren', E(b.restAfter10)],
      ['Laufzeit bis zur Volltilgung (gleicher Zins)', dur],
    ]) + `<p><a class="ck-link" href="/calculators/amortization#tp_l=${Math.round(b.loan)}&tp_z=${num('bu_z')}&tp_t=${num('bu_t')}">Tilgungsplan zu diesem Darlehen</a> · <a class="ck-link" href="/calculators/closing-costs/${val('bu_land')}">Nebenkosten im Detail</a></p>`;
  });
}

// Rechner-Ergebnis als Objekt ins Konto übernehmen (Übergabe über localStorage, Übernahme im Konto nach Bestätigung).
const PENDING = 'lr-pending-object';
function objFrom({ name, price, rent, area = 0, land, brokerPct = 0, equity = 0, ratePct = 0, repaymentPct = 0, nonRecoverable = 0, maintenance = 0, vacancyPct = 0, extra = {} }) {
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk) return null;
  return { name, price, rent, area, equity, interestPct: ratePct, repaymentPct, nonRecoverable: Math.round(nonRecoverable * 100) / 100, maintenance: Math.round(maintenance * 100) / 100, vacancyPct,
    loan: Math.max(0, Math.round(nk.allIn - equity)), purchaseCostPct: nk.totalPct, grestPct: GREST[land].pct, notaryPct: 2, brokerPct, ...extra };
}
function saveButton(card, label, build) {
  if (!card) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-dark save-obj'; b.textContent = label;
  const note = document.createElement('span'); note.className = 'form-note'; note.setAttribute('role', 'status');
  b.onclick = () => {
    const o = build();
    if (!o || !(o.price > 0)) { note.textContent = ' Bitte zuerst einen Kaufpreis eintragen.'; return; }
    try { localStorage.setItem(PENDING, JSON.stringify({ ...o, source: location.pathname, at: Date.now() })); } catch { note.textContent = ' Speichern im Browser nicht möglich.'; return; }
    location.href = '/app/dashboard';
  };
  const p = document.createElement('p'); p.className = 'save-row'; p.append(b, note); card.append(p);
}

// Deal-Scorecard
if ($('sc_overall')) {
  const ids = ['sc_n', 'sc_p', 'sc_o', 'sc_e', 'sc_z', 'sc_t', 'sc_land', 'sc_b', 'sc_k', 'sc_m', 'sc_a', 'sc_i', 'sc_u', 'sc_v', 'sc_b2'];
  remember('scorecard', ids);
  const L = { ok: 'Freigegeben', warn: 'In Prüfung', bad: 'Kritisch', na: 'Ungeprüft' };
  const badge = (st) => `<span class="st ${st}">${L[st]}</span>`;
  const opt = (id) => ($(id)?.value === '' ? '' : num(id));
  watch(ids, () => {
    const s = scorecard({ netIncome: opt('sc_n'), householdSize: num('sc_p'), otherObligations: num('sc_o'), equity: opt('sc_e'), ratePct: num('sc_z'), repaymentPct: num('sc_t'),
      land: val('sc_land'), brokerPct: num('sc_b'), price: opt('sc_k'), rent: opt('sc_m'), area: opt('sc_a'), maintenanceQm: num('sc_i'), nonRecoverable: num('sc_u'),
      vergleichsmieteQm: opt('sc_v'), mietpreisbremse: chk('sc_b2') });
    const h = s.haushalt, e = s.eigenkapital, o = s.objekt;
    $('sc_h').innerHTML = `<p>${badge(h.status)}</p>` + (h.status === 'na' ? `<p class="form-note">${h.lines[0]}</p>` : table([
      ['Lebenshaltungspauschale', E(h.living)], ['Monatsrate', E(h.rate)], ['Überschuss nach Rate und Objektkosten', `<strong>${E(h.surplus)}</strong>`]]));
    $('sc_e_out').innerHTML = `<p>${badge(e.status)}</p>` + (e.status === 'na' ? `<p class="form-note">${e.lines[0]}</p>` : table([
      ['Kaufnebenkosten', E(e.nebenkosten)], ['Reserve (3 Monatsausgaben)', E(e.reserve)], ['Zielwert Eigenkapital', `<strong>${E(e.target)}</strong>`], ['Darlehen', E(s.loan)]]));
    $('sc_ob').innerHTML = `<p>${badge(o.status)}</p>` + (o.status === 'na' ? `<p class="form-note">${o.lines[0]}</p>` : table([
      ['Bruttomietrendite', P(o.yieldPct)], ['Kaufpreisfaktor', String(o.factor).replace('.', ',')], ['Instandhaltung', `${String(num('sc_i')).replace('.', ',')} €/m²${num('sc_i') < 1 ? ' ' + flag(false, '', 'unter 1,00 €/m²') : ''}`],
      ['Grenze Mietpreisbremse', o.cap == null ? '–' : `${E(o.cap)}${num('sc_m') > o.cap ? ' ' + flag(false, '', 'Miete liegt darüber') : ''}`]]));
    const t = { ok: 'Alle drei Bereiche im grünen Bereich.', warn: 'Mindestens ein Bereich braucht Aufmerksamkeit.', bad: 'Mindestens ein Bereich ist kritisch.', na: 'Noch nicht alle Bereiche prüfbar – bitte Angaben ergänzen.' };
    $('sc_overall').className = `sc-overall ${s.overall}`;
    $('sc_overall').innerHTML = `<strong>Gesamt: ${L[s.overall]}</strong> ${t[s.overall]}`;
  });
  saveButton($('sc_ob')?.closest('.dash-card'), 'Als Objekt im Konto speichern', () => objFrom({ name: 'Objekt aus Deal-Scorecard', price: num('sc_k'), rent: num('sc_m'), area: num('sc_a'), land: val('sc_land'), brokerPct: num('sc_b'), equity: num('sc_e'),
    ratePct: num('sc_z'), repaymentPct: num('sc_t'), nonRecoverable: num('sc_u'), maintenance: num('sc_i') * num('sc_a'), extra: { vergleichsmieteQm: num('sc_v'), mietpreisbremse: chk('sc_b2') } }));
}

// Cashflow vor und nach Steuern
if ($('cf_out')) {
  const ids = ['cf_p', 'cf_land', 'cf_b', 'cf_r', 'cf_v', 'cf_n', 'cf_m', 'cf_g', 'cf_e', 'cf_z', 'cf_t', 'cf_s', 'cf_a', 'cf_x'];
  remember('cashflow', ids);
  watch(ids, () => {
    const c = cashflowSteuer({ price: num('cf_p'), land: val('cf_land'), brokerPct: num('cf_b'), rent: num('cf_r'), vacancyPct: num('cf_v'), nonRecoverable: num('cf_n'), maintenance: num('cf_m'),
      rentGrowthPct: num('cf_g'), equity: num('cf_e'), ratePa: num('cf_z') / 100, repaymentPa: num('cf_t') / 100, buildingSharePct: num('cf_s'), afaPct: num('cf_a'), taxPct: num('cf_x'), years: 10 });
    if (!c) { $('cf_out').innerHTML = '<p class="form-note">Bitte Kaufpreis und Miete eintragen.</p>'; $('cf_tab').innerHTML = ''; return; }
    const y = c.rows[0], sign = (v) => `<span class="${v < 0 ? 'neg' : 'pos'}">${E(v)}</span>`;
    $('cf_out').innerHTML = table([
      ['Darlehen', E(c.loan)], ['Monatsrate', E(c.monthlyRate)], ['AfA pro Jahr', E(c.afa)],
      ['Cashflow vor Steuern (Jahr 1, pro Monat)', `<strong>${sign(y.before / 12)}</strong>`],
      ['Steuerliches Ergebnis (Jahr 1)', `${E(y.taxable)} ${y.taxable < 0 ? '<span class="form-note">(Verlust mindert die Steuer auf andere Einkünfte)</span>' : ''}`],
      [y.tax < 0 ? 'Steuererstattung (Jahr 1)' : 'Steuerlast (Jahr 1)', E(Math.abs(y.tax))],
      ['Cashflow nach Steuern (Jahr 1, pro Monat)', `<strong>${sign(y.after / 12)}</strong>`],
      ['Vermögensaufbau durch Tilgung (Jahr 1)', E(y.principal)],
    ]);
    $('cf_tab').innerHTML = table(c.rows.map((r) => [r.year, E(r.rent), E(r.interest), E(r.afa), E(r.taxable), E(-r.tax), sign(r.before), sign(r.after), E(r.balance)]),
      ['Jahr', 'Miete', 'Zinsen', 'AfA', 'Steuerl. Ergebnis', 'Steuereffekt', 'CF vor St.', 'CF nach St.', 'Restschuld']) +
      `<p class="form-note">Summe 10 Jahre: Cashflow nach Steuern ${E(c.total.after)}, Tilgung ${E(c.total.principal)}.</p>`;
  });
  saveButton($('cf_tab')?.closest('.dash-card'), 'Als Objekt im Konto speichern', () => objFrom({ name: 'Objekt aus Cashflow-Rechner', price: num('cf_p'), rent: num('cf_r'), land: val('cf_land'), brokerPct: num('cf_b'), equity: num('cf_e'),
    ratePct: num('cf_z'), repaymentPct: num('cf_t'), nonRecoverable: num('cf_n'), maintenance: num('cf_m'), vacancyPct: num('cf_v'), extra: { buildingSharePct: num('cf_s'), marginalTaxPct: num('cf_x') } }));
}

// Angebotsvergleich
if ($('vg_out')) {
  const shared = ['vg_land', 'vg_b', 'vg_e', 'vg_z', 'vg_t', 'vg_v'];
  const per = [1, 2, 3].flatMap((k) => ['name', 'p', 'r', 'a', 'n'].map((f) => `vg${k}_${f}`));
  remember('vergleich', [...shared, ...per]);
  watch([...shared, ...per], () => {
    const res = [1, 2, 3].map((k) => {
      if (!(num(`vg${k}_p`) > 0)) return null;
      const a = angebot({ price: num(`vg${k}_p`), rent: num(`vg${k}_r`), area: num(`vg${k}_a`), land: val('vg_land'), brokerPct: num('vg_b'), equity: num('vg_e'),
        ratePa: num('vg_z') / 100, repaymentPa: num('vg_t') / 100, nonRecoverable: num(`vg${k}_n`), vacancyPct: num('vg_v') });
      return a && { ...a, name: val(`vg${k}_name`) || `Angebot ${k}` };
    }).filter(Boolean);
    if (!res.length) { $('vg_out').innerHTML = '<p class="form-note">Mindestens einen Kaufpreis eintragen.</p>'; return; }
    const best = (k, hi = true) => { const v = res.map((r) => r[k]).filter((x) => x != null); return v.length > 1 ? (hi ? Math.max(...v) : Math.min(...v)) : null; };
    const row = (label, k, fmt, hi) => { const b = best(k, hi); return [label, ...res.map((r) => (r[k] == null ? '–' : r[k] === b ? `<strong>${fmt(r[k])}</strong>` : fmt(r[k])))]; };
    const dn = (v) => String(v).replace('.', ',');
    $('vg_out').innerHTML = table([
      row('Kaufnebenkosten', 'nebenkosten', E, false), row('Gesamtkosten', 'allIn', E, false), row('Darlehen', 'loan', E, false), row('Monatsrate', 'rate', E, false),
      row('Cashflow vor Steuern / Monat', 'cashflow', E, true), row('Bruttomietrendite', 'grossYieldPct', (v) => P(v), true), row('Nettomietrendite (auf Gesamtkosten)', 'netYieldPct', (v) => P(v), true),
      row('Kaufpreisfaktor', 'factor', dn, false), row('Preis pro m²', 'pricePerQm', E, false), row('Miete pro m²', 'rentPerQm', E, true), row('DSCR', 'dscr', dn, true),
    ], ['', ...res.map((r) => esc(r.name))]) + '<p class="form-note">Fett: jeweils bester Wert. Ein einzelner Wert entscheidet nicht – Lage, Zustand und WEG-Unterlagen zählen mit.</p>';
  });
  [1, 2, 3].forEach((k) => saveButton(document.getElementById(`vg${k}_n`)?.closest('.vg-col'), `Angebot ${k} ins Konto`, () => num(`vg${k}_p`) > 0 && objFrom({ name: val(`vg${k}_name`) || `Angebot ${k}`, price: num(`vg${k}_p`), rent: num(`vg${k}_r`), area: num(`vg${k}_a`),
    land: val('vg_land'), brokerPct: num('vg_b'), equity: num('vg_e'), ratePct: num('vg_z'), repaymentPct: num('vg_t'), nonRecoverable: num(`vg${k}_n`), vacancyPct: num('vg_v') })));
}

// Kaufen oder mieten
if ($('km_out')) {
  const ids = ['km_p', 'km_land', 'km_b', 'km_e', 'km_z', 'km_t', 'km_o', 'km_r', 'km_g', 'km_w', 'km_i', 'km_y'];
  remember('kaufenmieten', ids);
  watch(ids, () => {
    const k = kaufenMieten({ price: num('km_p'), land: val('km_land'), brokerPct: num('km_b'), equity: num('km_e'), ratePa: num('km_z') / 100, repaymentPa: num('km_t') / 100,
      ownerCosts: num('km_o'), rent: num('km_r'), rentGrowthPct: num('km_g'), valueGrowthPct: num('km_w'), investPct: num('km_i'), years: Math.min(40, Math.max(1, Math.round(num('km_y')))) });
    if (!k) { $('km_out').innerHTML = '<p class="form-note">Bitte Kaufpreis und Miete eintragen.</p>'; return; }
    const pick = k.rows.filter((r) => r.year === 1 || r.year % 5 === 0 || r.year === k.rows.length);
    const e = k.end, diff = e.buyer - e.renter;
    $('km_out').innerHTML = `<p><strong>Nach ${e.year} Jahren: ${diff >= 0 ? 'Kaufen' : 'Mieten'} liegt um ${E(Math.abs(diff))} vorn.</strong> ${k.breakEven ? `Der Kauf holt den Mieter nach ${k.breakEven} Jahren ein.` : 'Im gewählten Zeitraum holt der Kauf den Mieter nicht ein.'}</p>` +
      table(pick.map((r) => [r.year, E(r.rent), E(r.value), E(r.debt), `<strong>${E(r.buyer)}</strong>`, `<strong>${E(r.renter)}</strong>`]), ['Jahr', 'Miete/Monat', 'Immobilienwert', 'Restschuld', 'Vermögen Käufer', 'Vermögen Mieter']) +
      `<p class="form-note">Monatsrate ${E(k.rate)} plus Eigentümerkosten; Kaufnebenkosten ${E(k.nebenkosten)} sind beim Kauf sofort „verbraucht“.</p>`;
  });
}

// AfA-Plan
if ($('ap_out')) {
  const ids = ['ap_k', 'ap_m', 'ap_p', 'ap_y', 'ap_s', 'ap_a', 'ap_b'];
  remember('afa', ids);
  watch(ids, () => {
    $('ap_p').disabled = val('ap_m') === 'degressiv';
    const a = afaPlan({ ak: num('ap_k'), method: val('ap_m'), linearPct: Number(val('ap_p')), years: Math.min(50, Math.max(1, Math.round(num('ap_y')))), sonder: chk('ap_s'), area: num('ap_a'), baukostenQm: num('ap_b') });
    if (!a) { $('ap_out').innerHTML = '<p class="form-note">Bitte die Gebäudekosten eintragen.</p>'; return; }
    const note = a.s7b ? (a.s7b.eligible ? `<p class="form-note">Sonder-AfA: Bemessungsgrundlage ${E(a.s7b.base)} (höchstens 4.000 €/m²), je Jahr ${E(a.s7b.base * 0.05)}.</p>` : `<p>${flag(false, '', 'Keine Sonder-AfA: Baukosten über 5.200 €/m² oder nicht angegeben')}</p>`) : '';
    $('ap_out').innerHTML = note + table(a.rows.map((r) => [r.year, E(r.regular), r.extra ? E(r.extra) : '–', `<strong>${E(r.total)}</strong>`, E(r.rest)]), ['Jahr', 'Reguläre AfA', 'Sonder-AfA', 'Summe', 'Restwert']) +
      `<p class="form-note">Summe ${a.rows.length} Jahre: ${E(a.total)}${a.extra ? ` (davon Sonder-AfA ${E(a.extra)})` : ''}. Steuerwirkung ≈ Summe × Grenzsteuersatz – siehe <a class="ck-link" href="/calculators/cash-flow">Cashflow nach Steuern</a>.</p>`;
  });
}

// Mieterhöhung mit Briefentwurf
if ($('mh_out')) {
  const ids = ['mh_r', 'mh_a', 'mh_v', 'mh_3', 'mh_c', 'mh_l', 'mh_s'];
  remember('mieterhoehung', ids);
  watch(ids, () => {
    const m = mieterhoehung({ rent: num('mh_r'), area: num('mh_a'), vergleichQm: num('mh_v'), rent3y: num('mh_3'), capPct: Number(val('mh_c')), lastChange: val('mh_l'), sendDate: val('mh_s') });
    if (!m) { $('mh_out').innerHTML = '<p class="form-note">Bitte Miete, Fläche und Vergleichsmiete eintragen.</p>'; $('mh_letter').value = ''; return; }
    $('mh_out').innerHTML = table([
      ['Grenze ortsübliche Vergleichsmiete', E(m.byMarket)], [`Grenze Kappung (${val('mh_c')} % auf die Miete vor drei Jahren)`, E(m.byCap)],
      ['Zulässige neue Nettokaltmiete', `<strong>${E(m.max)}</strong> <span class="form-note">(begrenzt durch ${m.limitedBy === 'kappung' ? 'Kappungsgrenze' : 'Vergleichsmiete'})</span>`],
      ['Erhöhung pro Monat', E(m.increase)],
      ['Verlangen frühestens (§ 558 Abs. 1 S. 2 BGB)', m.earliestRequest ? D(m.earliestRequest) : 'Datum der letzten Erhöhung eintragen'],
      ['Neue Miete ab (§ 558b Abs. 1 BGB)', m.effective ? `<strong>${D(m.effective)}</strong>` : '–'],
      ['Zustimmungsfrist des Mieters', 'bis Ende des zweiten Kalendermonats nach Zugang'],
    ]);
    const neu = E(m.max), qm = (m.max / num('mh_a')).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    $('mh_letter').value = `[Name und Anschrift Vermieter]

[Name und Anschrift aller Mieter]

[Ort], [Datum]

Mieterhöhungsverlangen gemäß § 558 BGB – Wohnung [Adresse, Lage im Haus]

Sehr geehrte/r [Name],

die Nettokaltmiete für die oben genannte Wohnung (${String(num('mh_a')).replace('.', ',')} m²) beträgt derzeit ${E(num('mh_r'))} monatlich${val('mh_l') ? ` und ist seit dem ${D(val('mh_l'))} unverändert` : ''}.

Ich bitte Sie, einer Erhöhung der Nettokaltmiete auf ${neu} monatlich (${qm} €/m²) mit Wirkung ab ${m.effective ? D(m.effective) : '[Datum]'} zuzustimmen. Die Betriebskostenvorauszahlung bleibt unverändert.

Begründung: Die ortsübliche Vergleichsmiete für vergleichbaren Wohnraum beträgt nach dem [Mietspiegel der Stadt …, Stand …, Tabellenfeld …] ${num('mh_v').toLocaleString('de-DE', { minimumFractionDigits: 2 })} €/m². Die Kappungsgrenze von ${val('mh_c')} % innerhalb von drei Jahren ist eingehalten.

Bitte erteilen Sie Ihre Zustimmung bis zum Ablauf des zweiten Kalendermonats nach Zugang dieses Schreibens.

Mit freundlichen Grüßen

[Unterschrift / Name]`;
  });
  $('mh_copy').onclick = async () => { try { await navigator.clipboard.writeText($('mh_letter').value); $('mh_note').textContent = 'Kopiert.'; } catch { $('mh_letter').select(); $('mh_note').textContent = 'Text markiert – mit Strg+C kopieren.'; } };
}

// Seitensuche über Werkzeuge, Antworten und Begriffe (Index aus routes.js / content.js).
if ($('sres') && window.__IA_IDX) {
  const IDX = window.__IA_IDX;
  const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss');
  const pre = IDX.map((e) => ({ e, t: norm(e.t), d: norm(e.d), x: norm(e.x || '') }));
  const run = () => {
    const q = norm($('sq').value.trim());
    const words = q.split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) { $('sres').innerHTML = ''; $('scount').textContent = `${IDX.length} Einträge durchsuchbar.`; return; }
    const hits = pre.map((r) => {
      let sc = 0;
      for (const w of words) { const a = r.t.includes(w) ? 5 : 0, b = r.d.includes(w) ? 2 : 0, c = r.x.includes(w) ? 1 : 0; if (!a && !b && !c) return null; sc += a + b + c; }
      if (r.t.startsWith(words[0])) sc += 3;
      return { ...r.e, sc };
    }).filter(Boolean).sort((a, b) => b.sc - a.sc).slice(0, 30);
    $('scount').textContent = hits.length ? `${hits.length} Treffer` : 'Keine Treffer. Andere Schreibweise versuchen oder die Wissenszentrale durchstöbern.';
    const mark = (t) => { let h = esc(t); for (const w of words) h = h.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'); return h; };
    $('sres').innerHTML = hits.map((h) => `<a class="s-hit" href="${h.u}"><span class="st na">${h.k}</span><strong>${mark(h.t)}</strong><span>${mark(h.d.length > 180 ? h.d.slice(0, h.d.lastIndexOf(' ', 177)) + ' …' : h.d)}</span></a>`).join('');
  };
  const q0 = new URLSearchParams(location.search).get('q');
  if (q0) $('sq').value = q0;
  $('sq').addEventListener('input', () => { history.replaceState(null, '', $('sq').value ? `/search?q=${encodeURIComponent($('sq').value)}` : '/search'); run(); });
  run();
  if (!q0) $('sq').focus();
}

// Leistungsvergleich der Tarife als Tabelle (Spalte hl hervorgehoben).
const cmpTable = (v, hl = -1) => (v?.zeilen?.length ? `<details class="cmp" open><summary>Tarife im Vergleich</summary><div class="cmp-wrap"><table class="cmp-table"><thead><tr><th></th>${v.spalten.map((s, i) => `<th${i === hl ? ' class="hl"' : ''}>${esc(s)}</th>`).join('')}</tr></thead><tbody>${v.zeilen.map(([l, ...c]) => `<tr><th scope="row">${esc(l)}</th>${c.map((x, i) => `<td class="${x === '✓' ? 'y' : x === '–' ? 'n' : ''}${i === hl ? ' hl' : ''}">${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>` : '');
// Öffentliche Angebotsseite aus der zentralen Preisliste
if ($('pubOffers')) {
  // Robust laden: bis zu 3 Versuche; schlägt alles fehl, bleibt die vorgerenderte Preisliste stehen.
  const loadP = async (n = 0) => { try { const r = await fetch('/data/preise.json', { cache: n ? 'reload' : 'default' }); if (!r.ok) throw new Error(r.status); return await r.json(); } catch (e) { if (n < 2) { await new Promise((ok) => setTimeout(ok, 600 * (n + 1))); return loadP(n + 1); } throw e; } };
  const hadPre = !!document.querySelector('#pubOffers .offer');
  loadP().then(async (P) => {
    const eur = (c) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    const draw = () => {
      const m = P.privat;
      $('pubOffers').innerHTML = `<p class="form-note">${esc(m.zielgruppe)}</p>
        <div class="offers">${m.plans.map((p, i) => `<div class="offer${p.highlight ? ' rec' : ''}">${p.badge ? `<span class="${p.highlight ? 'offer-rec' : 'offer-badge'}">${esc(p.badge)}</span>` : ''}<div class="offer-top">${PIC(p.id)}<h4>${esc(p.name)}</h4></div>${p.fuer ? `<p class="offer-for">${esc(p.fuer)}</p>` : ''}<div class="offer-price">${eur(p.cents)} <small>${esc(p.intervall)}</small></div><ul>${p.basis ? `<li class="offer-basis">${esc(p.basis)}</li>` : ''}${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul><a class="btn btn-pay offer-buy" href="/app/dashboard?buy=${p.id}#angebot" data-offer="${i}">Jetzt buchen</a></div>`).join('')}</div>
        <div class="offer-free"><strong>Immer kostenlos:</strong> ${P.kostenlos.features.map(esc).join(' · ')}</div>
        ${m.demo ? `<p class="offer-demo">${esc(m.demo)}</p>` : ''}
        ${cmpTable(m.vergleich)}
        <div class="offer-guar"><strong>Bank-Akzeptanz-Garantie für die Kreditmappe:</strong> Lehnt Ihre finanzierende Bank das Format der Mappe ab, erstatten wir den vollen Kaufpreis. Melden Sie sich dazu innerhalb von 60 Tagen nach dem Kauf per E-Mail mit dem Namen der Bank. Die Garantie betrifft das Format der Mappe, nicht die Kreditentscheidung der Bank. Einzelheiten: <a class="ck-link" href="/terms#garantie">AGB Nr. 4a</a>.</div>
        <p class="form-note">Für Makler, Finanzierungsvermittler und Banken gibt es eigene Tarife (netto, mit Widget, Anfragen und Team): <a class="ck-link" href="/business">Angebot für Unternehmen</a>.</p>
        <p class="form-note">${esc(P.hinweis)} Widerrufsbelehrung: <a class="ck-link" href="/terms">AGB</a>. Kündigung: <a class="ck-link" href="/cancel">Verträge hier kündigen</a>.</p>`;
      document.querySelectorAll('#pubOffers [data-offer]').forEach((a) => a.onclick = async (e) => {
        e.preventDefault();
        const { openBuy } = await import('./buy.mjs?v=892f3666');
        openBuy(m.plans[+a.dataset.offer]);
      });
    };
    // Symbole sind Zierde: Lädt das Kaufmodul nicht (Funkloch, Werbeblocker, Update), erscheinen die Preise trotzdem.
    const PIC = await import('./buy.mjs?v=892f3666').then((x) => x.planIcon).catch(() => () => '');
    try { draw(); } catch (e) { console.warn('[preise]', e); throw e; }
  }).catch(() => {
    if (hadPre) { // vorgerenderte Angebote behalten; Kaufknöpfe führen dann über den normalen Link
      return;
    }
    $('pubOffers').innerHTML = '<p class="form-note">Die Preise werden gerade aktualisiert. <button type="button" class="btn btn-ghost" id="pubRetry">Erneut laden</button></p>';
    $('pubRetry')?.addEventListener('click', () => location.reload());
  });
}

// Glossar-Suche
if ($('gl_q')) {
  const items = [...document.querySelectorAll('.gl-item')];
  const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  $('gl_q').addEventListener('input', () => {
    const q = norm($('gl_q').value.trim());
    let n = 0;
    items.forEach((it) => { const hit = !q || norm(it.textContent).includes(q); it.hidden = !hit; if (hit) n++; });
    $('gl_none').hidden = n > 0;
  });
}

// Erklär-Hinweise (Tooltips): Klick oder Tastatur öffnet, Escape oder Klick daneben schließt.
document.addEventListener('click', (e) => {
  const b = e.target.closest('.tip');
  document.querySelectorAll('.tip[aria-expanded="true"]').forEach((x) => { if (x !== b) { x.setAttribute('aria-expanded', 'false'); x.nextElementSibling.hidden = true; } });
  if (b) { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); b.nextElementSibling.hidden = !open; }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.tip[aria-expanded="true"]').forEach((x) => { x.setAttribute('aria-expanded', 'false'); x.nextElementSibling.hidden = true; }); });

// Einstieg „Meine erste Immobilie“
if ($('ez_out')) {
  const form = $('wz');
  form.classList.add('js');
  const show = (n) => {
    form.querySelectorAll('fieldset').forEach((f) => { f.hidden = f.dataset.step !== String(n); });
    document.querySelectorAll('.steps li').forEach((li) => li.classList.toggle('on', Number(li.dataset.step) <= n));
    form.querySelector(`fieldset[data-step="${n}"] input, fieldset[data-step="${n}"] select`)?.focus({ preventScroll: true });
  };
  form.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => show(Number(b.dataset.next))));
  show(1);
  const ids = ['ez_p', 'ez_l', 'ez_m', 'ez_r', 'ez_c', 'ez_e', 'ez_s', 'ez_i', 'ez_t', 'ez_g'];
  remember('einstieg', ids);
  watch(ids, () => {
    const e = einstieg({ price: num('ez_p'), rent: num('ez_r'), equity: num('ez_e'), land: val('ez_l'), ratePa: num('ez_i') / 100, repaymentPa: num('ez_t') / 100, brokerPct: num('ez_m'), costSharePct: num('ez_c'), reserve: num('ez_s'), growthPa: num('ez_g') / 100 });
    if (!e) { $('ez_out').innerHTML = '<p class="form-note">Bitte einen Kaufpreis eintragen.</p>'; return; }
    const card = (h, big, txt, tone = '') => `<div class="ez-card ${tone ? 'ez-' + tone : ''}"><h3>${h}</h3><p class="ez-big">${big}</p><p>${txt}</p></div>`;
    $('ez_out').innerHTML = `<div class="ez-grid">`
      + card('Darlehen und Rate', E(e.rate) + ' / Monat', `Darlehen ${E(e.loan)} bei Kaufnebenkosten von ${E(e.nk.total)} (${P(e.nk.totalPct)}).${e.equityCoversCosts ? '' : ' <strong>Ihr Eigenkapital deckt die Nebenkosten nicht</strong> – das verteuert die Finanzierung deutlich.'}`, e.equityCoversCosts ? '' : 'warn')
      + card('Ihr Tilgungshebel', E(e.firstPrincipal) + ' / Monat', `So viel Darlehen zahlen Sie schon im ersten Monat zurück – Vermögen, das Sie aufbauen. Die Miete deckt ${e.rentCoversPct === null ? '–' : P(e.rentCoversPct, 1)} der Rate.`)
      + card('Monatlicher Cashflow', (e.cashflow >= 0 ? '+' : '') + E(e.cashflow), e.cashflow >= 0 ? 'Die Wohnung trägt sich vor Steuern selbst.' : `Sie zahlen monatlich ${E(-e.cashflow)} zu (vor Steuern; die Steuerwirkung kann einen Teil ausgleichen).`, e.cashflow >= 0 ? 'ok' : 'warn')
      + card('Sicherheitsnetz', e.reserveMonths === null ? '–' : `${e.reserveMonths} Monate`, `So lange trägt Ihr Notgroschen Rate und Kosten (${E(e.vacantBurden)} pro Monat), falls die Miete ausfällt.`, e.reserveMonths !== null && e.reserveMonths < 6 ? 'warn' : 'ok')
      + card('In zehn Jahren', E(e.repaid10) + ' getilgt', `Restschuld dann ${E(e.rest10)}. Bei ${P(num('ez_g'), 1)} Wertentwicklung pro Jahr: Immobilie ${E(e.value10)}, Ihr Anteil ${E(e.netWorth10)}. Nach zehn Jahren ist ein Verkaufsgewinn steuerfrei (§ 23 EStG).`)
      + `</div><p class="obj-actions"><a class="btn btn-dark" href="/auth/register">Objekt speichern und Kreditmappe vorbereiten</a><a class="btn btn-ghost" href="/scenarios">Anschlusszins prüfen</a></p>`;
  });
}
