// Werkzeuge für Privatkunden (Ansicht „Werkzeuge“). Alles rechnet im Browser; Eingaben bleiben in diesem Browser.
// Käufer-Pass: Angebotsvergleich der Bankangebote, Bankgespräch-Vorbereitung.
// Investor Pro: zusätzlich Anschlussfinanzierung mit Forward-Aufschlag und Kündigungsrecht nach § 489 BGB.
// Die Freischaltung im Browser ist eine Komfortfunktion; die Rechenwege sind offen dokumentiert.
import { monthlyRate, balanceAfterMonths, tilgungsplan, kaufnebenkosten, GREST } from './calc.mjs';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const E2 = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const P = (v, d = 2) => `${(Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
const num = (v) => { let t = String(v ?? '').trim(); if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const x = Number(t); return Number.isFinite(x) ? x : 0; };
const store = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem('ia-tool-' + k) || 'null'); localStorage.setItem('ia-tool-' + k, JSON.stringify(v)); } catch { /* ohne Speicher */ } return null; };

// ---------- Rechenkern (exportiert für Tests) ----------
// Bankangebote vergleichen: Kosten während der Zinsbindung (Zinsen + Gebühren) und Restschuld am Ende.
export function compareOffers(list) {
  const rows = list.filter((o) => o.loan > 0 && o.rate > 0 && o.repay > 0 && o.years > 0).map((o) => {
    const months = Math.round(o.years * 12);
    const pay = monthlyRate(o.loan, o.rate / 100, o.repay / 100);
    const rest = balanceAfterMonths(o.loan, o.rate / 100, o.repay / 100, months);
    const interest = pay * months - (o.loan - rest);
    const cost = interest + (o.fees || 0);
    return { ...o, pay, rest, interest, cost, months };
  });
  if (!rows.length) return { rows, best: null, sameYears: true };
  const sameYears = rows.every((r) => r.years === rows[0].years);
  // Vergleichbar machen: Kosten + Restschuld (was Sie bis zum Ende der Zinsbindung zahlen und danach noch schulden),
  // bezogen auf gleiche Darlehenshöhe. Bei unterschiedlicher Zinsbindung nur eingeschränkt vergleichbar.
  rows.forEach((r) => { r.score = (r.cost + r.rest) / r.loan; });
  const best = rows.reduce((a, b) => (b.score < a.score ? b : a));
  return { rows, best, sameYears };
}

// Anschlussfinanzierung: Restschuld, Vorlauf, Forward-Zins und Vergleich mit Zins-Szenarien bei Ablauf.
export function forwardCalc({ rest, monthsToEnd, todayRate, surchargePerMonth, repay, freeMonths = 0 }) {
  const lead = Math.max(0, monthsToEnd - freeMonths);
  const fwdRate = todayRate + surchargePerMonth * lead;
  const pay = (r) => monthlyRate(rest, r / 100, repay / 100);
  const scen = [-1, 0, 1, 2].map((d) => ({ d, rate: todayRate + d, pay: pay(Math.max(0, todayRate + d)) }));
  return { lead, fwdRate, fwdPay: pay(fwdRate), todayPay: pay(todayRate), scen, breakEven: fwdRate };
}

// § 489 Abs. 1 Nr. 2 BGB: Kündigung 10 Jahre nach vollständiger Auszahlung mit 6 Monaten Frist ohne Vorfälligkeitsentschädigung.
export function kuendigungsrecht489(payout) {
  if (!payout) return null;
  const d = new Date(payout);
  if (Number.isNaN(d.getTime())) return null;
  const from = new Date(d); from.setFullYear(from.getFullYear() + 10);
  const end = new Date(from); end.setMonth(end.getMonth() + 6);
  return { from, end };
}


// Höchster Kaufpreis, bei dem Ziel-Cashflow bzw. Ziel-Bruttorendite erreicht werden.
export function maxPrice({ rent, costPct, equity, rate, repay, nkPct, targetCf, targetYield }) {
  const costs = rent * costPct / 100;
  const ann = (rate + repay) / 100;
  const byCf = ann > 0 ? (((rent - costs - targetCf) * 12) / ann + equity) / (1 + nkPct / 100) : 0;
  const byYield = targetYield > 0 ? (rent * 12) / (targetYield / 100) : Infinity;
  return { byCf: Math.max(0, byCf), byYield, max: Math.max(0, Math.min(byCf, byYield)) };
}

// Betriebskostenabrechnung: Kosten nach Umlageschlüssel auf die Mietpartei verteilen, Vorauszahlungen abziehen.
export function betriebskosten({ rows, flaecheGesamt, flaecheMieter, personenGesamt, personenMieter, einheitenGesamt, monate = 12, vorauszahlung }) {
  const share = (k) => k === 'flaeche' ? (flaecheGesamt > 0 ? flaecheMieter / flaecheGesamt : 0) : k === 'personen' ? (personenGesamt > 0 ? personenMieter / personenGesamt : 0) : k === 'einheit' ? (einheitenGesamt > 0 ? 1 / einheitenGesamt : 0) : 1;
  const out = rows.filter((r) => r.betrag > 0).map((r) => ({ ...r, anteil: r.betrag * share(r.key) * (monate / 12) }));
  const summe = out.reduce((a, r) => a + r.anteil, 0);
  return { rows: out, summe, saldo: summe - vorauszahlung };
}

// ---------- Oberfläche ----------
// Dezenter Hinweis statt Werbeblock: Rechnen ist immer frei, nur Drucken/Kopieren gehört zum Tarif.
// Kontext für Hinweise: Ansicht (Einsteiger/Profi), Tarif und aktuelle Preise aus preise.json.
let CTX = { mode: 'einsteiger', tier: 'free', prices: { pass: '49 € einmalig', pro: '29 €/Monat' } };
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3Z"/></svg>';
// Welcher Tarif passt? Einsteiger kaufen meist einmalig (Käufer-Pass), Profis/Vermieter nutzen Investor Pro.
// Wer schon den Käufer-Pass hat, bekommt für Pro-Werkzeuge nur den Hinweis auf Investor Pro.
const lock = (need) => {
  const usePro = need === 'pro' || CTX.mode === 'profi' || CTX.tier === 'starter';
  return `<p class="tl-hint">${LOCK_SVG} Drucken und Vorlagen mit ${usePro ? `Investor Pro (${esc(CTX.prices.pro)})` : `Käufer-Pass (${esc(CTX.prices.pass)})`} · <a href="#angebot">ansehen</a></p>`;
};

function offersTool(box, ok) {
  const saved = store('offers') || [{ bank: 'Bank A', loan: 280000, rate: 3.65, eff: 3.72, repay: 2, years: 10, fees: 0, special: 5 }, { bank: 'Bank B', loan: 280000, rate: 3.55, eff: 3.68, repay: 2, years: 10, fees: 900, special: 0 }, { bank: '', loan: 280000, rate: 0, eff: 0, repay: 2, years: 10, fees: 0, special: 0 }];
  const F = [['bank', 'Bank / Anbieter', 'text'], ['loan', 'Darlehen (€)'], ['rate', 'Sollzins (%)'], ['eff', 'Effektivzins (%)'], ['repay', 'Tilgung (%)'], ['years', 'Zinsbindung (Jahre)'], ['fees', 'Gebühren (€)'], ['special', 'Sondertilgung p. a. (%)']];
  box.innerHTML = `<h3>Bankangebote vergleichen</h3><p class="form-note">Tragen Sie bis zu drei Angebote aus dem ESIS-Merkblatt (Europäisches Standardisiertes Merkblatt) ein. Verglichen wird, was Sie bis zum Ende der Zinsbindung zahlen und was danach noch an Schulden übrig ist.</p>
    <div class="tl-offers">${saved.map((o, i) => `<fieldset class="tl-off"><legend>Angebot ${i + 1}</legend>${F.map(([k, l, t]) => `<label>${l}<input data-o="${i}" data-k="${k}" ${t === 'text' ? 'type="text" maxlength="40"' : 'type="number" step="any" inputmode="decimal"'} value="${esc(o[k] ?? '')}"></label>`).join('')}</fieldset>`).join('')}</div>
    <div id="tlOffOut" aria-live="polite"></div>${ok ? '<p class="tl-act"><button type="button" class="btn btn-outline" id="tlOffPrint">Vergleich drucken / als PDF sichern</button></p>' : lock('pass')}`;
  const run = () => {
    const list = saved.map((o) => ({ ...o, loan: num(o.loan), rate: num(o.rate), eff: num(o.eff), repay: num(o.repay), years: num(o.years), fees: num(o.fees), special: num(o.special) }));
    const r = compareOffers(list);
    store('offers', saved);
    const out = $('tlOffOut');
    if (!r.rows.length) { out.innerHTML = '<p class="form-note">Bitte mindestens ein Angebot mit Darlehen, Sollzins, Tilgung und Zinsbindung eintragen.</p>'; return; }
    out.innerHTML = `<div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Angebot</th><th>Rate / Monat</th><th>Zinsen in der Bindung</th><th>Gebühren</th><th>Restschuld am Ende</th><th>Sondertilgung</th></tr></thead><tbody>${r.rows.map((x) => `<tr class="${x === r.best ? 'best' : ''}"><td><strong>${esc(x.bank || 'Angebot')}</strong><small>${P(x.rate)} soll · ${P(x.eff)} eff. · ${x.years} J.</small></td><td>${E2(x.pay)}</td><td>${E(x.interest)}</td><td>${E(x.fees)}</td><td>${E(x.rest)}</td><td>${x.special ? P(x.special, 0) : '–'}</td></tr>`).join('')}</tbody></table></div>
      <p class="tl-verdict">${r.best ? `<strong>Günstigstes Angebot nach Zinsen, Gebühren und Restschuld: ${esc(r.best.bank || 'Angebot')}.</strong>` : ''} ${r.sameYears ? '' : '<strong>Achtung:</strong> Die Zinsbindungen sind unterschiedlich lang – längere Bindung kostet meist etwas mehr, schützt aber länger vor steigenden Zinsen. '}Höhere Tilgung senkt die Restschuld, erhöht aber die Rate; vergleichen Sie bei gleicher Tilgung. Sondertilgungsrechte und Bereitstellungszinsen stehen im ESIS-Merkblatt.</p>`;
  };
  box.addEventListener('input', (e) => { const t = e.target; if (t.dataset.o == null) return; saved[+t.dataset.o][t.dataset.k] = t.type === 'text' ? t.value : t.value; run(); });
  $('tlOffPrint')?.addEventListener('click', () => printBox(box, 'Bankangebote im Vergleich'));
  run();
}

function bankTool(box, ok, d) {
  const p = d.profile || {};
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name);
  const st = store('bank') || {};
  const Q = [
    ['Konditionen', ['Wie hoch sind Soll- und Effektivzins – und für welche Zinsbindung?', 'Welche Sondertilgung ist kostenlos möglich (Prozent pro Jahr)?', 'Kann ich die Tilgung während der Laufzeit ändern (Tilgungssatzwechsel)?', 'Ab wann fallen Bereitstellungszinsen an und wie hoch sind sie?', 'Gibt es Gebühren (Schätzung, Bearbeitung, Teilauszahlung)?']],
    ['Prüfung durch die Bank', ['Welchen Beleihungswert setzen Sie für das Objekt an?', 'Wie hoch ist der Beleihungsauslauf und ab wann steigt der Zins?', 'Mit welchen Lebenshaltungskosten rechnen Sie in der Haushaltsrechnung?', 'Welche Unterlagen fehlen Ihnen noch?']],
    ['Nach der Zusage', ['Wie lange gilt das Angebot?', 'Wann muss die Grundschuld eingetragen sein?', 'Welche Auszahlungsvoraussetzungen gibt es?']],
  ];
  const facts = [
    ['Nettoeinkommen / Monat', p.netIncome ? E(num(p.netIncome)) : '–'],
    ['Eigenkapital', p.equity ? E(num(p.equity)) : '–'],
    ['Wunsch-Kaufpreis', p.targetPrice ? E(num(p.targetPrice)) : '–'],
    ['Objekte im Konto', String(objs.length)],
  ];
  box.innerHTML = `<h3>Bankgespräch vorbereiten</h3><p class="form-note">Ihre wichtigsten Zahlen auf einen Blick, die Fragen, die Sie stellen sollten, und Platz für die Antworten der Bank. Ausdrucken und mitnehmen.</p>
    <div class="tl-facts">${facts.map(([k, v]) => `<div><small>${k}</small><strong>${v}</strong></div>`).join('')}</div>
    <p class="form-note">Fehlt etwas? Ergänzen Sie es im Konto unter Finanzprofil. Die vollständige Haushaltsrechnung steht in Ihrer Kreditmappe.</p>
    ${Q.map(([h, qs], gi) => `<h4 class="tl-sub">${h}</h4><ol class="tl-q">${qs.map((q, qi) => { const k = gi + '_' + qi; return `<li><label><span>${q}</span><input type="text" data-b="${k}" maxlength="200" placeholder="Antwort der Bank" value="${esc(st[k] || '')}"></label></li>`; }).join('')}</ol>`).join('')}
    <label class="tl-notes">Eigene Notizen<textarea data-b="notes" rows="3" maxlength="2000">${esc(st.notes || '')}</textarea></label>
    ${ok ? '<p class="tl-act"><button type="button" class="btn btn-outline" id="tlBankPrint">Gesprächsbogen drucken / als PDF sichern</button><a class="btn btn-ghost" href="#objekte">Kreditmappe öffnen</a></p>' : lock('pass')}`;
  box.addEventListener('input', (e) => { const k = e.target.dataset.b; if (!k) return; st[k] = e.target.value; store('bank', st); });
  $('tlBankPrint')?.addEventListener('click', () => printBox(box, 'Bankgespräch – Vorbereitung'));
}

function forwardTool(box, ok, d) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name && num(o.loan) > 0);
  const st = store('fwd') || { rest: 180000, months: 30, today: 3.6, sur: 0.02, free: 0, repay: 2, payout: '' };
  box.innerHTML = `<h3>Anschlussfinanzierung &amp; Forward-Darlehen</h3><p class="form-note">Wann endet Ihre Zinsbindung, was kostet es, sich den heutigen Zins schon jetzt zu sichern – und ab welchem Zins bei Ablauf hätte sich das gelohnt?</p>
    ${objs.length ? `<label class="tl-pick">Aus Objekt übernehmen<select id="fwObj"><option value="">– wählen –</option>${objs.map((o, i) => `<option value="${i}">${esc(o.name)}</option>`).join('')}</select></label>` : ''}
    <div class="tl-grid">
      <label>Restschuld bei Ablauf (€)<input id="fw_rest" type="number" step="any" value="${st.rest}"></label>
      <label>Monate bis Ablauf<input id="fw_m" type="number" min="0" max="66" step="1" value="${st.months}"></label>
      <label>Heutiger Zins (%)<input id="fw_i" type="number" step="0.01" value="${st.today}"></label>
      <label>Forward-Aufschlag je Monat Vorlauf (%-Punkte)<input id="fw_s" type="number" step="0.005" value="${st.sur}"></label>
      <label>Aufschlagsfreie Monate<input id="fw_f" type="number" min="0" max="12" step="1" value="${st.free}"></label>
      <label>Tilgung danach (%)<input id="fw_t" type="number" step="0.1" value="${st.repay}"></label>
      <label>Vollständig ausgezahlt am (für § 489 BGB)<input id="fw_p" type="date" value="${esc(st.payout)}"></label>
    </div>
    <div id="fwOut" aria-live="polite"></div>
    <p class="form-note">Aufschläge sind Annahmen – fragen Sie die tatsächlichen Werte bei Bank oder Vermittler an. Keine Zinsprognose, keine Finanzierungsberatung.</p>
    ${ok ? '<p class="tl-act"><button type="button" class="btn btn-outline" id="fwPrint">Drucken / als PDF sichern</button></p>' : lock('pro')}`;
  const run = () => {
    const v = { rest: num($('fw_rest').value), months: num($('fw_m').value), today: num($('fw_i').value), sur: num($('fw_s').value), free: num($('fw_f').value), repay: num($('fw_t').value), payout: $('fw_p').value };
    store('fwd', v);
    const out = $('fwOut');
    if (!(v.rest > 0) || !(v.repay > 0)) { out.innerHTML = '<p class="form-note">Bitte Restschuld und Tilgung eintragen.</p>'; return; }
    const r = forwardCalc({ rest: v.rest, monthsToEnd: v.months, todayRate: v.today, surchargePerMonth: v.sur, repay: v.repay, freeMonths: v.free });
    const k = kuendigungsrecht489(v.payout);
    out.innerHTML = `<div class="tl-facts"><div><small>Forward-Zins</small><strong>${P(r.fwdRate)}</strong><span>${r.lead} Monate Vorlauf × ${P(v.sur, 3).replace(' %', '')} Pkt.</span></div><div><small>Rate mit Forward</small><strong>${E2(r.fwdPay)}</strong></div><div><small>Rate zum heutigen Zins</small><strong>${E2(r.todayPay)}</strong></div></div>
      <div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Zins bei Ablauf</th><th>Rate</th><th>Forward günstiger?</th></tr></thead><tbody>${r.scen.map((s) => `<tr><td>${P(s.rate)} (${s.d > 0 ? '+' : ''}${s.d} Pkt.)</td><td>${E2(s.pay)}</td><td>${s.rate > r.fwdRate ? `ja, ${E2(s.pay - r.fwdPay)} / Monat` : 'nein'}</td></tr>`).join('')}</tbody></table></div>
      <p class="tl-verdict"><strong>Der Forward lohnt sich, wenn der Zins bei Ablauf über ${P(r.breakEven)} liegt.</strong> Er ist eine Absicherung gegen steigende Zinsen – fallen sie, zahlen Sie mehr als nötig. Ein Forward ist bindend: Wer ihn nicht abnimmt, muss meist eine Nichtabnahmeentschädigung zahlen.</p>
      ${k ? `<p class="tl-verdict"><strong>Kündigungsrecht nach § 489 BGB:</strong> Ab ${k.from.toLocaleDateString('de-DE')} (10 Jahre nach vollständiger Auszahlung) können Sie mit 6 Monaten Frist ohne Vorfälligkeitsentschädigung kündigen – frühestes Ende also ${k.end.toLocaleDateString('de-DE')}. Das gilt auch bei längerer Zinsbindung.</p>` : ''}`;
  };
  box.addEventListener('input', run);
  $('fwObj')?.addEventListener('change', (e) => {
    const o = objs[+e.target.value]; if (!o) return;
    const years = num(o.fixedYears) || 10;
    const rest = balanceAfterMonths(num(o.loan), num(o.interestPct || 3.5) / 100, num(o.repaymentPct || 2) / 100, years * 12);
    $('fw_rest').value = Math.round(rest);
    if (o.payoutDate) { const end = new Date(o.payoutDate); end.setMonth(end.getMonth() + years * 12); const m = Math.max(0, Math.round((end - Date.now()) / 2629800000)); $('fw_m').value = m; $('fw_p').value = o.payoutDate; }
    run();
  });
  $('fwPrint')?.addEventListener('click', () => printBox(box, 'Anschlussfinanzierung'));
  run();
}


function priceTool(box, ok) {
  const st = store('price') || { rent: 1100, costPct: 15, equity: 60000, rate: 3.6, repay: 2, land: 'hessen', broker: 3.57, targetCf: 0, targetYield: 4.5, asking: 340000 };
  const lands = Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === st.land ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  box.innerHTML = `<h3>Kaufpreis-Verhandlung</h3><p class="form-note">Bis zu welchem Kaufpreis rechnet sich das Objekt für Sie? Daraus entsteht Ihr Verhandlungsspielraum – und ein höfliches, begründetes Angebot an den Verkäufer.</p>
    <div class="tl-grid">
      <label>Angebotspreis im Exposé (€)<input data-p="asking" type="number" step="any" value="${st.asking}"></label>
      <label>Kaltmiete / Monat (€)<input data-p="rent" type="number" step="any" value="${st.rent}"></label>
      <label>Nicht umlagefähige Kosten (% der Miete)<input data-p="costPct" type="number" step="1" value="${st.costPct}"></label>
      <label>Eigenkapital (€)<input data-p="equity" type="number" step="any" value="${st.equity}"></label>
      <label>Sollzins (%)<input data-p="rate" type="number" step="0.05" value="${st.rate}"></label>
      <label>Tilgung (%)<input data-p="repay" type="number" step="0.1" value="${st.repay}"></label>
      <label>Bundesland<select data-p="land">${lands}</select></label>
      <label>Makler Käufer (%)<input data-p="broker" type="number" step="0.01" value="${st.broker}"></label>
      <label>Ziel-Cashflow / Monat (€)<input data-p="targetCf" type="number" step="10" value="${st.targetCf}"></label>
      <label>Mindest-Bruttorendite (%)<input data-p="targetYield" type="number" step="0.1" value="${st.targetYield}"></label>
    </div><div id="prOut" aria-live="polite"></div>${ok ? '<p class="tl-act"><button type="button" class="btn btn-outline" id="prCopy">Angebotsschreiben kopieren</button></p>' : lock('pass')}`;
  let letter = '';
  const run = () => {
    box.querySelectorAll('[data-p]').forEach((el) => { st[el.dataset.p] = el.tagName === 'SELECT' ? el.value : num(el.value); });
    store('price', st);
    const nk = kaufnebenkosten({ price: 100000, land: st.land, brokerPct: st.broker });
    const r = maxPrice({ ...st, nkPct: nk ? nk.totalPct : 10 });
    const gap = st.asking - r.max;
    const offer = Math.floor(r.max / 1000) * 1000;
    letter = `Sehr geehrte Damen und Herren,\n\nvielen Dank für die Informationen zum Objekt. Nach sorgfältiger Prüfung möchte ich Ihnen ein Kaufpreisangebot über ${E(offer)} unterbreiten.\n\nMeine Kalkulation: Bei einer Kaltmiete von ${E(st.rent)} im Monat, nicht umlagefähigen Kosten und Rücklagen sowie Kaufnebenkosten von rund ${nk ? P(nk.totalPct, 1) : '10 %'} trägt sich die Finanzierung nur bis zu diesem Preis. Die Bruttomietrendite liegt beim Angebotspreis bei ${P(st.asking ? st.rent * 12 / st.asking * 100 : 0)}.\n\nDas Angebot ist unverbindlich und steht unter dem Vorbehalt der Finanzierungszusage. Über eine Rückmeldung freue ich mich.\n\nMit freundlichen Grüßen`;
    box.querySelector('#prOut').innerHTML = `<div class="tl-facts"><div><small>Höchstpreis (Ziel-Cashflow)</small><strong>${E(r.byCf)}</strong></div><div><small>Höchstpreis (Mindestrendite)</small><strong>${Number.isFinite(r.byYield) ? E(r.byYield) : '–'}</strong></div><div><small>Ihr Höchstpreis</small><strong>${E(r.max)}</strong></div><div><small>${gap > 0 ? 'Zu verhandeln' : 'Puffer'}</small><strong>${E(Math.abs(gap))}</strong><span>${st.asking ? P(Math.abs(gap) / st.asking * 100, 1) : ''} ${gap > 0 ? 'unter Angebotspreis' : 'unter Ihrem Höchstpreis'}</span></div></div>
      <p class="tl-verdict">${gap > 0 ? (gap / st.asking > 0.15 ? `<strong>Zum Angebotspreis verfehlen Sie Ihr Ziel deutlich.</strong> Rechnerisch begründbar wären ${E(offer)} – ein so großer Abschlag wird selten akzeptiert. Prüfen Sie Ihre Ziele, die Miete (Mietspiegel) oder suchen Sie ein anderes Objekt.` : `<strong>Zum Angebotspreis rechnet es sich nicht ganz.</strong> Ein Angebot um ${E(offer)} ist begründbar.`) : '<strong>Der Angebotspreis liegt in Ihrem Rahmen.</strong> Verhandeln lohnt sich trotzdem – jeder Euro senkt Rate und Nebenkosten.'}</p>`;
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
  $('prCopy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(letter); $('prCopy').textContent = 'Kopiert ✓'; } catch { /* ohne Zwischenablage */ } });
}

function specialTool(box, ok) {
  const st = store('special') || { loan: 300000, rate: 3.6, repay: 2, special: 5000, years: 10 };
  box.innerHTML = `<h3>Sondertilgung planen</h3><p class="form-note">Was bringt eine jährliche Sondertilgung? Kürzere Laufzeit, weniger Zinsen und niedrigere Restschuld am Ende der Zinsbindung.</p>
    <div class="tl-grid"><label>Darlehen (€)<input data-s="loan" type="number" step="any" value="${st.loan}"></label><label>Sollzins (%)<input data-s="rate" type="number" step="0.05" value="${st.rate}"></label><label>Tilgung (%)<input data-s="repay" type="number" step="0.1" value="${st.repay}"></label><label>Sondertilgung pro Jahr (€)<input data-s="special" type="number" step="500" value="${st.special}"></label><label>Zinsbindung (Jahre)<input data-s="years" type="number" step="1" value="${st.years}"></label></div>
    <div id="spOut" aria-live="polite"></div>`;
  const run = () => {
    box.querySelectorAll('[data-s]').forEach((el) => { st[el.dataset.s] = num(el.value); });
    store('special', st);
    const a = tilgungsplan({ loan: st.loan, ratePa: st.rate / 100, repaymentPa: st.repay / 100, fixedYears: st.years });
    const b = tilgungsplan({ loan: st.loan, ratePa: st.rate / 100, repaymentPa: st.repay / 100, fixedYears: st.years, specialPa: st.special });
    if (!a || !b) { box.querySelector('#spOut').innerHTML = '<p class="form-note">Bitte Darlehen, Zins und Tilgung eintragen.</p>'; return; }
    const restA = a.years[st.years - 1]?.balance ?? 0, restB = b.years[st.years - 1]?.balance ?? 0;
    const yA = a.months ? a.months / 12 : null, yB = b.months ? b.months / 12 : null;
    box.querySelector('#spOut').innerHTML = `<div class="tl-facts"><div><small>Zinsersparnis gesamt</small><strong>${E(a.totalInterest - b.totalInterest)}</strong></div><div><small>Laufzeit</small><strong>${yB ? yB.toFixed(1).replace('.', ',') : '–'} statt ${yA ? yA.toFixed(1).replace('.', ',') : '–'} Jahre</strong></div><div><small>Restschuld nach ${st.years} Jahren</small><strong>${E(restB)}</strong><span>statt ${E(restA)}</span></div></div>
      <p class="tl-verdict">Prüfen Sie, wie viel Sondertilgung Ihr Vertrag kostenlos erlaubt (oft 5 % des Darlehens pro Jahr = ${E(st.loan * 0.05)}). Behalten Sie eine Rücklage – Sondertilgungen bekommen Sie nicht zurück.</p>`;
  };
  box.addEventListener('input', run);
  run();
}

function bkTool(box, ok) {
  const DEF = [['Grundsteuer', 'flaeche'], ['Wasser/Abwasser', 'personen'], ['Müllabfuhr', 'personen'], ['Gebäudeversicherung', 'flaeche'], ['Hausmeister', 'flaeche'], ['Treppenhausreinigung', 'einheit'], ['Gartenpflege', 'flaeche'], ['Allgemeinstrom', 'einheit'], ['Schornsteinfeger', 'einheit'], ['Aufzug', 'flaeche']];
  const st = store('bk') || { mieter: '', zeitraum: `${new Date().getFullYear() - 1}`, flaecheGesamt: 480, flaecheMieter: 72, personenGesamt: 11, personenMieter: 2, einheitenGesamt: 6, monate: 12, vorauszahlung: 1560, rows: DEF.map(([t, key]) => ({ t, key, betrag: 0 })) };
  const KEYS = [['flaeche', 'Wohnfläche'], ['personen', 'Personen'], ['einheit', 'Wohneinheiten'], ['direkt', 'direkt (100 %)']];
  box.innerHTML = `<h3>Betriebskostenabrechnung erstellen</h3><p class="form-note">Kosten des Hauses eintragen, Umlageschlüssel wählen – das Programm verteilt auf Ihre Mietpartei, zieht die Vorauszahlungen ab und erstellt die Abrechnung zum Ausdrucken. Heizkosten nach Heizkostenverordnung bitte separat (Messdienst).</p>
    <div class="tl-grid"><label>Mieter<input data-b="mieter" type="text" maxlength="80" value="${esc(st.mieter)}"></label><label>Abrechnungsjahr<input data-b="zeitraum" type="text" maxlength="20" value="${esc(st.zeitraum)}"></label><label>Monate im Zeitraum bewohnt<input data-b="monate" type="number" min="1" max="12" value="${st.monate}"></label>
      <label>Wohnfläche gesamt (m²)<input data-b="flaecheGesamt" type="number" step="any" value="${st.flaecheGesamt}"></label><label>Wohnfläche Mieter (m²)<input data-b="flaecheMieter" type="number" step="any" value="${st.flaecheMieter}"></label><label>Personen gesamt<input data-b="personenGesamt" type="number" step="1" value="${st.personenGesamt}"></label>
      <label>Personen Mieter<input data-b="personenMieter" type="number" step="1" value="${st.personenMieter}"></label><label>Wohneinheiten gesamt<input data-b="einheitenGesamt" type="number" step="1" value="${st.einheitenGesamt}"></label><label>Vorauszahlungen im Zeitraum (€)<input data-b="vorauszahlung" type="number" step="any" value="${st.vorauszahlung}"></label></div>
    <div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Kostenart</th><th>Gesamtbetrag Haus (€)</th><th>Umlageschlüssel</th><th>Anteil Mieter</th></tr></thead><tbody>${st.rows.map((r, i) => `<tr><td><input data-r="${i}" data-rk="t" type="text" maxlength="40" value="${esc(r.t)}"></td><td><input data-r="${i}" data-rk="betrag" type="number" step="any" value="${r.betrag || ''}"></td><td><select data-r="${i}" data-rk="key">${KEYS.map(([k, l]) => `<option value="${k}"${r.key === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td class="bk-a" id="bk${i}">–</td></tr>`).join('')}</tbody></table></div>
    <div id="bkOut" aria-live="polite"></div>${ok ? '<p class="tl-act"><button type="button" class="btn btn-dark" id="bkPrint">Abrechnung drucken / als PDF</button></p>' : lock('pro')}`;
  let res;
  const run = () => {
    box.querySelectorAll('[data-b]').forEach((el) => { st[el.dataset.b] = el.type === 'text' ? el.value : num(el.value); });
    box.querySelectorAll('[data-r]').forEach((el) => { st.rows[+el.dataset.r][el.dataset.rk] = el.dataset.rk === 'betrag' ? num(el.value) : el.value; });
    store('bk', st);
    res = betriebskosten(st);
    st.rows.forEach((r, i) => { const x = res.rows.find((y) => y.t === r.t && y.betrag === r.betrag); const c = $('bk' + i); if (c) c.textContent = x ? E2(x.anteil) : '–'; });
    box.querySelector('#bkOut').innerHTML = `<div class="tl-facts"><div><small>Kosten Mieter</small><strong>${E2(res.summe)}</strong></div><div><small>Vorauszahlungen</small><strong>${E2(st.vorauszahlung)}</strong></div><div><small>${res.saldo >= 0 ? 'Nachzahlung' : 'Guthaben'}</small><strong>${E2(Math.abs(res.saldo))}</strong></div></div>
      <p class="tl-verdict">Die Abrechnung muss dem Mieter spätestens 12 Monate nach Ende des Abrechnungszeitraums zugehen (§ 556 Abs. 3 BGB); danach sind Nachforderungen meist ausgeschlossen. Umlagefähig sind nur Kosten nach der Betriebskostenverordnung, die im Mietvertrag vereinbart sind.</p>`;
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
  $('bkPrint')?.addEventListener('click', () => {
    const w = window.open('', '_blank'); if (!w) return;
    const keyL = Object.fromEntries(KEYS);
    w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Betriebskostenabrechnung ${esc(st.zeitraum)}</title><style>body{font:13.5px/1.5 system-ui,sans-serif;margin:28px;color:#0F172A}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #CBD5E1;padding:6px;text-align:left}td.r,th.r{text-align:right}h1{font-size:20px}.n{font-size:11px;color:#475569;margin-top:18px}</style></head><body>
      <h1>Betriebskostenabrechnung ${esc(st.zeitraum)}</h1><p>Mieter: <strong>${esc(st.mieter || '–')}</strong> · Wohnfläche ${st.flaecheMieter} von ${st.flaecheGesamt} m² · Personen ${st.personenMieter} von ${st.personenGesamt} · Einheiten ${st.einheitenGesamt} · Zeitraum ${st.monate} Monate</p>
      <table><tr><th>Kostenart</th><th class="r">Gesamtkosten</th><th>Schlüssel</th><th class="r">Ihr Anteil</th></tr>${res.rows.map((r) => `<tr><td>${esc(r.t)}</td><td class="r">${E2(r.betrag)}</td><td>${keyL[r.key]}</td><td class="r">${E2(r.anteil)}</td></tr>`).join('')}
      <tr><th colspan="3">Summe Ihrer Kosten</th><th class="r">${E2(res.summe)}</th></tr><tr><td colspan="3">abzüglich Vorauszahlungen</td><td class="r">− ${E2(st.vorauszahlung)}</td></tr><tr><th colspan="3">${res.saldo >= 0 ? 'Nachzahlung' : 'Guthaben'}</th><th class="r">${E2(Math.abs(res.saldo))}</th></tr></table>
      <p>Die Belege können nach Absprache eingesehen werden.</p><p class="n">Erstellt mit ImmoAdv am ${new Date().toLocaleDateString('de-DE')}. Vorlage ohne Gewähr für die rechtliche Wirksamkeit im Einzelfall; keine Rechtsdienstleistung.</p></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  });
}

function printBox(box, title) {
  const w = window.open('', '_blank');
  if (!w) return;
  const clone = box.cloneNode(true);
  clone.querySelectorAll('input,textarea,select').forEach((el) => { const s = document.createElement('span'); s.className = 'pv'; s.textContent = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text || '') : el.value || '—'; el.replaceWith(s); });
  clone.querySelectorAll('.tl-act,.tl-lock,.tl-pick').forEach((el) => el.remove());
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)} – ImmoAdv</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#0F172A;margin:28px}h3{color:#0F2C59}table{border-collapse:collapse;width:100%}td,th{border:1px solid #CBD5E1;padding:6px;text-align:left}tr.best{background:#DCFCE7}label{display:block;margin:4px 0}.pv{font-weight:700;margin-left:6px}fieldset{border:1px solid #CBD5E1;margin:0 0 8px}small{display:block;color:#475569}.tl-facts{display:flex;gap:16px;flex-wrap:wrap}footer{margin-top:24px;font-size:11px;color:#64748B}</style></head><body>${clone.innerHTML}<footer>Erstellt mit ImmoAdv am ${new Date().toLocaleDateString('de-DE')}. Rechnerische Orientierung, keine Finanzierungs- oder Rechtsberatung.</footer></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

// tier: 'free' | 'starter' (Käufer-Pass) | 'pro' (Investor Pro); b2b: Unternehmenskonto (alles frei)
// Werkzeuge je Ansicht: Einsteiger = Kauf vorbereiten, Profi = Bestand verwalten. Die übrigen liegen eingeklappt darunter.
const TOOLS = {
  price: ['Kaufpreis verhandeln', 'pass', 'Bis zu welchem Preis rechnet sich das Objekt?', (b, ok) => priceTool(b, ok)],
  offers: ['Bankangebote vergleichen', 'pass', 'Welches Angebot ist bis zum Ende der Zinsbindung am günstigsten?', (b, ok) => offersTool(b, ok)],
  bank: ['Bankgespräch vorbereiten', 'pass', 'Ihre Zahlen, die richtigen Fragen, Platz für Antworten.', (b, ok, d) => bankTool(b, ok, d)],
  special: ['Sondertilgung planen', 'pass', 'Was bringt eine jährliche Sondertilgung?', (b, ok) => specialTool(b, ok)],
  fwd: ['Anschluss & Forward', 'pro', 'Restschuld, Forward-Zins und Kündigungsrecht nach § 489 BGB.', (b, ok, d) => forwardTool(b, ok, d)],
  bk: ['Betriebskostenabrechnung', 'pro', 'Kosten auf Ihre Mieter verteilen und abrechnen.', (b, ok) => bkTool(b, ok)],
};
const ORDER = {
  einsteiger: { main: ['price', 'offers', 'bank', 'special'], more: ['fwd', 'bk'] },
  profi: { main: ['fwd', 'bk', 'offers', 'special'], more: ['price', 'bank'] },
};
const PLAN_LINE = {
  free: (m) => m === 'profi' ? 'Kostenlos: alle Werkzeuge rechnen frei. Drucken, Vorlagen und Betriebskosten-Abrechnung mit Investor Pro.' : 'Kostenlos: alle Werkzeuge rechnen frei. Drucken und Vorlagen mit dem Käufer-Pass.',
  starter: () => 'Käufer-Pass aktiv: Kauf-Werkzeuge vollständig nutzbar. Anschluss und Betriebskosten mit Investor Pro.',
  pro: () => 'Investor Pro aktiv: alle Werkzeuge vollständig nutzbar.',
};

export async function mountTools(view, { d, tier = 'free', b2b = false, mode = 'einsteiger' }) {
  const m = mode === 'profi' ? 'profi' : 'einsteiger';
  const t = b2b ? 'pro' : ['starter', 'pro'].includes(tier) ? tier : 'free';
  try {
    const P = await fetch('/data/preise.json').then((r) => r.json());
    const pl = Object.fromEntries((P.privat?.plans || []).map((x) => [x.id, x]));
    const eur = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
    CTX = { mode: m, tier: t, prices: { pass: pl['buyer-pass'] ? `${eur(pl['buyer-pass'].cents)} einmalig` : CTX.prices.pass, pro: pl['pro-monthly'] ? `${eur(pl['pro-monthly'].cents)}/Monat` : CTX.prices.pro } };
  } catch { CTX = { ...CTX, mode: m, tier: t }; }
  const ok = (need) => (need === 'pro' ? t === 'pro' : t !== 'free');
  const o = ORDER[m];
  const sec = (id) => `<section class="tl-card" id="t-${id}"></section>`;
  view.innerHTML = `<div class="tl-top"><div><h2 class="tl-h">Werkzeuge</h2><p class="form-note">${m === 'profi' ? 'Für Ihren Bestand: Anschlussfinanzierung, Abrechnung, Konditionen.' : 'Für Ihren Kauf: Preis, Bankangebote, Bankgespräch – einfach ausprobieren.'}</p></div><span class="tl-plan tl-plan-${t}">${t === 'pro' ? 'Investor Pro' : t === 'starter' ? 'Käufer-Pass' : 'Kostenlos'}</span></div>
    <p class="tl-planline">${esc(PLAN_LINE[t](m))}</p>
    <nav class="tl-nav" aria-label="Werkzeuge">${o.main.map((id) => `<a href="#t-${id}">${esc(TOOLS[id][0])}</a>`).join('')}<a href="#steuer">Steuer</a><a href="/rechner">Alle Rechner</a></nav>
    ${o.main.map(sec).join('')}
    <details class="tl-more"><summary>Weitere Werkzeuge <span>${o.more.map((id) => esc(TOOLS[id][0])).join(' · ')}</span></summary>${o.more.map(sec).join('')}</details>
    <p class="form-note tl-foot">Ihre Eingaben bleiben nur in diesem Browser. <button type="button" class="text-btn" id="tlClear">Alle Eingaben löschen</button></p>`;
  o.main.forEach((id) => TOOLS[id][3]($('t-' + id), ok(TOOLS[id][1]), d));
  let moreDone = false;
  view.querySelector('.tl-more')?.addEventListener('toggle', (e) => { if (e.target.open && !moreDone) { moreDone = true; o.more.forEach((id) => TOOLS[id][3]($('t-' + id), ok(TOOLS[id][1]), d)); } });
  $('tlClear')?.addEventListener('click', () => { if (!confirm('Alle Eingaben in den Werkzeugen auf diesem Gerät löschen?')) return; try { Object.keys(localStorage).filter((k) => k.startsWith('ia-tool-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ohne Speicher */ } mountTools(view, { d, tier, b2b, mode }); });
  view.querySelectorAll('.tl-nav a[href^="#t-"]').forEach((a) => a.onclick = (e) => { e.preventDefault(); $(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
}
