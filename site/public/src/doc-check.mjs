// Fall-Analyse: Unterlagen einer Baufinanzierung erkennen und Kernwerte auslesen.
// Reine Textauswertung (deutsche Formulare) – läuft im Browser, die Dateien verlassen das Gerät nicht.
// Ergebnisse sind Lesehilfen; der Berater prüft die Originale.
import { deNum } from './listing-parse.mjs?v=892f3666';

const NUM = String.raw`(-?\d{1,3}(?:[.\s]\d{3})+(?:,\d{1,2})?|-?\d+(?:,\d{1,2})?)`;
const norm = (t) => String(t || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
const has = (t, re) => re.test(t);
const count = (t, res) => res.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);

// Betrag nach einem Label (gleiche oder nächste Zeile). Gibt die erste plausible Zahl zurück.
function amount(t, labels, { min = 0, max = 1e9 } = {}) {
  for (const l of labels) {
    const re = new RegExp(l.source + String.raw`[^\n\d-]{0,40}` + NUM + String.raw`(?:\s*(?:€|EUR))?`, 'i');
    const m = re.exec(t);
    if (m) { const v = deNum(m[1]); if (v != null && v >= min && v <= max) return v; }
    const re2 = new RegExp(l.source + String.raw`[^\n]*\n[^\n\d-]{0,20}` + NUM, 'i');
    const m2 = re2.exec(t);
    if (m2) { const v = deNum(m2[1]); if (v != null && v >= min && v <= max) return v; }
  }
  return null;
}
const MONATE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
// Spätestes plausibles Datum im Text (TT.MM.JJJJ oder „Monat JJJJ“).
function latestDate(t) {
  const ds = [];
  for (const m of t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2}|19\d{2})\b/g)) ds.push(new Date(+m[3], +m[2] - 1, +m[1]));
  for (const m of t.matchAll(new RegExp(String.raw`\b(${MONATE.join('|')})\s+(20\d{2})\b`, 'gi'))) ds.push(new Date(+m[2], MONATE.indexOf(m[1].toLowerCase()), 15));
  const now = Date.now() + 864e5 * 400;
  const ok = ds.filter((d) => !isNaN(d) && d.getTime() < now);
  return ok.length ? new Date(Math.max(...ok.map((d) => d.getTime()))) : null;
}
const months = (d) => (d ? (Date.now() - d.getTime()) / (30.44 * 864e5) : null);
const dstr = (d) => (d ? d.toLocaleDateString('de-DE') : null);

// ---------- Dokumentarten ----------
// score: Anzahl Treffer typischer Begriffe; extract: Kernwerte; check: Hinweise (ok / warn / bad).
export const TYPES = [
  { id: 'gehalt', label: 'Gehaltsabrechnung', group: 'Einkommen',
    sig: [/gehaltsabrechnung|entgeltabrechnung|verdienstabrechnung|abrechnung der brutto/i, /gesamt-?brutto|bruttobezüge|steuer-?brutto/i, /auszahlung(sbetrag)?|netto-?bezüge|nettoverdienst/i, /lohnsteuer/i, /steuerklasse|stkl/i, /sozialversicherung|krankenversicherung|rentenversicherung/i],
    extract(t) {
      const brutto = amount(t, [/gesamt-?brutto/, /brutto-?bezüge/, /steuer-?brutto/, /brutto/], { min: 300, max: 60000 });
      const netto = amount(t, [/auszahlungsbetrag/, /auszahlung/, /überweisung/, /netto-?verdienst/, /netto-?bezüge/, /netto/], { min: 200, max: 40000 });
      const d = latestDate(t);
      return { brutto, netto, monat: d ? d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }) : null, _date: d };
    },
    check(v) {
      const out = [];
      if (v.netto == null) out.push(['warn', 'Auszahlungsbetrag nicht eindeutig erkannt – bitte im Original prüfen.']);
      const m = months(v._date);
      if (m != null && m > 3) out.push(['warn', `Abrechnung ist älter als 3 Monate (${v.monat}). Banken verlangen meist die letzten drei.`]);
      if (v.brutto && v.netto && v.netto > v.brutto) out.push(['bad', 'Netto größer als Brutto – Auslesefehler oder ungewöhnliche Abrechnung.']);
      if (/dezember/i.test(v.monat || '')) out.push(['ok', 'Dezember-Abrechnung: enthält die Jahreswerte (Einmalzahlungen).']);
      return out;
    } },
  { id: 'steuerbescheid', label: 'Einkommensteuerbescheid', group: 'Einkommen',
    sig: [/bescheid\s+für\s+(20\d{2})|einkommensteuerbescheid/i, /einkommensteuer/i, /festgesetzt|festsetzung/i, /zu versteuerndes einkommen/i, /finanzamt/i],
    extract(t) {
      const jahr = Number((/bescheid\s+für\s+(20\d{2})/i.exec(t) || /veranlagungs?zeitraum\s*:?\s*(20\d{2})/i.exec(t) || [])[1]) || null;
      return { jahr, zvE: amount(t, [/zu versteuerndes einkommen/], { min: 0, max: 5e7 }), einkuenfte: amount(t, [/summe der einkünfte/, /gesamtbetrag der einkünfte/], { min: 0, max: 5e7 }) };
    },
    check(v) {
      const out = [];
      if (v.jahr && new Date().getFullYear() - v.jahr > 2) out.push(['warn', `Bescheid für ${v.jahr} – für Selbstständige werden meist die letzten zwei bis drei Jahre benötigt.`]);
      if (!v.zvE) out.push(['warn', 'Zu versteuerndes Einkommen nicht erkannt.']);
      return out;
    } },
  { id: 'bwa', label: 'BWA / Jahresabschluss', group: 'Einkommen',
    sig: [/betriebswirtschaftliche auswertung|\bbwa\b/i, /jahresabschluss|bilanz|gewinn- und verlustrechnung|einnahmen-?überschuss/i, /umsatzerlöse|betriebsergebnis|vorläufiges ergebnis/i],
    extract(t) { return { ergebnis: amount(t, [/vorläufiges ergebnis/, /betriebsergebnis/, /jahresüberschuss/, /gewinn/], { min: -1e8, max: 1e8 }), umsatz: amount(t, [/umsatzerlöse/, /gesamtleistung/], { min: 0, max: 1e9 }), stand: dstr(latestDate(t)) }; },
    check(v) { return v.ergebnis != null && v.ergebnis < 0 ? [['bad', 'Negatives Ergebnis – Kapitaldienstfähigkeit genau prüfen.']] : []; } },
  { id: 'konto', label: 'Kontoauszug / Eigenkapitalnachweis', group: 'Vermögen',
    sig: [/kontoauszug|depotauszug|vermögensübersicht|finanzstatus/i, /kontostand|saldo|guthaben|depotwert|kurswert/i, /\biban\b|kontonummer/i],
    extract(t) { const d = latestDate(t); return { saldo: amount(t, [/neuer kontostand/, /kontostand/, /saldo/, /guthaben/, /depotwert/, /gesamtwert/], { min: -1e7, max: 1e8 }), stand: dstr(d), _date: d }; },
    check(v) {
      const out = [];
      const m = months(v._date);
      if (m != null && m > 1.5) out.push(['warn', `Stand ${v.stand} – für den Eigenkapitalnachweis einen aktuellen Auszug anfordern.`]);
      if (v.saldo == null) out.push(['warn', 'Kontostand nicht erkannt.']);
      return out;
    } },
  { id: 'grundbuch', label: 'Grundbuchauszug', group: 'Objekt',
    sig: [/grundbuch von|amtsgericht.*grundbuch|grundbuchblatt/i, /bestandsverzeichnis/i, /abteilung\s*(i{1,3}|1|2|3)\b|zweite abteilung|dritte abteilung/i, /eigentümer/i, /gemarkung|flur(stück)?/i],
    extract(t) {
      const lasten = [['Wegerecht', /wegerecht|geh- und fahrrecht/i], ['Leitungsrecht', /leitungsrecht/i], ['Nießbrauch', /nießbrauch/i], ['Wohnungsrecht', /wohnungsrecht|wohnrecht/i], ['Vorkaufsrecht', /vorkaufsrecht/i], ['Reallast', /reallast/i], ['Auflassungsvormerkung', /auflassungsvormerkung|eigentumsvormerkung/i], ['Zwangsversteigerungsvermerk', /zwangsversteigerung/i], ['Insolvenzvermerk', /insolvenz/i]].filter(([, re]) => re.test(t)).map(([n]) => n);
      const gs = [...t.matchAll(/grundschuld[^\n]{0,80}?(\d{1,3}(?:\.\d{3})+(?:,\d{2})?)\s*(?:€|eur)/gi)].map((m) => deNum(m[1])).filter(Boolean);
      const d = latestDate(t);
      return { lasten, grundschulden: gs, abruf: dstr(d), _date: d };
    },
    check(v) {
      const out = [];
      const bad = v.lasten.filter((x) => /Zwangsversteigerung|Insolvenz|Nießbrauch|Wohnungsrecht/.test(x));
      if (bad.length) out.push(['bad', `Belastung in Abt. II: ${bad.join(', ')} – kann die Beleihung ausschließen oder den Wert mindern.`]);
      const other = v.lasten.filter((x) => !bad.includes(x));
      if (other.length) out.push(['warn', `Eintragungen in Abt. II: ${other.join(', ')} – Auswirkung auf den Beleihungswert prüfen.`]);
      if (!v.lasten.length) out.push(['ok', 'Keine typischen Lasten in Abt. II erkannt.']);
      if (v.grundschulden.length) out.push(['warn', `Bestehende Grundschuld(en) in Abt. III: ${v.grundschulden.map((x) => x.toLocaleString('de-DE')).join(' €, ')} € – Löschung oder Übernahme klären.`]);
      const m = months(v._date);
      if (m != null && m > 3) out.push(['warn', `Auszug vom ${v.abruf} – Banken verlangen meist einen höchstens 3 Monate alten Auszug.`]);
      return out;
    } },
  { id: 'energie', label: 'Energieausweis', group: 'Objekt',
    sig: [/energieausweis/i, /endenergie(bedarf|verbrauch)|primärenergie/i, /energieeffizienzklasse|effizienzklasse/i, /gültig bis/i, /gebäudeenergiegesetz|\bgeg\b|enev/i],
    extract(t) {
      const cls = (/(?:energieeffizienz)?klasse\s*:?\s*(A\+|[A-H])\b/i.exec(t) || [])[1] || null;
      const kwh = amount(t, [/endenergie(?:bedarf|verbrauch)?(?: dieses gebäudes)?/], { min: 5, max: 600 });
      const g = /gültig bis\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i.exec(t);
      const [dd, mm, yy] = g ? g[1].split('.').map(Number) : [];
      const valid = g ? new Date(yy, mm - 1, dd) : null;
      return { klasse: cls ? cls.toUpperCase() : null, kwh, gueltigBis: dstr(valid), art: /verbrauchsausweis|energieverbrauch/i.test(t) ? 'Verbrauchsausweis' : /bedarfsausweis|energiebedarf/i.test(t) ? 'Bedarfsausweis' : null, _valid: valid };
    },
    check(v) {
      const out = [];
      if (v._valid && v._valid.getTime() < Date.now()) out.push(['bad', `Energieausweis abgelaufen (gültig bis ${v.gueltigBis}).`]);
      if (v.klasse && /[GH]/.test(v.klasse)) out.push(['warn', `Effizienzklasse ${v.klasse}: Sanierungsbedarf und mögliche Bewertungsabschläge einplanen.`]);
      if (v.klasse && /A\+|A|B/.test(v.klasse)) out.push(['ok', `Effizienzklasse ${v.klasse} – ggf. günstigere Konditionen bzw. Förderung möglich.`]);
      return out;
    } },
  { id: 'teilung', label: 'Teilungserklärung', group: 'Wohnungseigentum',
    sig: [/teilungserklärung/i, /miteigentumsanteil|\bmea\b/i, /sondereigentum|gemeinschaftseigentum/i, /aufteilungsplan/i],
    extract(t) { const m = /(\d{1,4}(?:,\d+)?)\s*\/\s*(1\.?000|10\.?000|100\.?000)\s*(?:miteigentumsanteil|mea)?/i.exec(t); return { mea: m ? `${m[1]}/${m[2]}` : null, sondernutzung: /sondernutzungsrecht/i.test(t) }; },
    check() { return []; } },
  { id: 'protokoll', label: 'Protokoll Eigentümerversammlung', group: 'Wohnungseigentum',
    sig: [/protokoll|niederschrift/i, /eigentümerversammlung|wohnungseigentümerversammlung/i, /beschluss|abstimmung|tagesordnung/i],
    extract(t) {
      const flags = [['Sonderumlage', /sonderumlage/i], ['Sanierung / größere Maßnahme', /sanierung|dachsanierung|fassade|strangsanierung|heizungstausch/i], ['Rechtsstreit', /klage|rechtsstreit|anfechtung|gericht/i], ['Hausgeld-Rückstände', /rückstand|säumig|zahlungsverzug/i]].filter(([, re]) => re.test(t)).map(([n]) => n);
      const d = latestDate(t);
      return { themen: flags, datum: dstr(d) };
    },
    check(v) { return v.themen.length ? [['warn', `Themen im Protokoll: ${v.themen.join(', ')} – Kostenfolgen für den Käufer klären.`]] : [['ok', 'Keine Sonderumlage, Sanierung oder Rechtsstreit erkannt.']]; } },
  { id: 'wirtschaftsplan', label: 'Wirtschaftsplan / Hausgeldabrechnung', group: 'Wohnungseigentum',
    sig: [/wirtschaftsplan|hausgeldabrechnung|jahresabrechnung/i, /hausgeld|wohngeld/i, /(erhaltungs|instandhaltungs)-?rücklage/i],
    extract(t) { return { hausgeld: amount(t, [/monatliches hausgeld/, /hausgeld(?:vorauszahlung)? monatlich/, /hausgeld/, /wohngeld/], { min: 50, max: 3000 }), ruecklage: amount(t, [/(?:erhaltungs|instandhaltungs)-?rücklage(?:\s*(?:stand|bestand))?/], { min: 0, max: 1e8 }) }; },
    check(v) { return v.ruecklage != null && v.ruecklage < 10000 ? [['warn', 'Geringe Erhaltungsrücklage – Risiko von Sonderumlagen.']] : []; } },
  { id: 'miete', label: 'Mietvertrag', group: 'Vermietung',
    sig: [/mietvertrag/i, /vermieter/i, /mieter/i, /(netto)?kaltmiete|grundmiete/i, /nebenkosten|betriebskosten/i],
    extract(t) { return { kaltmiete: amount(t, [/nettokaltmiete/, /kaltmiete/, /grundmiete/, /miete monatlich/], { min: 100, max: 20000 }), staffel: /staffelmiete/i.test(t), index: /indexmiete|verbraucherpreisindex/i.test(t), beginn: dstr(latestDate(t)) }; },
    check(v) { const o = []; if (v.index) o.push(['ok', 'Indexmiete vereinbart.']); if (v.staffel) o.push(['ok', 'Staffelmiete vereinbart.']); if (!v.kaltmiete) o.push(['warn', 'Kaltmiete nicht erkannt.']); return o; } },
  { id: 'kaufvertrag', label: 'Kaufvertrag(sentwurf)', group: 'Objekt',
    sig: [/kaufvertrag|kaufvertragsentwurf|urkunde/i, /notar/i, /verkäufer/i, /käufer/i, /kaufpreis/i],
    extract(t) { return { kaufpreis: amount(t, [/kaufpreis beträgt/, /kaufpreis/], { min: 10000, max: 5e7 }), inventar: amount(t, [/inventar|einbauküche|bewegliche/], { min: 100, max: 200000 }) }; },
    check(v) { return v.kaufpreis ? [] : [['warn', 'Kaufpreis nicht erkannt.']]; } },
  { id: 'flaeche', label: 'Wohnflächenberechnung', group: 'Objekt',
    sig: [/wohnflächenberechnung|flächenberechnung/i, /wohnfläche/i, /woflv|ii\.?\s*bv|din 277/i, /m²|qm/i],
    extract(t) { return { flaeche: amount(t, [/gesamtwohnfläche/, /wohnfläche gesamt/, /summe wohnfläche/, /wohnfläche/], { min: 15, max: 2000 }) }; },
    check(v) { return v.flaeche ? [] : [['warn', 'Wohnfläche nicht erkannt.']]; } },
  { id: 'expose', label: 'Exposé', group: 'Objekt',
    sig: [/exposé|expose|objektbeschreibung/i, /kaufpreis/i, /wohnfläche/i, /zimmer/i, /baujahr/i, /provision|käuferprovision|courtage/i],
    extract(t) { return { kaufpreis: amount(t, [/kaufpreis/], { min: 10000, max: 5e7 }), flaeche: amount(t, [/wohnfläche/], { min: 15, max: 2000 }), baujahr: Number((/baujahr\s*:?\s*(1[89]\d{2}|20\d{2})/i.exec(t) || [])[1]) || null }; },
    check() { return []; } },
  { id: 'selbstauskunft', label: 'Selbstauskunft', group: 'Person',
    sig: [/selbstauskunft|persönliche angaben|haushaltsrechnung/i, /familienstand/i, /arbeitgeber|beschäftigt seit/i, /monatliche ausgaben|verbindlichkeiten/i],
    extract(t) { return { kinder: Number((/kinder\s*:?\s*(\d)/i.exec(t) || [])[1]) || null, verbindlichkeiten: amount(t, [/monatliche raten/, /verbindlichkeiten/], { min: 0, max: 50000 }) }; },
    check() { return []; } },
];

// Dokument erkennen. Liefert { type, label, group, values, findings, confidence } oder Typ „unbekannt“.
export function analyseText(raw, name = '') {
  const t = norm(raw);
  if (t.replace(/\s/g, '').length < 40) return { type: 'scan', label: 'Nicht lesbar (Scan/Bild)', group: '–', values: {}, findings: [['warn', 'Kein Text im PDF – vermutlich ein Scan. Bitte eine digitale Fassung anfordern oder die Werte manuell prüfen.']], confidence: 0, name };
  const scored = TYPES.map((x) => ({ x, s: count(t, x.sig) + (new RegExp(x.label.split(/[ /(]/)[0], 'i').test(name) ? 1 : 0) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best || best.s < 2) return { type: 'unbekannt', label: 'Nicht zugeordnet', group: '–', values: {}, findings: [['warn', 'Dokumentart nicht erkannt – bitte manuell zuordnen.']], confidence: 0, name };
  const values = best.x.extract(t);
  const findings = best.x.check(values);
  return { type: best.x.id, label: best.x.label, group: best.x.group, values, findings, confidence: Math.min(1, best.s / best.x.sig.length), name };
}

// Fehlende Unterlagen je Fallkonstellation.
export function missingDocs(types, { selbststaendig = false, etw = false, vermietet = false } = {}) {
  const need = [[selbststaendig ? 'steuerbescheid' : 'gehalt', selbststaendig ? 'Einkommensteuerbescheide (2–3 Jahre)' : 'Gehaltsabrechnungen (letzte 3)'], ['konto', 'Eigenkapitalnachweis'], ['grundbuch', 'Grundbuchauszug'], ['energie', 'Energieausweis'], ['flaeche', 'Wohnflächenberechnung'], ['kaufvertrag', 'Kaufvertragsentwurf']];
  if (selbststaendig) need.push(['bwa', 'Aktuelle BWA / Jahresabschlüsse']);
  if (etw) need.push(['teilung', 'Teilungserklärung'], ['protokoll', 'Protokolle der Eigentümerversammlungen'], ['wirtschaftsplan', 'Wirtschaftsplan / Hausgeldabrechnung']);
  if (vermietet) need.push(['miete', 'Mietvertrag']);
  const set = new Set(types);
  return need.filter(([k]) => !set.has(k)).map(([, l]) => l);
}

// Fallbild aus allen erkannten Dokumenten zusammenführen.
export function caseFacts(docs) {
  const by = (id) => docs.filter((d) => d.type === id);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const netto = avg(by('gehalt').map((d) => d.values.netto).filter((x) => x > 0));
  const kauf = by('kaufvertrag').map((d) => d.values.kaufpreis).find(Boolean) || by('expose').map((d) => d.values.kaufpreis).find(Boolean) || null;
  const flaeche = by('flaeche').map((d) => d.values.flaeche).find(Boolean) || by('expose').map((d) => d.values.flaeche).find(Boolean) || null;
  const ek = by('konto').map((d) => d.values.saldo).filter((x) => x > 0).reduce((a, b) => a + b, 0) || null;
  const e = by('energie')[0]?.values || {};
  return {
    nettoMonat: netto, gehaltsMonate: by('gehalt').length, kaufpreis: kauf, flaeche, eigenkapital: ek,
    hausgeld: by('wirtschaftsplan').map((d) => d.values.hausgeld).find(Boolean) || null,
    kaltmiete: by('miete').map((d) => d.values.kaltmiete).find(Boolean) || null,
    klasse: e.klasse || null, lasten: by('grundbuch').flatMap((d) => d.values.lasten),
    baujahr: by('expose').map((d) => d.values.baujahr).find(Boolean) || null,
    etw: by('teilung').length > 0 || by('wirtschaftsplan').length > 0 || by('protokoll').length > 0,
    selbststaendig: by('bwa').length > 0 || (by('steuerbescheid').length > 0 && !by('gehalt').length),
    vermietet: by('miete').length > 0,
  };
}

// Abgleich zwischen Dokumenten: Werte, die in mehreren Unterlagen stehen, gegeneinander prüfen.
// Liefert je Feld die Fundstellen (Dokumentart und Dateiname) und ob sie voneinander abweichen.
// Toleranz: Kaufpreis 0,5 %, Wohnfläche 3 % (Rundungen in Exposés). Nur echte Fundstellen, nichts geschätzt.
const XCHECK = [
  { key: 'kaufpreis', label: 'Kaufpreis', unit: '€', tol: 0.005, from: ['kaufvertrag', 'expose'] },
  { key: 'flaeche', label: 'Wohnfläche', unit: 'm²', tol: 0.03, from: ['flaeche', 'expose'] },
];
export function crossCheck(docs = []) {
  const out = [];
  for (const x of XCHECK) {
    const hits = docs.filter((d) => x.from.includes(d.type) && Number(d.values?.[x.key]) > 0).map((d) => ({ label: d.label, name: d.name || '', value: Number(d.values[x.key]) }));
    if (hits.length < 2) continue;
    const vals = hits.map((h) => h.value), min = Math.min(...vals), max = Math.max(...vals);
    out.push({ key: x.key, label: x.label, unit: x.unit, hits, differs: (max - min) / max > x.tol });
  }
  return out;
}
// Erkennungsqualität aus der Zuordnungssicherheit der Dokumentart (0–1).
export const quality = (c) => (c == null ? null : c >= 0.75 ? 'hoch' : c >= 0.5 ? 'mittel' : 'niedrig');
