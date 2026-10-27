// Reads the key facts of ONE listing from text the user hands over (one-click import in the user's own browser or
// pasted text). Runs in the browser only; nothing is sent to LeaseRun servers.
// Only numbers and facts for the user's own calculation are taken – no descriptions, photos or contact details.
// Built for US listings (Zillow, Redfin, Realtor.com, Trulia, Homes.com, MLS sheets, broker PDFs).
//
// Result keys (kept for the callers): price, area (sq ft), rooms (bedrooms), baths, year, hausgeld (HOA $/month),
// taxesAnnual, rent ($/month), brokerPct (buyer's agent %, if stated), energyClass (unused in the US, ''),
// plz (ZIP), city, state (2-letter), street, art ('SFR' | 'CONDO' | 'MFH' for 2–4 units/multifamily), units,
// title, name, url, portal, found[], missing[], warnings[].

const PORTALS = [[/zillow\./i, 'Zillow'], [/redfin\./i, 'Redfin'], [/realtor\.com/i, 'Realtor.com'], [/trulia\./i, 'Trulia'], [/homes\.com/i, 'Homes.com'], [/movoto\./i, 'Movoto'], [/loopnet\./i, 'LoopNet'], [/crexi\./i, 'Crexi']];

const STATE_CODES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

// US number: "349,000" → 349000, "1,234.56" → 1234.56, "3.5" → 3.5, "$1.2M" → 1200000, "425K" → 425000.
// Also tolerates European input ("349.000", "72,5") so pasted text from any source still works.
export function usNum(s) {
  if (s == null) return null;
  const raw = String(s).replace(/[\s  ]/g, '');
  const mult = /\d\s*[mM](?:il+(?:ion)?)?\b|\d[mM]$/.test(raw) ? 1e6 : /\d[kK]\b|\d[kK]$/.test(raw) ? 1e3 : 1;
  let t = raw.replace(/[^\d.,-]/g, '');
  if (!/\d/.test(t)) return null;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');
  else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.');
  else t = t.replace(/,/g, '');
  const n = Number(t) * mult;
  return Number.isFinite(n) ? n : null;
}
// Backwards-compatible name (older callers and tests).
export const deNum = usNum;

const NUM = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
const MONEY = new RegExp(String.raw`\$\s?${NUM}\s*([KkMm](?:il+ion)?)?\b`);

// Finds a label at the start of a line and the first matching value on the same line or the next two lines.
function byLabel(lines, labelRe, valueRe, skip) {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(labelRe);
    if (!m) continue;
    if (skip && skip.test(lines[i])) continue;
    const rest = lines[i].slice(m.index + m[0].length);
    for (const cand of [rest, lines[i + 1] || '', lines[i + 2] || '']) {
      const v = cand.match(valueRe);
      if (v) return { value: v, line: `${lines[i]} ${cand}` };
      if (cand && cand !== rest && /[a-z]{4,}/i.test(cand) && !valueRe.test(cand)) break;
    }
  }
  return null;
}
const money = (v) => (v ? usNum(v[1] + (v[2] || '')) : null);
const inRange = (v, lo, hi) => (v != null && v >= lo && v <= hi ? v : null);

function fromJsonLd(raw) {
  const out = {};
  if (!raw) return out;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const offer = Array.isArray(o.offers) ? o.offers[0] : o.offers;
    if (offer && out.price == null) { const p = usNum(offer.price ?? offer.lowPrice); if (p) out.price = p; }
    if (o.floorSize && out.area == null) out.area = usNum(o.floorSize.value ?? o.floorSize);
    if (o.numberOfRooms != null && out.rooms == null) out.rooms = usNum(o.numberOfRooms.value ?? o.numberOfRooms);
    if (o.numberOfBedrooms != null && out.rooms == null) out.rooms = usNum(o.numberOfBedrooms);
    if (o.numberOfBathroomsTotal != null && out.baths == null) out.baths = usNum(o.numberOfBathroomsTotal);
    if (o.yearBuilt != null && out.year == null) out.year = usNum(o.yearBuilt);
    if (o.address && typeof o.address === 'object' && !out.plz) {
      if (o.address.postalCode) out.plz = String(o.address.postalCode).slice(0, 10);
      if (o.address.addressLocality) out.city = String(o.address.addressLocality).slice(0, 60);
      if (o.address.addressRegion) out.state = String(o.address.addressRegion).toUpperCase().slice(0, 2);
      if (o.address.streetAddress) out.street = String(o.address.streetAddress).slice(0, 120);
    }
    if (o['@graph']) walk(o['@graph']);
    for (const k of ['mainEntity', 'itemOffered', 'about']) if (o[k]) walk(o[k]);
  };
  for (const chunk of String(raw).split(/\n(?=\s*[[{])/)) { try { walk(JSON.parse(chunk)); } catch { /* ignore invalid JSON */ } }
  return out;
}

// Personal data of third parties (agents, sellers) is never taken: lines with email, phone number or contact keywords
// are not used as a title; only property numbers are imported (data minimization).
const PII = /[\w.+-]+@[\w-]+\.[\w.]+|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|\+1[\s\d().-]{9,}|\b(Mr\.?|Mrs\.?|Ms\.?|Contact|Call|Text|Phone|Tel\.?|Cell|Fax|E-?mail|Listed by|Listing (agent|courtesy|provided)|Agent|Realtor|Broker(age)?|Seller|Presented by|Courtesy of|Realty|Properties,? (Inc|LLC)|LLC|Inc\.?)\b/i;
export const hasPII = (t) => PII.test(String(t || ''));

/**
 * @param {{u?: string, ti?: string, t?: string, j?: string}} d  u = listing URL, ti = page title, t = visible text, j = JSON-LD
 */
export function parseListing(d) {
  const url = /^https:\/\/[^\s]{8,2000}$/i.test(String(d.u || '').trim()) ? String(d.u).trim() : '';
  const text = String(d.t || '').slice(0, 30000);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const ld = fromJsonLd(d.j);
  const portal = (PORTALS.find(([re]) => re.test(url)) || [null, ''])[1];
  const all = `${url} ${d.ti || ''} ${lines.slice(0, 60).join(' ')}`;
  const r = { url, portal, found: [], missing: [], warnings: [] };

  const isRental = /\/(for_rent|rentals?|apartments-for-rent|homes-for-rent)\b|\/rent\//i.test(url) || (/\b(security deposit|for rent|\/mo\b.*lease|lease term)\b/i.test(text) && !/\b(list(ing)? price|asking price|for sale|sale price|price history)\b/i.test(text));
  if (isRental) r.warnings.push('This looks like a rental listing. The analysis is built for properties for sale.');

  // Price
  const p = byLabel(lines, /^(List(ing)? price|Asking price|Sale price|Price|Offered at|For sale)\b:?/i, MONEY, /\/\s*sq\.?\s*ft|per sq|price\/sqft|price per|\bzestimate\b|rent/i);
  r.price = inRange(p ? money(p.value) : ld.price, 10000, 100000000);
  if (r.price == null) {
    // Zillow/Redfin cards: price stands alone near the top ("$349,000").
    for (const l of lines.slice(0, 80)) { const m = l.match(new RegExp(String.raw`^\$\s?${NUM}\s*([KkMm])?$`)); if (m) { const v = inRange(money(m), 10000, 100000000); if (v) { r.price = v; break; } } }
  }
  if (r.price == null) { const m = text.match(/\$\s?(\d{2,3}(?:,\d{3}){1,2})(?!\s*\/\s*mo)(?!\s*per)(?!\s*\/\s*sq)/); if (m) r.price = inRange(usNum(m[1]), 10000, 100000000); }

  // Area (living area in square feet; lot size is skipped)
  const sqft = new RegExp(String.raw`${NUM}\s*(?:sq\.?\s*ft\.?|sqft|square\s*feet|sf)\b`, 'i');
  const a = byLabel(lines, /^(Living area|Finished sq\.? ?ft|Square feet|Sq\.? ?ft|Interior|Size|Home size|Total interior livable area|Living sq\.? ?ft)\b:?/i, sqft, /\blot\b/i);
  let area = a ? usNum(a.value[1]) : ld.area;
  if (area == null) { for (const l of lines.slice(0, 200)) { if (/\blot\b|acre/i.test(l)) continue; const m = l.match(sqft); if (m) { area = usNum(m[1]); break; } } }
  r.area = inRange(area, 200, 500000);

  // Bedrooms / bathrooms
  const bd = text.match(/(\d{1,2})\s*(?:bd|bds|beds?|bedrooms?|br)\b/i) || byLabel(lines, /^(Bedrooms|Beds)\b:?/i, /(\d{1,2})\b/)?.value;
  r.rooms = inRange(bd ? Number(bd[1]) : ld.rooms, 0, 200);
  const ba = text.match(/(\d{1,2}(?:\.\d)?)\s*(?:ba|baths?|bathrooms?)\b/i) || byLabel(lines, /^(Bathrooms|Baths|Total baths)\b:?/i, /(\d{1,2}(?:\.\d)?)\b/)?.value;
  r.baths = inRange(ba ? Number(ba[1]) : ld.baths, 0, 100);

  // Year built
  const bj = byLabel(lines, /^(Year built|Built in|Built)\b:?/i, /\b(1[6-9]\d\d|20[0-3]\d)\b/) || (text.match(/\b(?:year built|built in)\s*:?\s*(1[6-9]\d\d|20[0-3]\d)\b/i) ? { value: text.match(/\b(?:year built|built in)\s*:?\s*(1[6-9]\d\d|20[0-3]\d)\b/i) } : null);
  r.year = bj ? inRange(Number(bj.value[1]), 1600, new Date().getFullYear() + 5) : inRange(ld.year, 1600, new Date().getFullYear() + 5);

  // HOA dues (monthly; annual/quarterly converted)
  const hoa = byLabel(lines, /^(HOA(\s*(dues|fee|fees))?|Association fee|Homeowners association|Condo fee|Monthly HOA)\b[^$\n]{0,30}?/i, /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(?:\/\s*|per\s*|a\s*)?(mo|month|monthly|yr|year|annual|annually|qtr|quarter|quarterly)?/i);
  if (hoa) {
    const v = usNum(hoa.value[1]); const per = (hoa.value[2] || (/annual|year/i.test(hoa.line) ? 'yr' : /quarter/i.test(hoa.line) ? 'qtr' : 'mo')).toLowerCase();
    r.hausgeld = inRange(v == null ? null : /y|ann/.test(per) ? Math.round(v / 12) : /q/.test(per) ? Math.round(v / 3) : v, 1, 20000);
  } else r.hausgeld = /\bno hoa\b|hoa:?\s*(none|\$0|no)\b/i.test(text) ? 0 : null;

  // Property taxes (annual)
  const tx = byLabel(lines, /^(Annual )?(property )?tax(es)?( \(\d{4}\))?( amount)?\b[^$\n]{0,25}?/i, /\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(\/\s*(?:mo|month))?/i, /tax (assessed|assessment) value|tax history|\brate\b/i);
  if (tx) { let v = usNum(tx.value[1]); if (tx.value[2] || /\/\s*mo|monthly/i.test(tx.line)) v = v * 12; r.taxesAnnual = v != null && r.price && (v < r.price * 0.0005 || v > r.price * 0.05) ? null : inRange(v, 50, 2000000); }
  else r.taxesAnnual = null;

  // Rent (current lease, market rent or rent estimate)
  let mi = byLabel(lines, /^(Current rent|Monthly rent|Actual rent|Gross (monthly )?rent|Gross scheduled income|Gross income|Rental income|Rent roll|Total rents?|Market rent|Rent (estimate|zestimate)|Rent Zestimate|Est\.? rent|Estimated rent)\b[^$\n]{0,40}?/i, MONEY);
  if (!mi) { const m = text.match(/(?:rent(?:al)?\s*(?:estimate|est\.?|income|zestimate)|market\s*rent|current\s*rent|gross\s*rent)[^$\n]{0,20}(\$\s?(\d{1,3}(?:,\d{3})*|\d+))/i); if (m) mi = { value: [m[1], m[2]], line: m[0] }; }
  if (mi && !isRental) {
    let v = usNum(mi.value[1]);
    if (/\b(annual|per year|\/\s*yr|\/\s*year|yearly|gross scheduled income|GSI)\b/i.test(mi.line) || (v != null && r.price && v > r.price * 0.03)) v = v / 12;
    r.rent = inRange(v != null ? Math.round(v * 100) / 100 : null, 100, 1000000);
  } else r.rent = null;

  // Buyer's agent compensation (only if the listing states it)
  const pv = byLabel(lines, /^(Buyer'?s? (agent )?(compensation|commission)|Buyer agency compensation|Co-?op(erating)? (commission|compensation))\b:?/i, /(\d{1,2}(?:\.\d{1,2})?)\s*%/);
  r.brokerPct = pv ? inRange(usNum(pv.value[1]), 0, 10) : null;
  r.energyClass = '';

  // Address: street, city, state, ZIP from JSON-LD or the first address-looking line.
  let plz = ld.plz || '', city = ld.city || '', state = STATE_CODES.has(ld.state) ? ld.state : '', street = ld.street || '';
  if (!plz) {
    for (const l of [d.ti || '', ...lines.slice(0, 150)]) {
      const m = String(l).match(/(?:^|[|,\s])(\d{1,6}[A-Za-z]?\s+[A-Za-z0-9.'# -]{2,50}?)?,?\s*([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/);
      if (m && STATE_CODES.has(m[3])) { street = (m[1] || '').trim(); city = m[2].trim(); state = m[3]; plz = m[4]; break; }
    }
  }
  if (street && hasPII(street)) street = '';
  r.plz = plz; r.city = city; r.state = state; r.street = street;

  // Property type and units
  r.units = 1;
  if (/\b(four[-\s]?plex|quadplex|4[-\s]?units?|4 unit)\b/i.test(all)) { r.art = 'MFH'; r.units = 4; }
  else if (/\b(tri[-\s]?plex|3[-\s]?units?)\b/i.test(all)) { r.art = 'MFH'; r.units = 3; }
  else if (/\b(duplex|2[-\s]?units?)\b/i.test(all)) { r.art = 'MFH'; r.units = 2; }
  else if (/\b(multi[-\s]?family|apartment building|(\d{1,3})\s*units\b)/i.test(all)) { r.art = 'MFH'; const u = all.match(/\b(\d{1,3})\s*units\b/i); r.units = u ? Math.max(2, Number(u[1])) : 5; }
  else if (/\b(condo(minium)?|townho(use|me)|co-?op|apartment unit|loft)\b/i.test(all)) r.art = 'CONDO';
  else r.art = 'SFR';

  const h1 = String(d.ti || '').replace(/\s*[|–-]\s*(Zillow|Redfin|Realtor\.com|Trulia|Homes\.com|MLS.*)\s*$/i, '').trim();
  const t0 = (h1 || lines[0] || '').slice(0, 140);
  r.title = t0 && !hasPII(t0) ? t0 : '';
  const place = street ? `${street}, ${city}${state ? ' ' + state : ''}` : city ? `${city}${state ? ', ' + state : ''}` : '';
  r.name = [place, r.rooms ? `${r.rooms} bd` : '', r.baths ? `${r.baths} ba` : '', r.area ? `${Math.round(r.area).toLocaleString('en-US')} sq ft` : ''].filter(Boolean).join(' · ') || r.title || 'Listing';
  if (!r.title) r.title = r.name;

  for (const [k, label] of [['price', 'Price'], ['area', 'Square feet'], ['rooms', 'Bedrooms'], ['rent', 'Rent'], ['year', 'Year built'], ['hausgeld', 'HOA dues'], ['taxesAnnual', 'Property taxes']]) {
    (r[k] != null ? r.found : r.missing).push(label);
  }
  if (r.baths != null) r.found.push('Bathrooms');
  if (r.state) r.found.push('State');
  if (r.city) r.found.push('City');
  return r;
}

// Bookmarklet: runs on the listing page in the user's browser and hands text and URL over via the URL fragment
// (the fragment is never sent to a server). ASCII only, so it works as a bookmark in every browser.
export function bookmarklet(origin) {
  const code = `(()=>{try{var m=document.querySelector('main')||document.body;var t=(m.innerText||'').slice(0,20000);var j=[].slice.call(document.querySelectorAll('script[type="application/ld+json"]')).map(function(s){return s.textContent}).join('\\n').slice(0,8000);var d={v:1,u:location.href,ti:document.title.slice(0,200),t:t,j:j};var u='${origin}/app/dashboard#suche?import='+encodeURIComponent(JSON.stringify(d));var w=window.open(u,'leaserun');if(!w)location.href=u}catch(e){alert('LeaseRun: import not possible on this page')}})()`;
  return `javascript:${encodeURIComponent(code)}`;
}
