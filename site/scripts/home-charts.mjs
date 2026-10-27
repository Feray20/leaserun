// Erzeugt die Diagramme der Startseite aus dem LeaseRun-Rechenkern (Beispielrechnung, keine Prognose)
// und schreibt sie in /learn/warum-investieren und /learn/vermietete-wohnung-rechnung (zwischen den Markern charts:why bzw. charts:rechnung).
// Aufruf: node scripts/home-charts.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { analyse, balanceAfterMonths, kaufnebenkosten, GREST } from '../public/src/calc.mjs';

const EX = { price: 300000, area: 72, rent: 1100, land: 'hessen', brokerPct: 3.57, equity: 60000, ratePct: 3.8, repaymentPct: 2, vacancyPct: 2, nonRecoverable: 60, maintenanceQm: 1 };
const a = analyse(EX);
const eur = (v) => Math.round(v).toLocaleString('de-DE') + ' €';
const k = (v) => Math.round(v / 1000).toLocaleString('de-DE') + ' Tsd. €';
const C = { navy: '#0F2C59', blue: '#0284C7', sky: '#38BDF8', mint: '#0E9F6E', grey: '#94A3B8', line: '#E2E8F0', text: '#334155', red: '#C2410C' };

// Jede Grafik in zwei Fassungen: breit (Desktop) und schmal mit größerer Schrift (Handy); per CSS umgeschaltet.
const svgTag = (W, H, desc, g, m) => `<svg class="hc-svg ${m ? 'hc-m' : 'hc-d'}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${desc}"><g font-size="${m ? 13 : 12}" fill="${C.text}">${g}</g></svg>`;
const Tk = (v) => k(v).replace(' Tsd. €', ' T€');
const legend = (items) => `<ul class="hc-legend">${items.map(([col, t, dash]) => `<li><i style="background:${dash ? 'none' : col};border-top:${dash ? `3px dashed ${col}` : '0'}"></i>${t}</li>`).join('')}</ul>`;

// ---------- 1. Vermögen aus Tilgung und Wertentwicklung ----------
const years = 25, zu = Math.max(0, -a.cashflow);
const net = (g, t) => EX.price * Math.pow(1 + g / 100, t) - balanceAfterMonths(a.loan, EX.ratePct / 100, EX.repaymentPct / 100, t * 12);
const inv = (t) => EX.equity + zu * 12 * t; // Eigenkapital plus Zuzahlungen (ohne Mietsteigerung) – damit das Bild nicht geschönt ist
function chartWealth(m) {
  const W = m ? 360 : 640, H = m ? 300 : 340, L = m ? 40 : 64, R = m ? 70 : 132, T = 16, B = 40;
  const sc = [[0, C.grey, '6 5'], [1, C.blue, ''], [2, C.navy, '']];
  const max = Math.ceil(net(2, years) / 100000) * 100000, min = 0;
  const x = (t) => L + (t / years) * (W - L - R), y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
  let g = '';
  for (let v = min; v <= max; v += 100000) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.line}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : m ? Math.round(v / 1000) + 'T' : Tk(v)}</text>`;
  for (let t = 0; t <= years; t += 5) g += `<text x="${x(t)}" y="${H - B + 20}" text-anchor="middle">${t === 0 ? 'Kauf' : m ? t + ' J.' : 'Jahr ' + t}</text>`;
  g += `<polyline points="${Array.from({ length: years + 1 }, (_, t) => `${x(t).toFixed(1)},${y(inv(t)).toFixed(1)}`).join(' ')}" fill="none" stroke="${C.red}" stroke-width="2.5" stroke-dasharray="3 4"/>`;
  const ends = [[y(inv(years)), Tk(inv(years)), C.red]];
  for (const [gr, col, dash] of sc) {
    g += `<polyline points="${Array.from({ length: years + 1 }, (_, t) => `${x(t).toFixed(1)},${y(net(gr, t)).toFixed(1)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="3" ${dash ? `stroke-dasharray="${dash}"` : ''} stroke-linejoin="round"/>`;
    ends.push([y(net(gr, years)), Tk(net(gr, years)), col]);
  }
  ends.sort((p, q) => p[0] - q[0]);
  for (let i = 1; i < ends.length; i++) if (ends[i][0] - ends[i - 1][0] < 17) ends[i][0] = ends[i - 1][0] + 17;
  for (const [yy, t, col] of ends) g += `<text x="${W - R + 6}" y="${yy + 4}" fill="${col}" font-weight="700">${t}</text>`;
  const desc = `Liniendiagramm: Nettovermögen (Wert minus Restschuld) über 25 Jahre. Bei stagnierendem Wert ${eur(net(0, years))}, bei 1 % ${eur(net(1, years))}, bei 2 % ${eur(net(2, years))}. Eigener Einsatz aus Eigenkapital und Zuzahlungen ${eur(inv(years))}.`;
  return svgTag(W, H, desc, g, m);
}
const wealthLegend = legend([[C.navy, 'Wert +2 % im Jahr'], [C.blue, 'Wert +1 % im Jahr'], [C.grey, 'Wert stagniert (0 %)', true], [C.red, 'Dein Einsatz (Eigenkapital + Zuzahlungen)', true]]);

// ---------- 2. Wohin die Miete fließt (Monat 1) ----------
const vac = EX.rent * EX.vacancyPct / 100, costs = EX.nonRecoverable + EX.maintenanceQm * EX.area;
function chartFlow(m) {
  const W = m ? 360 : 640, L = m ? 0 : 110, R = m ? 0 : 10, bh = m ? 46 : 48;
  const rows = [
    ['Einnahmen', [[EX.rent, C.blue], ...(zu ? [[zu, C.red]] : [])]],
    ['Ausgaben', [[a.interestM, C.grey], [a.principalM, C.mint], [costs + vac, '#CBD5E1'], ...(a.cashflow > 0 ? [[a.cashflow, C.navy]] : [])]],
  ];
  const tot = Math.max(...rows.map(([, p]) => p.reduce((s, q) => s + q[0], 0)));
  const sx = (v) => (v / tot) * (W - L - R - 6);
  let g = '', yy = m ? 18 : 10;
  for (const [name, parts] of rows) {
    if (m) g += `<text x="0" y="${yy - 4}" font-weight="700">${name}</text>`;
    else g += `<text x="${L - 12}" y="${yy + bh / 2 + 5}" text-anchor="end" font-weight="700">${name}</text>`;
    let xx = L;
    for (const [v, col] of parts) {
      const w = sx(v);
      g += `<rect x="${xx.toFixed(1)}" y="${yy}" width="${w.toFixed(1)}" height="${bh}" rx="4" fill="${col}"/>`;
      if (w > (m ? 50 : 60)) g += `<text x="${(xx + w / 2).toFixed(1)}" y="${yy + bh / 2 + 5}" text-anchor="middle" fill="${col === '#CBD5E1' ? C.text : '#fff'}" font-weight="700">${eur(v)}</text>`;
      xx += w + 2;
    }
    yy += bh + (m ? 34 : 22);
  }
  const H = yy - (m ? 30 : 16);
  const desc = `Balkendiagramm Monat 1: Miete ${eur(EX.rent)}${zu ? ` plus Zuzahlung ${eur(zu)}` : ''}; Ausgaben Zins ${eur(a.interestM)}, Tilgung ${eur(a.principalM)}, Kosten und Leerstand ${eur(costs + vac)}.`;
  return svgTag(W, H, desc, g, m);
}
const flowLegend = legend([[C.blue, `Miete ${eur(EX.rent)}`], ...(zu ? [[C.red, `Deine Zuzahlung ${eur(zu)}`]] : []), [C.grey, `Zins ${eur(a.interestM)}`], [C.mint, `Tilgung = dein Vermögen ${eur(a.principalM)}`], ['#CBD5E1', `Kosten & Leerstand ${eur(costs + vac)}`]]);

// ---------- 3. Kaufnebenkosten je Bundesland ----------
const SHORT = { 'Mecklenburg-Vorpommern': 'Meckl.-Vorp.', 'Nordrhein-Westfalen': 'Nordrhein-Westf.', 'Baden-Württemberg': 'Baden-Württ.', 'Schleswig-Holstein': 'Schleswig-Holst.' };
const nkRows = Object.keys(GREST).map((l) => ({ l, name: GREST[l].name, v: kaufnebenkosten({ price: EX.price, land: l }).total })).sort((p, q) => p.v - q.v);
function chartNk(m) {
  const W = m ? 360 : 640, row = m ? 24 : 21, T = 6, L = m ? 128 : 178, R = m ? 58 : 70, H = T + nkRows.length * row + 6;
  const max = nkRows[nkRows.length - 1].v;
  let g = '';
  nkRows.forEach((r, i) => {
    const y = T + i * row, w = (r.v / max) * (W - L - R);
    const col = r.v === nkRows[0].v ? C.mint : r.v === max ? C.red : C.blue;
    g += `<text x="${L - 8}" y="${y + 15}" text-anchor="end">${m ? SHORT[r.name] || r.name : r.name}</text><rect x="${L}" y="${y + 4}" width="${w.toFixed(1)}" height="${m ? 15 : 14}" rx="3" fill="${col}"/><text x="${L + w + 5}" y="${y + 15}">${m ? (r.v / 1000).toLocaleString('de-DE') + ' T€' : eur(r.v)}</text>`;
  });
  const desc = `Balkendiagramm: Kaufnebenkosten ohne Makler bei 300.000 € Kaufpreis je Bundesland, von ${eur(nkRows[0].v)} (${nkRows[0].name}) bis ${eur(max)}.`;
  return svgTag(W, H, desc, g, m);
}
// ---------- 0. Kaufkraft: Geld auf dem Konto bei Inflation ----------
function chartKaufkraft(m) {
  const W = m ? 360 : 640, H = m ? 230 : 250, L = m ? 44 : 64, R = m ? 70 : 120, T = 16, B = 36, years = 20, inf = 0.02;
  const x = (t) => L + (t / years) * (W - L - R), y = (v) => T + (1 - v / 100000) * (H - T - B);
  let g = '';
  for (let v = 0; v <= 100000; v += 25000) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${C.line}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : Math.round(v / 1000) + (m ? 'T' : ' T€')}</text>`;
  for (let t = 0; t <= years; t += 5) g += `<text x="${x(t)}" y="${H - B + 20}" text-anchor="middle">${t === 0 ? 'heute' : m ? t + ' J.' : 'Jahr ' + t}</text>`;
  g += `<line x1="${L}" x2="${W - R}" y1="${y(100000)}" y2="${y(100000)}" stroke="${C.grey}" stroke-width="2.5" stroke-dasharray="6 5"/>`;
  const pts = Array.from({ length: years + 1 }, (_, t) => `${x(t).toFixed(1)},${y(100000 / Math.pow(1 + inf, t)).toFixed(1)}`);
  g += `<polygon points="${x(0)},${y(100000)} ${pts.join(' ')} ${x(years)},${y(100000)}" fill="${C.red}" fill-opacity=".12"/>`;
  g += `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.red}" stroke-width="3"/>`;
  const end = 100000 / Math.pow(1 + inf, years);
  g += `<text x="${W - R + 6}" y="${y(100000) + 4}" fill="${C.grey}" font-weight="700">100 T€</text><text x="${W - R + 6}" y="${y(end) + 4}" fill="${C.red}" font-weight="700">${Math.round(end / 1000)} T€</text>`;
  const desc = `Liniendiagramm: Kaufkraft von 100.000 € ohne Zinsen bei 2 % Inflation sinkt in 20 Jahren auf ${eur(end)}.`;
  return svgTag(W, H, desc, g, m);
}
const kaufkraftLegend = legend([[C.grey, 'Kontostand: 100.000 €', true], [C.red, 'Was man dafür kaufen kann (2 % Inflation)']]);
const kk20 = 100000 / Math.pow(1.02, 20), kk2225 = 100000 / (1.069 * 1.059 * 1.022 * 1.022);
const both = (fn) => fn(false) + fn(true);

const n = { min: nkRows[0], max: nkRows[nkRows.length - 1] };
const html = `<section class="section home-why" id="warum"><div class="container">
  <h1 class="home-h2">Warum überhaupt investieren?</h1>
  <p class="hc-lead">Geld, das nur auf dem Konto liegt, wirkt sicher – verliert aber jedes Jahr an Kaufkraft. Wer investiert, geht dagegen Risiken ein. Beides gehört ehrlich auf den Tisch.</p>
  <div class="why-grid">
    <figure class="hc-card why-chart"><figcaption><strong>Inflation: das stille Minus</strong><span>100.000 € ohne Zinsen sind bei 2 % Inflation nach 20 Jahren nur noch so viel wert wie heute ${eur(kk20)}. Und es kann schneller gehen: Wer Anfang 2022 100.000 € auf dem Konto hatte, konnte Ende 2025 damit nur noch kaufen, was vorher rund ${eur(Math.round(kk2225 / 100) * 100)} gekostet hat (Inflation 2022: 6,9 %, 2023: 5,9 %, 2024 und 2025: je 2,2 %, Destatis).</span></figcaption>${both(chartKaufkraft)}${kaufkraftLegend}</figure>
    <div class="why-cards">
      <article class="why-card"><span class="why-tag">Stagnation</span><h3>Wenn nichts wächst</h3><p>Auf dem Konto wächst bei Nullzins nichts – real schrumpft es. Bei einer vermieteten Immobilie baut die Tilgung auch dann Vermögen auf, wenn die Preise stagnieren. Voraussetzung: Miete und Reserve tragen die Rate.</p></article>
      <article class="why-card"><span class="why-tag warn">Krisenzeiten</span><h3>Kein Investment ist krisenfest</h3><p>2023 fielen die Preise für Wohnimmobilien im Schnitt um 8,4 % – der stärkste Rückgang seit Beginn der Statistik 2000 (Destatis). Wer mit Reserve, langer Zinsbindung und tragfähiger Miete gekauft hatte, musste nicht verkaufen und konnte abwarten.</p></article>
      <article class="why-card"><span class="why-tag ok">Mit Verstand</span><h3>Krisen vorher durchrechnen</h3><p>LeaseRun rechnet jedes Angebot mit Stresstest: Zins plus 2 Prozentpunkte, Mietausfall, Kipp-Zins und Anschlussfinanzierung. So siehst du vor dem Kauf, ob ein Objekt auch schlechte Jahre übersteht.</p></article>
    </div>
  </div>
  <p class="hc-note">Allgemeine Information, keine Anlageberatung. Jede Geldanlage hat Risiken; Immobilienpreise können fallen. <a class="ck-link" href="/learn">Wie funktioniert Geld? Alles Wichtige im Lernbereich</a></p>
</div></section>
<section class="section home-charts"><div class="container">
  <h1 class="home-h2">Was eine vermietete Wohnung rechnerisch leistet</h1>
  <p class="hc-lead">Ein durchgerechnetes Beispiel: Eigentumswohnung in Hessen, ${eur(EX.price)} Kaufpreis, ${EX.area} m², ${eur(EX.rent)} Kaltmiete, ${eur(EX.equity)} Eigenkapital, ${String(EX.ratePct).replace('.', ',')} % Zins und ${EX.repaymentPct} % Tilgung.</p>
  <div class="hc-grid">
    <figure class="hc-card hc-wide"><figcaption><strong>Vermögen nach 25 Jahren – selbst wenn der Wert stagniert</strong><span>Wert der Wohnung minus Restschuld. Die rote Linie zeigt deinen eigenen Einsatz (Eigenkapital plus Zuzahlungen, zusammen ${eur(inv(years))}). Selbst bei stagnierendem Wert liegt das Vermögen mit ${eur(net(0, years))} darüber, weil der Mieter einen großen Teil der Tilgung trägt. Mit 1 bis 2 % Wertsteigerung im Jahr wächst es deutlich schneller.</span></figcaption>${both(chartWealth)}${wealthLegend}</figure>
    <figure class="hc-card"><figcaption><strong>Wohin die Miete fließt</strong><span>Im Beispiel zahlst du ${eur(zu)} im Monat zu und tilgen gleichzeitig ${eur(a.principalM)}. Es fließt also mehr in dein Vermögen, als du zuzahlst. LeaseRun zeigt das für jedes Angebot.</span></figcaption>${both(chartFlow)}${flowLegend}</figure>
    <figure class="hc-card"><figcaption><strong>Kaufnebenkosten je Bundesland</strong><span>Bei ${eur(EX.price)} Kaufpreis (ohne Makler) liegen zwischen ${n.min.name} und ${n.max.name} ${eur(n.max.v - n.min.v)}. Diese Kosten finanziert die Bank selten mit.</span></figcaption>${both(chartNk)}</figure>
  </div>
  <p class="hc-note">Beispielrechnung mit dem LeaseRun-Rechenkern, keine Prognose und keine Anlageberatung. Vereinfacht: gleichbleibender Zins über die gesamte Laufzeit, ohne Steuern, Mietsteigerung und Rücklagen für größere Sanierungen. Wertentwicklung kann auch negativ sein. <a class="ck-link" href="/start">Mit eigenen Zahlen rechnen – kostenlos und ohne Konto</a></p>
</div></section>`;

const cut = html.indexOf('<section class="section home-charts">');
for (const [file, key, part] of [['wissen/warum-investieren/index.html', 'why', html.slice(0, cut).trimEnd()], ['wissen/vermietete-wohnung-rechnung/index.html', 'rechnung', html.slice(cut).trimEnd()]]) {
  const p = new URL(`../public/${file}`, import.meta.url);
  const s = readFileSync(p, 'utf8');
  const re = new RegExp(`<!--charts:${key}:start-->[\\s\\S]*?<!--charts:${key}:end-->`);
  if (!re.test(s)) throw new Error(`Marker charts:${key} fehlt in ${file}`);
  writeFileSync(p, s.replace(re, () => `<!--charts:${key}:start-->${part}<!--charts:${key}:end-->`));
}
console.log('charts ok', { stagnation: Math.round(net(0, years)), einsatz: Math.round(inv(years)), zuzahlung: Math.round(zu), tilgung: Math.round(a.principalM) });
