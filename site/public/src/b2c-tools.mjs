// Software-Tools für Privatkunden (Ansicht „Software-Tools“). Alles rechnet im Browser; Eingaben bleiben in diesem Browser.
// Personalisiert: Jedes Tool startet mit den Zahlen des gewählten Objekts und des Finanzprofils – ohne Beispielwerte.
// Tarife: Kostenlos = Basis-Tools · Käufer-Pass = alle Kauf-Tools mit Druck und Vorlagen · Investor Pro = zusätzlich
// Portfolio, Anschluss & Forward und Betriebskosten. Einsteiger und Profi unterscheiden sich in Reihenfolge, Erklärtiefe
// und Fachlogik (Beleihungsauslauf, normierter Angebotsvergleich, Steuerwirkung, Portfolio-Stresstest).
// Die Freischaltung im Browser ist eine Komfortfunktion; die Rechenwege sind offen dokumentiert.
import { monthlyRate, balanceAfterMonths, tilgungsplan, kaufnebenkosten, portfolio, GREST } from './calc.mjs?v=892f3666';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const E2 = (v) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const P = (v, d = 2) => `${(Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`;
const D = (v, d = 2) => (Number.isFinite(v) ? v : 0).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
// Deutsche Eingaben: „300.000“, „3,55“, „1.234,56“, „300000“.
export const num = (v) => {
  let t = String(v ?? '').replace(/[€%\s]/g, '').trim();
  if (!t) return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const x = Number(t);
  return Number.isFinite(x) ? x : 0;
};

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

// Profi: Angebote mit unterschiedlicher Zinsbindung vergleichbar machen. Kürzere Bindungen werden mit einem
// angenommenen Anschlusszins bis zum gemeinsamen Horizont (längste Bindung) fortgeschrieben.
export function normalizeOffers(list, { anschlussRate = 0 } = {}) {
  const base = compareOffers(list);
  if (!base.rows.length) return { ...base, horizon: 0 };
  const H = Math.max(...base.rows.map((r) => r.years));
  const rows = base.rows.map((r) => {
    if (r.years >= H || !(anschlussRate > 0)) return { ...r, costH: r.cost, restH: r.rest, extra: 0 };
    const m = Math.round((H - r.years) * 12);
    const pay = monthlyRate(r.rest, anschlussRate / 100, r.repay / 100);
    const restH = balanceAfterMonths(r.rest, anschlussRate / 100, r.repay / 100, m);
    const extra = pay * m - (r.rest - restH);
    return { ...r, costH: r.cost + extra, restH, extra };
  });
  rows.forEach((r) => { r.scoreH = (r.costH + r.restH) / r.loan; });
  const best = rows.reduce((a, b) => (b.scoreH < a.scoreH ? b : a));
  return { rows, best, sameYears: base.sameYears, horizon: H };
}

// Kaufnebenkosten und Finanzierungsstruktur; Profi: Beleihungsauslauf mit Sicherheitsabschlag auf den Kaufpreis.
export function nkPlan({ price, land, brokerPct = 0, notaryPct = 1.5, equity = 0, blwAbschlagPct = 10 }) {
  const nk = kaufnebenkosten({ price, land, notaryPct, landRegistryPct: 0.5, brokerPct });
  if (!nk) return null;
  const total = price + nk.total;
  const loan = Math.max(0, total - equity);
  const blw = price * (1 - blwAbschlagPct / 100);
  return { nk, total, loan, ekQuote: total > 0 ? (equity / total) * 100 : 0, coversNk: equity >= nk.total, beyondNk: equity - nk.total,
    ltv: price > 0 ? (loan / price) * 100 : 0, blw, bla: blw > 0 ? (loan / blw) * 100 : 0 };
}

// Profi: Lohnt Sondertilgung gegenüber einer Alternativanlage? Bei vermieteten Objekten sind Schuldzinsen Werbungskosten
// (§ 9 EStG) – die Tilgung „verdient“ dann nur den Zins nach Steuern. Alternativanlage nach Abgeltungsteuer inkl. Soli (26,375 %).
export function sondertilgungVergleich({ rate, taxPct = 0, vermietet = false, altRendite = 0 }) {
  const eff = vermietet ? rate * (1 - taxPct / 100) : rate;
  const altNet = altRendite * (1 - 0.26375);
  const altNoetig = eff / (1 - 0.26375);
  return { eff, altNet, altNoetig, lohnt: altRendite > 0 ? eff >= altNet : null };
}

// Profi: Kennzahlen zum Angebotspreis (Faktor, Nettoanfangsrendite, DSCR, Break-even-Zins).
export function preisKennzahlen({ asking, rent, costPct, equity, rate, repay, nkPct }) {
  if (!(asking > 0) || !(rent > 0)) return null;
  const costs = (rent * costPct) / 100;
  const loan = Math.max(0, asking * (1 + nkPct / 100) - equity);
  const pay = monthlyRate(loan, rate / 100, repay / 100);
  return {
    faktor: asking / (rent * 12),
    nar: (((rent - costs) * 12) / (asking * (1 + nkPct / 100))) * 100,
    dscr: pay > 0 ? (rent - costs) / pay : null,
    breakEven: loan > 0 ? (((rent - costs) * 12) / loan) * 100 - repay : null,
    loan, pay, cf: rent - costs - pay,
  };
}

// ---------- Grafiken (SVG, ohne Bibliothek) ----------
const COL = { navy: '#0F2C59', blue: '#0284C7', sky: '#7DD3FC', green: '#16A34A', amber: '#D97706', red: '#DC2626', grey: '#CBD5E1', ink: '#334155', muted: '#64748B' };
const kShort = (v) => (Math.abs(v) >= 1e6 ? `${D(v / 1e6, 1)} Mio. €` : Math.abs(v) >= 1e4 ? `${D(v / 1e3, 0)} T€` : E(v));
// Waagerechte Balken als HTML (gut lesbar auf dem Handy): [{ label, value, color }]
function chartBars(items, { title = '', fmt = E } = {}) {
  const rows = items.filter((i) => Number.isFinite(i.value));
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return `<figure class="tl-chart" role="img" aria-label="${esc(title || 'Balkendiagramm')}">${title ? `<figcaption class="tl-ct">${esc(title)}</figcaption>` : ''}<div class="tl-bars">${rows.map((r) => `<div class="tl-bar"><span class="l">${esc(r.label)}</span><span class="t"><i style="width:${Math.max(1.5, (Math.abs(r.value) / max) * 100).toFixed(1)}%;background:${r.color || COL.blue}"></i></span><b>${esc(fmt(r.value))}</b></div>`).join('')}</div></figure>`;
}
// Linien über eine Achse (SVG): series [{ name, values, color, dash }], xs = Beschriftungen der x-Achse.
function chartLines(series, { title = '', xs = [], fmt = kShort, marker = null } = {}) {
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  if (!all.length) return '';
  const W = 420, H = 200, L = 62, R = 10, T = 10, B = 24;
  const max = Math.max(...all, 1) * 1.05, min = Math.min(0, ...all);
  const n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : 0);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => { const v = min + f * (max - min); return `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="#E2E8F0"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" font-size="12" text-anchor="end" fill="${COL.muted}">${esc(fmt(v))}</text>`; }).join('');
  const step = Math.max(1, Math.ceil(n / 6));
  const xl = xs.map((t, i) => (i % step === 0 || i === n - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 6}" font-size="12" text-anchor="${i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" fill="${COL.muted}">${esc(t)}</text>` : '')).join('');
  const lines = series.map((s) => `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''} points="${s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  const mk = marker != null && marker < n ? `<line x1="${x(marker).toFixed(1)}" x2="${x(marker).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="${COL.amber}" stroke-dasharray="3 4"/>` : '';
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') + (mk ? `<span><i style="background:${COL.amber}"></i>Ende Zinsbindung</span>` : '');
  return `<figure class="tl-chart">${title ? `<figcaption class="tl-ct">${esc(title)}</figcaption>` : ''}<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title || 'Liniendiagramm')}">${grid}${mk}${lines}${xl}</svg><div class="tl-legend">${legend}</div></figure>`;
}
// Ein gestapelter Balken mit Legende (HTML): parts [{ label, value, color }]
function chartStack(parts, { title = '' } = {}) {
  const ok = parts.filter((p) => p.value > 0);
  const sum = ok.reduce((a, p) => a + p.value, 0);
  if (!(sum > 0)) return '';
  return `<figure class="tl-chart" role="img" aria-label="${esc(title || 'Aufteilung')}">${title ? `<figcaption class="tl-ct">${esc(title)}</figcaption>` : ''}<div class="tl-stack">${ok.map((p) => `<i style="width:${((p.value / sum) * 100).toFixed(2)}%;background:${p.color}"></i>`).join('')}</div><div class="tl-legend">${ok.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b>${E(p.value)}</b> · ${D((p.value / sum) * 100, 0)} %</span>`).join('')}</div></figure>`;
}

// ---------- Oberfläche ----------
let CTX = { mode: 'einsteiger', tier: 'free', objId: 'eigen', prices: { pass: '49 € einmalig', pro: '29 €/Monat' } };
const LOCK_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3Z"/></svg>';
const PRO = () => CTX.mode === 'profi';
const KEY = (tool) => `lr-tool2-${tool}-${CTX.objId}`;
const load = (tool, seed) => { try { const v = JSON.parse(localStorage.getItem(KEY(tool)) || 'null'); return v && typeof v === 'object' ? { ...seed, ...v } : { ...seed }; } catch { return { ...seed }; } };
const save = (tool, v) => { try { localStorage.setItem(KEY(tool), JSON.stringify(v)); } catch { /* ohne Speicher */ } };
const val = (v) => (v === '' || v == null || v === 0 ? '' : typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 4, useGrouping: false }) : v);
const inp = (k, label, v, ph = '') => `<label>${label}<input data-f="${k}" type="text" inputmode="decimal" autocomplete="off" value="${esc(val(v))}"${ph ? ` placeholder="${esc(ph)}"` : ''}></label>`;
const txt = (k, label, v, ph = '') => `<label>${label}<input data-f="${k}" type="text" maxlength="80" value="${esc(v ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></label>`;
const chk = (k, label, on) => `<label class="tl-chk"><input data-f="${k}" type="checkbox"${on ? ' checked' : ''}> ${label}</label>`;
const landSel = (k, v) => `<label>Bundesland<select data-f="${k}"><option value="">– bitte wählen –</option>${Object.entries(GREST).map(([id, g]) => `<option value="${id}"${id === v ? ' selected' : ''}>${esc(g.name)} (${D(g.pct, 1)} % GrESt)</option>`).join('')}</select></label>`;
const read = (box, st) => { box.querySelectorAll('[data-f]').forEach((el) => { st[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; }); };
const need = (txt) => `<p class="tl-need">${txt}</p>`;
// Einsteiger: kurze Erklärung zum Aufklappen. Profi: keine Erklärtexte.
const why = (t) => (PRO() ? '' : `<details class="tl-why"><summary>Was bedeutet das?</summary><p>${t}</p></details>`);
const facts = (list) => `<div class="tl-facts">${list.filter(Boolean).map(([k, v, s, tone]) => `<div${tone ? ` class="${tone}"` : ''}><small>${k}</small><strong>${v}</strong>${s ? `<span>${s}</span>` : ''}</div>`).join('')}</div>`;
const lockPrint = () => `<p class="tl-hint">${LOCK_SVG} Drucken, PDF und Vorlagen mit dem Käufer-Pass (${esc(CTX.prices.pass)}) · <a href="#angebot">ansehen</a></p>`;
const printBtn = (id, label = 'Drucken / als PDF sichern') => (CTX.print ? `<p class="tl-act"><button type="button" class="btn btn-outline" data-print="${id}">${label}</button></p>` : lockPrint());

// Startwerte aus dem gewählten Objekt und dem Finanzprofil (keine erfundenen Beispielzahlen).
function seed(d) {
  const p = d.profile || {}, o = CTX.obj || {};
  const price = num(o.price), rent = num(o.rent), equity = num(o.equity) || num(p.equity);
  const costs = num(o.nonRecoverable) + num(o.maintenance);
  return {
    price, rent, area: num(o.area), equity, land: o.land || p.land || '', broker: num(o.brokerPct),
    loan: num(o.loan), rate: num(o.interestPct), repay: num(o.repaymentPct), years: num(o.fixedYears),
    costPct: rent > 0 && costs > 0 ? Math.round((costs / rent) * 1000) / 10 : '', tax: num(o.marginalTaxPct) || num(p.marginalTaxPct),
    payout: o.payoutDate || '', vermietet: rent > 0, net: num(p.netIncome),
  };
}

// ---------- 1. Kaufnebenkosten & Eigenkapital (kostenlos) ----------
function nkTool(box, d) {
  const s0 = seed(d);
  const st = load('nk', { price: s0.price, land: s0.land, broker: s0.broker, notary: 1.5, equity: s0.equity, abschlag: 10 });
  box.innerHTML = `<h3>Kaufnebenkosten &amp; Eigenkapital</h3><p class="form-note">${PRO() ? 'Nebenkosten nach Bundesland, Finanzierungsstruktur und Beleihungsauslauf.' : 'Was zum Kaufpreis dazukommt – und ob Ihr Eigenkapital reicht.'}</p>
    <div class="tl-grid">${inp('price', 'Kaufpreis (€)', st.price, 'z. B. aus dem Exposé')}${landSel('land', st.land)}${inp('broker', 'Makler, Käuferanteil (%)', st.broker, '0 wenn provisionsfrei')}${inp('equity', 'Eigenkapital (€)', st.equity)}
    ${PRO() ? `${inp('notary', 'Notar (%)', st.notary)}${inp('abschlag', 'Sicherheitsabschlag Beleihungswert (%)', st.abschlag)}` : ''}</div><div class="tl-out" aria-live="polite"></div>`;
  const run = () => {
    read(box, st); save('nk', st);
    const out = box.querySelector('.tl-out');
    const r = nkPlan({ price: num(st.price), land: st.land, brokerPct: num(st.broker), notaryPct: PRO() ? num(st.notary) || 1.5 : 1.5, equity: num(st.equity), blwAbschlagPct: PRO() ? num(st.abschlag) : 10 });
    if (!r) { out.innerHTML = need('Bitte Kaufpreis und Bundesland eintragen.'); return; }
    const parts = r.nk.parts.map((x, i) => ({ label: x.label.replace(/ \(Richtwert\)/, ''), value: x.amount, color: [COL.navy, COL.blue, COL.sky, COL.amber][i] }));
    out.innerHTML = facts([
      ['Nebenkosten', E(r.nk.total), P(r.nk.totalPct, 1) + ' vom Kaufpreis'],
      ['Gesamtkosten', E(r.total)],
      ['Darlehensbedarf', E(r.loan), num(st.equity) ? `Eigenkapitalquote ${P(r.ekQuote, 1)}` : 'ohne Eigenkapital'],
      PRO() ? ['Beleihungsauslauf', P(r.bla, 1), `Beleihungswert ≈ ${E(r.blw)}`, r.bla > 100 ? 'bad' : r.bla > 80 ? 'warn' : 'ok'] : ['Eigenkapital deckt Nebenkosten', r.coversNk ? 'ja' : 'nein', r.coversNk ? `+ ${E(r.beyondNk)} für den Kaufpreis` : `es fehlen ${E(-r.beyondNk)}`, r.coversNk ? 'ok' : 'bad'],
    ]) + chartStack(parts, { title: 'Woraus die Nebenkosten bestehen' }) + chartStack([{ label: 'Eigenkapital', value: Math.min(num(st.equity), r.total), color: COL.green }, { label: 'Darlehen', value: r.loan, color: COL.navy }], { title: 'Wie der Kauf finanziert wird' })
      + (PRO()
        ? `<p class="tl-verdict">LTV ${P(r.ltv, 1)} auf den Kaufpreis, Beleihungsauslauf ${P(r.bla, 1)}. Banken staffeln den Zins meist nach Beleihungsauslauf (typische Stufen 60 / 80 / 90 / 100 %); ${r.bla > 100 ? 'über 100 % liegt eine Vollfinanzierung mit deutlichem Aufschlag und strengerer Haushaltsprüfung vor.' : r.bla > 80 ? `bis 80 % fehlen rechnerisch ${E(r.loan - r.blw * 0.8)} Eigenkapital.` : 'Sie liegen in einer günstigen Stufe.'} Der Beleihungswert nach BelWertV liegt meist unter dem Kaufpreis; der Abschlag ist eine Annahme.</p>`
        : `<p class="tl-verdict">${r.coversNk ? `<strong>Gut aufgestellt:</strong> Ihr Eigenkapital deckt die Nebenkosten und bringt ${E(r.beyondNk)} zusätzlich in den Kaufpreis ein.` : `<strong>Hier wird es eng:</strong> Ihr Eigenkapital deckt die Nebenkosten nicht vollständig. Viele Banken erwarten, dass mindestens die Nebenkosten aus eigenem Geld bezahlt werden.`}</p>`
          + why('Nebenkosten (Grunderwerbsteuer, Notar, Grundbuch, ggf. Makler) erhöhen den Wert der Immobilie nicht. Deshalb finanzieren Banken sie ungern. Je mehr Eigenkapital Sie darüber hinaus einbringen, desto niedriger ist meist Ihr Zins.'));
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// ---------- 2. Kaufpreis-Check (kostenlos; Angebotsschreiben mit Käufer-Pass) ----------
function priceTool(box, d) {
  const s0 = seed(d);
  const st = load('price', { asking: s0.price, rent: s0.rent, costPct: s0.costPct || 15, equity: s0.equity, rate: s0.rate, repay: s0.repay || 2, land: s0.land, broker: s0.broker, targetCf: 0, targetYield: '' });
  box.innerHTML = `<h3>Kaufpreis-Check</h3><p class="form-note">${PRO() ? 'Höchstpreis aus Ziel-Cashflow und Mindestrendite, Kennzahlen zum Angebotspreis.' : 'Bis zu welchem Preis rechnet sich das Objekt für Sie – und wie viel Verhandlungsspielraum gibt es?'}</p>
    <div class="tl-grid">${inp('asking', 'Angebotspreis (€)', st.asking)}${inp('rent', 'Kaltmiete / Monat (€)', st.rent)}${inp('equity', 'Eigenkapital (€)', st.equity)}${inp('rate', 'Sollzins (%)', st.rate, 'aus Bankangebot')}${inp('repay', 'Tilgung (%)', st.repay)}${landSel('land', st.land)}
    ${PRO() ? `${inp('costPct', 'Nicht umlagefähig + Instandhaltung (% der Miete)', st.costPct)}${inp('broker', 'Makler Käufer (%)', st.broker)}${inp('targetCf', 'Ziel-Cashflow / Monat (€)', st.targetCf)}${inp('targetYield', 'Mindest-Bruttorendite (%)', st.targetYield, 'optional')}` : `${inp('targetCf', 'Was soll monatlich übrig bleiben? (€)', st.targetCf, '0 = Miete trägt die Rate')}`}</div>
    <div class="tl-out" aria-live="polite"></div>${CTX.print ? '<p class="tl-act"><button type="button" class="btn btn-outline" data-copy="1">Angebotsschreiben kopieren</button></p>' : lockPrint()}`;
  let letter = '';
  const run = () => {
    read(box, st); save('price', st);
    const out = box.querySelector('.tl-out');
    const v = { asking: num(st.asking), rent: num(st.rent), costPct: num(st.costPct), equity: num(st.equity), rate: num(st.rate), repay: num(st.repay), targetCf: num(st.targetCf), targetYield: PRO() ? num(st.targetYield) : 0 };
    if (!(v.rent > 0) || !(v.rate > 0) || !(v.repay > 0)) { out.innerHTML = need('Bitte Kaltmiete, Sollzins und Tilgung eintragen.'); return; }
    const nk = st.land ? kaufnebenkosten({ price: 100000, land: st.land, brokerPct: num(st.broker) }) : null; // ohne Bundesland: 10 % pauschal
    const nkPct = nk ? nk.totalPct : 10;
    const r = maxPrice({ ...v, nkPct });
    const gap = v.asking - r.max;
    const offer = Math.floor(r.max / 1000) * 1000;
    const k = PRO() ? preisKennzahlen({ ...v, nkPct }) : null;
    letter = `Sehr geehrte Damen und Herren,\n\nvielen Dank für die Unterlagen zum Objekt. Nach eingehender Prüfung unterbreite ich Ihnen ein Kaufpreisangebot über ${E(offer)}.\n\nZur Begründung: Bei einer Nettokaltmiete von ${E(v.rent)} im Monat, den nicht umlagefähigen Kosten und Rücklagen sowie Kaufnebenkosten von rund ${P(nkPct, 1)} trägt sich die Finanzierung nur bis zu diesem Preis.${v.asking ? ` Die Bruttomietrendite liegt beim Angebotspreis bei ${P((v.rent * 12) / v.asking * 100)}.` : ''}\n\nDas Angebot ist unverbindlich und steht unter dem Vorbehalt der Finanzierungszusage. Über Ihre Rückmeldung freue ich mich.\n\nMit freundlichen Grüßen`;
    out.innerHTML = facts([
      ['Ihr Höchstpreis', E(r.max), Number.isFinite(r.byYield) && r.byYield < r.byCf ? 'begrenzt durch Mindestrendite' : 'begrenzt durch Cashflow'],
      v.asking ? [gap > 0 ? 'Zu verhandeln' : 'Puffer', E(Math.abs(gap)), `${P(Math.abs(gap) / v.asking * 100, 1)} ${gap > 0 ? 'unter Angebotspreis' : 'unter Ihrem Höchstpreis'}`, gap > 0 ? 'warn' : 'ok'] : null,
      k ? ['Kaufpreisfaktor', D(k.faktor, 1), `Nettoanfangsrendite ${P(k.nar)}`] : null,
      k ? ['DSCR zum Angebotspreis', k.dscr == null ? '–' : D(k.dscr), `Break-even-Zins ${k.breakEven == null ? '–' : P(k.breakEven)}`, k.dscr != null && k.dscr < 1 ? 'bad' : k.dscr != null && k.dscr < 1.2 ? 'warn' : 'ok'] : null,
    ]) + (v.asking ? chartBars([{ label: 'Angebotspreis', value: v.asking, color: COL.grey }, { label: 'Höchstpreis (Cashflow)', value: r.byCf, color: COL.navy }, ...(Number.isFinite(r.byYield) ? [{ label: 'Höchstpreis (Rendite)', value: r.byYield, color: COL.blue }] : [])], { title: 'Preis im Vergleich' }) : '')
      + `<p class="tl-verdict">${!v.asking ? 'Tragen Sie den Angebotspreis ein, um den Spielraum zu sehen.' : gap > 0 ? (gap / v.asking > 0.15 ? `<strong>Zum Angebotspreis verfehlen Sie Ihr Ziel deutlich.</strong> Begründbar wären ${E(offer)} – ein so hoher Abschlag wird selten akzeptiert. ${PRO() ? 'Prüfen Sie Mietsteigerungspotenzial (Mietspiegel, § 558 BGB) oder Eigenkapitaleinsatz.' : 'Prüfen Sie Ihre Ziele oder suchen Sie ein anderes Objekt.'}` : `<strong>Zum Angebotspreis rechnet es sich nicht ganz.</strong> Ein Angebot um ${E(offer)} ist sachlich begründbar.`) : '<strong>Der Angebotspreis liegt in Ihrem Rahmen.</strong> Verhandeln lohnt sich trotzdem: Jeder Euro weniger senkt Rate und Nebenkosten.'}</p>`
      + why('Der Höchstpreis ist der Preis, bei dem die Miete nach Abzug der Kosten gerade die Bankrate trägt (plus Ihr Wunsch-Überschuss). Liegt der Angebotspreis darüber, legen Sie jeden Monat Geld dazu.');
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
  box.querySelector('[data-copy]')?.addEventListener('click', async (e) => { try { await navigator.clipboard.writeText(letter); e.target.textContent = 'Kopiert ✓'; } catch { /* ohne Zwischenablage */ } });
}

// ---------- 3. Sondertilgung (kostenlos) ----------
function specialTool(box, d) {
  const s0 = seed(d);
  const st = load('special', { loan: s0.loan, rate: s0.rate, repay: s0.repay || 2, special: '', years: s0.years || 10, vermietet: s0.vermietet, tax: s0.tax, alt: '' });
  box.innerHTML = `<h3>Sondertilgung</h3><p class="form-note">${PRO() ? 'Zinsersparnis, Laufzeit und Restschuld – und ob Sondertilgung nach Steuern gegen eine Alternativanlage gewinnt.' : 'Was bringt es, jedes Jahr zusätzlich zu tilgen?'}</p>
    <div class="tl-grid">${inp('loan', 'Darlehen (€)', st.loan)}${inp('rate', 'Sollzins (%)', st.rate)}${inp('repay', 'Tilgung (%)', st.repay)}${inp('special', 'Sondertilgung pro Jahr (€)', st.special, 'z. B. 5 % des Darlehens')}${inp('years', 'Zinsbindung (Jahre)', st.years)}
    ${PRO() ? `${inp('tax', 'Grenzsteuersatz (%)', st.tax)}${inp('alt', 'Rendite Alternativanlage vor Steuern (%)', st.alt, 'optional')}${chk('vermietet', 'Objekt ist vermietet (Zinsen sind Werbungskosten)', st.vermietet)}` : ''}</div><div class="tl-out" aria-live="polite"></div>`;
  const run = () => {
    read(box, st); save('special', st);
    const out = box.querySelector('.tl-out');
    const v = { loan: num(st.loan), rate: num(st.rate), repay: num(st.repay), special: num(st.special), years: Math.max(1, Math.round(num(st.years) || 10)) };
    const a = tilgungsplan({ loan: v.loan, ratePa: v.rate / 100, repaymentPa: v.repay / 100, fixedYears: v.years });
    if (!a || !(v.rate > 0)) { out.innerHTML = need('Bitte Darlehen, Sollzins und Tilgung eintragen.'); return; }
    if (!(v.special > 0)) { out.innerHTML = need(`Tragen Sie einen jährlichen Betrag ein – viele Verträge erlauben 5 % des Darlehens kostenlos, hier ${E(v.loan * 0.05)}.`); return; }
    const b = tilgungsplan({ loan: v.loan, ratePa: v.rate / 100, repaymentPa: v.repay / 100, fixedYears: v.years, specialPa: v.special });
    const restA = a.years[v.years - 1]?.balance ?? 0, restB = b.years[v.years - 1]?.balance ?? 0;
    const yA = a.months ? a.months / 12 : null, yB = b.months ? b.months / 12 : null;
    const n = Math.min(a.years.length, 40);
    const curve = (p) => [v.loan, ...Array.from({ length: n }, (_, i) => p.years[i]?.balance ?? 0)];
    const cmp = PRO() ? sondertilgungVergleich({ rate: v.rate, taxPct: num(st.tax), vermietet: st.vermietet, altRendite: num(st.alt) }) : null;
    out.innerHTML = facts([
      ['Zinsersparnis gesamt', E(a.totalInterest - b.totalInterest), '', 'ok'],
      ['Laufzeit', `${yB ? D(yB, 1) : '–'} statt ${yA ? D(yA, 1) : '–'} Jahren`],
      [`Restschuld nach ${v.years} Jahren`, E(restB), `statt ${E(restA)}`],
      cmp ? ['Zins nach Steuern', P(cmp.eff), st.vermietet ? 'Schuldzinsen als Werbungskosten' : 'selbst genutzt: kein Steuereffekt'] : null,
    ]) + chartLines([{ name: 'ohne Sondertilgung', values: curve(a), color: '#94A3B8' }, { name: 'mit Sondertilgung', values: curve(b), color: COL.green }], { title: 'Restschuld im Zeitverlauf', xs: Array.from({ length: n + 1 }, (_, i) => `${i} J.`), marker: v.years })
      + (cmp
        ? `<p class="tl-verdict">Jeder sondergetilgte Euro bringt sicher ${P(cmp.eff)} p. a. ${cmp.lohnt == null ? `Eine Alternativanlage müsste vor Abgeltungsteuer mehr als ${P(cmp.altNoetig)} erzielen, um besser zu sein.` : cmp.lohnt ? `<strong>Sondertilgung gewinnt:</strong> Die Alternativanlage bringt nach Abgeltungsteuer nur ${P(cmp.altNet)}.` : `<strong>Alternativanlage rechnerisch besser:</strong> ${P(cmp.altNet)} nach Steuern – allerdings mit Kursrisiko; Sondertilgung ist risikolos.`} Bei vermieteten Objekten senkt Tilgung zudem die abziehbaren Zinsen der Folgejahre.</p>`
        : `<p class="tl-verdict">Prüfen Sie im Darlehensvertrag, wie viel Sondertilgung kostenlos erlaubt ist (oft 5 % pro Jahr = ${E(v.loan * 0.05)}). Behalten Sie eine Rücklage – getilgtes Geld bekommen Sie nicht zurück.</p>`
          + why('Eine Sondertilgung senkt sofort die Schuld. Weil Zinsen immer auf die Restschuld berechnet werden, zahlen Sie danach jeden Monat weniger Zinsen – und sind früher schuldenfrei.'));
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// ---------- 4. Bankangebote vergleichen (Käufer-Pass) ----------
function offersTool(box, d) {
  const s0 = seed(d);
  const blank = () => ({ bank: '', loan: s0.loan || '', rate: '', eff: '', repay: s0.repay || '', years: s0.years || '', fees: '' });
  const st = load('offers', { list: [blank(), blank(), blank()], anschluss: '' });
  const F = [['bank', 'Bank / Anbieter', 1], ['loan', 'Darlehen (€)'], ['rate', 'Sollzins (%)'], ['eff', 'Effektivzins (%)'], ['repay', 'Tilgung (%)'], ['years', 'Zinsbindung (Jahre)'], ['fees', 'Gebühren (€)']];
  box.innerHTML = `<h3>Bankangebote vergleichen</h3><p class="form-note">${PRO() ? 'Kosten bis Bindungsende plus Restschuld; bei unterschiedlichen Bindungen normiert auf den längsten Horizont.' : 'Tragen Sie die Angebote aus dem ESIS-Merkblatt ein. Verglichen wird, was Sie bis zum Ende der Zinsbindung zahlen und was danach noch offen ist.'}</p>
    <div class="tl-offers">${st.list.map((o, i) => `<fieldset class="tl-off"><legend>Angebot ${i + 1}</legend>${F.map(([k, l, t]) => `<label>${l}<input data-o="${i}" data-k="${k}" type="text" ${t ? 'maxlength="40"' : 'inputmode="decimal"'} value="${esc(val(o[k]))}"></label>`).join('')}</fieldset>`).join('')}</div>
    ${PRO() ? `<div class="tl-grid">${inp('anschluss', 'Annahme Anschlusszins (%) für kürzere Bindungen', st.anschluss, 'z. B. Zins heute + 1')}</div>` : ''}
    <div class="tl-out" aria-live="polite"></div>${printBtn('offers', 'Vergleich drucken / als PDF sichern')}`;
  const run = () => {
    box.querySelectorAll('[data-o]').forEach((el) => { st.list[+el.dataset.o][el.dataset.k] = el.value; });
    const a = box.querySelector('[data-f="anschluss"]'); if (a) st.anschluss = a.value;
    save('offers', st);
    const out = box.querySelector('.tl-out');
    const list = st.list.map((o) => ({ ...o, loan: num(o.loan), rate: num(o.rate), eff: num(o.eff), repay: num(o.repay), years: num(o.years), fees: num(o.fees) }));
    const r = PRO() ? normalizeOffers(list, { anschlussRate: num(st.anschluss) }) : compareOffers(list);
    if (!r.rows.length) { out.innerHTML = need('Bitte mindestens ein Angebot mit Darlehen, Sollzins, Tilgung und Zinsbindung eintragen.'); return; }
    const norm = PRO() && !r.sameYears && num(st.anschluss) > 0;
    out.innerHTML = `<div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Angebot</th><th>Rate / Monat</th><th>Zinsen in der Bindung</th><th>Gebühren</th><th>Restschuld am Ende</th>${norm ? `<th>Kosten + Rest bis ${r.horizon} J.</th>` : ''}</tr></thead><tbody>${r.rows.map((x) => `<tr class="${x === r.best ? 'best' : ''}"><td><strong>${esc(x.bank || 'Angebot')}</strong><small>${P(x.rate)} soll${x.eff ? ` · ${P(x.eff)} eff.` : ''} · ${x.years} J.</small></td><td>${E2(x.pay)}</td><td>${E(x.interest)}</td><td>${E(x.fees)}</td><td>${E(x.rest)}</td>${norm ? `<td>${E(x.costH + x.restH)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`
      + chartBars(r.rows.map((x) => ({ label: x.bank || 'Angebot', value: norm ? x.costH + x.restH : x.cost + x.rest, color: x === r.best ? COL.green : COL.navy })), { title: norm ? `Kosten und Restschuld bis Jahr ${r.horizon}` : 'Kosten und Restschuld am Bindungsende' })
      + `<p class="tl-verdict">${r.best ? `<strong>Günstigstes Angebot: ${esc(r.best.bank || 'Angebot')}.</strong> ` : ''}${r.sameYears ? '' : norm ? `Kürzere Bindungen sind mit ${P(num(st.anschluss))} Anschlusszins bis Jahr ${r.horizon} fortgeschrieben – das Ergebnis hängt an dieser Annahme. ` : PRO() ? '<strong>Unterschiedliche Zinsbindungen:</strong> Tragen Sie einen Anschlusszins ein, um die Angebote auf denselben Horizont zu normieren. ' : '<strong>Achtung:</strong> Die Zinsbindungen sind unterschiedlich lang. Eine längere Bindung kostet meist etwas mehr, schützt aber länger vor steigenden Zinsen. '}${PRO() ? 'Bereitstellungszinsen, Sondertilgungsrechte und Tilgungssatzwechsel stehen im ESIS-Merkblatt und sind nicht bepreist.' : 'Vergleichen Sie am besten bei gleicher Tilgung.'}</p>`
      + why('Nicht nur der Zins zählt: Eine niedrige Rate kann bedeuten, dass am Ende mehr Schulden übrig sind. Deshalb addiert der Vergleich Zinsen, Gebühren und Restschuld – der kleinste Wert gewinnt.');
  };
  box.addEventListener('input', run);
  run();
}

// ---------- 5. Bankgespräch vorbereiten (Käufer-Pass) ----------
const Q_EIN = [
  ['Konditionen', ['Wie hoch sind Soll- und Effektivzins – und für welche Zinsbindung?', 'Wie viel Sondertilgung ist kostenlos möglich?', 'Kann ich die Tilgung später ändern?', 'Ab wann fallen Bereitstellungszinsen an?', 'Gibt es Gebühren (Schätzung, Bearbeitung)?']],
  ['Prüfung durch die Bank', ['Mit welchem Beleihungswert rechnen Sie?', 'Mit welchen Lebenshaltungskosten rechnen Sie in der Haushaltsrechnung?', 'Welche Unterlagen fehlen Ihnen noch?']],
  ['Nach der Zusage', ['Wie lange gilt das Angebot?', 'Welche Voraussetzungen gibt es für die Auszahlung?']],
];
const Q_PRO = [
  ['Konditionen und Optionen', ['Zinsstaffel nach Beleihungsauslauf: Wo liegen die Schwellen (60 / 80 / 90 / 100 %)?', 'Bereitstellungszinsfreie Zeit und Satz danach?', 'Sondertilgung p. a., Tilgungssatzwechsel (wie oft, Spanne)?', 'Forward-Option bzw. Anschlussangebot zur Zinsbindung?', 'Ist ein Kündigungsrecht nach § 489 BGB vertraglich unverändert?']],
  ['Bewertung und Sicherheiten', ['Beleihungswert nach BelWertV: Ansatz Ertrags- oder Sachwert, Sicherheitsabschlag?', 'Mietansatz in der Kapitaldienstfähigkeit (Quote, Bewirtschaftungspauschale)?', 'Zweckerklärung der Grundschuld: eng oder weit?', 'Abtretung der Mietforderungen verlangt?']],
  ['Portfolio und Struktur', ['Wie werden Bestandsobjekte und deren Restschulden in der Gesamtbetrachtung angesetzt?', 'Covenants oder Nachbewertungsklauseln?', 'Gesamtkreditrahmen für weitere Käufe?']],
];
function bankTool(box, d) {
  const p = d.profile || {}, o = CTX.obj || {};
  const st = load('bank', {});
  const Q = PRO() ? Q_PRO : Q_EIN;
  const loan = num(o.loan);
  const f = [
    ['Nettoeinkommen / Monat', p.netIncome ? E(num(p.netIncome)) : 'noch offen'],
    ['Eigenkapital', p.equity ? E(num(p.equity)) : 'noch offen'],
    CTX.obj ? ['Objekt', esc(o.name || 'Objekt'), o.price ? `Kaufpreis ${E(num(o.price))}` : ''] : ['Objekte im Konto', String((d.objects || []).filter((x) => x && x.name).length)],
    loan ? ['Darlehenswunsch', E(loan), o.interestPct ? `${P(num(o.interestPct))} Soll / ${P(num(o.repaymentPct || 0))} Tilgung` : ''] : null,
  ];
  box.innerHTML = `<h3>Bankgespräch vorbereiten</h3><p class="form-note">${PRO() ? 'Verhandlungspunkte jenseits des Zinses – Bewertung, Sicherheiten, Optionen.' : 'Ihre Zahlen, die richtigen Fragen und Platz für die Antworten. Ausdrucken und mitnehmen.'}</p>
    ${facts(f)}${!p.netIncome || !p.equity ? '<p class="form-note">Fehlende Angaben ergänzen Sie unter <a href="#konto">Konto › Finanzprofil</a>.</p>' : ''}
    ${Q.map(([h, qs], gi) => `<h4 class="tl-sub">${h}</h4><ol class="tl-q">${qs.map((q, qi) => { const k = (PRO() ? 'p' : 'e') + gi + '_' + qi; return `<li><label><span>${q}</span><input type="text" data-b="${k}" maxlength="200" placeholder="Antwort der Bank" value="${esc(st[k] || '')}"></label></li>`; }).join('')}</ol>`).join('')}
    <label class="tl-notes">Eigene Notizen<textarea data-b="notes" rows="3" maxlength="2000">${esc(st.notes || '')}</textarea></label>
    ${printBtn('bank', 'Gesprächsbogen drucken / als PDF sichern')}`;
  box.addEventListener('input', (e) => { const k = e.target.dataset.b; if (!k) return; st[k] = e.target.value; save('bank', st); });
}

// ---------- 6. Portfolio-Kennzahlen (Investor Pro) ----------
function portfolioTool(box, d) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name && num(o.price) > 0)
    .map((o) => ({ id: o.id, name: o.name, price: num(o.price), loan: num(o.loan), rent: num(o.rent), vacancyPct: num(o.vacancyPct), nonRecoverable: num(o.nonRecoverable), maintenance: num(o.maintenance), interestPct: num(o.interestPct), repaymentPct: num(o.repaymentPct), fixedYears: num(o.fixedYears) }));
  const st = load('portfolio', { shock: 2 });
  box.innerHTML = `<h3>Portfolio-Kennzahlen</h3><p class="form-note">${PRO() ? 'Alle Objekte: NOI, Kapitaldienst, DSCR, LTV und Cashflow nach Zinsschock zum Bindungsende.' : 'Wie stehen Ihre Objekte zusammen da – und was passiert, wenn die Zinsen bei der Anschlussfinanzierung steigen?'}</p>
    <div class="tl-grid">${inp('shock', 'Zinsschock bei Anschluss (%-Punkte)', st.shock)}</div><div class="tl-out" aria-live="polite"></div>${printBtn('portfolio')}`;
  const run = () => {
    read(box, st); save('portfolio', st);
    const out = box.querySelector('.tl-out');
    if (!objs.length) { out.innerHTML = need('Legen Sie unter <a href="#objekte">Objekte</a> mindestens ein Objekt mit Kaufpreis, Miete und Darlehen an.'); return; }
    const pf = portfolio(objs, { shockPp: num(st.shock) });
    const t = pf.total;
    out.innerHTML = facts([
      ['Cashflow / Monat', E2(t.cashflow), 'vor Steuern', t.cashflow < 0 ? 'bad' : 'ok'],
      ['DSCR gesamt', t.dscr == null ? '–' : D(t.dscr), 'NOI ÷ Kapitaldienst', t.dscr != null && t.dscr < 1 ? 'bad' : t.dscr != null && t.dscr < 1.2 ? 'warn' : 'ok'],
      ['LTV gesamt', t.ltv == null ? '–' : P(t.ltv, 1), `${E(t.loan)} auf ${E(t.price)}`],
      t.afterCashflow != null ? ['Cashflow nach Zinsschock', E2(t.afterCashflow), `+${D(num(st.shock), 1)} Pkt. zum Bindungsende`, t.afterCashflow < 0 ? 'bad' : 'ok'] : null,
    ]) + `<div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Objekt</th><th>NOI / Monat</th><th>Rate</th><th>Cashflow</th><th>DSCR</th><th>LTV</th><th>nach Schock</th></tr></thead><tbody>${pf.rows.map((r) => `<tr><td><strong>${esc(r.name)}</strong><small>Bruttorendite ${r.grossYieldPct == null ? '–' : P(r.grossYieldPct)}</small></td><td>${E2(r.noiMonthly)}</td><td>${E2(r.rate)}</td><td>${E2(r.cashflow)}</td><td>${r.dscr == null ? '–' : D(r.dscr)}</td><td>${r.ltv == null ? '–' : P(r.ltv, 1)}</td><td>${r.after ? E2(r.after.cashflow) : '–'}</td></tr>`).join('')}</tbody></table></div>`
      + chartBars(pf.rows.flatMap((r) => [{ label: r.name, value: r.cashflow, color: r.cashflow < 0 ? COL.red : COL.green }, ...(r.after ? [{ label: '… nach Schock', value: r.after.cashflow, color: r.after.cashflow < 0 ? COL.red : COL.amber }] : [])]), { title: 'Cashflow je Objekt (Monat)', fmt: E2 })
      + `<p class="tl-verdict">${pf.rows.filter((r) => r.after && r.after.cashflow < 0).length ? `<strong>${pf.rows.filter((r) => r.after && r.after.cashflow < 0).length} Objekt(e) kippen beim Zinsschock in einen negativen Cashflow.</strong> Prüfen Sie Forward-Darlehen oder Sondertilgung vor dem Bindungsende.` : 'Alle Objekte tragen sich auch nach dem angenommenen Zinsschock.'}${PRO() ? ' NOI = Miete abzüglich Mietausfall, nicht umlagefähiger Kosten und Instandhaltung; „nach Schock“ mit Restschuld zum Bindungsende.' : ''}</p>`
      + why('DSCR zeigt, wie oft die Miete nach Kosten die Bankrate abdeckt. Unter 1,0 legen Sie Geld dazu; viele Banken wünschen mindestens 1,2. Der Zinsschock simuliert einen höheren Zins bei der Anschlussfinanzierung.');
  };
  box.addEventListener('input', run);
  run();
}

// ---------- 7. Anschluss & Forward (Investor Pro) ----------
function forwardTool(box, d) {
  const o = CTX.obj || {};
  const yrs = num(o.fixedYears) || 10;
  const restSeed = num(o.loan) > 0 && num(o.interestPct) > 0 ? Math.round(balanceAfterMonths(num(o.loan), num(o.interestPct) / 100, num(o.repaymentPct || 2) / 100, yrs * 12)) : '';
  let mSeed = '';
  if (o.payoutDate) { const end = new Date(o.payoutDate); end.setMonth(end.getMonth() + yrs * 12); mSeed = Math.max(0, Math.round((end - Date.now()) / 2629800000)); }
  const st = load('fwd', { rest: restSeed, months: mSeed, today: '', sur: 0.02, free: 0, repay: num(o.repaymentPct) || 2, payout: o.payoutDate || '' });
  box.innerHTML = `<h3>Anschluss &amp; Forward</h3><p class="form-note">${PRO() ? 'Forward-Zins aus Vorlauf und Aufschlag, Break-even gegen Zinsszenarien, Kündigungsrecht § 489 BGB.' : 'Wann endet Ihre Zinsbindung – und lohnt es sich, den heutigen Zins schon jetzt zu sichern?'}</p>
    <div class="tl-grid">${inp('rest', 'Restschuld bei Ablauf (€)', st.rest)}${inp('months', 'Monate bis Ablauf', st.months)}${inp('today', 'Heutiger Zins (%)', st.today, 'aktuelles Angebot')}${inp('sur', 'Forward-Aufschlag je Monat (%-Punkte)', st.sur)}${inp('free', 'Aufschlagsfreie Monate', st.free)}${inp('repay', 'Tilgung danach (%)', st.repay)}
    <label>Vollständig ausgezahlt am (§ 489 BGB)<input data-f="payout" type="date" value="${esc(st.payout)}"></label></div>
    <div class="tl-out" aria-live="polite"></div>${printBtn('fwd')}`;
  const run = () => {
    read(box, st); save('fwd', st);
    const out = box.querySelector('.tl-out');
    const v = { rest: num(st.rest), months: num(st.months), today: num(st.today), sur: num(st.sur), free: num(st.free), repay: num(st.repay) };
    if (!(v.rest > 0) || !(v.today > 0) || !(v.repay > 0)) { out.innerHTML = need('Bitte Restschuld, heutigen Zins und Tilgung eintragen.'); return; }
    const r = forwardCalc({ rest: v.rest, monthsToEnd: v.months, todayRate: v.today, surchargePerMonth: v.sur, repay: v.repay, freeMonths: v.free });
    const k = kuendigungsrecht489(st.payout);
    const xs = [-1, 0, 1, 2, 3].map((dd) => v.today + dd);
    out.innerHTML = facts([['Forward-Zins', P(r.fwdRate), `${r.lead} Monate Vorlauf`], ['Rate mit Forward', E2(r.fwdPay)], ['Rate zum heutigen Zins', E2(r.todayPay)]])
      + chartLines([{ name: 'Rate bei Zins zum Ablauf', values: xs.map((z) => monthlyRate(v.rest, Math.max(0, z) / 100, v.repay / 100)), color: COL.navy }, { name: 'Rate mit Forward (fest)', values: xs.map(() => r.fwdPay), color: COL.green, dash: true }], { title: 'Monatsrate je Zinsniveau bei Ablauf', xs: xs.map((z) => P(z, 1)), fmt: (x) => E(x) })
      + `<p class="tl-verdict"><strong>Der Forward lohnt sich, wenn der Zins bei Ablauf über ${P(r.breakEven)} liegt.</strong> ${PRO() ? 'Ein Forward ist bindend; bei Nichtabnahme droht eine Nichtabnahmeentschädigung. Alternativ: Kündigung nach § 489 BGB und Umschuldung.' : 'Er schützt vor steigenden Zinsen – fallen sie, zahlen Sie mehr als nötig.'}</p>`
      + (k ? `<p class="tl-verdict"><strong>§ 489 BGB:</strong> Kündigung ohne Vorfälligkeitsentschädigung ab ${k.from.toLocaleDateString('de-DE')} mit 6 Monaten Frist – frühestes Ende ${k.end.toLocaleDateString('de-DE')}.</p>` : '')
      + why('Ein Forward-Darlehen sichert schon heute den Zins für die Anschlussfinanzierung. Dafür zahlen Sie einen kleinen Aufschlag je Monat Vorlauf.');
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// ---------- 8. Betriebskostenabrechnung (Investor Pro) ----------
function bkTool(box, d) {
  const o = CTX.obj || {};
  const DEF = [['Grundsteuer', 'flaeche'], ['Wasser/Abwasser', 'personen'], ['Müllabfuhr', 'personen'], ['Gebäudeversicherung', 'flaeche'], ['Hausmeister', 'flaeche'], ['Treppenhausreinigung', 'einheit'], ['Gartenpflege', 'flaeche'], ['Allgemeinstrom', 'einheit'], ['Schornsteinfeger', 'einheit'], ['Aufzug', 'flaeche']];
  const st = load('bk', { mieter: '', zeitraum: `${new Date().getFullYear() - 1}`, flaecheGesamt: '', flaecheMieter: num(o.area) || '', personenGesamt: '', personenMieter: '', einheitenGesamt: '', monate: 12, vorauszahlung: '', rows: DEF.map(([t, key]) => ({ t, key, betrag: '' })) });
  const KEYS = [['flaeche', 'Wohnfläche'], ['personen', 'Personen'], ['einheit', 'Wohneinheiten'], ['direkt', 'direkt (100 %)']];
  box.innerHTML = `<h3>Betriebskostenabrechnung</h3><p class="form-note">Kosten des Hauses eintragen, Umlageschlüssel wählen – das Tool verteilt auf Ihre Mietpartei und zieht die Vorauszahlungen ab. Heizkosten nach Heizkostenverordnung separat (Messdienst).</p>
    <div class="tl-grid">${txt('mieter', 'Mieter', st.mieter)}${txt('zeitraum', 'Abrechnungsjahr', st.zeitraum)}${inp('monate', 'Monate bewohnt', st.monate)}${inp('flaecheGesamt', 'Wohnfläche Haus (m²)', st.flaecheGesamt)}${inp('flaecheMieter', 'Wohnfläche Mieter (m²)', st.flaecheMieter)}${inp('personenGesamt', 'Personen Haus', st.personenGesamt)}${inp('personenMieter', 'Personen Mieter', st.personenMieter)}${inp('einheitenGesamt', 'Wohneinheiten', st.einheitenGesamt)}${inp('vorauszahlung', 'Vorauszahlungen im Jahr (€)', st.vorauszahlung)}</div>
    <div class="tl-tablewrap"><table class="tl-table"><thead><tr><th>Kostenart</th><th>Betrag Haus (€)</th><th>Umlageschlüssel</th><th>Anteil Mieter</th></tr></thead><tbody>${st.rows.map((r, i) => `<tr><td><input data-r="${i}" data-rk="t" type="text" maxlength="40" value="${esc(r.t)}"></td><td><input data-r="${i}" data-rk="betrag" type="text" inputmode="decimal" value="${esc(val(r.betrag))}"></td><td><select data-r="${i}" data-rk="key">${KEYS.map(([k, l]) => `<option value="${k}"${r.key === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td><td class="bk-a" data-a="${i}">–</td></tr>`).join('')}</tbody></table></div>
    <div class="tl-out" aria-live="polite"></div>${CTX.print ? '<p class="tl-act"><button type="button" class="btn btn-dark" data-bkprint="1">Abrechnung drucken / als PDF</button></p>' : ''}`;
  let res;
  const run = () => {
    read(box, st);
    box.querySelectorAll('[data-r]').forEach((el) => { st.rows[+el.dataset.r][el.dataset.rk] = el.value; });
    save('bk', st);
    const v = { rows: st.rows.map((r) => ({ ...r, betrag: num(r.betrag) })), flaecheGesamt: num(st.flaecheGesamt), flaecheMieter: num(st.flaecheMieter), personenGesamt: num(st.personenGesamt), personenMieter: num(st.personenMieter), einheitenGesamt: num(st.einheitenGesamt), monate: num(st.monate) || 12, vorauszahlung: num(st.vorauszahlung) };
    res = betriebskosten(v);
    v.rows.forEach((r, i) => { const x = res.rows.find((y) => y.t === r.t && y.betrag === r.betrag); const c = box.querySelector(`[data-a="${i}"]`); if (c) c.textContent = x ? E2(x.anteil) : '–'; });
    const out = box.querySelector('.tl-out');
    if (!res.rows.length) { out.innerHTML = need('Tragen Sie die Kosten des Hauses und die Verteilschlüssel ein.'); return; }
    out.innerHTML = facts([['Kosten Mieter', E2(res.summe)], ['Vorauszahlungen', E2(v.vorauszahlung)], [res.saldo >= 0 ? 'Nachzahlung' : 'Guthaben', E2(Math.abs(res.saldo)), '', res.saldo >= 0 ? 'warn' : 'ok']])
      + chartBars(res.rows.map((r) => ({ label: r.t, value: r.anteil, color: COL.blue })), { title: 'Anteil des Mieters je Kostenart', fmt: E2 })
      + '<p class="tl-verdict">Die Abrechnung muss spätestens 12 Monate nach Ende des Abrechnungszeitraums zugehen (§ 556 Abs. 3 BGB). Umlagefähig sind nur Kosten nach Betriebskostenverordnung, die im Mietvertrag vereinbart sind.</p>';
    res.v = v;
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
  box.querySelector('[data-bkprint]')?.addEventListener('click', () => {
    if (!res?.rows.length) return;
    const w = window.open('', '_blank'); if (!w) return;
    const keyL = Object.fromEntries(KEYS), v = res.v;
    w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Betriebskostenabrechnung ${esc(st.zeitraum)}</title><style>body{font:13.5px/1.5 system-ui,sans-serif;margin:28px;color:#0F172A}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #CBD5E1;padding:6px;text-align:left}td.r,th.r{text-align:right}h1{font-size:20px}.n{font-size:11px;color:#475569;margin-top:18px}</style></head><body>
      <h1>Betriebskostenabrechnung ${esc(st.zeitraum)}</h1><p>Mieter: <strong>${esc(st.mieter || '–')}</strong> · Wohnfläche ${D(v.flaecheMieter, 0)} von ${D(v.flaecheGesamt, 0)} m² · Personen ${v.personenMieter} von ${v.personenGesamt} · Einheiten ${v.einheitenGesamt} · ${v.monate} Monate</p>
      <table><tr><th>Kostenart</th><th class="r">Gesamtkosten</th><th>Schlüssel</th><th class="r">Ihr Anteil</th></tr>${res.rows.map((r) => `<tr><td>${esc(r.t)}</td><td class="r">${E2(r.betrag)}</td><td>${keyL[r.key]}</td><td class="r">${E2(r.anteil)}</td></tr>`).join('')}
      <tr><th colspan="3">Summe Ihrer Kosten</th><th class="r">${E2(res.summe)}</th></tr><tr><td colspan="3">abzüglich Vorauszahlungen</td><td class="r">− ${E2(v.vorauszahlung)}</td></tr><tr><th colspan="3">${res.saldo >= 0 ? 'Nachzahlung' : 'Guthaben'}</th><th class="r">${E2(Math.abs(res.saldo))}</th></tr></table>
      <p>Die Belege können nach Absprache eingesehen werden.</p><p class="n">Erstellt mit LeaseRun am ${new Date().toLocaleDateString('de-DE')}. Vorlage ohne Gewähr für die rechtliche Wirksamkeit im Einzelfall; keine Rechtsdienstleistung.</p></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  });
}

function printBox(box, title) {
  const w = window.open('', '_blank');
  if (!w) return;
  const clone = box.cloneNode(true);
  clone.querySelectorAll('input,textarea,select').forEach((el) => { const s = document.createElement('span'); s.className = 'pv'; s.textContent = el.type === 'checkbox' ? (el.checked ? 'ja' : 'nein') : el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text || '') : el.value || '—'; el.replaceWith(s); });
  clone.querySelectorAll('.tl-act,.tl-hint,.tl-why,.tl-need').forEach((el) => el.remove());
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)} – LeaseRun</title><style>body{font:14px/1.5 system-ui,sans-serif;color:#0F172A;margin:28px}h3{color:#0F2C59}table{border-collapse:collapse;width:100%}td,th{border:1px solid #CBD5E1;padding:6px;text-align:left}tr.best{background:#DCFCE7}label{display:block;margin:4px 0}.pv{font-weight:700;margin-left:6px}fieldset{border:1px solid #CBD5E1;margin:0 0 8px}small{display:block;color:#475569}.tl-facts{display:flex;gap:16px;flex-wrap:wrap}.tl-chart{margin:10px 0}.tl-chart svg{max-width:640px;width:100%}.tl-legend span{margin-right:12px}.tl-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px}footer{margin-top:24px;font-size:11px;color:#64748B}</style></head><body>${clone.innerHTML}<footer>Erstellt mit LeaseRun am ${new Date().toLocaleDateString('de-DE')}. Rechnerische Orientierung, keine Finanzierungs- oder Rechtsberatung.</footer></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

// ---------- Register: Tarif und Reihenfolge je Ansicht ----------
// need: 'free' (kostenlos) · 'pass' (Käufer-Pass oder Investor Pro) · 'pro' (Investor Pro)
const TOOLS = {
  nk: ['Kaufnebenkosten & Eigenkapital', 'free', 'Was zum Kaufpreis dazukommt und ob das Eigenkapital reicht.', nkTool],
  price: ['Kaufpreis-Check', 'free', 'Höchstpreis und Verhandlungsspielraum.', priceTool],
  special: ['Sondertilgung', 'free', 'Zinsersparnis und kürzere Laufzeit.', specialTool],
  offers: ['Bankangebote vergleichen', 'pass', 'Welches Angebot bis zum Bindungsende am günstigsten ist.', offersTool],
  bank: ['Bankgespräch vorbereiten', 'pass', 'Ihre Zahlen, die richtigen Fragen, Platz für Antworten.', bankTool],
  portfolio: ['Portfolio-Kennzahlen', 'pro', 'Alle Objekte: Cashflow, DSCR, LTV und Zinsschock.', portfolioTool],
  fwd: ['Anschluss & Forward', 'pro', 'Forward-Zins, Break-even und § 489 BGB.', forwardTool],
  bk: ['Betriebskostenabrechnung', 'pro', 'Kosten auf Mieter verteilen und abrechnen.', bkTool],
};
// Einsteiger: in Kauf-Reihenfolge (erst rechnen, dann verhandeln, dann Bank). Profi: Bestand und Kennzahlen zuerst.
const ORDER = {
  einsteiger: { main: ['nk', 'price', 'offers', 'bank', 'special'], more: ['portfolio', 'fwd', 'bk'] },
  profi: { main: ['portfolio', 'price', 'offers', 'fwd', 'special', 'bk'], more: ['nk', 'bank'] },
};
const PLAN_LINE = {
  free: (m) => m === 'profi' ? 'Kostenlos: Kaufnebenkosten, Kaufpreis-Check und Sondertilgung. Bankangebote und Bankgespräch mit dem Käufer-Pass; Portfolio, Anschluss und Betriebskosten mit Investor Pro.' : 'Kostenlos: Kaufnebenkosten, Kaufpreis-Check und Sondertilgung. Bankangebote, Bankgespräch, Druck und Angebotsschreiben mit dem Käufer-Pass.',
  starter: () => 'Käufer-Pass aktiv: alle Kauf-Tools inklusive Druck und Angebotsschreiben. Portfolio, Anschluss und Betriebskosten mit Investor Pro.',
  pro: () => 'Investor Pro aktiv: alle Software-Tools ohne Einschränkung.',
};
const TICON = {
  nk: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h8"/>',
  price: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  special: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  offers: '<path d="M3 21h18M5 21V10M10 21V10M14 21V10M19 21V10M2 10l10-6 10 6z"/>',
  bank: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  portfolio: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  fwd: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  bk: '<path d="M7 3h10v18l-3-2-2 2-2-2-3 2z"/><path d="M10 8h4M10 12h4"/>',
};
const RANK = { free: 0, pass: 1, pro: 2 };
const TIER_RANK = { free: 0, starter: 1, pro: 2 };

// „Rechnen mit: Beispiel“ – vorgefertigte Musterwohnung, wie ein Profi sie anlegen würde (klar als Beispiel gekennzeichnet).
const EX_OBJ = { id: 'beispiel', name: 'Beispiel: 3-Zimmer-Wohnung (Profi-Vorlage)', price: 300000, rent: 1000, area: 75, equity: 66000, land: 'hessen', brokerPct: 3.57,
  loan: 270000, interestPct: 3.8, repaymentPct: 2, fixedYears: 10, nonRecoverable: 120, maintenance: 80, vacancyPct: 2, marginalTaxPct: 35, payoutDate: '' };
const EX_PROFILE = { equity: 66000, land: 'hessen', marginalTaxPct: 35, netIncome: 4200 };

// Einsteiger: „So würde ein Profi das ausfüllen“ – nur auf Knopfdruck, klar als Beispiel gekennzeichnet;
// die eigenen Eingaben werden vorher gesichert und lassen sich mit einem Tipp wiederherstellen.
const PROFI_EX = {
  nk: { v: { price: 300000, land: 'hessen', broker: 3.57, equity: 66000 }, tips: [
    'Kaufpreis aus dem Exposé – aber erst nach dem Kaufpreis-Check als Obergrenze verwenden.',
    'Bundesland immer wählen: Die Grunderwerbsteuer liegt je nach Land zwischen 3,5 und 6,5 %.',
    'Makler: Käuferanteil laut Exposé (in Hessen meist 3,57 %); provisionsfrei = 0.',
    'Eigenkapital: mindestens die Kaufnebenkosten (hier rund 36.000 €) plus etwa 10 % des Kaufpreises – das senkt den Zins spürbar.'] },
  price: { v: { asking: 300000, rent: 1000, costPct: 20, equity: 66000, rate: 3.8, repay: 2, land: 'hessen', broker: 3.57, targetCf: 0, targetYield: '' }, tips: [
    'Angebotspreis aus dem Exposé, Kaltmiete aus Mietvertrag bzw. Mietspiegel – nie die „mögliche“ Miete aus der Werbung.',
    'Kosten großzügig mit 20 % der Miete ansetzen (nicht umlagefähige Kosten, Instandhaltung, Leerstand).',
    'Zins aus einem aktuellen Bankangebot plus Puffer – lieber 0,3 Prozentpunkte zu hoch als zu niedrig.',
    'Ziel „0 € übrig“: Die Miete trägt die Rate. Alles darüber ist Ihr Verhandlungsspielraum.'] },
  special: { v: { loan: 240000, rate: 3.8, repay: 2, special: 4800, years: 10, vermietet: false, tax: '', alt: '' }, tips: [
    'Darlehen und Zins genau aus dem Darlehensvertrag übernehmen.',
    'Sondertilgung: höchstens das, was kostenlos erlaubt ist (oft 5 % pro Jahr) – hier 2 % des Darlehens.',
    'Erst Notgroschen (3–6 Monatsausgaben) aufbauen, dann sondertilgen – getilgtes Geld bekommen Sie nicht zurück.',
    'Bei vermieteten Objekten ist der Zins steuerlich absetzbar; dort lohnt Sondertilgung oft weniger.'] },
};

export async function mountTools(view, { d, tier = 'free', b2b = false, mode = 'einsteiger', features = {} }) {
  const m = mode === 'profi' ? 'profi' : 'einsteiger';
  const t = b2b ? 'pro' : ['starter', 'pro'].includes(tier) ? tier : 'free';
  // Alte Eingaben mit Beispielzahlen (vor der Personalisierung) einmalig entfernen.
  try { Object.keys(localStorage).filter((k) => k.startsWith('lr-tool-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ohne Speicher */ }
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => o && o.name);
  let pick = null; try { pick = sessionStorage.getItem('lr-tool2-obj'); } catch { /* ohne Speicher */ }
  const demo = pick === 'beispiel';
  const sel = demo ? EX_OBJ : objs.find((o) => String(o.id) === pick) || (pick === 'eigen' ? null : objs.find((o) => num(o.price) > 0) || null);
  // Einzelfreigaben aus dem Web-Admin: „on“ schaltet frei, „off“ sperrt – sonst gilt der Tarif.
  const F = b2b ? {} : (features || {});
  CTX = { ...CTX, mode: m, tier: t, print: F.druck === 'on' || (F.druck !== 'off' && t !== 'free'), obj: sel, objId: demo ? 'beispiel' : sel ? String(sel.id || objs.indexOf(sel)) : 'eigen' };
  const dd = demo ? { ...d, profile: { ...(d.profile || {}), ...EX_PROFILE } } : d;
  try {
    const PR = await fetch('/data/preise.json').then((r) => r.json());
    const pl = Object.fromEntries((PR.privat?.plans || []).map((x) => [x.id, x]));
    const eur = (c) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 }) + ' €';
    CTX.prices = { pass: pl['buyer-pass'] ? `${eur(pl['buyer-pass'].cents)} einmalig` : CTX.prices.pass, pro: pl['pro-monthly'] ? `${eur(pl['pro-monthly'].cents)}/Monat` : CTX.prices.pro };
  } catch { /* Standardpreise */ }
  const has = (id) => (F['t_' + id] === 'on' ? true : F['t_' + id] === 'off' ? false : TIER_RANK[t] >= RANK[TOOLS[id][1]]);
  const o = ORDER[m];
  const lockCard = (id) => { const [title, nd, desc] = TOOLS[id]; return `<h3>${esc(title)} <span class="tl-badge">${nd === 'pro' ? 'Investor Pro' : 'Käufer-Pass'}</span></h3><p class="form-note">${esc(desc)}</p><p class="tl-hint">${LOCK_SVG} Enthalten in ${nd === 'pro' ? `Investor Pro (${esc(CTX.prices.pro)})` : `Käufer-Pass (${esc(CTX.prices.pass)}) und Investor Pro`} · <a href="#angebot">Tarife ansehen</a></p>`; };
  const sec = (id) => `<section class="tl-card${has(id) ? '' : ' tl-locked'}" id="t-${id}" hidden></section>`;
  const mainIds = [...o.main.filter(has), ...o.main.filter((id) => !has(id))];
  view.innerHTML = `<div class="tl-top"><div><h2 class="tl-h">Software-Tools</h2><p class="form-note">${m === 'profi' ? 'Kennzahlen und Fachlogik: Beleihungsauslauf, normierter Angebotsvergleich, Steuerwirkung, Portfolio-Stresstest.' : 'Schritt für Schritt durch Ihren Kauf – jedes Tool rechnet mit Ihren eigenen Zahlen und erklärt das Ergebnis.'}</p></div><span class="tl-plan tl-plan-${t}">${t === 'pro' ? 'Investor Pro' : t === 'starter' ? 'Käufer-Pass' : 'Kostenlos'}</span></div>
    <p class="tl-planline">${esc(PLAN_LINE[t](m))}</p>
    <div class="tl-base"><label>Rechnen mit<select id="tlObj"><option value="eigen"${sel ? '' : ' selected'}>Eigenen Werten (leer starten)</option><option value="beispiel"${demo ? ' selected' : ''}>Beispiel (Profi-Vorlage, vorausgefüllt)</option>${objs.map((x) => `<option value="${esc(String(x.id))}"${x === sel ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>${demo ? '<small class="tl-demo"><strong>Beispielzahlen</strong> – 3-Zimmer-Wohnung für 300.000 € in Hessen, so wie ein Profi sie anlegt. Nicht Ihre Zahlen: Zum Ausprobieren ändern oder oben „Eigenen Werten“ wählen.</small>' : objs.length ? '<small>Werte aus Objekt und Finanzprofil werden übernommen und lassen sich je Tool anpassen.</small>' : '<small>Noch kein Objekt angelegt – <a href="#objekte">Objekt anlegen</a>, dann rechnen die Tools mit Ihren Zahlen.</small>'}</div>
    <div class="obj-pick tl-pickgrid" role="group" aria-label="Software-Tools">${[...mainIds, ...o.more].map((id, i) => `<button type="button" class="obj-op${has(id) ? '' : ' off'}" data-tl="${id}" aria-expanded="false"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TICON[id] || TICON.nk}</svg><span><strong>${m === 'einsteiger' && i < mainIds.length && has(id) ? `${i + 1}. ` : ''}${esc(TOOLS[id][0])}</strong><small>${has(id) ? esc(TOOLS[id][2]) : `${esc(TOOLS[id][2])} · ${TOOLS[id][1] === 'pro' ? 'Investor Pro' : 'Käufer-Pass'}`}</small></span><svg class="obj-op-c" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div>
    <p class="tl-links"><a href="#steuer">Steuer &amp; AfA</a> · <a href="/calculators">Alle Rechner</a></p>
    
    ${[...mainIds, ...o.more].map(sec).join('')}
    <p class="form-note tl-foot">Ihre Eingaben bleiben nur in diesem Browser. <button type="button" class="text-btn" id="tlClear">Eingaben zurücksetzen</button></p>`;
  const q = (id) => view.querySelector('#t-' + id);
  const mount = (id) => {
    const b = q(id); if (!b) return; if (!has(id)) { b.innerHTML = lockCard(id); return; }
    TOOLS[id][3](b, dd);
    const ex = PROFI_EX[id];
    if (m !== 'einsteiger' || !ex || demo) return;
    const bak = 'lr-tool2-bak-' + id;
    let shown = false; try { shown = !!sessionStorage.getItem(bak); } catch { /* ohne Speicher */ }
    b.querySelector('h3')?.insertAdjacentHTML('afterend', shown
      ? `<div class="tl-ex on"><p><strong>Beispiel eines Profis</strong> – nicht Ihre Zahlen. So geht ein erfahrener Käufer vor:</p><ul>${ex.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul><button type="button" class="btn btn-outline" data-ex-back>Meine eigenen Werte wiederherstellen</button></div>`
      : '<div class="tl-ex"><button type="button" class="btn btn-outline" data-ex-go><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/></svg>So würde ein Profi das ausfüllen</button></div>');
    b.querySelector('[data-ex-go]')?.addEventListener('click', () => {
      try { sessionStorage.setItem(bak, localStorage.getItem(KEY(id)) ?? '__leer__'); localStorage.setItem(KEY(id), JSON.stringify(ex.v)); } catch { /* ohne Speicher */ }
      mount(id);
    });
    b.querySelector('[data-ex-back]')?.addEventListener('click', () => {
      try { const v = sessionStorage.getItem(bak); sessionStorage.removeItem(bak); if (v === '__leer__' || v == null) localStorage.removeItem(KEY(id)); else localStorage.setItem(KEY(id), v); } catch { /* ohne Speicher */ }
      mount(id);
    });
  };
  // Tools erst beim Antippen öffnen: vorher ist nur die Auswahl sichtbar, danach genau ein Tool.
  const mounted = new Set();
  const open = (id, scroll) => {
    CTX.open = id || null;
    view.querySelectorAll('.tl-card').forEach((c) => { c.hidden = c.id !== 't-' + id; });
    view.querySelectorAll('[data-tl]').forEach((a) => { const on = a.dataset.tl === id; a.classList.toggle('on', on); a.setAttribute('aria-expanded', String(on)); });
        if (!id) return;
    if (!mounted.has(id)) { mounted.add(id); mount(id); }
    const c = q(id);
    if (scroll && c) requestAnimationFrame(() => { const top = c.getBoundingClientRect().top + window.scrollY - (document.querySelector('.app-top')?.offsetHeight || 0) - 12; window.scrollTo({ top, behavior: 'smooth' }); });
  };
  if (CTX.open && TOOLS[CTX.open]) open(CTX.open, false);
  view.querySelector('#tlObj')?.addEventListener('change', (e) => { try { sessionStorage.setItem('lr-tool2-obj', e.target.value); } catch { /* ohne Speicher */ } mountTools(view, { d, tier, b2b, mode, features }); });
  view.querySelector('#tlClear')?.addEventListener('click', () => { if (!confirm('Eingaben in den Software-Tools zurücksetzen? Die Werte werden danach wieder aus Objekt und Finanzprofil übernommen.')) return; try { Object.keys(localStorage).filter((k) => k.startsWith('lr-tool2-')).forEach((k) => localStorage.removeItem(k)); } catch { /* ohne Speicher */ } mountTools(view, { d, tier, b2b, mode, features }); });
  view.onclick = (e) => { const b = e.target.closest('[data-print]'); if (b) printBox(b.closest('.tl-card'), TOOLS[b.dataset.print]?.[0] || 'LeaseRun'); };
  view.querySelectorAll('button[data-tl]').forEach((a) => a.onclick = (e) => { e.preventDefault(); open(CTX.open === a.dataset.tl ? null : a.dataset.tl, true); });
}
