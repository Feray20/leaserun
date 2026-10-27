// Liest die Eckdaten EINES Inserats aus Text, den der Nutzer selbst übergibt (Ein-Klick-Übernahme im eigenen
// Browser oder eingefügter Text). Läuft nur im Browser; es wird nichts an LeaseRun-Server gesendet.
// Übernommen werden nur Zahlen und Fakten für die eigene Berechnung – keine Beschreibungen, Bilder oder Kontaktdaten.

const PORTALS = [[/immobilienscout24\./i, 'ImmoScout24'], [/immowelt\./i, 'Immowelt'], [/kleinanzeigen\./i, 'Kleinanzeigen'], [/immonet\./i, 'Immonet']];

// Deutsche Zahl: "349.000" → 349000, "72,5" → 72.5, "1.234,56" → 1234.56, "3.5" (Zimmer) → 3.5
export function deNum(s) {
  if (s == null) return null;
  let t = String(s).replace(/[\s  ]/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t)) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const NUM = String.raw`(\d{1,3}(?:[.\s  ]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)`;

// Sucht ein Label am Zeilenanfang und den ersten passenden Wert in derselben oder den zwei folgenden Zeilen.
function byLabel(lines, labelRe, valueRe, skip) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    if (skip && skip.test(lines[i])) continue;
    const rest = lines[i].slice(m.index + m[0].length);
    for (const cand of [rest, lines[i + 1] || '', lines[i + 2] || '']) {
      const v = cand.match(valueRe);
      if (v) return { value: v, line: `${lines[i]} ${cand}` };
      if (cand && cand !== rest && /[a-zäöü]{4,}/i.test(cand) && !valueRe.test(cand)) break;
    }
  }
  return null;
}

const inRange = (v, lo, hi) => (v != null && v >= lo && v <= hi ? v : null);

function fromJsonLd(raw) {
  const out = {};
  if (!raw) return out;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const offer = Array.isArray(o.offers) ? o.offers[0] : o.offers;
    if (offer && out.price == null) { const p = deNum(offer.price ?? offer.lowPrice); if (p) out.price = p; }
    if (o.floorSize && out.area == null) out.area = deNum(o.floorSize.value ?? o.floorSize);
    if (o.numberOfRooms != null && out.rooms == null) out.rooms = deNum(o.numberOfRooms.value ?? o.numberOfRooms);
    if (o.address && typeof o.address === 'object' && !out.plz) {
      if (o.address.postalCode) out.plz = String(o.address.postalCode).slice(0, 5);
      if (o.address.addressLocality) out.city = String(o.address.addressLocality).slice(0, 60);
    }
    if (o['@graph']) walk(o['@graph']);
    for (const k of ['mainEntity', 'itemOffered', 'about']) if (o[k]) walk(o[k]);
  };
  for (const chunk of String(raw).split(/\n(?=\s*[[{])/)) { try { walk(JSON.parse(chunk)); } catch { /* ungültiges JSON ignorieren */ } }
  return out;
}

/**
 * @param {{u?: string, ti?: string, t?: string, j?: string}} d  u = Inserats-URL, ti = Seitentitel, t = sichtbarer Text, j = JSON-LD
 */
// Personenbezogene Daten Dritter (Makler, Verkäufer) werden nie übernommen: Zeilen mit E-Mail, Telefonnummer
// oder Kontakt-Stichwort scheiden als Titel aus; übernommen werden nur Objektzahlen (Art. 5 Abs. 1 lit. c DSGVO).
const PII = /[\w.+-]+@[\w-]+\.[\w.]+|(?:\+49|0049|\b0)\s?[\d][\d\s/()-]{5,}\d|\b(Herr|Frau|Ansprechpartner(in)?|Kontakt(person)?|Tel\.?|Telefon|Mobil|Fax|E-?Mail|Makler(in|büro)?|Anbieter(in)?|Verkäufer(in)?|Immobilien\s?(GmbH|Büro|Service)|GmbH|e\.\s?K\.)\b/i;
export const hasPII = (t) => PII.test(String(t || ''));

export function parseListing(d) {
  const url = /^https:\/\/[^\s]{8,2000}$/i.test(String(d.u || '').trim()) ? String(d.u).trim() : '';
  const text = String(d.t || '').slice(0, 30000);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const ld = fromJsonLd(d.j);
  const portal = (PORTALS.find(([re]) => re.test(url)) || [null, ''])[1];
  const all = `${url} ${d.ti || ''} ${lines.slice(0, 60).join(' ')}`;
  const r = { url, portal, found: [], missing: [], warnings: [] };

  if (/\/(mieten|wohnung-mieten|haus-mieten)\b|s-wohnung-mieten|mietwohnung/i.test(url) || (/\bKaution\b/.test(text) && !/Kaufpreis/i.test(text))) {
    r.warnings.push('Das sieht nach einem Mietangebot aus. Die Analyse ist für Kaufobjekte gedacht.');
  }

  const euro = new RegExp(`${NUM}\\s*(?:€|EUR|Euro)`, 'i');
  const p = byLabel(lines, /^(Kaufpreis|Preis)\b:?/i, euro, /pro\s*m²|\/\s*m²|je\s*m²|Preis\s*\/\s*m²|Quadratmeterpreis/i);
  r.price = inRange(p ? deNum(p.value[1]) : ld.price, 10000, 100000000);
  if (r.price == null) {
    // Kleinanzeigen u. a.: Preis steht ohne Label weit oben ("349.000 € VB").
    for (const l of lines.slice(0, 80)) { const m = l.match(new RegExp(`^${NUM}\\s*€(\\s*VB)?$`)); if (m) { const v = inRange(deNum(m[1]), 10000, 100000000); if (v) { r.price = v; break; } } }
  }

  const qm = new RegExp(`${NUM}\\s*(?:m²|m2|qm)`, 'i');
  const a = byLabel(lines, /^(Wohnfläche|Wohnflaeche)(\s*ca\.?)?:?/i, qm);
  r.area = inRange(a ? deNum(a.value[1]) : ld.area, 8, 20000);

  const z = byLabel(lines, /^(Zimmer|Zimmeranzahl|Anzahl Zimmer)\b:?/i, /^\s*:?\s*(\d{1,2}(?:[.,]5)?)\b/);
  r.rooms = inRange(z ? deNum(z.value[1]) : ld.rooms, 0.5, 200);

  const bj = byLabel(lines, /^Baujahr\b:?/i, /\b(1[5-9]\d\d|20[0-3]\d)\b/);
  r.year = bj ? inRange(Number(bj.value[1]), 1500, new Date().getFullYear() + 5) : null;

  const hg = byLabel(lines, /^Hausgeld\b(\s*\(.*?\))?:?/i, euro);
  r.hausgeld = hg ? inRange(deNum(hg.value[1]), 1, 20000) : null;

  let mi = byLabel(lines, /^(Mieteinnahmen|Ist-Miete|Istmiete|Mieteinnahme|Kaltmiete \(vermietet\)|Nettokaltmiete|Jahresnettokaltmiete)\b[^\d€]{0,40}?/i, euro);
  // Exposés von Kaufobjekten nennen die laufende Miete oft nur „Kaltmiete“ oder „Jahresmiete“.
  if (!mi && /Kaufpreis/i.test(text)) mi = byLabel(lines, /^(Kaltmiete|Aktuelle Miete|Miete kalt|Jahresmiete|Jahreskaltmiete|Nettomiete)\b[^\d€]{0,40}?/i, euro);
  if (mi) {
    let v = deNum(mi.value[1]);
    if (/pro\s*Jahr|p\.\s*a\.|jährlich|Jahres|\/\s*Jahr/i.test(mi.line)) v = v / 12;
    r.rent = inRange(v != null ? Math.round(v * 100) / 100 : null, 10, 1000000);
  } else r.rent = null;

  const pv = byLabel(lines, /^(Provision für Käufer|Käuferprovision|Provision|Maklerprovision|Courtage)\b:?/i, /(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
  r.brokerPct = pv ? inRange(deNum(pv.value[1]), 0, 15) : /provisionsfrei|keine (Käufer)?provision/i.test(text) ? 0 : null;

  const ec = byLabel(lines, /^(Energieeffizienzklasse|Effizienzklasse)\b:?/i, /^\s*:?\s*(A\+|[A-H])\b/);
  r.energyClass = ec ? ec.value[1] : '';

  // Ort: PLZ und Ort aus JSON-LD oder der ersten Adresszeile.
  let plz = ld.plz || '', city = ld.city || '';
  if (!plz) {
    for (const l of lines.slice(0, 150)) {
      const m = l.match(/\b(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\- ]{1,40}?)(?:[,(]|$|\s{2})/);
      if (m) { plz = m[1]; city = m[2].split(/\s[-–]\s/)[0].trim(); break; }
    }
  }
  r.plz = plz; r.city = city;

  r.art = /mehrfamilienhaus|mehrfamilienh|zinshaus|renditeobjekt/i.test(all) ? 'MFH' : /wohnung|etagenwohnung|eigentumswohnung|apartment|penthouse|maisonette/i.test(all) ? 'ETW' : /\bhaus\b|einfamilienhaus|doppelhaus|reihenhaus|haus-kaufen|haeuser/i.test(all) ? 'EFH' : 'ETW';

  const h1 = String(d.ti || '').replace(/\s*[|–-]\s*(ImmoScout24|immowelt|Kleinanzeigen|eBay).*$/i, '').trim();
  const t0 = (h1 || lines[0] || '').slice(0, 140);
  r.title = t0 && !hasPII(t0) ? t0 : '';
  r.name = [r.city, r.area ? `${Math.round(r.area)} m²` : '', r.rooms ? `${String(r.rooms).replace('.', ',')} Zi.` : ''].filter(Boolean).join(' · ') || r.title || 'Inserat';
  if (!r.title) r.title = r.name;

  for (const [k, label] of [['price', 'Kaufpreis'], ['area', 'Wohnfläche'], ['rooms', 'Zimmer'], ['rent', 'Miete (Ist)'], ['year', 'Baujahr'], ['hausgeld', 'Hausgeld'], ['brokerPct', 'Provision']]) {
    (r[k] != null ? r.found : r.missing).push(label);
  }
  if (r.energyClass) r.found.push('Effizienzklasse');
  if (r.city) r.found.push('Ort');
  return r;
}

// Bookmarklet: läuft auf der Inseratsseite im Browser des Nutzers und übergibt Text und URL per URL-Fragment
// (das Fragment wird nicht an Server übertragen). Ohne Sonderzeichen, damit es in jedem Browser als Lesezeichen funktioniert.
export function bookmarklet(origin) {
  const code = `(()=>{try{var m=document.querySelector('main')||document.body;var t=(m.innerText||'').slice(0,20000);var j=[].slice.call(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){return s.textContent}).join('\\n').slice(0,8000);var d={v:1,u:location.href,ti:document.title.slice(0,200),t:t,j:j};var u='${origin}/app/dashboard#suche?import='+encodeURIComponent(JSON.stringify(d));var w=window.open(u,'leaserun');if(!w)location.href=u}catch(e){alert('LeaseRun: Uebernahme nicht moeglich')}})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
