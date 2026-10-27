// LeaseRun – gemeinsamer Rechenkern für Rechner, Fristen, Szenarien und Portfolio.
// Reine Funktionen ohne DOM; im Browser als Modul geladen und mit node:test geprüft.
// Alle Rechtsangaben: Stand Oktober 2026; maßgeblich ist die jeweils aktuelle Fassung.

import { val } from './finanz-config.mjs';

const r2 = (x) => Math.round(x * 100) / 100;

// ---------- Annuitätendarlehen ----------
export function monthlyRate(loan, ratePa, repaymentPa) {
  return loan > 0 ? (loan * (ratePa + repaymentPa)) / 12 : 0;
}

export function balanceAfterMonths(loan, ratePa, repaymentPa, months) {
  if (loan <= 0) return 0;
  const i = ratePa / 12;
  const a = monthlyRate(loan, ratePa, repaymentPa);
  if (i === 0) return Math.max(0, loan - a * months);
  const q = Math.pow(1 + i, months);
  return Math.max(0, loan * q - a * ((q - 1) / i));
}

// Monatliche Bewirtschaftung vor Finanzierung: Miete abzüglich Mietausfall und nicht umlagefähiger Kosten.
export function netOperatingMonthly({ rent = 0, vacancyPct = 0, nonRecoverable = 0, maintenance = 0 }) {
  return rent * (1 - vacancyPct / 100) - nonRecoverable - maintenance;
}

// ---------- Anschlussfinanzierung ----------
// Restschuld am Ende der Zinsbindung, neue Rate je Zinssatz und Kipp-Punkt (Zins, bei dem der Cashflow vor Steuern 0 wird).
export function anschluss({ loan, ratePa, repaymentPa, fixedYears, noiMonthly, newRepaymentPa = repaymentPa, rates = [0.03, 0.04, 0.05, 0.06, 0.07] }) {
  const rest = balanceAfterMonths(loan, ratePa, repaymentPa, Math.round(fixedYears * 12));
  const oldRate = monthlyRate(loan, ratePa, repaymentPa);
  const rows = rates.map((r) => {
    const rate = monthlyRate(rest, r, newRepaymentPa);
    return { ratePa: r, rate: r2(rate), diff: r2(rate - oldRate), cashflow: r2(noiMonthly - rate) };
  });
  // Kipp-Punkt: noi = rest*(r+t)/12  →  r = 12*noi/rest − t
  const kipp = rest > 0 ? (12 * noiMonthly) / rest - newRepaymentPa : null;
  return { rest: r2(rest), oldRate: r2(oldRate), rows, kippPunktPa: kipp === null ? null : Math.round(kipp * 10000) / 10000 };
}

// ---------- Verkaufsszenario ----------
// Veräußerungsgewinn nach § 23 EStG: Verkaufserlös − Verkaufskosten − (Anschaffungskosten − in Anspruch genommene AfA).
// Steuerpflicht nur bei Verkauf innerhalb von zehn Jahren; Freigrenze 1.000 € je Jahr (§ 23 Abs. 3 Satz 5 EStG, seit VZ 2024).
export function verkauf({ price, purchaseCostPct = 0, buildingSharePct = 80, afaRatePa = 0.02, years, growthPa = 0, saleCostPct = 0, loan = 0, ratePa = 0, repaymentPa = 0, taxPct = 0 }) {
  const ak = price * (1 + purchaseCostPct / 100);
  const afaBasis = ak * (buildingSharePct / 100);
  const afaTaken = Math.min(afaBasis, afaBasis * afaRatePa * years);
  const value = price * Math.pow(1 + growthPa, years);
  const saleNet = value * (1 - saleCostPct / 100);
  const book = ak - afaTaken;
  const gain = saleNet - book;
  const within10 = years < 10;
  const taxable = within10 && gain >= 1000 ? gain : 0;
  const tax = Math.max(0, taxable) * (taxPct / 100);
  const rest = balanceAfterMonths(loan, ratePa, repaymentPa, Math.round(years * 12));
  return {
    ak: r2(ak), afaTaken: r2(afaTaken), value: r2(value), saleNet: r2(saleNet), book: r2(book), gain: r2(gain),
    within10, tax: r2(tax), rest: r2(rest), cashAfterSale: r2(saleNet - rest - tax),
  };
}

// ---------- Mietrecht ----------
// Indexmiete (§ 557b BGB): Änderung im Verhältnis des Verbraucherpreisindex; frühestens zwölf Monate nach der letzten Änderung wirksam.
export function indexmiete({ rent, indexOld, indexNew, lastChange, effective }) {
  if (!(indexOld > 0) || !(indexNew > 0)) return null;
  const factor = indexNew / indexOld;
  const out = { newRent: r2(rent * factor), changePct: Math.round((factor - 1) * 10000) / 100, diff: r2(rent * factor - rent) };
  if (lastChange && effective) {
    const earliest = addMonths(parseDate(lastChange), 12);
    out.earliest = iso(earliest);
    out.timingOk = parseDate(effective) >= earliest;
  }
  return out;
}

// Staffelmiete (§ 557a BGB): Beträge in Euro, jede Staffel mindestens ein Jahr unverändert;
// in Gebieten mit Mietpreisbremse gilt die Grenze für jede Staffel (§ 557a Abs. 4).
export function staffelmiete({ steps, area = 0, vergleichsmieteQm = 0, bremse = false }) {
  const s = [...steps].filter((x) => x.date && x.rent > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  const cap = bremse && vergleichsmieteQm > 0 && area > 0 ? vergleichsmieteQm * 1.1 * area : null;
  return s.map((x, i) => {
    const prev = s[i - 1];
    const gapOk = !prev || parseDate(x.date) >= addMonths(parseDate(prev.date), 12);
    return {
      date: x.date, rent: r2(x.rent), increase: prev ? r2(x.rent - prev.rent) : 0,
      increasePct: prev ? Math.round((x.rent / prev.rent - 1) * 10000) / 100 : 0,
      gapOk, capOk: cap === null ? null : x.rent <= cap + 0.005, cap: cap === null ? null : r2(cap),
    };
  });
}

// ---------- Steuer ----------
// Kaufpreisaufteilung nach der Restwertmethode: Bodenwert = Grundstücksfläche × Bodenrichtwert × Miteigentumsanteil.
// Vereinfachung: Die BMF-Arbeitshilfe nutzt ein Sachwertverfahren; das Finanzamt kann abweichen.
export function kaufpreisaufteilung({ price, landArea, bodenrichtwert, meaShare = 1, meaTotal = 1 }) {
  const frac = meaTotal > 0 ? meaShare / meaTotal : 1;
  const land = Math.min(price, landArea * bodenrichtwert * frac);
  const building = price - land;
  return { land: r2(land), building: r2(building), buildingSharePct: price > 0 ? Math.round((building / price) * 10000) / 100 : 0 };
}

// Anschaffungsnahe Herstellungskosten (§ 6 Abs. 1 Nr. 1a EStG): 15 % der Gebäude-Anschaffungskosten netto, drei Jahre ab Anschaffung.
export function grenze15({ price, purchaseCostPct = 0, buildingSharePct = 80, spentNet = 0 }) {
  const akGebaeude = price * (1 + purchaseCostPct / 100) * (buildingSharePct / 100);
  const limit = akGebaeude * 0.15;
  return { akGebaeude: r2(akGebaeude), limit: r2(limit), spent: r2(spentNet), headroom: r2(limit - spentNet), exceeded: spentNet > limit };
}

// Verbilligte Vermietung (§ 21 Abs. 2 EStG): Verhältnis Ist-Miete zu ortsüblicher Miete (jeweils Kaltmiete).
// Ab 2021: ≥ 66 % → Werbungskosten voll abziehbar. 50 bis < 66 % → voll nur bei positiver Totalüberschuss-
// prognose, sonst anteilig. < 50 % → Aufteilung in entgeltlich/unentgeltlich, Abzug nur anteilig.
export function verbilligteMiete({ ist = 0, ortsueblich = 0 }) {
  if (!(ortsueblich > 0) || !(ist >= 0)) return null;
  const quote = (ist / ortsueblich) * 100;
  let stufe, abzugPct, hinweis;
  if (quote >= 66) { stufe = 'voll'; abzugPct = 100; hinweis = 'Mindestens 66 % der ortsüblichen Miete: Werbungskosten voll abziehbar.'; }
  else if (quote >= 50) { stufe = 'prognose'; abzugPct = 100; hinweis = '50 bis unter 66 %: voller Abzug nur mit positiver Totalüberschussprognose, sonst anteilig.'; }
  else { stufe = 'anteilig'; abzugPct = r2(quote); hinweis = 'Unter 50 %: Vermietung gilt anteilig als unentgeltlich; Werbungskosten nur anteilig abziehbar.'; }
  return { quote: r2(quote), stufe, abzugPct, mindestMiete66: r2(ortsueblich * 0.66), mindestMiete50: r2(ortsueblich * 0.5), hinweis };
}

// Drei-Objekt-Grenze (gewerblicher Grundstückshandel): Werden in engem zeitlichem Zusammenhang (i. d. R. fünf
// Jahre) mehr als drei Objekte veräußert, droht die Einstufung als gewerblich (Gewerbesteuer, kein steuerfreier
// Verkauf). Rechtsprechung, keine starre Grenze – daher nur ein Warnhinweis. Prüft jedes 5-Jahres-Fenster.
const gueltigesDatum = (s) => (s instanceof Date ? (isNaN(+s) ? null : s) : (/^\d{4}-\d{2}-\d{2}/.test(String(s || '')) ? parseDate(s) : null));

export function dreiObjektGrenze(dates = []) {
  const ds = dates.map(gueltigesDatum).filter(Boolean).sort((a, b) => a - b);
  let maxImFenster = ds.length ? 1 : 0, risiko = false, fenster = null;
  for (let i = 0; i < ds.length; i++) {
    const ende = new Date(ds[i]); ende.setFullYear(ende.getFullYear() + 5);
    const n = ds.filter((d) => d >= ds[i] && d < ende).length;
    if (n > maxImFenster) maxImFenster = n;
    if (n > 3 && !risiko) { risiko = true; fenster = { von: iso(ds[i]), bis: iso(ende) }; }
  }
  return { anzahl: ds.length, maxImFenster, risiko, fenster };
}

// Verkauf steuerfrei (§ 23 EStG): private Veräußerung steuerfrei nach Ablauf von 10 Jahren ab Anschaffung
// (maßgeblich der Tag des obligatorischen Vertrags). Ausnahme Eigennutzung (§ 23 Abs. 1 Nr. 1 S. 3): steuerfrei,
// wenn im Jahr der Veräußerung und den beiden vorangegangenen Kalenderjahren zu eigenen Wohnzwecken genutzt.
export function verkaufSteuerfrei({ anschaffung, verkauf = null, eigengenutzt = false }) {
  const a = gueltigesDatum(anschaffung);
  if (!a) return null;
  // Frist (§§ 187, 188 BGB): beginnt am Tag nach der Anschaffung und endet mit dem Jahrestag nach 10 Jahren.
  // Steuerfrei ist erst ein Verkauf (Notarvertrag) ab dem Folgetag.
  const frist = new Date(a); frist.setFullYear(frist.getFullYear() + 10);
  const ab = new Date(frist); ab.setDate(ab.getDate() + 1);
  const v = verkauf ? gueltigesDatum(verkauf) : null;
  const spekulationVorbei = v ? v >= ab : null;
  let steuerfrei = spekulationVorbei === true;
  let grund = steuerfrei ? 'Zehnjahresfrist abgelaufen – Veräußerungsgewinn steuerfrei.' : null;
  if (!steuerfrei && eigengenutzt) { steuerfrei = true; grund = 'Eigennutzung (ausschließlich seit Kauf oder im Verkaufsjahr und den beiden Vorjahren) – steuerfrei (§ 23 Abs. 1 Nr. 1 S. 3 EStG).'; }
  return { fristEnde: iso(frist), steuerfreiAb: iso(ab), spekulationVorbei, steuerfrei, grund };
}

// ---------- Fristen ----------
export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}
export function iso(d) { return d.toISOString().slice(0, 10); }
export function addMonths(d, n) {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d.getUTCDate(), last));
  return x;
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

// Liefert sortierte Termine. Eingaben als ISO-Datum (JJJJ-MM-TT); fehlende Angaben werden übersprungen.
export function fristen({ purchaseDate, payoutDate, fixedYears, lastRentChange, indexRent = false, energyCertDate }) {
  const out = [];
  const push = (date, title, detail, source, kind = 'frist') => out.push({ date: iso(date), title, detail, source, kind });
  if (purchaseDate) {
    const p = parseDate(purchaseDate);
    push(addMonths(p, 36), 'Ende der 15-%-Frist für Instandsetzungen',
      'Bis hier zählen Instandsetzungs- und Modernisierungskosten (netto) für die 15-%-Grenze der Gebäude-Anschaffungskosten. Beginn ist die Anschaffung (Übergang von Nutzen und Lasten); bitte mit diesem Datum rechnen.',
      '§ 6 Abs. 1 Nr. 1a EStG');
    push(addDays(addMonths(p, 120), 1), 'Verkauf ohne Spekulationssteuer möglich',
      'Ab diesem Tag liegen zwischen Kaufvertrag und Verkaufsvertrag mehr als zehn Jahre. Maßgeblich sind die Daten der notariellen Verträge.',
      '§ 23 Abs. 1 Satz 1 Nr. 1 EStG');
  }
  const pay = payoutDate || purchaseDate;
  if (pay && fixedYears > 0) {
    const p = parseDate(pay);
    const end = addMonths(p, Math.round(fixedYears * 12));
    push(addMonths(end, -12), 'Anschlussfinanzierung vorbereiten',
      'Empfehlung: zwölf Monate vor Ablauf Angebote einholen und Restschuld prüfen. Forward-Darlehen sind je nach Bank deutlich früher möglich.',
      'Empfehlung LeaseRun', 'hinweis');
    push(end, 'Ende der Zinsbindung', 'Ab hier gilt der neue Zinssatz. Restschuld und Anschluss-Szenarien in „Szenarien“ prüfen.', 'Darlehensvertrag');
    if (fixedYears > 10) {
      const notice = addMonths(p, 120);
      push(notice, 'Kündigungsrecht nach zehn Jahren (frühestens kündigen)',
        'Bei Zinsbindung über zehn Jahre kann der Darlehensnehmer zehn Jahre nach vollständigem Empfang des Darlehens mit sechs Monaten Frist kündigen. Auszahlungsdatum laut Bank verwenden.',
        '§ 489 Abs. 1 Nr. 2 BGB');
      push(addMonths(notice, 6), 'Frühestes Vertragsende nach Kündigung', 'Sechs Monate nach der Kündigung.', '§ 489 Abs. 1 Nr. 2 BGB');
    }
  }
  if (lastRentChange) {
    const c = parseDate(lastRentChange);
    if (indexRent) {
      push(addMonths(c, 12), 'Indexmiete: nächste Anpassung frühestens wirksam',
        'Die Miete muss jeweils mindestens ein Jahr unverändert bleiben (Erhöhungen nach § 559 BGB und Änderungen nach § 557b ausgenommen).',
        '§ 557b Abs. 2 BGB');
    } else {
      push(addMonths(c, 12), 'Mieterhöhung bis zur Vergleichsmiete frühestens verlangen',
        'Das Erhöhungsverlangen kann frühestens ein Jahr nach der letzten Erhöhung gestellt werden.', '§ 558 Abs. 1 Satz 2 BGB');
      push(addMonths(c, 15), 'Mieterhöhung frühestens wirksam',
        'Die Miete muss zum Zeitpunkt der Erhöhung seit 15 Monaten unverändert sein; Kappungsgrenze 20 % bzw. 15 % in drei Jahren beachten.',
        '§ 558 Abs. 1 Satz 1, Abs. 3 BGB');
    }
  }
  if (energyCertDate) {
    push(addMonths(parseDate(energyCertDate), 120), 'Energieausweis läuft ab',
      'Energieausweise gelten zehn Jahre. Bei Verkauf oder Neuvermietung muss ein gültiger Ausweis vorliegen.', 'Energieausweis-Recht (seit 29.07.2026 GModG, zuvor § 79 GEG)');
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// iCalendar-Datei (RFC 5545) mit ganztägigen Terminen.
export function toICS(events, { name = 'LeaseRun Fristen', stamp = new Date() } = {}) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => {
    const parts = [];
    let rest = line;
    while (rest.length > 74) { parts.push(rest.slice(0, 74)); rest = ' ' + rest.slice(74); }
    parts.push(rest);
    return parts.join('\r\n');
  };
  const dt = (s) => s.replace(/-/g, '');
  const ts = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LeaseRun//Fristen//DE', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  events.forEach((e, i) => {
    const end = iso(addDays(parseDate(e.date), 1));
    lines.push('BEGIN:VEVENT', `UID:leaserun-${dt(e.date)}-${i}@leaserun.com`, `DTSTAMP:${ts}`,
      `DTSTART;VALUE=DATE:${dt(e.date)}`, `DTEND;VALUE=DATE:${dt(end)}`,
      fold(`SUMMARY:${esc(e.title)}`), fold(`DESCRIPTION:${esc(`${e.detail} Quelle: ${e.source}. Keine Rechtsberatung.`)}`), 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

// ---------- Portfolio ----------
// Kennzahlen je Objekt und Summen; Zinsschock wirkt erst ab Ende der jeweiligen Zinsbindung.
export function portfolio(objects, { shockPp = 0 } = {}) {
  const rows = objects.map((o) => {
    const noi = netOperatingMonthly(o);
    const rate = monthlyRate(o.loan || 0, (o.interestPct || 0) / 100, (o.repaymentPct || 0) / 100);
    const cf = noi - rate;
    let after = null;
    if (o.fixedYears > 0 && o.loan > 0) {
      const a = anschluss({ loan: o.loan, ratePa: o.interestPct / 100, repaymentPa: o.repaymentPct / 100, fixedYears: o.fixedYears, noiMonthly: noi,
        rates: [o.interestPct / 100 + shockPp / 100] });
      after = { rest: a.rest, cashflow: a.rows[0].cashflow, rate: a.rows[0].rate };
    }
    return {
      id: o.id, name: o.name, price: o.price || 0, loan: o.loan || 0, rentYear: r2((o.rent || 0) * 12),
      noiMonthly: r2(noi), rate: r2(rate), cashflow: r2(cf),
      dscr: rate > 0 ? Math.round((noi / rate) * 100) / 100 : null,
      ltv: o.price > 0 ? Math.round(((o.loan || 0) / o.price) * 10000) / 100 : null,
      grossYieldPct: o.price > 0 ? Math.round(((o.rent || 0) * 12 / o.price) * 10000) / 100 : null,
      after,
    };
  });
  const sum = (k) => r2(rows.reduce((s, r) => s + (r[k] || 0), 0));
  const noi = sum('noiMonthly'), rate = sum('rate');
  const price = sum('price'), loan = sum('loan');
  return {
    rows,
    total: {
      price, loan, rentYear: sum('rentYear'), noiMonthly: noi, rate, cashflow: sum('cashflow'),
      dscr: rate > 0 ? Math.round((noi / rate) * 100) / 100 : null,
      ltv: price > 0 ? Math.round((loan / price) * 10000) / 100 : null,
      afterCashflow: rows.every((r) => r.after) ? r2(rows.reduce((s, r) => s + r.after.cashflow, 0)) : null,
    },
  };
}

// ---------- Kaufnebenkosten nach Bundesland ----------
// Grunderwerbsteuersätze, Stand Oktober 2026 (letzte Änderung: Bremen 5,5 % seit 01.07.2025).
// Notar und Grundbuch sind Richtwerte nach GNotKG; Makler: Käuferanteil nach Vereinbarung (bei Wohnungen und
// Einfamilienhäusern höchstens die Hälfte der Gesamtprovision, § 656c BGB).
export const GREST = {
  'baden-wuerttemberg': { name: 'Baden-Württemberg', pct: 5.0 },
  bayern: { name: 'Bayern', pct: 3.5 },
  berlin: { name: 'Berlin', pct: 6.0 },
  brandenburg: { name: 'Brandenburg', pct: 6.5 },
  bremen: { name: 'Bremen', pct: 5.5, since: '2025-07-01' },
  hamburg: { name: 'Hamburg', pct: 5.5, since: '2023-01-01' },
  hessen: { name: 'Hessen', pct: 6.0 },
  'mecklenburg-vorpommern': { name: 'Mecklenburg-Vorpommern', pct: 6.0 },
  niedersachsen: { name: 'Niedersachsen', pct: 5.0 },
  'nordrhein-westfalen': { name: 'Nordrhein-Westfalen', pct: 6.5 },
  'rheinland-pfalz': { name: 'Rheinland-Pfalz', pct: 5.0 },
  saarland: { name: 'Saarland', pct: 6.5 },
  sachsen: { name: 'Sachsen', pct: 5.5, since: '2023-01-01' },
  'sachsen-anhalt': { name: 'Sachsen-Anhalt', pct: 5.0 },
  'schleswig-holstein': { name: 'Schleswig-Holstein', pct: 6.5 },
  thueringen: { name: 'Thüringen', pct: 5.0, since: '2024-01-01' },
};

export function kaufnebenkosten({ price, land, notaryPct = val('notar_pct'), landRegistryPct = val('grundbuch_pct'), brokerPct = 0 }) {
  const g = GREST[land];
  if (!g || !(price > 0)) return null;
  const parts = [
    { key: 'grest', label: `Grunderwerbsteuer ${g.name}`, pct: g.pct },
    { key: 'notar', label: 'Notar (Richtwert)', pct: notaryPct },
    { key: 'grundbuch', label: 'Grundbuchamt (Richtwert)', pct: landRegistryPct },
    ...(brokerPct > 0 ? [{ key: 'makler', label: 'Makler (Käuferanteil)', pct: brokerPct }] : []),
  ].map((x) => ({ ...x, amount: r2((price * x.pct) / 100) }));
  const total = r2(parts.reduce((s, x) => s + x.amount, 0));
  return { land: g.name, parts, total, totalPct: Math.round((total / price) * 10000) / 100, allIn: r2(price + total) };
}

// ---------- Einstieg „Meine erste Immobilie“ ----------
// Drei Eingaben plus Annahmen; liefert Darlehen, Rate, Tilgungshebel, Sicherheitsnetz und 10-Jahres-Bild.
export function einstieg({ price, rent, equity, land = 'hessen', ratePa = 0.038, repaymentPa = 0.02, brokerPct = 3.57, costSharePct = 15, reserve = 0, growthPa = 0 }) {
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk) return null;
  const loan = Math.max(0, price + nk.total - equity);
  const rate = monthlyRate(loan, ratePa, repaymentPa);
  const firstInterest = (loan * ratePa) / 12;
  const firstPrincipal = rate - firstInterest;
  const costs = (rent * costSharePct) / 100; // nicht umlagefähige Kosten und Instandhaltung als Anteil der Kaltmiete (Annahme)
  const cashflow = rent - costs - rate;
  const vacantBurden = rate + costs; // Monatliche Last ohne Mieteinnahme
  const rest10 = balanceAfterMonths(loan, ratePa, repaymentPa, 120);
  const value10 = price * Math.pow(1 + growthPa, 10);
  return {
    nk, loan: r2(loan), equityCoversCosts: equity >= nk.total, rate: r2(rate),
    firstPrincipal: r2(firstPrincipal), firstInterest: r2(firstInterest),
    rentCoversPct: rate > 0 ? Math.round((rent / rate) * 1000) / 10 : null,
    costs: r2(costs), cashflow: r2(cashflow),
    reserveMonths: vacantBurden > 0 ? Math.floor(reserve / vacantBurden) : null, vacantBurden: r2(vacantBurden),
    rest10: r2(rest10), repaid10: r2(loan - rest10), value10: r2(value10), netWorth10: r2(value10 - rest10),
  };
}

// ---------- Tilgungsplan ----------
// Annuitätendarlehen mit optionaler jährlicher Sondertilgung (am Ende jedes Darlehensjahres).
// Nach Ablauf der Zinsbindung wird – vereinfachend – mit demselben Zins weitergerechnet.
export function tilgungsplan({ loan, ratePa, repaymentPa, fixedYears = 10, specialPa = 0, maxYears = 60 }) {
  if (!(loan > 0) || !(ratePa >= 0) || !(repaymentPa > 0)) return null;
  const i = ratePa / 12;
  const a = monthlyRate(loan, ratePa, repaymentPa);
  let bal = loan, month = 0, totalInterest = 0, totalSpecial = 0, restAtFixed = null;
  const years = [];
  for (let y = 1; y <= maxYears && bal > 0.005; y++) {
    let interest = 0, principal = 0, special = 0;
    for (let m = 0; m < 12 && bal > 0.005; m++) {
      const zi = bal * i;
      const ti = Math.min(bal, a - zi);
      interest += zi; principal += ti; bal -= ti; month++;
    }
    if (specialPa > 0 && bal > 0.005) { special = Math.min(bal, specialPa); bal -= special; }
    totalInterest += interest; totalSpecial += special;
    years.push({ year: y, interest: r2(interest), principal: r2(principal), special: r2(special), balance: r2(Math.max(0, bal)) });
    if (y === Math.round(fixedYears)) restAtFixed = r2(Math.max(0, bal));
  }
  return {
    monthly: r2(a),
    years,
    months: bal > 0.005 ? null : month,
    totalInterest: r2(totalInterest),
    totalSpecial: r2(totalSpecial),
    restAtFixed: restAtFixed ?? (years.length < fixedYears ? 0 : null),
  };
}

export function tilgungsplanCSV(plan) {
  const f = (x) => String(x.toFixed(2)).replace('.', ',');
  const head = 'Jahr;Zinsen;Tilgung;Sondertilgung;Restschuld';
  return [head, ...plan.years.map((r) => [r.year, f(r.interest), f(r.principal), f(r.special), f(r.balance)].join(';'))].join('\r\n');
}

// ---------- Budget: Welcher Kaufpreis ist mit meiner Rate darstellbar? ----------
// Rate = (Überschuss + angerechnete Miete − Objektkosten) × (1 − Puffer); Darlehen = Rate × 12 / (Zins + Tilgung);
// Kaufpreis so, dass Darlehen + Eigenkapital = Kaufpreis + Kaufnebenkosten.
export function budget({ netIncome = 0, expenses = 0, rent = 0, rentSharePct = 75, objectCosts = 0, bufferPct = 20, equity = 0, ratePa, repaymentPa, land, notaryPct = 1.5, landRegistryPct = 0.5, brokerPct = 0 }) {
  const g = GREST[land];
  if (!g || !(ratePa + repaymentPa > 0)) return null;
  const surplus = netIncome - expenses + (rent * rentSharePct) / 100 - objectCosts;
  const rate = Math.max(0, surplus * (1 - bufferPct / 100));
  const loan = (rate * 12) / (ratePa + repaymentPa);
  const nkPct = g.pct + notaryPct + landRegistryPct + brokerPct;
  const price = Math.max(0, (loan + equity) / (1 + nkPct / 100));
  const nk = (price * nkPct) / 100;
  const plan = loan > 0 ? tilgungsplan({ loan, ratePa, repaymentPa, fixedYears: 10 }) : null;
  return {
    surplus: r2(surplus), rate: r2(rate), loan: r2(loan), price: r2(price), nebenkosten: r2(nk), nkPct: r2(nkPct),
    equityCoversNk: equity >= nk, equityShare: price > 0 ? r2((equity / (price + nk)) * 100) : 0,
    loanToPrice: price > 0 ? r2((loan / price) * 100) : 0, restAfter10: plan ? plan.restAtFixed : 0, months: plan ? plan.months : 0,
  };
}

// ---------- Bankreife je Objekt ----------
// Welche Angaben und Unterlagen für ein vollständiges Bankgespräch noch fehlen. docs: [{ category }].
const has = (v) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const pos = (v) => Number(v) > 0;
export function readiness(o, docs = []) {
  const cats = new Set(docs.map((d) => d.category));
  const financed = pos(o.loan);
  const weg = pos(o.meaTotal);
  const groups = [
    { key: 'basis', label: 'Grunddaten', items: [
      ['Kaufpreis', pos(o.price)], ['Nettokaltmiete', has(o.rent)], ['Wohnfläche', pos(o.area)], ['Baujahr', pos(o.yearBuilt)] ] },
    { key: 'bewirtschaftung', label: 'Bewirtschaftung', items: [
      ['Nicht umlagefähige Kosten', has(o.nonRecoverable)], ['Instandhaltung', has(o.maintenance)], ['Mietausfall', has(o.vacancyPct)] ] },
    { key: 'finanzierung', label: 'Finanzierung', items: [
      ['Eigenkapital', has(o.equity)],
      ...(financed ? [['Sollzins', pos(o.interestPct)], ['Tilgung', pos(o.repaymentPct)], ['Zinsbindung', pos(o.fixedYears)]] : []) ] },
    { key: 'objekt', label: 'Objektangaben für die Bank', items: [
      ['Grundbuch (Amtsgericht, Blatt)', has(o.grundbuchAmt) && has(o.grundbuchBlatt)], ['Flur und Flurstück', has(o.flur) && has(o.flurstueck)],
      ['Heizung', has(o.heatingType)], ['Energiekennwert', pos(o.energyConsumption) || pos(o.primaryEnergy)] ] },
    { key: 'unterlagen', label: 'Unterlagen', items: [
      ['Objekt (Exposé, Grundrisse)', cats.has('objekt')], ['Mietverträge', cats.has('miete')], ['Grundbuch und Flurkarte', cats.has('grundbuch')],
      ['Energieausweis / Technik', cats.has('technik')], ['Einkommen und Eigenkapital', cats.has('finanzen')],
      ...(weg ? [['WEG-Unterlagen', cats.has('weg')]] : []) ] },
  ].map((g) => ({ ...g, done: g.items.filter((i) => i[1]).length, total: g.items.length, missing: g.items.filter((i) => !i[1]).map((i) => i[0]) }));
  const done = groups.reduce((s, g) => s + g.done, 0), total = groups.reduce((s, g) => s + g.total, 0);
  return { pct: total ? Math.round((done / total) * 100) : 0, done, total, groups, mappeReady: pos(o.price) && has(o.rent) && has(o.name) };
}

// ---------- Nächste Termine über alle Objekte ----------
export function upcoming(objects, { today = new Date(), limit = 8 } = {}) {
  const t = iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())));
  const all = [];
  for (const o of objects) {
    const f = fristen({ purchaseDate: o.purchaseDate, payoutDate: o.payoutDate, fixedYears: Number(o.fixedYears) || 0, lastRentChange: o.lastRentChange });
    for (const e of f) if (e.date >= t) all.push({ ...e, object: o.name || 'Objekt', objectId: o.id });
  }
  all.sort((a, b) => a.date.localeCompare(b.date));
  return { items: all.slice(0, limit), all };
}

// ---------- Deal-Scorecard (Ampel) ----------
// Status: 'na' (ungeprüft, Angaben fehlen), 'ok', 'warn', 'bad'. Pauschalen und Schwellen sind offengelegte
// LeaseRun-Annahmen (Banken setzen eigene Werte an): Lebenshaltung 1.000 € + 350 € je weitere Person,
// Eigenkapital = Kaufnebenkosten + 10 % Kaufpreis + Reserve von 3 Monatsausgaben, Instandhaltung mind. 1,00 €/m² und Monat.
// Haushaltsmodell aus der zentralen Finanz-Konfiguration (finanz-config.mjs) – dieselben Werte wie im Bank-Chancen-Checker.
export const SCORE_ASSUMPTIONS = { livingBase: val('lebenshaltung_erste_person'), livingPerPerson: val('lebenshaltung_weiterer_erwachsener'), rentSharePct: val('mietanrechnung'), equityPricePct: 10, reserveMonths: val('reserve_monate'), maintMinQm: 1.0, surplusOkPct: val('ueberschuss_gruen') };
export function scorecard(i) {
  const A = SCORE_ASSUMPTIONS, num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const net = num(i.netIncome), other = num(i.otherObligations) ?? 0, size = Math.max(1, num(i.householdSize) ?? 1);
  const price = num(i.price), rent = num(i.rent), area = num(i.area), equity = num(i.equity);
  const nk = price > 0 && GREST[i.land] ? kaufnebenkosten({ price, land: i.land, brokerPct: num(i.brokerPct) ?? 0 }) : null;
  const living = A.livingBase + A.livingPerPerson * (size - 1);
  const loan = nk && equity != null ? Math.max(0, nk.allIn - equity) : null;
  const rate = loan != null ? monthlyRate(loan, (num(i.ratePct) ?? 0) / 100, (num(i.repaymentPct) ?? 0) / 100) : null;
  const maint = area > 0 ? (num(i.maintenanceQm) ?? 0) * area : 0;
  const nonRec = num(i.nonRecoverable) ?? 0;

  // Haushalt
  let haushalt = { status: 'na', lines: ['Nettoeinkommen, Kaufpreis und Eigenkapital eintragen.'] };
  if (net > 0 && rate != null) {
    const rentIn = ((rent ?? 0) * A.rentSharePct) / 100;
    const surplus = net - living - other + rentIn - nonRec - maint - rate;
    haushalt = { status: surplus < 0 ? 'bad' : surplus < (net * A.surplusOkPct) / 100 ? 'warn' : 'ok', surplus: r2(surplus), rate: r2(rate), living,
      lines: [`Lebenshaltungspauschale: ${living} € (${size} Person${size > 1 ? 'en' : ''})`, `Rate: ${r2(rate)} €`, `Überschuss nach Rate: ${r2(surplus)} €`] };
  }
  // Eigenkapital
  let ek = { status: 'na', lines: ['Kaufpreis, Bundesland und Eigenkapital eintragen.'] };
  if (nk && equity != null) {
    const reserve = A.reserveMonths * (living + other);
    const target = nk.total + (price * A.equityPricePct) / 100 + reserve;
    ek = { status: equity >= target ? 'ok' : equity >= nk.total ? 'warn' : 'bad', target: r2(target), nebenkosten: nk.total, reserve: r2(reserve),
      lines: [`Kaufnebenkosten: ${nk.total} €`, `Ziel inkl. 10 % Kaufpreis und ${A.reserveMonths} Monatsausgaben Reserve: ${r2(target)} €`, `Vorhanden: ${equity} €`] };
  }
  // Objekt
  let objekt = { status: 'na', lines: ['Kaufpreis, Miete und Wohnfläche eintragen.'] };
  if (price > 0 && rent > 0 && area > 0) {
    const yieldPct = Math.round(((rent * 12) / price) * 10000) / 100;
    const maintQm = num(i.maintenanceQm) ?? 0;
    const vq = num(i.vergleichsmieteQm);
    const cap = i.mietpreisbremse && vq > 0 ? r2(vq * 1.1 * area) : null;
    const issues = [];
    if (cap != null && rent > cap) issues.push('bad');
    if (maintQm < A.maintMinQm) issues.push('warn');
    objekt = { status: issues.includes('bad') ? 'bad' : issues.includes('warn') ? 'warn' : 'ok', yieldPct, factor: Math.round((price / (rent * 12)) * 10) / 10, cap,
      lines: [`Bruttomietrendite: ${yieldPct} % (Kaufpreisfaktor ${Math.round((price / (rent * 12)) * 10) / 10})`,
        `Instandhaltung: ${maintQm} €/m² und Monat${maintQm < A.maintMinQm ? ' – unter 1,00 €/m²' : ''}`,
        cap != null ? `Mietpreisbremse: höchstens ${cap} € (Vergleichsmiete + 10 %)${rent > cap ? ' – Miete liegt darüber' : ''}` : 'Mietpreisbremse: nicht angegeben'] };
  }
  const order = { bad: 3, warn: 2, na: 1, ok: 0 };
  const overall = [haushalt, ek, objekt].reduce((w, x) => (order[x.status] > order[w] ? x.status : w), 'ok');
  return { haushalt, eigenkapital: ek, objekt, overall, loan: loan != null ? r2(loan) : null };
}

// ---------- Bank-Chancen-Checker (Ratgeber, /calculators/approval-odds) ----------
// Modellhafte Orientierung, keine Kreditentscheidung. Gleiches Haushaltsmodell wie die Deal-Scorecard (SCORE_ASSUMPTIONS),
// erweitert um Erwachsene/Kinder, bestehende Raten, Mieteinnahmen und laufende Objektkosten. Alle Werte je Monat.
const n0 = (v) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0; };
export function lebenshaltungModell(adults = 1, children = 0) {
  const a = Math.max(1, Math.round(n0(adults)) || 1), k = Math.round(n0(children));
  return val('lebenshaltung_erste_person') + val('lebenshaltung_weiterer_erwachsener') * (a - 1) + val('lebenshaltung_kind') * k;
}
export function bankChance(i = {}) {
  const net = n0(i.netIncome), loan = n0(i.loan);
  const ratePa = (i.ratePct == null || i.ratePct === '' ? val('zins_modell') : n0(i.ratePct)) / 100;
  const repPa = (i.repaymentPct == null || i.repaymentPct === '' ? val('tilgung_modell') : n0(i.repaymentPct)) / 100;
  const living = i.livingOverride != null && i.livingOverride !== '' && Number(i.livingOverride) >= 0 ? Number(i.livingOverride) : lebenshaltungModell(i.adults, i.children);
  const commitments = n0(i.commitments), propertyCosts = n0(i.propertyCosts);
  const rentIn = (n0(i.rentIncome) * val('mietanrechnung')) / 100;
  const rate = monthlyRate(loan, ratePa, repPa);
  const fixed = commitments + living + propertyCosts - rentIn; // Belastung ohne Rate
  const surplus = net - fixed - rate;
  const okPct = val('ueberschuss_gruen');
  const threshold = (net * okPct) / 100;
  const status = !(net > 0) || !(loan > 0) ? 'na' : surplus < 0 ? 'red' : surplus < threshold ? 'yellow' : 'green';
  // Umkehrrechnungen: welches Darlehen bzw. welches Nettoeinkommen im Modell „tragfähig“ wäre.
  const annuity = ratePa + repPa;
  const maxRate = Math.max(0, net * (1 - okPct / 100) - fixed);
  const maxLoan = annuity > 0 ? (maxRate * 12) / annuity : 0;
  const netNeeded = (fixed + rate) / (1 - okPct / 100);
  const flags = [];
  if (net > 0 && rate / net > val('rate_quote_hinweis') / 100) flags.push({ key: 'quote', text: `Die Rate liegt bei ${Math.round((rate / net) * 100)} % des Haushaltsnettos – über der verbreiteten Faustregel von etwa ${val('rate_quote_hinweis')} %.` });
  if (!(propertyCosts > 0)) flags.push({ key: 'objektkosten', text: 'Laufende Objektkosten (Hausgeld, Nebenkosten, Rücklage) sind mit 0 € angesetzt. Tragen Sie einen realistischen Betrag ein.' });
  if (repPa < 0.01 && loan > 0) flags.push({ key: 'tilgung', text: 'Eine anfängliche Tilgung unter 1 % führt zu sehr langen Laufzeiten und hoher Restschuld.' });
  const emp = String(i.employment || '');
  if (emp === 'probezeit') flags.push({ key: 'probezeit', text: 'Probezeit: Viele Institute prüfen hier genauer oder warten das Ende der Probezeit ab.' });
  if (emp === 'befristet') flags.push({ key: 'befristet', text: 'Befristeter Vertrag: Entscheidend ist meist, wie sicher das Einkommen über die Befristung hinaus ist.' });
  if (emp === 'selbststaendig') flags.push({ key: 'selbststaendig', text: 'Selbstständig: Üblich ist der Nachweis über mehrere Jahresabschlüsse bzw. Steuerbescheide; maßgeblich ist das nachhaltige Einkommen.' });
  let objekt = null;
  const price = n0(i.price);
  if (price > 0 && GREST[i.land]) {
    const nk = kaufnebenkosten({ price, land: i.land, brokerPct: i.brokerPct == null || i.brokerPct === '' ? 0 : n0(i.brokerPct) });
    const equity = n0(i.equity);
    const ltv = (loan / price) * 100;
    objekt = { nebenkosten: nk.total, nkPct: nk.totalPct, land: nk.land, equity, loanToPrice: r2(ltv), equityCoversNk: equity >= nk.total, gap: r2(Math.max(0, nk.allIn - equity - loan)) };
    if (equity < nk.total) flags.push({ key: 'ek', text: `Das Eigenkapital deckt die Kaufnebenkosten (${Math.round(nk.total).toLocaleString('de-DE')} €) nicht vollständig – das entspricht einer Finanzierung über 100 % des Kaufpreises.` });
    if (ltv > 100) flags.push({ key: 'ltv', text: `Das Darlehen liegt bei ${String(r2(ltv)).replace('.', ',')} % des Kaufpreises.` });
  }
  return {
    status, rate: r2(rate), living: r2(living), rentIn: r2(rentIn), commitments: r2(commitments), propertyCosts: r2(propertyCosts),
    surplus: r2(surplus), threshold: r2(threshold), quotePct: net > 0 ? r2((rate / net) * 100) : 0,
    maxLoan: Math.max(0, Math.round(maxLoan / 1000) * 1000), netNeeded: Math.ceil(netNeeded / 10) * 10,
    restAfter10: loan > 0 ? r2(balanceAfterMonths(loan, ratePa, repPa, 120)) : 0, ratePct: r2(ratePa * 100), repaymentPct: r2(repPa * 100),
    flags, objekt,
  };
}
// Benötigtes Haushaltsnetto für ein Darlehen (Modell, Status „tragfähig“), z. B. für Tabellen in Ratgeber-Seiten.
export function nettoFuerDarlehen({ loan, ratePct, repaymentPct, adults = 1, children = 0, commitments = 0, propertyCosts = 0 }) {
  return bankChance({ netIncome: 1, loan, ratePct, repaymentPct, adults, children, commitments, propertyCosts }).netNeeded;
}

// ---------- Zero-to-Pro: Stufe aus echtem Fortschritt ----------
export const RANKS = ['Orientierender Mieter', 'Banken-Ready Analyst', 'Souveräner Verhandler', 'Bestandshalter'];
export function rank(profile = {}, objects = [], docs = [], today = new Date()) {
  const t = today.toISOString().slice(0, 10);
  const prof = Number(profile.netIncome) > 0 && profile.equity !== undefined && profile.equity !== '';
  const reads = objects.map((o) => readiness(o, docs.filter((d) => d.object_ref === o.id)));
  const best = reads.reduce((m, r) => Math.max(m, r.pct), 0);
  const owned = objects.some((o) => typeof o.purchaseDate === 'string' && o.purchaseDate && o.purchaseDate <= t && Number(o.fixedYears) > 0);
  const steps = [
    { done: true, label: 'Konto angelegt' },
    { done: prof && objects.length > 0 && best >= 60, label: 'Finanzprofil ausgefüllt, ein Objekt erfasst und mindestens 60 % Bankreife', next: !prof ? 'Finanzprofil ausfüllen (Nettoeinkommen, Eigenkapital).' : !objects.length ? 'Ein Objekt anlegen.' : 'Angaben und Unterlagen ergänzen, bis die Bankreife mindestens 60 % erreicht.' },
    { done: best >= 90, label: 'Ein Objekt mit mindestens 90 % Bankreife – bereit für das Bankgespräch', next: 'Fehlende Unterlagen hochladen (siehe „Bankreife je Objekt“).' },
    { done: owned, label: 'Gekauftes Objekt mit Kaufdatum und Zinsbindung – Fristen werden überwacht', next: 'Nach dem Kauf Kaufdatum, Auszahlung und Zinsbindung eintragen.' },
  ];
  let level = 0;
  for (let i = 1; i < steps.length; i++) { if (steps[i].done) level = i; else break; }
  if (owned) level = 3; // Bestandshalter auch ohne vorherige Stufen (z. B. Bestand eingetragen)
  const nextStep = steps.slice(1).find((s) => !s.done);
  return { level: level + 1, name: RANKS[level], steps, next: nextStep ? nextStep.next : null, bestReadiness: best };
}

// ---------- Cashflow vor und nach Steuern (Vermietung) ----------
// Modell: Anschaffungsnebenkosten werden anteilig Gebäude/Boden zugeordnet; AfA auf den Gebäudeanteil.
// Nicht umlagefähige Kosten und Instandhaltung werden als Werbungskosten angesetzt (Modellannahme).
// Steuerwirkung = steuerliches Ergebnis × Grenzsteuersatz (negativ = Erstattung). Ohne Soli/Kirchensteuer.
export function cashflowSteuer({ price, land, brokerPct = 0, equity = 0, ratePa, repaymentPa, rent, vacancyPct = 0, nonRecoverable = 0, maintenance = 0,
  buildingSharePct = 75, afaPct = 2, taxPct = 42, rentGrowthPct = 0, years = 10 }) {
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk || !(rent >= 0)) return null;
  const loan = Math.max(0, nk.allIn - equity);
  const plan = loan > 0 ? tilgungsplan({ loan, ratePa, repaymentPa, fixedYears: years, maxYears: Math.max(years, 1) }) : null;
  const afa = (nk.allIn * buildingSharePct / 100) * afaPct / 100;
  const rows = [];
  for (let y = 1; y <= years; y++) {
    const p = plan?.years[y - 1] ?? { interest: 0, principal: 0, balance: 0 };
    const rentY = rent * 12 * Math.pow(1 + rentGrowthPct / 100, y - 1) * (1 - vacancyPct / 100);
    const costs = (nonRecoverable + maintenance) * 12;
    const before = rentY - costs - p.interest - p.principal;
    const taxable = rentY - costs - p.interest - afa;
    const tax = taxable * taxPct / 100;
    rows.push({ year: y, rent: r2(rentY), costs: r2(costs), interest: r2(p.interest), principal: r2(p.principal), afa: r2(afa), taxable: r2(taxable), tax: r2(tax), before: r2(before), after: r2(before - tax), balance: r2(p.balance) });
  }
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  return { loan: r2(loan), nebenkosten: nk.total, afa: r2(afa), monthlyRate: plan ? plan.monthly : 0, rows, total: { before: sum('before'), after: sum('after'), principal: sum('principal'), tax: sum('tax') } };
}

// ---------- Angebotsvergleich ----------
export function angebot({ price, rent, area = 0, land, brokerPct = 0, equity = 0, ratePa, repaymentPa, nonRecoverable = 0, maintenance = 0, vacancyPct = 0 }) {
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk) return null;
  const loan = Math.max(0, nk.allIn - equity);
  const rate = monthlyRate(loan, ratePa, repaymentPa);
  const noi = netOperatingMonthly({ rent, vacancyPct, nonRecoverable, maintenance });
  return {
    nebenkosten: nk.total, allIn: nk.allIn, loan: r2(loan), rate: r2(rate), noi: r2(noi), cashflow: r2(noi - rate),
    grossYieldPct: rent > 0 ? Math.round(((rent * 12) / price) * 10000) / 100 : null,
    netYieldPct: Math.round(((noi * 12) / nk.allIn) * 10000) / 100,
    factor: rent > 0 ? Math.round((price / (rent * 12)) * 10) / 10 : null,
    pricePerQm: area > 0 ? r2(price / area) : null, rentPerQm: area > 0 && rent > 0 ? r2(rent / area) : null,
    dscr: rate > 0 ? Math.round((noi / rate) * 100) / 100 : null,
  };
}

// ---------- Kaufen oder Mieten ----------
// Monatliche Simulation. Wer monatlich weniger zahlt, legt die Differenz zum Anlagezins an; der Mieter legt
// zusätzlich das Eigenkapital (inkl. Nebenkosten) an. Ohne Steuern auf Erträge und Verkaufskosten (Modell).
export function kaufenMieten({ price, land, brokerPct = 0, equity, ratePa, repaymentPa, ownerCosts = 0, rent, rentGrowthPct = 2, valueGrowthPct = 1.5, investPct = 4, years = 20 }) {
  const nk = kaufnebenkosten({ price, land, brokerPct });
  if (!nk || !(rent > 0)) return null;
  const loan = Math.max(0, nk.allIn - equity);
  const rate = monthlyRate(loan, ratePa, repaymentPa);
  const i = ratePa / 12, inv = Math.pow(1 + investPct / 100, 1 / 12) - 1;
  let bal = loan, buyerDepot = Math.max(0, equity - nk.allIn), renterDepot = equity, rentM = rent;
  const rows = [];
  let breakEven = null;
  for (let m = 1; m <= years * 12; m++) {
    let pay = 0;
    if (bal > 0.005) { const zi = bal * i; const t = Math.min(bal, rate - zi); bal -= t; pay = zi + t; }
    const buyerOut = pay + ownerCosts;
    buyerDepot *= 1 + inv; renterDepot *= 1 + inv;
    if (buyerOut > rentM) renterDepot += buyerOut - rentM; else buyerDepot += rentM - buyerOut;
    if (m % 12 === 0) {
      const y = m / 12;
      const value = price * Math.pow(1 + valueGrowthPct / 100, y);
      const buyer = value - bal + buyerDepot;
      rows.push({ year: y, value: r2(value), debt: r2(Math.max(0, bal)), buyer: r2(buyer), renter: r2(renterDepot), rent: r2(rentM) });
      if (breakEven === null && buyer >= renterDepot) breakEven = y;
      rentM *= 1 + rentGrowthPct / 100;
    }
  }
  return { loan: r2(loan), rate: r2(rate), nebenkosten: nk.total, rows, breakEven, end: rows[rows.length - 1] };
}

// ---------- AfA-Plan: linear, degressiv, Sonder-AfA § 7b ----------
// Linear § 7 Abs. 4 EStG (2 / 2,5 / 3 %), degressiv § 7 Abs. 5a EStG (5 % vom Restwert; Baubeginn bzw. Kaufvertrag
// 01.10.2023–30.09.2029), Sonder-AfA § 7b EStG (4 Jahre je 5 %; Bemessung höchstens 4.000 €/m², Baukosten
// höchstens 5.200 €/m², Effizienzhaus 40 mit QNG, Bauantrag 01.01.2023–30.09.2029, 10 Jahre Vermietung).
// Vereinfachung: volle Jahresbeträge ab Jahr 1 (tatsächlich zeitanteilig im ersten Jahr).
export function afaPlan({ ak, method = 'linear', linearPct = 2, years = 10, sonder = false, area = 0, baukostenQm = 0 }) {
  if (!(ak > 0)) return null;
  const s7b = sonder && area > 0 ? { eligible: baukostenQm > 0 && baukostenQm <= 5200, base: Math.min(ak, 4000 * area) } : null;
  let rest = ak;
  const rows = [];
  for (let y = 1; y <= years && rest > 0.005; y++) {
    const regular = Math.min(rest, method === 'degressiv' ? rest * 0.05 : (ak * linearPct) / 100);
    const extra = s7b?.eligible && y <= 4 ? Math.min(rest - regular, s7b.base * 0.05) : 0;
    rest -= regular + extra;
    rows.push({ year: y, regular: r2(regular), extra: r2(extra), total: r2(regular + extra), rest: r2(rest) });
  }
  const sum = (k) => r2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, total: sum('total'), regular: sum('regular'), extra: sum('extra'), s7b, rest: r2(rest) };
}

// ---------- Mieterhöhung bis zur ortsüblichen Vergleichsmiete (§§ 558, 558b BGB) ----------
// Höchstmiete = min(Vergleichsmiete × Fläche, Miete vor drei Jahren × (1 + Kappungsgrenze)).
// Verlangen frühestens 12 Monate nach der letzten Erhöhung; wirksam ab Beginn des dritten Kalendermonats nach
// Zugang, frühestens 15 Monate nach der letzten Erhöhung.
export function mieterhoehung({ rent, area, vergleichQm, rent3y, capPct = 20, lastChange, sendDate }) {
  if (!(rent > 0) || !(area > 0) || !(vergleichQm > 0)) return null;
  const byMarket = vergleichQm * area;
  const base = rent3y > 0 ? rent3y : rent;
  const byCap = base * (1 + capPct / 100);
  const max = Math.min(byMarket, byCap);
  const out = { byMarket: r2(byMarket), byCap: r2(byCap), max: r2(Math.max(rent, max)), increase: r2(Math.max(0, max - rent)),
    limitedBy: byCap < byMarket ? 'kappung' : 'vergleich', earliestRequest: null, effective: null };
  if (lastChange) {
    const lc = parseDate(lastChange);
    out.earliestRequest = iso(addMonths(lc, 12));
    const send = sendDate ? parseDate(sendDate) : addMonths(lc, 12);
    const sendOk = send < addMonths(lc, 12) ? addMonths(lc, 12) : send;
    const third = new Date(Date.UTC(sendOk.getUTCFullYear(), sendOk.getUTCMonth() + 3, 1));
    const min15 = addMonths(lc, 15);
    out.effective = iso(third > min15 ? third : min15);
    out.sendUsed = iso(sendOk);
  }
  return out;
}

// ---------- Objekt-Analyse: alle Kennzahlen aus Kernfakten ----------
// Eingaben sind Nutzerangaben; nichts wird von Portalen geladen. Mietspiegelwert (€/m²) trägt der Nutzer ein.
export function analyse(i) {
  const n = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
  const price = n(i.price), area = n(i.area), land = i.land;
  const nk = price > 0 && GREST[land] ? kaufnebenkosten({ price, land, brokerPct: n(i.brokerPct) }) : null;
  if (!nk) return null;
  const rentIst = n(i.rent), vq = n(i.vergleichQm), vac = n(i.vacancyPct) / 100;
  const rentMarket = vq > 0 && area > 0 ? vq * area : 0;
  const rent = rentIst > 0 ? rentIst : rentMarket;
  const nonRec = n(i.nonRecoverable), maint = area > 0 ? n(i.maintenanceQm) * area : 0;
  const equity = n(i.equity), loan = Math.max(0, nk.allIn - equity);
  const ratePa = n(i.ratePct) / 100, tilg = n(i.repaymentPct) / 100;
  const rate = monthlyRate(loan, ratePa, tilg);
  const interestM = (loan * ratePa) / 12, principalM = rate - interestM;
  const noi = rent * (1 - vac) - nonRec - maint;
  const cf = noi - rate;
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 10000) / 100 : null);
  const dec = (a, b, d = 2) => (b > 0 ? Math.round((a / b) * 10 ** d) / 10 ** d : null);
  const needRent = (target) => (1 - vac > 0 ? r2((target + nonRec + maint) / (1 - vac)) : null);
  const plan = loan > 0 && ratePa + tilg > 0 ? tilgungsplan({ loan, ratePa, repaymentPa: tilg, fixedYears: n(i.fixedYears) || 10 }) : null;
  // Steuer (Jahr 1)
  const afa = (nk.allIn * (n(i.buildingSharePct) || 0)) / 100 * ((n(i.afaPct) || 0) / 100);
  const taxable = rent * 12 * (1 - vac) - (nonRec + maint) * 12 - interestM * 12 - afa;
  const tax = (taxable * n(i.taxPct)) / 100;
  // Ertragswert (vereinfacht, ImmoWertV): nur mit Bodenwert, Liegenschaftszins und Restnutzungsdauer
  const landValue = n(i.landValue), lz = n(i.capRatePct) / 100, rnd = n(i.remainingLife);
  let ertragswert = null;
  if (landValue > 0 && lz > 0 && rnd > 0 && rent > 0) {
    const re = rent * 12 - (nonRec + maint) * 12;
    const q = 1 + lz, qn = Math.pow(q, rnd), bf = (qn - 1) / (qn * (q - 1));
    ertragswert = r2(landValue + Math.max(0, re - landValue * lz) * bf);
  }
  const yr = n(i.yearBuilt), ec = String(i.energyClass || '').toUpperCase();
  const hints = [];
  if (yr > 0 && yr < 1978) hints.push('Baujahr vor der ersten Wärmeschutzverordnung (1977): energetischen Zustand und Sanierungsstand prüfen.');
  if (['F', 'G', 'H'].includes(ec)) hints.push(`Effizienzklasse ${ec}: höhere Energiekosten und mögliche Modernisierungspflichten nach GEG einplanen.`);
  if (n(i.maintenanceQm) < 1) hints.push('Instandhaltung unter 1,00 €/m² und Monat angesetzt – eher knapp.');
  if (rentIst > 0 && rentMarket > 0 && i.mietpreisbremse && rentIst > rentMarket * 1.1) hints.push('Ist-Miete liegt über Vergleichsmiete + 10 %: Mietpreisbremse (§ 556d BGB) und Ausnahmen prüfen.');
  if (rentIst > 0 && rentMarket > 0 && rentIst < rentMarket * 0.9) hints.push('Ist-Miete liegt deutlich unter dem Mietspiegel: Erhöhungspotenzial nach § 558 BGB (Kappungsgrenze beachten).');
  if (!(equity >= nk.total)) hints.push('Eigenkapital deckt die Kaufnebenkosten nicht – Banken finanzieren diese selten mit.');
  if (rate > 0 && noi / rate < 1) hints.push('Die Miete trägt die Rate nicht (DSCR unter 1,0): monatliche Zuzahlung nötig.');
  return {
    price, area, nebenkosten: nk.total, nkPct: nk.totalPct, allIn: nk.allIn, pricePerQm: area > 0 ? r2(price / area) : null, allInPerQm: area > 0 ? r2(nk.allIn / area) : null,
    rent: r2(rent), rentSource: rentIst > 0 ? 'ist' : rentMarket > 0 ? 'mietspiegel' : 'keine', rentPerQm: area > 0 && rent > 0 ? r2(rent / area) : null,
    rentMarket: rentMarket ? r2(rentMarket) : null, rentCap: rentMarket && i.mietpreisbremse ? r2(rentMarket * 1.1) : null,
    rentGapPct: rentIst > 0 && rentMarket > 0 ? Math.round(((rentMarket - rentIst) / rentIst) * 1000) / 10 : null,
    factor: rent > 0 ? Math.round((price / (rent * 12)) * 10) / 10 : null, grossYield: pct(rent * 12, price), netYield: pct(noi * 12, nk.allIn),
    loan: r2(loan), ltv: pct(loan, price), rate: r2(rate), interestM: r2(interestM), principalM: r2(principalM), noi: r2(noi), cashflow: r2(cf),
    dscr: dec(noi, rate), icr: dec(noi, interestM), debtYield: pct(noi * 12, loan), cashOnCash: pct(cf * 12, equity), equityReturn: pct((cf + principalM) * 12, equity),
    kippZins: loan > 0 ? Math.round(((noi * 12) / loan - tilg) * 10000) / 100 : null,
    rateStress: loan > 0 ? r2(monthlyRate(loan, ratePa + 0.02, tilg)) : null,
    rentBreakEven: needRent(rate), rentDscr12: needRent(rate * 1.2), rentYield5: r2((nk.allIn * 0.05) / 12 / Math.max(0.0001, 1 - vac) + (nonRec + maint) / Math.max(0.0001, 1 - vac)),
    restAfterFixed: plan ? plan.restAtFixed : null, payoffYears: plan?.months ? Math.round((plan.months / 12) * 10) / 10 : null,
    afa: r2(afa), taxable: r2(taxable), tax: r2(tax), cashflowAfterTax: r2(cf - tax / 12),
    ertragswert, ertragswertGapPct: ertragswert ? Math.round(((price - ertragswert) / ertragswert) * 1000) / 10 : null,
    hints,
  };
}



// ---------- Exposé-Kennzahlen (Metrics Engine) ----------
// Aus den Eckdaten eines Exposés (PDF-Import, Ein-Klick-Übernahme oder Eingabe) das typisierte Ergebnis
// ExposeMetricsResult (siehe lib/domain/expose-metrics.ts). Rechnet mit dem gleichen Kern wie die Objekt-Analyse.
// Sanierungspuffer je m² sind LeaseRun-Annahmen (Größenordnung für Hülle/Heizung), kein Gutachten.
export const SANIERUNG_QM = { E: 100, F: 200, G: 300, H: 400 };
export function exposeMetrics(p, f = {}) {
  const n = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? 0 : Number(v));
  const price = n(p.purchasePrice), area = n(p.livingAreaSqm), rent = n(p.monthlyColdRent);
  const land = GREST[p.address?.state] ? p.address.state : null;
  if (!(price > 0) || !land) return null;
  const nonAlloc = n(p.nonAllocatableCosts), reserve = n(p.monthlyMaintenanceReserve);
  const a = analyse({ price, area, land, brokerPct: f.brokerPct ?? 3.57, rent, vacancyPct: f.vacancyPct ?? 0,
    nonRecoverable: nonAlloc + reserve, maintenanceQm: 0, equity: n(f.equity), ratePct: f.ratePct ?? 3.5, repaymentPct: f.repaymentPct ?? 2, fixedYears: f.fixedYears ?? 10,
    yearBuilt: n(p.constructionYear), energyClass: p.energyClass || '' });
  const nk = kaufnebenkosten({ price, land, brokerPct: f.brokerPct ?? 3.57 });
  const part = (k) => nk.parts.filter((x) => x.key === k).reduce((s, x) => s + x.amount, 0);
  const ec = String(p.energyClass || '').toUpperCase(), yr = n(p.constructionYear);
  let riskLevel = ec in SANIERUNG_QM ? (['G', 'H'].includes(ec) ? 'HIGH' : 'MEDIUM') : 'LOW';
  if (riskLevel === 'LOW' && yr > 0 && yr < 1978 && !ec) riskLevel = 'MEDIUM';
  const buffer = ec in SANIERUNG_QM && area > 0 ? r2(SANIERUNG_QM[ec] * area) : 0;
  const ann = price > 0 ? r2(a.rate) : 0;
  return {
    property: { ...p },
    metrics: {
      pricePerSqm: area > 0 ? r2(price / area) : 0,
      rentPerSqm: area > 0 && rent > 0 ? r2(rent / area) : 0,
      purchaseMultiplier: rent > 0 ? Math.round((price / (rent * 12)) * 10) / 10 : 0,
      grossRentalYieldPercent: rent > 0 ? Math.round(((rent * 12) / price) * 10000) / 100 : 0,
      netRentalYieldPercent: a.netYield ?? 0,
      incidentalCosts: {
        propertyTransferTax: r2(part('grest')), notaryAndRegistry: r2(part('notar') + part('grundbuch')), brokerCommission: r2(part('makler')),
        totalIncidentalCosts: nk.total, totalInvestment: nk.allIn,
      },
      financingQuickCheck: {
        calculatedMonthlyRate: ann,
        monthlyPreTaxCashflow: r2(rent - ann - nonAlloc - reserve),
        dscrValue: a.dscr ?? 0,
        ltvPercent: a.ltv ?? 0,
        stressTestRateDelta: a.rateStress != null ? r2(a.rateStress - ann) : 0,
      },
      sanitationRisk: { riskLevel, recommendedSanitationBuffer: buffer },
    },
  };
}

// ---------- Startseiten-Demo: Beispielimmobilie mit Prüfpunkten und Orientierungswert ----------
// Nutzt scorecard() für Haushalt, Eigenkapital und (bei Vermietung) Objekt und prüft zusätzlich den Zins-Puffer
// (+2 Prozentpunkte). Orientierungswert = Mittel der gerechneten Ampeln (grün 100, gelb 60, rot 20), gedeckelt durch
// die schlechteste Ampel. Kein Bank-Score; nur zur Veranschaulichung auf öffentlichen Seiten.
export const DEMO_DEFAULTS = { price: 389000, area: 82, rent: 0, use: 'owner', equity: 80000, ratePct: 3.6, repaymentPct: 2, netIncome: 5200, householdSize: 2, land: 'niedersachsen', brokerPct: 3.57, maintenanceQm: 1 };
export function demoAnalyse(input = {}) {
  const i = { ...DEMO_DEFAULTS, ...input };
  if (i.use !== 'investor') i.rent = 0;
  const sc = scorecard(i);
  const st = scorecard({ ...i, ratePct: i.ratePct + 2 });
  const nk = kaufnebenkosten({ price: i.price, land: i.land, brokerPct: i.brokerPct });
  const loan = sc.loan ?? 0;
  const rate = r2(monthlyRate(loan, i.ratePct / 100, i.repaymentPct / 100));
  const rest10 = r2(balanceAfterMonths(loan, i.ratePct / 100, i.repaymentPct / 100, 120));
  const pts = { ok: 100, warn: 60, bad: 20 };
  const stress = st.haushalt.status === 'bad' ? 'bad' : st.haushalt.status === 'warn' ? 'warn' : st.haushalt.status === 'ok' ? 'ok' : 'na';
  const lamps = [
    { key: 'haushalt', status: sc.haushalt.status, surplus: sc.haushalt.surplus ?? null },
    { key: 'eigenkapital', status: sc.eigenkapital.status, target: sc.eigenkapital.target ?? null },
    ...(i.rent > 0 ? [{ key: 'objekt', status: sc.objekt.status, yieldPct: sc.objekt.yieldPct ?? null }] : []),
    { key: 'zinspuffer', status: stress, surplus: st.haushalt.surplus ?? null },
  ].filter((l) => l.status !== 'na');
  const worst = lamps.some((l) => l.status === 'bad') ? 'bad' : lamps.some((l) => l.status === 'warn') ? 'warn' : 'ok';
  const cap = { bad: 59, warn: 84, ok: 100 }[worst];
  const score = lamps.length ? Math.min(cap, Math.round(lamps.reduce((s, l) => s + pts[l.status], 0) / lamps.length)) : null;
  const label = score == null ? 'Daten unvollständig' : score >= 85 ? 'Wenige Auffälligkeiten' : score >= 65 ? 'Einzelne Punkte prüfen' : score >= 45 ? 'Mehrere Punkte kritisch prüfen' : 'Deutliche Risiken – genau prüfen';
  const openPoints = lamps.filter((l) => l.status !== 'ok').length;
  return { input: i, nk, loan, rate, rest10, equityQuotePct: nk ? Math.round((i.equity / nk.allIn) * 1000) / 10 : null,
    burdenPct: i.netIncome > 0 ? Math.round((rate / i.netIncome) * 1000) / 10 : null, lamps, score, label, openPoints };
}
