// Cockpit je Modus (Privatbereich):
//  Einsteiger – Budget-Tacho, Haushaltsüberschuss, maximaler Kaufpreis, Warmrate, Eigenkapital, Nebenkosten-Ampel.
//  Profi      – RenditeRadar, 10-Jahres-Vermögenskurve, Szenarien für Mietausfall und Anschlussfinanzierung.
// Angemeldet gibt es keine Beispielzahlen: Alles rechnet mit Finanzprofil und Objekten des Kunden; fehlt etwas, steht dort ein Hinweis.
import { budget, kaufnebenkosten, monthlyRate, tilgungsplan, GREST } from './calc.mjs?v=892f3666';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const E = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : Number(x).toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d }));
const P = (x, d = 1) => (x == null || Number.isNaN(x) ? '–' : `${Number(x).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const n = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0; };

// Fachbegriffe in einfachen Worten (Tooltip auf Tippen und Fokus).
const TIPS = {
  tilgung: 'Tilgung ist der Teil Ihrer Rate, mit dem Sie den Kredit zurückzahlen. Der Rest der Rate sind Zinsen.',
  grundschuld: 'Die Grundschuld ist die Sicherheit für die Bank: Sie wird im Grundbuch eingetragen. Zahlen Sie nicht, darf die Bank die Immobilie verwerten.',
  notar: 'Notar und Grundbuchamt kosten zusammen rund 2 % des Kaufpreises. Ohne Notar ist ein Immobilienkauf in Deutschland nicht wirksam.',
  nebenkosten: 'Kaufnebenkosten: Grunderwerbsteuer, Notar, Grundbuch und ggf. Makler. Banken finanzieren sie selten mit – sie sollten aus Ihrem Eigenkapital kommen.',
  warmrate: 'Warmrate = Kreditrate plus laufende Wohnkosten (z. B. Hausgeld, Heizung, Strom). Das ist, was Sie monatlich wirklich zahlen.',
};
export const tip = (k, label) => `<span class="tipw">${label}<button type="button" class="tip" aria-label="Was bedeutet ${esc(label)}?" data-tip="${esc(TIPS[k])}">?</button></span>`;

// Halbkreis-Tacho: 0–60 % Belastung (Grün bis 35, Gelb bis 45, Rot darüber).
function tacho(pct) {
  const p = Math.max(0, Math.min(60, pct ?? 0)), ang = Math.PI * (1 - p / 60);
  const x = 100 + 78 * Math.cos(ang), y = 100 - 78 * Math.sin(ang);
  const arc = (a0, a1, c) => { const s = Math.PI * (1 - a0 / 60), e = Math.PI * (1 - a1 / 60); return `<path d="M${100 + 86 * Math.cos(s)} ${100 - 86 * Math.sin(s)} A86 86 0 0 1 ${100 + 86 * Math.cos(e)} ${100 - 86 * Math.sin(e)}" stroke="${c}" stroke-width="16" fill="none"/>`; };
  return `<svg viewBox="0 0 200 118" class="tacho" role="img" aria-label="Belastung ${pct == null ? 'unbekannt' : Math.round(pct) + ' % des Nettoeinkommens'}">
    ${arc(0, 35, '#22C55E')}${arc(35, 45, '#F59E0B')}${arc(45, 60, '#EF4444')}
    ${pct == null ? '' : `<line x1="100" y1="100" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#0F2C59" stroke-width="5" stroke-linecap="round"/><circle cx="100" cy="100" r="8" fill="#0F2C59"/>`}
  </svg>`;
}

// ---------------- Einsteiger ----------------
export function mountEinsteiger(box, { d, save }) {
  const pr = d.profile || {};
  const land = GREST[pr.land] ? pr.land : '';
  box.innerHTML = `<section class="cm cm-ein" aria-label="Mein Budget">
    <h4 class="sc-h">Mein Budget auf einen Blick</h4>
    <div class="cm-in">
      <label>Netto im Monat (€)<input id="cm_net" type="number" min="0" step="50" inputmode="decimal" value="${n(pr.netIncome) || ''}"></label>
      <label>Ausgaben im Monat ohne Wohnen (€)<input id="cm_out" type="number" min="0" step="50" inputmode="decimal" value="${n(pr.expenses) || ''}" placeholder="Essen, Auto, Versicherungen …"></label>
      <label>Eigenkapital (€)<input id="cm_eq" type="number" min="0" step="1000" inputmode="decimal" value="${pr.equity === undefined || pr.equity === '' ? '' : n(pr.equity)}"></label>
      <label>Wunsch-Kaufpreis (€, optional)<input id="cm_tp" type="number" min="0" step="5000" inputmode="decimal" value="${n(pr.targetPrice) || ''}"></label>
      <label>Wohnkosten ohne Rate (€/Monat)<input id="cm_wk" type="number" min="0" step="10" inputmode="decimal" value="${n(pr.housingCosts) || ''}" placeholder="Hausgeld, Heizung, Strom"></label>
      <label>Bundesland<select id="cm_land"><option value="">bitte wählen</option>${Object.entries(GREST).map(([k, g]) => `<option value="${k}"${k === land ? ' selected' : ''}>${g.name}</option>`).join('')}</select></label>
    </div>
    <div id="cm_out_box" aria-live="polite"></div>
    <p class="form-note">Annahmen für die Rate: 3,5 % Sollzins, 2 % ${tip('tilgung', 'Tilgung')}, 20 % Puffer vom Überschuss. Orientierung, keine Kreditzusage.</p>
  </section>`;
  const $ = (id) => box.querySelector('#' + id);
  let t = 0;
  const calc = () => {
    const net = n($('cm_net').value), out = n($('cm_out').value), eq = n($('cm_eq').value), tp = n($('cm_tp').value), wk = n($('cm_wk').value), ld = $('cm_land').value;
    const o = $('cm_out_box');
    if (!net || !ld || $('cm_out').value === '') { o.innerHTML = `<p class="cm-empty">Bitte Netto, Ausgaben und Bundesland eintragen – dann sehen Sie Ihren Rahmen. ${$('cm_eq').value === '' ? 'Eigenkapital gern dazu.' : ''}</p>`; return; }
    const b = budget({ netIncome: net, expenses: out + wk, equity: eq, ratePa: 0.035, repaymentPa: 0.02, land: ld });
    const price = tp > 0 ? tp : b.price;
    const nk = kaufnebenkosten({ price, land: ld });
    const loan = Math.max(0, price + nk.total - eq);
    const rate = monthlyRate(loan, 0.035, 0.02), warm = rate + wk;
    const load = net > 0 ? (warm / net) * 100 : null;
    const surplus = net - out - warm;
    const lamp = eq >= nk.total + price * 0.1 ? ['ok', 'gut gedeckt'] : eq >= nk.total ? ['warn', 'knapp gedeckt'] : ['bad', 'nicht gedeckt'];
    const zone = load == null ? ['', '–'] : load <= 35 ? ['ok', 'Komfortabel'] : load <= 45 ? ['warn', 'Knapp'] : ['bad', 'Überlastung'];
    const w = Math.max(1, net);
    o.innerHTML = `<div class="cm-grid">
      <div class="cm-tacho ${zone[0]}">${tacho(load)}<strong>${zone[1]}</strong><small>${load == null ? '' : `${Math.round(load)} % Ihres Nettos gehen ins Wohnen`}</small></div>
      <div class="cm-kpis">
        <div class="cm-k"><small>Maximaler Kaufpreis</small><strong>${E(b.price)}</strong><span>bei Ihrem Überschuss</span></div>
        <div class="cm-k"><small>${tip('warmrate', 'Monatliche Warmrate')}</small><strong>${E(warm)}</strong><span>${tp > 0 ? 'für Ihren Wunschpreis' : 'beim maximalen Kaufpreis'}</span></div>
        <div class="cm-k"><small>Benötigtes Eigenkapital</small><strong>${E(nk.total)}</strong><span>mindestens · empfohlen ${E(nk.total + price * 0.1)}</span></div>
        <div class="cm-k ${lamp[0]}"><small>${tip('nebenkosten', 'Kaufnebenkosten')}</small><strong>${E(nk.total)}</strong><span><i class="amp ${lamp[0]}"></i> Eigenkapital ${lamp[1]}</span></div>
      </div></div>
      <div class="cm-hh" aria-label="Haushaltsrechnung"><small>Haushaltsrechnung pro Monat</small>
        <div class="cm-bar"><span class="b-out" style="width:${Math.min(100, (out / w) * 100)}%" title="Ausgaben"></span><span class="b-wohn" style="width:${Math.min(100, (warm / w) * 100)}%" title="Wohnen"></span><span class="b-rest ${surplus < 0 ? 'neg' : ''}" style="width:${Math.max(0, Math.min(100, (surplus / w) * 100))}%" title="Überschuss"></span></div>
        <div class="cm-leg"><span><i class="b-out"></i>Ausgaben ${E(out)}</span><span><i class="b-wohn"></i>Wohnen ${E(warm)}</span><span><i class="b-rest"></i>${surplus < 0 ? 'Fehlbetrag' : 'Übrig'} ${E(Math.abs(surplus))}</span></div></div>
      <p class="form-note">Grunderwerbsteuer, ${tip('notar', 'Notar')} und Grundbuch sind eingerechnet (${GREST[ld].name}). Die Bank sichert den Kredit mit einer ${tip('grundschuld', 'Grundschuld')}.</p>`;
    clearTimeout(t);
    t = setTimeout(() => save({ netIncome: net, expenses: out, equity: $('cm_eq').value === '' ? '' : eq, targetPrice: tp, housingCosts: wk, land: ld }), 600);
  };
  box.addEventListener('input', calc); box.addEventListener('change', calc);
  calc();
}

// ---------------- Profi ----------------
// Kennzahlen je Objekt (gleiche Logik wie im Portfolio): NOI, Rate, Cashflow, DSCR, LTV, Rendite, Faktor.
function objMetrics(o) {
  const price = n(o.price), rent = n(o.rent), loan = n(o.loan), zi = n(o.interestPct) / 100, ti = n(o.repaymentPct) / 100;
  const noi = rent * (1 - n(o.vacancyPct) / 100) - n(o.nonRecoverable) - n(o.maintenance);
  const rate = monthlyRate(loan, zi, ti);
  return { price, rent, loan, zi, ti, noi, rate, cf: noi - rate, dscr: rate > 0 ? noi / rate : null, ltv: price > 0 ? (loan / price) * 100 : null, gross: price > 0 ? (rent * 12 / price) * 100 : null, factor: rent > 0 ? price / (rent * 12) : null, fixed: n(o.fixedYears) || 10 };
}

// RenditeRadar: fünf Achsen, jeweils 0 (schwach) bis 1 (stark). Grenzen sind LeaseRun-Annahmen und werden angezeigt.
function radar(m) {
  const cl = (x) => Math.max(0, Math.min(1, x));
  const ax = [
    ['Bruttorendite', m.gross == null ? 0 : cl(m.gross / 7), P(m.gross)],
    ['DSCR', m.dscr == null ? 0 : cl((m.dscr - 0.6) / 0.9), m.dscr == null ? '–' : m.dscr.toFixed(2).replace('.', ',')],
    ['Cashflow', cl((m.cf + 400) / 800), E(m.cf)],
    ['Beleihung', m.ltv == null ? 0 : cl((110 - m.ltv) / 60), m.ltv == null ? '–' : P(m.ltv, 0)],
    ['Faktor', m.factor == null ? 0 : cl((32 - m.factor) / 14), m.factor == null ? '–' : m.factor.toFixed(1).replace('.', ',')],
  ];
  const c = 110, R = 78, pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / ax.length; return [c + r * Math.cos(a), c + r * Math.sin(a)]; };
  const ring = (f) => ax.map((_, i) => pt(i, R * f).map((v) => v.toFixed(1)).join(',')).join(' ');
  const poly = ax.map(([, v], i) => pt(i, R * Math.max(0.04, v)).map((x) => x.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 220 220" class="radar" role="img" aria-label="RenditeRadar">
    ${[0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" class="rg"/>`).join('')}
    ${ax.map((_, i) => { const [x, y] = pt(i, R); return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rg"/>`; }).join('')}
    <polygon points="${poly}" class="rp"/>
    ${ax.map(([l, , v], i) => { const [x, y] = pt(i, R + 20); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="rl">${esc(l)}</text><text x="${x.toFixed(1)}" y="${(y + 11).toFixed(1)}" text-anchor="middle" class="rv">${esc(v)}</text>`; }).join('')}
  </svg>`;
}

// 10-Jahres-Vermögenskurve: Eigenkapital im Objekt = Wert − Restschuld, plus kumulierter Cashflow (vor Steuern).
function wealth(m, o, { growthPct = 0, vacancyPct = null, refiPct = null } = {}) {
  const years = [];
  let cum = 0;
  const vac = vacancyPct == null ? n(o.vacancyPct) : vacancyPct;
  const noi = m.rent * (1 - vac / 100) - n(o.nonRecoverable) - n(o.maintenance);
  const plan = m.loan > 0 && m.ti > 0 ? tilgungsplan({ loan: m.loan, ratePa: m.zi, repaymentPa: m.ti, fixedYears: m.fixed, maxYears: 60 }) : null;
  let bal = m.loan;
  for (let y = 1; y <= 10; y++) {
    const inFixed = y <= m.fixed;
    const zi = inFixed || refiPct == null ? m.zi : refiPct / 100;
    const rate = m.loan > 0 ? monthlyRate(m.loan, zi, m.ti) : 0;
    if (plan && inFixed) bal = plan.years[y - 1]?.balance ?? bal;
    else if (m.loan > 0) { const interest = bal * zi; bal = Math.max(0, bal - Math.max(0, rate * 12 - interest)); }
    cum += (noi - rate) * 12;
    const value = m.price * Math.pow(1 + growthPct / 100, y);
    years.push({ y, eq: value - bal, cum, bal, value, cf: noi - rate });
  }
  return years;
}
function curve(ys) {
  const W = 320, H = 150, pad = 30;
  const vals = ys.map((x) => x.eq + x.cum);
  const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
  const X = (i) => pad + (i * (W - pad - 8)) / (ys.length - 1), Y = (v) => H - 20 - ((v - lo) / (hi - lo || 1)) * (H - 40);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="wcurve" role="img" aria-label="Vermögen nach 10 Jahren ${E(vals[vals.length - 1])}">
    <line x1="${pad}" x2="${W - 8}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}" class="wz"/>
    <path d="${line} L${X(ys.length - 1).toFixed(1)} ${Y(lo).toFixed(1)} L${X(0).toFixed(1)} ${Y(lo).toFixed(1)} Z" class="wa"/><path d="${line}" class="wl"/>
    ${ys.map((x, i) => (i % 3 === 2 || i === 0 ? `<text x="${X(i).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="wt">J${x.y}</text>` : '')).join('')}
    <text x="${X(ys.length - 1).toFixed(1)}" y="${(Y(vals[vals.length - 1]) - 6).toFixed(1)}" text-anchor="end" class="wv">${E(vals[vals.length - 1])}</text>
  </svg>`;
}

export function mountProfi(box, { d }) {
  const objs = (Array.isArray(d.objects) ? d.objects : []).filter((o) => n(o.price) > 0);
  if (!objs.length) { box.innerHTML = '<p class="form-note pro-empty">RenditeRadar, Vermögenskurve und Szenarien erscheinen, sobald ein Objekt mit Kaufpreis, Miete und Darlehen angelegt ist. <a href="#suche">Exposé importieren</a></p>'; return; }
  box.innerHTML = `<section class="cm cm-pro" aria-label="Investment-Analyse">
    <div class="cm-pro-h"><h4 class="sc-h">Investment-Analyse</h4><label>Objekt<select id="cp_o">${objs.map((o, i) => `<option value="${i}">${esc(o.name || 'Objekt ' + (i + 1))}</option>`).join('')}</select></label></div>
    <div class="cm-pro-g"><div class="cm-card"><h5>RenditeRadar</h5><div id="cp_radar"></div><p class="form-note">Außen = stark. Skalen: Bruttorendite bis 7 %, DSCR 0,6–1,5, Cashflow ±400 €, Beleihung 50–110 %, Faktor 18–32 (LeaseRun-Annahmen).</p></div>
    <div class="cm-card"><h5>Vermögen in 10 Jahren</h5><div id="cp_curve"></div><p class="form-note" id="cp_cn"></p></div></div>
    <div class="cm-card"><h5>Szenarien</h5><div class="cm-sl">
      <label>Wertentwicklung p. a.<input id="cp_g" type="range" min="-2" max="4" step="0.5" value="0"><output id="cp_gv"></output></label>
      <label>Mietausfall<input id="cp_v" type="range" min="0" max="25" step="1" value="0"><output id="cp_vv"></output></label>
      <label>Anschlusszins nach Zinsbindung<input id="cp_r" type="range" min="1" max="9" step="0.25" value="4"><output id="cp_rv"></output></label>
    </div><div id="cp_sc" class="cm-sc"></div></div>
  </section>`;
  const $ = (id) => box.querySelector('#' + id);
  const run = () => {
    const o = objs[Number($('cp_o').value) || 0], m = objMetrics(o);
    const g = Number($('cp_g').value), v = Number($('cp_v').value), r = Number($('cp_r').value);
    $('cp_gv').textContent = P(g); $('cp_vv').textContent = P(v, 0); $('cp_rv').textContent = P(r, 2);
    $('cp_radar').innerHTML = radar(m);
    const base = wealth(m, o, { growthPct: g, vacancyPct: v, refiPct: r });
    const last = base[base.length - 1];
    $('cp_curve').innerHTML = curve(base);
    $('cp_cn').textContent = `Eigenkapital im Objekt ${E(last.eq)} + kumulierter Cashflow ${E(last.cum)} (vor Steuern). Restschuld nach 10 Jahren ${E(last.bal)}.`;
    const after = base.find((x) => x.y === Math.min(10, m.fixed + 1));
    const stress = monthlyRate(m.loan, m.zi + 0.02, m.ti) - m.rate;
    $('cp_sc').innerHTML = `<div class="cm-kpis">
      <div class="cm-k ${base[0].cf < 0 ? 'bad' : 'ok'}"><small>Cashflow mit ${P(v, 0)} Mietausfall</small><strong>${E(base[0].cf)}</strong><span>pro Monat, vor Steuern</span></div>
      <div class="cm-k ${after && after.cf < 0 ? 'bad' : 'ok'}"><small>Cashflow nach Zinsbindung</small><strong>${after ? E(after.cf) : '–'}</strong><span>bei ${P(r, 2)} Anschlusszins${m.fixed >= 10 ? ' (Bindung ≥ 10 J.)' : ''}</span></div>
      <div class="cm-k warn"><small>Zins-Stresstest +2 %</small><strong>+ ${E(stress)}</strong><span>Mehrbelastung pro Monat</span></div>
      <div class="cm-k"><small>Kipp-Zins</small><strong>${m.loan > 0 ? P(((m.noi * 12) / m.loan - m.ti) * 100, 2) : '–'}</strong><span>ab hier wird der Cashflow negativ</span></div></div>`;
  };
  box.addEventListener('input', run); box.addEventListener('change', run);
  run();
}

// Tooltips: Tippen/Klick öffnet, außerhalb schließt.
if (!window.__iaTips) {
  window.__iaTips = true;
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.tip');
    document.querySelectorAll('.tip-pop').forEach((p) => { if (!b || p.dataset.for !== b.dataset.tip) p.remove(); });
    if (!b) return;
    e.preventDefault();
    if (b.nextElementSibling?.classList.contains('tip-pop')) { b.nextElementSibling.remove(); return; }
    const p = document.createElement('span'); p.className = 'tip-pop'; p.setAttribute('role', 'tooltip'); p.dataset.for = b.dataset.tip; p.textContent = b.dataset.tip; b.after(p);
  });
}
