// Unternehmensportal → Beratungskompass für erfahrene Berater: Gesprächsgrafiken, Sonderfälle, Einwände, Prüfpfade,
// Unterlagen-Checklisten und Pflichten-Check (keine Grundlagen). Alle Beispielzahlen werden hier nachvollziehbar berechnet.
// Hinweis: Orientierungswissen, keine Rechts- oder Finanzierungsberatung; bankindividuelle Vorgaben gehen vor.
import { BRANCHEN, KAPITEL } from './b2b-branche.mjs?v=892f3666';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const E = (v, d = 0) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d });
const P = (v, d = 1) => (v * 100).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';
const N = (v, d = 2) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- Beispielfall (durchgängig) ----------
const FALL = {
  kaufpreis: 400000, marktwert: 400000, abschlag: 0.10, nebenkosten: 0.105, eigenkapital: 120000,
  zins: 0.036, tilgung: 0.02, netto: 5200, lebenshaltung: 1600, verpflichtungen: 300, bewirtschaftung: 350,
  kaltmiete: 1200, nichtUmlage: 150,
};
FALL.darlehen = FALL.kaufpreis * (1 + FALL.nebenkosten) - FALL.eigenkapital; // 322.000
FALL.beleihungswert = FALL.marktwert * (1 - FALL.abschlag);
FALL.annuitaet = FALL.darlehen * (FALL.zins + FALL.tilgung);
FALL.rate = FALL.annuitaet / 12;

function tilgungsplan(darlehen, zins, tilgung, jahre = 30) {
  const rateM = (darlehen * (zins + tilgung)) / 12;
  let rest = darlehen; const out = [];
  for (let j = 1; j <= jahre && rest > 0.5; j++) {
    let z = 0, t = 0;
    for (let m = 0; m < 12 && rest > 0.005; m++) { const zm = rest * zins / 12; const tm = Math.min(rateM - zm, rest); z += zm; t += tm; rest -= tm; }
    out.push({ j, z, t, rest });
  }
  return out;
}

// ---------- 1. Mindmap: Einflussfaktoren der Kreditentscheidung ----------
const MIND = [
  { t: 'Kapitaldienstfähigkeit', c: 'a', k: ['Haushaltsrechnung (Einnahmen − Lebenshaltung − Verpflichtungen)', 'Kapitaldienst = Zins + Tilgung (Annuität)', 'Zinsänderungsrisiko nach Ablauf der Sollzinsbindung (Stresszins)', 'DSCR bei Kapitalanlagen'] },
  { t: 'Objekt & Sicherheit', c: 'b', k: ['Marktwert (§ 194 BauGB) vs. Beleihungswert (BelWertV)', 'Sicherheitsabschlag, Beleihungsauslauf, LTV', 'Grundschuld, Rangstelle, Zweckerklärung', 'Lage, Zustand, Drittverwendbarkeit, Energieeffizienz'] },
  { t: 'Bonität', c: 'c', k: ['SCHUFA-Score, Negativmerkmale', 'internes Rating → Ausfallwahrscheinlichkeit (PD)', 'Beschäftigung: Probezeit, Befristung, Selbstständigkeit', 'Vermögen und Verbindlichkeiten (Selbstauskunft)'] },
  { t: 'Eigenkapital', c: 'd', k: ['Erwerbsnebenkosten aus Eigenmitteln (GrESt, Notar, Grundbuch, Makler)', 'Eigenkapitalquote am Gesamtaufwand', 'Eigenleistung nur eingeschränkt anrechenbar', 'Liquiditätsreserve nach Kauf'] },
  { t: 'Regulatorik', c: 'e', k: ['Kreditwürdigkeitsprüfung §§ 505a–505e BGB (WIKR)', 'ESIS-Merkblatt, vorvertragliche Information', 'CRR (Basel III): Risikogewichte, Eigenmittel', 'MaRisk BTO 1.2: Trennung Markt / Marktfolge; § 18 KWG'] },
  { t: 'Unterlagen', c: 'f', k: ['Selbstauskunft, Ausweis, Einkommensnachweise', 'Exposé, Grundbuchauszug, Flurkarte, Baubeschreibung', 'WEG: Teilungserklärung, Protokolle, Wirtschaftsplan, Rücklage', 'Kaufvertragsentwurf, Wohnflächenberechnung, Energieausweis'] },
];
function mindmap(data = MIND, core = 'Kredit&shy;entscheidung', sub = 'Wohnimmobilienfinanzierung', label = 'Mindmap: Einflussfaktoren der Kreditentscheidung') {
  return `<div class="bw-mind" role="img" aria-label="${label}">
    <div class="bw-mind-core"><span>${core}</span><small>${sub}</small></div>
    ${data.map((b, i) => `<div class="bw-mind-b bw-c-${b.c}" style="--i:${i}"><strong>${b.t}</strong><ul>${b.k.map((k) => `<li>${esc(k)}</li>`).join('')}</ul></div>`).join('')}
  </div>`;
}
// Zweite Mindmap: Welche Unterlagen die Bank je Kundentyp erwartet.
const MIND2 = [
  { t: 'Angestellte', c: 'a', k: ['letzte 3 Gehaltsabrechnungen', 'Dezember-Abrechnung des Vorjahres', 'Arbeitsvertrag (bei Probezeit / Befristung)', 'Einkommensteuerbescheid, falls vorhanden'] },
  { t: 'Selbstständige', c: 'b', k: ['Jahresabschlüsse bzw. EÜR der letzten 2–3 Jahre', 'Einkommensteuerbescheide und -erklärungen', 'aktuelle BWA mit Summen- und Saldenliste', 'Nachweis Kranken- und Altersvorsorge'] },
  { t: 'Kapitalanleger', c: 'c', k: ['Mietverträge und Mieterliste', 'Anlage V der letzten Jahre', 'Aufstellung der Bestandsimmobilien mit Restschulden', 'Nachweise zu Instandhaltung und Rücklagen'] },
  { t: 'Objekt', c: 'd', k: ['Grundbuchauszug (aktuell), Flurkarte', 'Wohnflächenberechnung, Baubeschreibung, Grundrisse', 'Energieausweis, Fotos, Exposé', 'Kaufvertragsentwurf'] },
  { t: 'Eigentumswohnung', c: 'e', k: ['Teilungserklärung mit Aufteilungsplan', 'Protokolle der letzten 3 Eigentümerversammlungen', 'Wirtschaftsplan und Hausgeldabrechnung', 'Stand der Erhaltungsrücklage'] },
  { t: 'Persönliches', c: 'f', k: ['Ausweis, Selbstauskunft', 'Eigenkapitalnachweise (Kontoauszüge, Depot)', 'bestehende Kredite und Leasingverträge', 'bei Paaren: Unterlagen beider Darlehensnehmer'] },
];

// ---------- 2. Struktogramm (Nassi-Shneiderman): Kreditvorprüfung ----------
function ns() {
  const seq = (t) => `<div class="ns-s">${t}</div>`;
  const ifb = (cond, yes, no) => `<div class="ns-if"><div class="ns-cond"><span class="ns-tri" aria-hidden="true"></span><b>${cond}</b><i class="ns-j">ja</i><i class="ns-n">nein</i></div><div class="ns-br"><div class="ns-yes">${yes}</div><div class="ns-no">${no}</div></div></div>`;
  const loop = (cond, body) => `<div class="ns-loop"><div class="ns-lh">${cond}</div><div class="ns-lb">${body}</div></div>`;
  return `<div class="ns" role="img" aria-label="Struktogramm der Kreditvorprüfung">
    <div class="ns-title">Algorithmus „Kreditvorprüfung Wohnimmobilie“</div>
    ${seq('Selbstauskunft, Einkommens- und Objektunterlagen erfassen')}
    ${loop('solange Pflichtunterlagen unvollständig', seq('fehlende Unterlagen anfordern (Dokumentenanforderung, Erinnerung)'))}
    ${seq('Gesamtaufwand = Kaufpreis + Erwerbsnebenkosten; Darlehensbedarf = Gesamtaufwand − Eigenkapital')}
    ${seq('Beleihungswert = Marktwert × (1 − Sicherheitsabschlag); Beleihungsauslauf = Darlehen ÷ Beleihungswert')}
    ${ifb('Erwerbsnebenkosten aus Eigenkapital gedeckt?',
    seq('Standardfinanzierung prüfen'),
    seq('Vollfinanzierung (> 100 %): Zinsaufschlag, strengere Bonitätsanforderung'))}
    ${seq('Haushaltsrechnung: frei verfügbares Einkommen − Kapitaldienst (inkl. Stresszins)')}
    ${ifb('Kapitaldienstfähigkeit gegeben (Überschuss ≥ 0 auch im Stressfall)?',
    ifb('Beleihungsauslauf ≤ 80 %?', seq('Regelfall: Bankanfrage vorbereiten'), seq('Eigenkapital erhöhen, Zusatzsicherheit oder höhere Tilgung prüfen')),
    seq('Ablehnungsgrund dokumentieren; Alternativen: längere Laufzeit, niedrigerer Kaufpreis, Mitdarlehensnehmer'))}
    ${seq('Kreditmappe (BankReady) mit Prüfsumme erzeugen → Einreichung an Bank / Partner')}
  </div>`;
}

// Zweites Struktogramm: Anschlussfinanzierung (Prolongation, Forward, Umschuldung).
function ns2() {
  const seq = (t) => `<div class="ns-s">${t}</div>`;
  const ifb = (cond, yes, no) => `<div class="ns-if"><div class="ns-cond"><span class="ns-tri" aria-hidden="true"></span><b>${cond}</b><i class="ns-j">ja</i><i class="ns-n">nein</i></div><div class="ns-br"><div class="ns-yes">${yes}</div><div class="ns-no">${no}</div></div></div>`;
  const loop = (cond, body) => `<div class="ns-loop"><div class="ns-lh">${cond}</div><div class="ns-lb">${body}</div></div>`;
  return `<div class="ns" role="img" aria-label="Struktogramm der Anschlussfinanzierung">
    <div class="ns-title">Algorithmus „Anschlussfinanzierung“</div>
    ${seq('Restschuld zum Ende der Sollzinsbindung und Restlaufzeit ermitteln (Tilgungsplan)')}
    ${ifb('Zinsbindung endet in höchstens 60 Monaten?',
    ifb('Endet sie in höchstens 6 Monaten?',
      seq('Prolongationsangebot der Hausbank einholen und mit Marktangeboten vergleichen'),
      seq('Forward-Darlehen kalkulieren: heutiger Zins plus Forward-Aufschlag, Zinsrisiko gegen Aufschlag abwägen')),
    seq('Beobachten; nach 10 Jahren seit Vollauszahlung gilt das Kündigungsrecht nach § 489 Abs. 1 Nr. 2 BGB (6 Monate Frist)'))}
    ${loop('für jedes Angebot', seq('Effektivzins, Sondertilgung, Bereitstellungszinsen, Tilgungssatzwechsel und Gebühren vergleichen'))}
    ${ifb('Wechsel zu einer anderen Bank?',
    seq('Umschuldung: Grundschuld abtreten lassen statt neu bestellen (spart Notar- und Grundbuchkosten), Ablösung terminieren'),
    seq('Prolongation unterschreiben, neue Zinsbindung und Tilgung dokumentieren'))}
    ${seq('Fristen im Kunden-Cockpit hinterlegen: 12, 6, 3 und 1 Monat vor Ablauf erinnern')}
  </div>`;
}

// ---------- 3. Swimlane: von der Anfrage bis zur Auszahlung ----------
const LANES = ['Interessent', 'Makler / Vermittler', 'LeaseRun', 'Bank'];
const STEPS = [
  [0, 'Anfrage über Widget, Partnerseite oder QR-Code (mit Einwilligung)'],
  [2, 'Lead mit Eckdaten und Kennzahlen im Postkorb'],
  [1, 'Erstgespräch, Bedarfsanalyse, Unterlagenliste'],
  [0, 'Selbstauskunft und Unterlagen hochladen'],
  [2, 'RenditeRadar: Kennzahlen, Stresstest, Plausibilitäten'],
  [2, 'BankReady: Kreditmappe mit Prüfsumme und Echtheits-QR'],
  [1, 'Einreichung, Konditionsanfrage'],
  [3, 'Kreditwürdigkeitsprüfung, Objektbewertung, Votum (Markt / Marktfolge)'],
  [3, 'ESIS-Merkblatt, Darlehensangebot'],
  [0, 'Vertrag, Grundschuldbestellung beim Notar'],
  [3, 'Auszahlung nach Erfüllung der Auszahlungsvoraussetzungen'],
];
function swimlane() {
  return `<div class="bw-swim" role="img" aria-label="Prozess von der Anfrage bis zur Auszahlung in vier Bahnen">
    <div class="bw-swim-h">${LANES.map((l, i) => `<span class="bw-l${i}">${l}</span>`).join('')}</div>
    ${STEPS.map(([l, t], i) => `<div class="bw-swim-r"><b class="bw-swim-n">${i + 1}</b>${LANES.map((_, k) => `<div class="bw-swim-c">${k === l ? `<div class="bw-swim-box bw-l${l}"><small>${LANES[l]}</small>${esc(t)}</div>` : ''}</div>`).join('')}</div>`).join('')}
  </div>`;
}

// ---------- 4. Kennzahlenbaum ----------
function baum() {
  const f = FALL;
  const nk = f.kaufpreis * f.nebenkosten, ges = f.kaufpreis + nk;
  const noi = (f.kaltmiete - f.nichtUmlage) * 12;
  const node = (t, formel, wert, kids = '') => `<li><div class="bw-node"><strong>${t}</strong><code>${formel}</code><span>${wert}</span></div>${kids ? `<ul>${kids}</ul>` : ''}</li>`;
  return `<ul class="bw-tree" aria-label="Kennzahlenbaum">${node('Finanzierbarkeit', 'Objekt × Kunde × Bank', 'Gesamturteil',
    node('Gesamtaufwand', 'Kaufpreis + Erwerbsnebenkosten', E(ges),
      node('Erwerbsnebenkosten', 'GrESt + Notar/Grundbuch + Makler', `${E(nk)} (${P(f.nebenkosten)})`))
    + node('Darlehensbedarf', 'Gesamtaufwand − Eigenkapital', E(f.darlehen),
      node('Beleihungsauslauf', 'Darlehen ÷ Beleihungswert', P(f.darlehen / f.beleihungswert))
      + node('LTV', 'Darlehen ÷ Marktwert', P(f.darlehen / f.marktwert)))
    + node('Kapitaldienst', 'Darlehen × (Sollzins + Anfangstilgung)', `${E(f.annuitaet)} p. a. · ${E(f.rate)} mtl.`,
      node('Kapitaldienstfähigkeit', 'frei verfügbar − Rate ≥ 0', E(f.netto - f.lebenshaltung - f.verpflichtungen - f.bewirtschaftung - f.rate) + ' mtl.')
      + node('DSCR (Kapitalanlage)', 'Nettomietertrag ÷ Kapitaldienst', N(noi / f.annuitaet))))}</ul>`;
}

// ---------- 5. Diagramme (SVG, aus dem Beispielfall berechnet) ----------
function chartBeleihung() {
  const f = FALL;
  const rows = [
    ['Kaufpreis', f.kaufpreis, '#94A3B8'],
    ['Marktwert', f.marktwert, '#0369A1'],
    ['Beleihungswert', f.beleihungswert, '#0F2C59'],
    ['Realkredit (60 %)', f.beleihungswert * 0.6, '#16A34A'],
    ['Darlehen', f.darlehen, '#DC2626'],
  ];
  const max = 450000, W = 640, L = 170, bh = 34, gap = 14, H = rows.length * (bh + gap) + 40;
  const x = (v) => L + (v / max) * (W - L - 110);
  return `<svg class="bw-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Balkendiagramm Beleihungswert">
    ${[0, 100000, 200000, 300000, 400000].map((t) => `<line x1="${x(t)}" y1="8" x2="${x(t)}" y2="${H - 26}" stroke="#E2E8F0"/><text x="${x(t)}" y="${H - 8}" text-anchor="middle" class="bw-ax">${t / 1000} Tsd.</text>`).join('')}
    ${rows.map(([l, v, c], i) => { const y = 10 + i * (bh + gap); return `<text x="${L - 10}" y="${y + bh / 2 + 5}" text-anchor="end" class="bw-lb">${l}</text><rect x="${L}" y="${y}" width="${x(v) - L}" height="${bh}" rx="4" fill="${c}"/><text x="${x(v) + 6}" y="${y + bh / 2 + 5}" class="bw-val">${E(v)}</text>`; }).join('')}
    <line x1="${x(f.beleihungswert)}" y1="6" x2="${x(f.beleihungswert)}" y2="${H - 26}" stroke="#0F2C59" stroke-dasharray="4 3"/>
  </svg>`;
}

function chartWasserfall() {
  const f = FALL;
  const steps = [['Netto&shy;einkommen', f.netto, 'pos'], ['Lebens&shy;haltung', -f.lebenshaltung, 'neg'], ['Verpflich&shy;tungen', -f.verpflichtungen, 'neg'], ['Bewirt&shy;schaftung', -f.bewirtschaftung, 'neg'], ['Rate', -f.rate, 'rate']];
  const W = 640, H = 300, top = 20, base = 250, sc = (base - top) / 5600, bw = 78, gx = 104;
  let run = 0; const bars = [];
  steps.forEach(([l, v, k], i) => { const a = run, b = run + v; run = b; bars.push({ l, v, k, y1: Math.max(a, b), y2: Math.min(a, b), x: 30 + i * gx }); });
  const rest = run;
  const yy = (v) => base - v * sc;
  return `<svg class="bw-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Wasserfalldiagramm Haushaltsrechnung">
    <line x1="20" y1="${base}" x2="${W - 10}" y2="${base}" stroke="#94A3B8"/>
    ${bars.map((b) => `<rect x="${b.x}" y="${yy(b.y1)}" width="${bw}" height="${Math.max(2, (b.y1 - b.y2) * sc)}" rx="3" fill="${b.k === 'pos' ? '#0F2C59' : b.k === 'rate' ? '#0284C7' : '#F87171'}"/><text x="${b.x + bw / 2}" y="${yy(b.y1) - 6}" text-anchor="middle" class="bw-val">${b.v > 0 ? '' : '−'}${E(Math.abs(b.v))}</text><foreignObject x="${b.x - 12}" y="${base + 4}" width="${bw + 24}" height="40"><div class="bw-fo">${b.l}</div></foreignObject>`).join('')}
    <rect x="${30 + 5 * gx}" y="${yy(rest)}" width="${bw}" height="${rest * sc}" rx="3" fill="#16A34A"/><text x="${30 + 5 * gx + bw / 2}" y="${yy(rest) - 6}" text-anchor="middle" class="bw-val">${E(rest)}</text><foreignObject x="${30 + 5 * gx - 12}" y="${base + 4}" width="${bw + 24}" height="40"><div class="bw-fo"><b>Überschuss</b></div></foreignObject>
  </svg>`;
}

function chartAnnuitaet() {
  const f = FALL, plan = tilgungsplan(f.darlehen, f.zins, f.tilgung, 30);
  const W = 640, H = 280, L = 54, B = 240, T = 16, R = 16, bw = (W - L - R) / plan.length;
  const maxA = f.annuitaet * 1.05, y = (v) => B - (v / maxA) * (B - T);
  const yr = (v) => B - (v / f.darlehen) * (B - T);
  const pts = plan.map((p, i) => `${L + i * bw + bw / 2},${yr(p.rest)}`).join(' ');
  const z10 = plan[9];
  return `<svg class="bw-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Annuitätendarlehen: Zins- und Tilgungsanteil je Jahr">
    ${[0, 0.25, 0.5, 0.75, 1].map((t) => `<line x1="${L}" y1="${y(maxA * t)}" x2="${W - R}" y2="${y(maxA * t)}" stroke="#EEF2F7"/><text x="${L - 6}" y="${y(maxA * t) + 4}" text-anchor="end" class="bw-ax">${Math.round(maxA * t / 1000)} Tsd.</text>`).join('')}
    ${plan.map((p, i) => `<rect x="${L + i * bw + 1}" y="${y(p.z + p.t)}" width="${bw - 2}" height="${(p.t / maxA) * (B - T)}" fill="#16A34A"/><rect x="${L + i * bw + 1}" y="${y(p.z)}" width="${bw - 2}" height="${(p.z / maxA) * (B - T)}" fill="#0F2C59"/>`).join('')}
    <polyline points="${pts}" fill="none" stroke="#F59E0B" stroke-width="2.5"/>
    ${[1, 10, 20, plan.length].map((j) => `<text x="${L + (j - 1) * bw + bw / 2}" y="${B + 16}" text-anchor="middle" class="bw-ax">Jahr ${j}</text>`).join('')}
    <line x1="${L + 10 * bw}" y1="${T}" x2="${L + 10 * bw}" y2="${B}" stroke="#DC2626" stroke-dasharray="4 3"/><text x="${L + 10 * bw + 6}" y="${T + 14}" class="bw-ax bw-red">Ende Zinsbindung (10 J.): Restschuld ${E(z10.rest)}</text>
  </svg>
  <div class="bw-legend"><span><i style="background:#0F2C59"></i>Zinsanteil</span><span><i style="background:#16A34A"></i>Tilgungsanteil</span><span><i style="background:#F59E0B"></i>Restschuld (Linie; ganz oben = ${E(f.darlehen)})</span></div>`;
}

function dscrGauge() {
  const f = FALL, noi = (f.kaltmiete - f.nichtUmlage) * 12, d = noi / f.annuitaet;
  const ang = (v) => Math.PI * (1 - Math.min(v, 2) / 2);
  const pt = (v, r) => [160 + r * Math.cos(ang(v)), 150 - r * Math.sin(ang(v))];
  const arc = (a, b, c) => { const [x1, y1] = pt(a, 110), [x2, y2] = pt(b, 110); return `<path d="M${x1},${y1} A110,110 0 0 1 ${x2},${y2}" stroke="${c}" stroke-width="22" fill="none"/>`; };
  const [nx, ny] = pt(d, 92);
  return `<svg class="bw-svg bw-gauge" viewBox="0 0 320 190" role="img" aria-label="DSCR ${N(d)}">
    ${arc(0, 1, '#FCA5A5')}${arc(1, 1.2, '#FDE68A')}${arc(1.2, 2, '#86EFAC')}
    <line x1="160" y1="150" x2="${nx}" y2="${ny}" stroke="#0F2C59" stroke-width="4" stroke-linecap="round"/><circle cx="160" cy="150" r="7" fill="#0F2C59"/>
    <text x="160" y="182" text-anchor="middle" class="bw-big">DSCR ${N(d)}</text>
    <text x="40" y="168" class="bw-ax">0</text><text x="160" y="22" text-anchor="middle" class="bw-ax">1,0</text><text x="268" y="168" class="bw-ax">2,0</text>
  </svg>`;
}

// Zinsänderungsrisiko: Monatsrate nach 10 Jahren bei verschiedenen Anschlusszinsen (Restschuld über 20 Jahre getilgt).
function rateAnnu(S, i, n) { const m = i / 12; return m === 0 ? S / n : (S * m) / (1 - Math.pow(1 + m, -n)); }
function stress() {
  const f = FALL, plan = tilgungsplan(f.darlehen, f.zins, f.tilgung, 30), rest = plan[9].rest;
  return [f.zins, 0.05, 0.06, 0.07].map((z) => ({ z, rate: rateAnnu(rest, z, 240) }));
}
function chartStress() {
  const f = FALL, rows = stress(), max = Math.max(...rows.map((r) => r.rate)) * 1.15;
  const W = 640, H = 270, L = 70, B = 220, bw = 90, gap = (W - L - 20 - rows.length * bw) / (rows.length - 1);
  const y = (v) => B - (v / max) * (B - 20);
  return `<svg class="bw-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monatsrate nach Zinsbindung bei verschiedenen Anschlusszinsen">
    <line x1="${L - 10}" y1="${B}" x2="${W - 10}" y2="${B}" stroke="#94A3B8"/>
    <line x1="${L - 10}" y1="${y(f.rate)}" x2="${W - 10}" y2="${y(f.rate)}" stroke="#0F2C59" stroke-dasharray="5 4"/><text x="${W - 12}" y="${y(f.rate) + 16}" text-anchor="end" class="bw-ax">– – heutige Rate ${E(f.rate)}</text>
    ${rows.map((r, i) => { const x = L + i * (bw + gap); const c = r.rate <= f.rate * 1.05 ? '#16A34A' : r.rate <= f.rate * 1.2 ? '#F59E0B' : '#DC2626'; return `<rect x="${x}" y="${y(r.rate)}" width="${bw}" height="${B - y(r.rate)}" rx="4" fill="${c}"/><text x="${x + bw / 2}" y="${y(r.rate) - 6}" text-anchor="middle" class="bw-val">${E(r.rate)}</text><text x="${x + bw / 2}" y="${B + 20}" text-anchor="middle" class="bw-lb">${P(r.z, 1)}</text>`; }).join('')}
    <text x="${W / 2}" y="${H - 6}" text-anchor="middle" class="bw-ax">Anschlusszins ab Jahr 11 · Restschuld ${E(tilgungsplan(f.darlehen, f.zins, f.tilgung, 30)[9].rest)} über 20 Jahre</text>
  </svg>`;
}
// Tilgungssatz-Vergleich: Restschuld nach 10 Jahren bei 1–4 % Anfangstilgung (gleicher Sollzins).
function chartTilgung() {
  const f = FALL, rows = [0.01, 0.02, 0.03, 0.04].map((t) => ({ t, rest: tilgungsplan(f.darlehen, f.zins, t, 30)[9].rest, rate: f.darlehen * (f.zins + t) / 12 }));
  const W = 640, L = 150, bh = 34, gap = 14, H = rows.length * (bh + gap) + 34, x = (v) => L + (v / f.darlehen) * (W - L - 120);
  return `<svg class="bw-svg bw-svg-mid" viewBox="0 0 ${W} ${H}" role="img" aria-label="Restschuld nach 10 Jahren je Anfangstilgung">
    ${rows.map((r, i) => { const yy = 8 + i * (bh + gap); return `<text x="${L - 10}" y="${yy + 14}" text-anchor="end" class="bw-lb">${P(r.t, 0)} Tilgung</text><text x="${L - 10}" y="${yy + 30}" text-anchor="end" class="bw-ax">${E(r.rate)} mtl.</text><rect x="${L}" y="${yy}" width="${x(r.rest) - L}" height="${bh}" rx="4" fill="${['#DC2626', '#F59E0B', '#0369A1', '#16A34A'][i]}"/><text x="${x(r.rest) + 6}" y="${yy + bh / 2 + 5}" class="bw-val">${E(r.rest)}</text>`; }).join('')}
    <text x="${L}" y="${H - 6}" class="bw-ax">Restschuld nach 10 Jahren bei ${P(f.zins, 2)} Sollzins · Darlehen ${E(f.darlehen)}</text>
  </svg>`;
}

// ---------- 6. Rechtsrahmen ----------
const RECHT = [
  ['§ 34c GewO', 'Immobilienmakler, Darlehensvermittler (ohne Immobiliar-Verbraucherdarlehen), Bauträger, WEG-Verwalter', 'Erlaubnis der IHK/Gewerbeamt, MaBV-Pflichten, Weiterbildung 20 Std. in 3 Jahren'],
  ['§ 34i GewO', 'Immobiliardarlehensvermittler (Verbraucher-Baufinanzierung)', 'Sachkundeprüfung, Berufshaftpflicht, Registrierung im Vermittlerregister (DIHK), ImmVermV'],
  ['KWG / CRR', 'Kreditinstitute', 'Erlaubnis BaFin, Eigenmittel nach CRR (Basel III), § 18 KWG: Offenlegung der wirtschaftlichen Verhältnisse ab 750.000 €'],
  ['MaRisk BTO 1', 'Kreditgeschäft der Banken', 'Funktionstrennung Markt / Marktfolge, Votierung, Kreditprozesse, Risikoklassifizierung'],
  ['§§ 491 ff., 505a–505e BGB', 'Immobiliar-Verbraucherdarlehen (Umsetzung der Wohnimmobilienkreditrichtlinie)', 'Kreditwürdigkeitsprüfung, ESIS-Merkblatt (Art. 247 EGBGB), Widerrufsrecht, Beratungsstandards'],
  ['§§ 656a–656d BGB', 'Maklerverträge über Wohnung / Einfamilienhaus mit Verbrauchern', 'Textform; Halbteilung der Provision; Abwälzung höchstens zur Hälfte nach Zahlungsnachweis'],
  ['§ 511 BGB', 'Beratungsleistungen bei Immobiliar-Verbraucherdarlehen', 'Information vor der Beratung, Empfehlung aus ausreichender Zahl von Verträgen, Dokumentation'],
  ['§§ 655a–655e BGB', 'Darlehensvermittlungsverträge mit Verbrauchern', 'Textform, Offenlegung der Vergütung, Vergütung erst bei Auszahlung'],
  ['§ 87 GEG', 'Immobilienanzeigen (Verkauf, Vermietung)', 'Pflichtangaben aus dem Energieausweis in der Anzeige'],
  ['GwG', 'Immobilienmakler als Verpflichtete (§ 2 Abs. 1 Nr. 14 GwG)', 'Identifizierung, Risikomanagement, Aufzeichnung, Verdachtsmeldung an die FIU'],
  ['§ 34f / § 34h GewO', 'Finanzanlagenvermittler und Honorar-Finanzanlagenberater', 'Sachkunde, Haftpflicht, Register; keine Erlaubnis für Immobiliardarlehen'],
  ['§ 34d GewO', 'Versicherungsvermittler und -berater', 'Erlaubnis, Sachkunde, Register, Weiterbildung 15 Stunden je Kalenderjahr'],
  ['Art. 28 DSGVO', 'Verarbeitung von Kundendaten im Auftrag', 'Auftragsverarbeitungsvertrag (AVV) – im Portal unter „Profil“ abgeschlossen'],
];

// ---------- 7. Fachglossar ----------
const GLOSSAR = [
  ['Annuität', 'Gleichbleibende Jahresleistung aus Zins und Tilgung. Der Zinsanteil sinkt, der Tilgungsanteil steigt mit jeder Rate.'],
  ['Anschlussfinanzierung', 'Neue Konditionen für die Restschuld nach Ablauf der Sollzinsbindung – intern als Prolongation oder extern als Umschuldung.'],
  ['Auszahlungsvoraussetzungen', 'Bedingungen vor der Valutierung, z. B. eingetragene Grundschuld, Notarbestätigung, Nachweis der Eigenmittel.'],
  ['Beleihungsauslauf', 'Darlehen im Verhältnis zum Beleihungswert. Wichtigster Treiber der Zinsstaffel neben der Bonität.'],
  ['Beleihungswert', 'Vorsichtig ermittelter, langfristig erzielbarer Wert nach BelWertV – meist unter dem Marktwert.'],
  ['Bereitstellungszinsen', 'Entgelt für zugesagte, aber noch nicht abgerufene Darlehensbeträge nach Ablauf der bereitstellungsfreien Zeit.'],
  ['Bonität', 'Kreditwürdigkeit des Kunden aus Einkommen, Vermögen, Zahlungsverhalten und Beschäftigungssituation.'],
  ['CRR', 'Capital Requirements Regulation (EU) – setzt Basel III um; regelt u. a. die Risikogewichte für immobilienbesicherte Kredite.'],
  ['DSCR', 'Debt Service Coverage Ratio: Nettomietertrag ÷ Kapitaldienst. Unter 1,0 muss der Kapitaldienst teilweise aus anderem Einkommen getragen werden.'],
  ['Eigenkapitalquote', 'Eigenmittel im Verhältnis zum Gesamtaufwand (Kaufpreis + Nebenkosten).'],
  ['Erwerbsnebenkosten', 'Grunderwerbsteuer (3,5–6,5 % je Bundesland), Notar und Grundbuch (rund 1,5–2 %), ggf. Maklerprovision.'],
  ['ESIS-Merkblatt', 'Europäisches Standardisiertes Merkblatt mit allen wesentlichen Darlehensbedingungen vor Vertragsschluss.'],
  ['Grundschuld', 'Grundpfandrecht im Grundbuch (Abt. III) als Sicherheit der Bank; mit Sicherungszweckerklärung an das Darlehen gebunden.'],
  ['Haushaltsrechnung', 'Gegenüberstellung von Einnahmen und Ausgaben zur Prüfung der Kapitaldienstfähigkeit.'],
  ['Kapitaldienstfähigkeit (KDF)', 'Fähigkeit, Zins und Tilgung dauerhaft aus dem verfügbaren Einkommen zu leisten – auch nach einem Zinsanstieg.'],
  ['KfW-Förderung', 'Förderkredite der KfW (z. B. Wohneigentum, energieeffiziente Gebäude), meist über die Hausbank beantragt.'],
  ['LTV', 'Loan-to-Value: Darlehen im Verhältnis zum Markt- oder Kaufpreis (international üblich).'],
  ['Marktwert', 'Verkehrswert nach § 194 BauGB: Preis, der am Stichtag im gewöhnlichen Geschäftsverkehr erzielbar wäre.'],
  ['Nachrangdarlehen', 'Darlehen mit schlechterer Rangstelle im Grundbuch; höheres Risiko, daher höherer Zins.'],
  ['PD', 'Probability of Default: geschätzte Ausfallwahrscheinlichkeit aus dem internen Rating der Bank.'],
  ['Realkredit', 'Grundpfandrechtlich gesicherter Kredit innerhalb von 60 % des Beleihungswerts (Pfandbrief-Deckungsgrenze nach § 14 PfandBG).'],
  ['Restschuld', 'Offener Darlehensbetrag zu einem Stichtag, insbesondere zum Ende der Sollzinsbindung.'],
  ['Sicherheitsabschlag', 'Bankindividueller Abschlag vom Marktwert zur Ermittlung des Beleihungswerts (häufig 10–20 %).'],
  ['Sollzinsbindung', 'Zeitraum mit festem Sollzins. Nach 10 Jahren besteht ein gesetzliches Kündigungsrecht (§ 489 Abs. 1 Nr. 2 BGB) mit 6 Monaten Frist.'],
  ['Sondertilgung', 'Vertraglich vereinbarte außerplanmäßige Tilgung, z. B. 5 % der Darlehenssumme pro Jahr.'],
  ['Stresszins', 'Angenommener höherer Zins nach Zinsbindungsende, mit dem die Tragfähigkeit vorsichtig geprüft wird.'],
  ['Valutierung', 'Auszahlung des Darlehens; ab dann laufen Sollzinsen.'],
  ['Vorfälligkeitsentschädigung', 'Ausgleich des Zinsschadens der Bank bei vorzeitiger Rückzahlung innerhalb der Zinsbindung (§ 502 BGB).'],
  ['Zweckerklärung', 'Sicherungsabrede, welche Forderungen die Grundschuld absichert (eng oder weit).'],
];

// ---------- Praxis: Sonderfälle und Einwände (für erfahrene Berater, keine Grundlagen) ----------
const SONDER = [
  ['Selbstständig unter 3 Jahren', 'Viele Banken verlangen zwei bis drei Jahresabschlüsse; einzelne akzeptieren ein volles Geschäftsjahr bei einschlägiger Vorerfahrung.', 'Branchenerfahrung und Vortätigkeit belegen, aktuelle BWA mit Vorjahresvergleich, höhere Eigenkapitalquote, gezielt Banken mit Selbstständigen-Fokus ansprechen.'],
  ['Probezeit oder Befristung', 'Bankindividuell: teils Ablehnung, teils Zusage bei gefragten Berufen oder langer Beschäftigungshistorie.', 'Arbeitgeberbestätigung (Übernahmeabsicht), lückenloser Lebenslauf, Einkommen des Mitantragstellers tragend rechnen.'],
  ['Elternzeit', 'Elterngeld wird meist nicht dauerhaft angerechnet; das Einkommen nach Rückkehr teils schon.', 'Rückkehrbestätigung mit Datum und Stundenumfang; Kapitaldienst für die Elternzeit-Phase separat darstellen.'],
  ['Beleihungsauslauf über 100 %', 'Kleiner Anbieterkreis, spürbare Zinsaufschläge, sehr gute Bonität und Haushaltsüberschuss nötig.', 'Höhere Anfangstilgung, Förderbausteine (KfW, Landesförderbanken) einbinden, Überschuss nach Stresszins belegen.'],
  ['Kapitalanleger mit Bestand', 'Mieten werden häufig nur zu 70–80 % angesetzt; der Bestand wird gesamthaft gerechnet.', 'Objektliste mit Restschulden, Mieten und Bewirtschaftung; DSCR je Objekt und gesamt; Anlage V der letzten Jahre.'],
  ['Erbbaurecht', 'Restlaufzeit muss die Darlehenslaufzeit deutlich übersteigen; Zustimmung des Grundstückseigentümers zur Belastung erforderlich.', 'Erbbaurechtsvertrag früh anfordern, Restlaufzeit und Erbbauzins prüfen, Zustimmung vor Einreichung klären.'],
  ['Energieeffizienzklasse G / H', 'Abschläge beim Beleihungswert möglich; Sanierungsbedarf fließt in die Bewertung ein.', 'Sanierungsfahrplan und Kostenschätzung beilegen, Modernisierung mitfinanzieren, Förderprogramme für Sanierung prüfen.'],
  ['Einkommen aus dem Ausland', 'Bankindividuell, oft mit Abschlägen (Währung, Rechtsdurchsetzung) oder nur bei ausgewählten Banken.', 'Bankauswahl vor Unterlagensammlung; Steuerbescheide, Arbeitsvertrag und Übersetzungen bereithalten.'],
];
const EINWAND = [
  ['„Ich warte, bis die Zinsen fallen.“', 'Rate bei ±1 Prozentpunkt zeigen (Grafik Stresstest). Ein Forward-Darlehen oder ein variabler Baustein kann Zeit gewinnen – ohne Zinsprognose zu versprechen.'],
  ['„Die Rate soll so niedrig wie möglich sein.“', 'Grafik Anfangstilgung: Restschuld nach 10 Jahren bei 1 % vs. 3 %. Mittelweg: moderate Tilgung plus Sondertilgungsrecht und Tilgungssatzwechsel.'],
  ['„Eine lange Zinsbindung ist zu teuer.“', 'Aufschlag für längere Bindung gegen das Risiko der Anschlussrate stellen. Nach 10 Jahren besteht ohnehin das Kündigungsrecht nach § 489 BGB.'],
  ['„Warum so viele Unterlagen?“', 'Die Bank ist zur Kreditwürdigkeitsprüfung verpflichtet (§ 505b BGB). Vollständige Mappe = weniger Rückfragen, schnellere Zusage. LeaseRun zeigt dem Kunden, was fehlt.'],
  ['„Meine Hausbank ist günstiger.“', 'Effektivzins und Konditionen aus dem ESIS-Merkblatt nebeneinanderlegen – inklusive Sondertilgung, Bereitstellungszinsfreiheit und Tilgungswechsel.'],
];

const TITLES = { charts: 'Gesprächsgrafiken', sonder: 'Sonderfälle', einwand: 'Einwände', ns: 'Prüfpfade', unterlagen: 'Unterlagen', recht: 'Pflichten-Check' };
const chTitle = (k) => TITLES[k] || KAPITEL[k]?.t.split(/ [–-] /)[0] || k;
const recht = (b) => (BRANCHEN[b]?.recht ? RECHT.filter(([n]) => BRANCHEN[b].recht.includes(n)) : RECHT);
// Kapitel aus der Branchen-Datei als HTML (Tabelle, Karten oder Schritte).
function kapitelHtml(k, full) {
  const c = KAPITEL[k]; if (!c) return '';
  if (c.typ === 'table') return full
    ? `<div class="wa-wrap"><table class="bw-table"><thead><tr>${c.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${c.rows.map((r) => `<tr>${r.map((x, i) => `<td>${i ? x : `<strong>${x}</strong>`}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    : c.rows.map((r) => `<div class="bw-sf"><strong>${r[0]}</strong>${r.slice(1).map((x, i) => `<p${i === r.length - 2 ? ' class="bw-sf-a"' : ''}>${i ? '→ ' : ''}${x}</p>`).join('')}</div>`).join('');
  if (c.typ === 'steps') return `<ol class="bw-steps">${c.items.map(([t, x]) => `<li><strong>${t}</strong><p>${x}</p></li>`).join('')}</ol>`;
  return full ? `<div class="bw-ew">${c.items.map(([t, x]) => `<article><strong>${t}</strong><p>${x}</p></article>`).join('')}</div>` : c.items.map(([t, x]) => `<div class="bw-sf"><strong>${t}</strong><p>${x}</p></div>`).join('');
}

// ---------- Handy: kompakte Ansicht ----------
const VIEW_KEY = 'bw-view';
const viewPref = () => { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } };
const setView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* nur Komfort */ } };
const ANSCHLUSS = ['Bis 60 Monate vorher: Forward-Darlehen (Aufschlag je Vorlaufmonat).', 'Ab etwa 12 Monate vorher: Prolongationsangebot gegen Marktangebote stellen.', 'Bankwechsel: Grundschuldabtretung statt Neubestellung spart Notar- und Grundbuchkosten.', 'Nach 10 Jahren ab Vollauszahlung: Kündigungsrecht nach § 489 BGB (6 Monate Frist).'];
function renderCompact(box, branche) {
  const B = BRANCHEN[branche] || BRANCHEN.allgemein, f = FALL, plan = tilgungsplan(f.darlehen, f.zins, f.tilgung, 30), st = stress();
  const body = (k) => {
    if (KAPITEL[k]) return kapitelHtml(k, false);
    if (k === 'sonder') return SONDER.map(([t, a, b]) => `<div class="bw-sf"><strong>${t}</strong><p>${a}</p><p class="bw-sf-a">→ ${b}</p></div>`).join('');
    if (k === 'einwand') return EINWAND.map(([t, a]) => `<div class="bw-sf"><strong>${t}</strong><p>${a}</p></div>`).join('');
    if (k === 'ns') return `<ul>${ANSCHLUSS.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (k === 'unterlagen') return MIND2.map((b) => `<div class="bw-sf"><strong>${b.t}</strong><p>${b.k.map(esc).join(' · ')}</p></div>`).join('');
    if (k === 'recht') return `<ul>${recht(branche).map(([a, , c]) => `<li><strong>${a}:</strong> ${c}</li>`).join('')}</ul>`;
    if (k === 'charts') return `<div class="bw-kpis">${[['Darlehen', E(f.darlehen)], ['Rate', E(f.rate) + ' mtl.'], ['Restschuld nach 10 J.', E(plan[9].rest)], ['Rate bei 6 % Anschluss', E(st[2].rate)]].map(([a, v]) => `<div><small>${a}</small><strong>${v}</strong></div>`).join('')}</div><p class="form-note">Kaufpreis ${E(f.kaufpreis)}, Eigenkapital ${E(f.eigenkapital)}, Sollzins ${P(f.zins, 2)}, Tilgung ${P(f.tilgung, 0)}. Die Grafiken dazu: „Gesprächsgrafiken öffnen“.</p>`;
    return '';
  };
  const label = (k) => (k === 'ns' ? 'Anschlussfinanzierung: Zeitfenster' : k === 'charts' ? 'Rechenbeispiel zum Zeigen' : KAPITEL[k]?.t || ({ sonder: 'Sonderfälle & Lösungsansätze', einwand: 'Einwände im Kundengespräch', unterlagen: 'Unterlagen je Kundentyp', recht: 'Pflichten-Check' })[k]);
  box.innerHTML = `<div class="bw bw-compact">
    <section class="pt-card bw-hero"><span class="bw-kick">Beratungskompass · ${esc(B.label)}</span><h2>Ihre Hilfe im Beratungsgespräch</h2>
      <p>Schnelle Antworten für den nächsten Termin – kurz fürs Handy, mit Grafiken in der vollen Ansicht.</p>
      <button type="button" class="btn bw-switch" data-view="voll">Volle Ansicht mit Grafiken</button></section>
    ${B.chapters.map((k, i) => `<details class="pt-card bw-acc"${i === 0 ? ' open' : ''}><summary><b class="bw-no">${i + 1}</b>${label(k)}</summary>${body(k)}</details>`).join('')}
    <p class="form-note">Erfahrungswerte und Normen, Stand Oktober 2026. Vorgaben der einzelnen Banken gehen vor. Keine Rechts- oder Steuerberatung.</p>
  </div>`;
  bindCommon(box, branche);
}
function bindCommon(box, branche) {
  box.querySelectorAll('.bw-switch').forEach((b) => b.onclick = () => { setView(b.dataset.view === 'voll' ? 'voll' : 'kompakt'); renderWissen(box, branche); box.scrollIntoView({ block: 'start' }); });
}

export function renderWissen(box, branche = 'allgemein') {
  const B = BRANCHEN[branche] || BRANCHEN.allgemein;
  const pref = viewPref();
  if (pref ? pref === 'kompakt' : innerWidth < 900) { renderCompact(box, branche); return; }
  const f = FALL;
  const noi = (f.kaltmiete - f.nichtUmlage) * 12;
  const sec = {
    charts: () => `<p class="form-note">Im Termin auf dem Bildschirm zeigen – sie machen Zinsrisiko und Tilgungswahl greifbar.</p>
      <div class="bw-grid">
        <figure class="bw-fig"><figcaption><strong>Stresstest: Rate nach der Zinsbindung</strong><span>Restschuld nach 10 Jahren, Anschlusszins 3,6 bis 7 %</span></figcaption>${chartStress()}
          <p class="form-note"><b>Impuls:</b> „Was passiert mit Ihrer Rate, wenn der Zins in zehn Jahren bei 6 % liegt?“</p></figure>
        <figure class="bw-fig"><figcaption><strong>Haushaltsrechnung (Wasserfall)</strong><span>Was nach der Rate übrig bleibt</span></figcaption>${chartWasserfall()}
          <p class="form-note"><b>Impuls:</b> Puffer nach Rate sichtbar machen – Grundlage für Tilgung und Zinsbindung.</p></figure>
        <figure class="bw-fig bw-wide"><figcaption><strong>Anfangstilgung entscheidet über die Restschuld</strong><span>Gleiches Darlehen, gleicher Zins, 1 bis 4 % Anfangstilgung</span></figcaption>${chartTilgung()}
          <p class="form-note"><b>Impuls:</b> Höhere Rate heute gegen weniger Zinsänderungsrisiko in zehn Jahren abwägen.</p></figure>
        <figure class="bw-fig bw-wide"><figcaption><strong>Zins- und Tilgungsanteil über 30 Jahre</strong><span>${E(f.darlehen)} · ${P(f.zins, 2)} Sollzins · ${P(f.tilgung, 0)} Anfangstilgung</span></figcaption>${chartAnnuitaet()}
          <p class="form-note"><b>Impuls:</b> Die Restschuld am Ende der Zinsbindung gehört ins Beratungsprotokoll.</p></figure>
        <figure class="bw-fig"><figcaption><strong>Beleihungsauslauf</strong><span>Sicherheitsabschlag ${P(f.abschlag, 0)} · Auslauf ${P(f.darlehen / f.beleihungswert)} · LTV ${P(f.darlehen / f.marktwert)}</span></figcaption>${chartBeleihung()}
          <p class="form-note"><b>Impuls:</b> Wie viel zusätzliches Eigenkapital die nächste Zinsstufe erreicht.</p></figure>
        <figure class="bw-fig"><figcaption><strong>DSCR bei Vermietung</strong><span>Nettomietertrag ${E(noi)} p. a. ÷ Kapitaldienst ${E(f.annuitaet)}</span></figcaption>${dscrGauge()}
          <p class="form-note"><b>Impuls:</b> Wie viel des Kapitaldienstes aus anderem Einkommen getragen werden muss.</p></figure>
      </div>`,
    sonder: () => `<div class="wa-wrap"><table class="bw-table"><thead><tr><th>Konstellation</th><th>Typische Bankhaltung</th><th>Lösungsansatz</th></tr></thead><tbody>${SONDER.map(([a, b, c]) => `<tr><td><strong>${a}</strong></td><td>${b}</td><td>${c}</td></tr>`).join('')}</tbody></table></div><p class="form-note">Erfahrungswerte; die Vorgaben der einzelnen Banken gehen vor.</p>`,
    einwand: () => `<div class="bw-ew">${EINWAND.map(([t, a]) => `<article><strong>${t}</strong><p>${a}</p></article>`).join('')}</div>`,
    ns: () => `<p class="form-note">Neufinanzierung und Anschluss als Ablauf – zum Abgleich mit Ihrem Prozess oder für neue Teammitglieder.</p>${ns()}<h3 class="bw-h3">Anschlussfinanzierung</h3>${ns2()}`,
    unterlagen: () => `<p class="form-note">Als Checkliste für den Kunden – LeaseRun zeigt ihm in der App automatisch, welche Unterlagen-Arten noch fehlen.</p>${mindmap(MIND2, 'Kredit&shy;mappe', 'vollständig einreichen', 'Mindmap: Unterlagen je Kundentyp')}`,
    recht: () => `<div class="wa-wrap"><table class="bw-table"><thead><tr><th>Norm</th><th>Gilt für</th><th>Kernpflichten</th></tr></thead><tbody>${recht(branche).map(([a, b, c]) => `<tr><td><strong>${a}</strong></td><td>${b}</td><td>${c}</td></tr>`).join('')}</tbody></table></div><p class="form-note">LeaseRun ist ein technisches Analyse- und Vorbereitungswerkzeug und vermittelt keine Kredite. Stand: Oktober 2026 – Orientierung, keine Rechtsberatung.</p>`,
  };
  const head = (k) => (KAPITEL[k] ? KAPITEL[k].t : ({ charts: 'Gesprächsgrafiken zum Zeigen', sonder: 'Sonderfälle & Lösungsansätze', einwand: 'Einwände im Kundengespräch', ns: 'Prüfpfade vor der Einreichung', unterlagen: 'Unterlagen je Kundentyp', recht: 'Pflichten-Check' })[k]);
  box.innerHTML = `<div class="bw">
    <section class="pt-card bw-hero"><span class="bw-kick">Beratungskompass · ${esc(B.label)}</span>
      <h2>Ihre Hilfe im Beratungsgespräch</h2>
      <p>Schnell die relevanten Informationen, Rechenbeispiele und Prüfpunkte für den nächsten Kundentermin finden – passend für ${esc(B.desc)}.</p>
      <nav class="bw-toc" aria-label="Kapitel">${B.chapters.map((k, i) => `<a href="#wissen=${k}" data-ch="${k}"><b>${i + 1}</b>${chTitle(k)}</a>`).join('')}</nav>
      <button type="button" class="btn bw-switch bw-switch-m" data-view="kompakt">Kompakte Ansicht</button>
      ${B.chapters.includes('charts') ? `<div class="bw-case"><strong>Beispielrechnung · keine Finanzierungszusage</strong><span>Kaufpreis ${E(f.kaufpreis)}</span><span>Nebenkosten ${P(f.nebenkosten)}</span><span>Eigenkapital ${E(f.eigenkapital)}</span><span>Darlehen ${E(f.darlehen)}</span><span>Sollzins ${P(f.zins, 2)} · Tilgung ${P(f.tilgung, 0)}</span><span>Rate ${E(f.rate, 2)} mtl.</span></div>` : ''}
    </section>
    ${B.chapters.map((k, i) => `<section class="pt-card" id="bw-${k}"><h2><b class="bw-no">${i + 1}</b> ${head(k)}</h2>${KAPITEL[k]?.intro ? `<p class="form-note">${KAPITEL[k].intro}</p>` : ''}${KAPITEL[k] ? kapitelHtml(k, true) : sec[k]()}</section>`).join('')}
    <p class="form-note">Erfahrungswerte und Normen, Stand Oktober 2026. Vorgaben der einzelnen Banken gehen vor. Keine Rechts- oder Steuerberatung.</p>
  </div>`;
  bindCommon(box, branche);
  box.querySelectorAll('[data-ch]').forEach((a) => a.onclick = (e) => { e.preventDefault(); box.querySelector('#bw-' + a.dataset.ch)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const want = /wissen=([a-zA-Z]+)/.exec(location.hash)?.[1];
  if (want) requestAnimationFrame(() => box.querySelector('#bw-' + want)?.scrollIntoView({ block: 'start' }));
}
