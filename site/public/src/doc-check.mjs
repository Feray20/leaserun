// Case review: recognize the documents of a US mortgage/purchase file and read key values.
// Pure text analysis (US forms) – runs in the browser, files never leave the device.
// Results are reading aids; the loan officer or agent checks the originals.
// Type ids and value keys are kept stable for callers (b2b-fall.mjs): e.g. 'gehalt' = pay stub, 'grundbuch' = title
// commitment, 'energie' = home inspection report, 'teilung' = CC&Rs, 'wirtschaftsplan' = HOA budget/resale certificate.
import { usNum } from './listing-parse.mjs?v=892f3666';

const NUM = String.raw`(-?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|-?\$?\s?\d+(?:\.\d{1,2})?)`;
const norm = (t) => String(t || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ');
const count = (t, res) => res.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0);
const fmtUsd = (v) => Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Amount after a label (same or next line). Returns the first plausible number.
function amount(t, labels, { min = 0, max = 1e9 } = {}) {
  for (const l of labels) {
    const re = new RegExp(l.source + String.raw`[^\n\d$-]{0,40}` + NUM, 'i');
    const m = re.exec(t);
    if (m) { const v = usNum(m[1]); if (v != null && v >= min && v <= max) return v; }
    const re2 = new RegExp(l.source + String.raw`[^\n]*\n[^\n\d$-]{0,20}` + NUM, 'i');
    const m2 = re2.exec(t);
    if (m2) { const v = usNum(m2[1]); if (v != null && v >= min && v <= max) return v; }
  }
  return null;
}
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// Latest plausible date in the text (MM/DD/YYYY, YYYY-MM-DD or "Month D, YYYY" / "Month YYYY").
function latestDate(t) {
  const ds = [];
  for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2})\b/g)) ds.push(new Date(+m[3], +m[1] - 1, +m[2]));
  for (const m of t.matchAll(/\b(20\d{2}|19\d{2})-(\d{2})-(\d{2})\b/g)) ds.push(new Date(+m[1], +m[2] - 1, +m[3]));
  for (const m of t.matchAll(new RegExp(String.raw`\b(${MONTHS.join('|')}|${MONTHS.map((x) => x.slice(0, 3)).join('|')})\.?\s+(?:(\d{1,2}),?\s+)?(20\d{2})\b`, 'gi'))) {
    const mi = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
    ds.push(new Date(+m[3], mi, m[2] ? +m[2] : 15));
  }
  const now = Date.now() + 864e5 * 400;
  const ok = ds.filter((d) => !isNaN(d) && d.getMonth() >= 0 && d.getTime() < now);
  return ok.length ? new Date(Math.max(...ok.map((d) => d.getTime()))) : null;
}
const months = (d) => (d ? (Date.now() - d.getTime()) / (30.44 * 864e5) : null);
const dstr = (d) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

// ---------- Document types ----------
// sig: typical terms (score = number of hits); extract: key values; check: notes (ok / warn / bad).
export const TYPES = [
  { id: 'gehalt', label: 'Pay stub', group: 'Income',
    sig: [/pay\s?stub|earnings statement|pay statement|statement of earnings/i, /gross pay|gross earnings|total gross/i, /net pay|take home/i, /federal (income )?tax|fed(eral)? withholding|\bfit\b/i, /social security|medicare|fica|oasdi/i, /\bytd\b|year to date|pay period|pay date/i],
    extract(t) {
      const brutto = amount(t, [/gross pay/, /total gross/, /gross earnings/, /gross/], { min: 200, max: 100000 });
      const netto = amount(t, [/net pay/, /take home pay/, /net amount/, /net/], { min: 100, max: 80000 });
      const ytd = amount(t, [/ytd gross/, /gross pay ytd/, /year to date gross/], { min: 200, max: 5e6 });
      const d = latestDate(t);
      return { brutto, netto, ytd, monat: d ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : null, _date: d };
    },
    check(v) {
      const out = [];
      if (v.brutto == null) out.push(['warn', 'Gross pay not clearly detected – please check the original. Lenders qualify on gross income.']);
      const m = months(v._date);
      if (m != null && m > 1) out.push(['warn', `Pay stub is older than 30 days (${v.monat}). Lenders usually want the most recent 30 days of pay stubs.`]);
      if (v.brutto && v.netto && v.netto > v.brutto) out.push(['bad', 'Net pay is higher than gross pay – reading error or unusual pay stub.']);
      if (v.ytd) out.push(['ok', `Year-to-date gross ${fmtUsd(v.ytd)} found – useful to verify annual income.`]);
      return out;
    } },
  { id: 'w2', label: 'Form W-2', group: 'Income',
    sig: [/\bw-?2\b|wage and tax statement/i, /wages,? tips,? other comp/i, /employer'?s? (name|identification)|\bein\b/i, /social security wages|medicare wages/i],
    extract(t) {
      const jahr = Number((/\b(20\d{2})\s*(?:form\s*)?w-?2\b|w-?2[^\n]{0,30}\b(20\d{2})\b|wage and tax statement\s*(20\d{2})/i.exec(t) || []).slice(1).find(Boolean)) || null;
      return { jahr, wages: amount(t, [/wages,? tips,? other comp(?:ensation)?/, /box 1/], { min: 0, max: 5e7 }) };
    },
    check(v) {
      const out = [];
      if (v.jahr && new Date().getFullYear() - v.jahr > 2) out.push(['warn', `W-2 for ${v.jahr} – lenders usually want the last two years.`]);
      if (v.wages == null) out.push(['warn', 'Box 1 wages not detected.']);
      return out;
    } },
  { id: 'steuerbescheid', label: 'Federal tax return (Form 1040)', group: 'Income',
    sig: [/form 1040|u\.?s\.? individual income tax return/i, /adjusted gross income|\bagi\b/i, /taxable income/i, /internal revenue service|\birs\b/i, /schedule (1|c|e)|filing status/i],
    extract(t) {
      const jahr = Number((/form 1040[^\n]{0,40}?\b(20\d{2})\b|\b(20\d{2})\s*form 1040|tax year\s*:?\s*(20\d{2})/i.exec(t) || []).slice(1).find(Boolean)) || null;
      return { jahr, zvE: amount(t, [/taxable income/], { min: 0, max: 5e7 }), einkuenfte: amount(t, [/adjusted gross income/, /total income/], { min: 0, max: 5e7 }), scheduleE: /schedule e/i.test(t), scheduleC: /schedule c/i.test(t) };
    },
    check(v) {
      const out = [];
      if (v.jahr && new Date().getFullYear() - v.jahr > 2) out.push(['warn', `Return for ${v.jahr} – self-employed borrowers usually need the last two years of personal (and business) returns.`]);
      if (!v.einkuenfte) out.push(['warn', 'Adjusted gross income not detected.']);
      if (v.scheduleE) out.push(['ok', 'Schedule E included – lenders use it to count existing rental income.']);
      return out;
    } },
  { id: 'bwa', label: 'Profit & loss / Schedule C / 1099', group: 'Income',
    sig: [/profit (and|&) loss|p\s?&\s?l\b|income statement/i, /schedule c|form 1099|1099-(nec|misc|k)/i, /net (profit|income)|gross receipts|total revenue/i, /year to date|ytd|fiscal year/i],
    extract(t) { return { ergebnis: amount(t, [/net profit/, /net income/, /net earnings/, /nonemployee compensation/], { min: -1e8, max: 1e8 }), umsatz: amount(t, [/gross receipts/, /total revenue/, /total income/], { min: 0, max: 1e9 }), stand: dstr(latestDate(t)) }; },
    check(v) { return v.ergebnis != null && v.ergebnis < 0 ? [['bad', 'Net loss – qualifying income from self-employment may be reduced or zero.']] : []; } },
  { id: 'konto', label: 'Bank / brokerage statement (assets)', group: 'Assets',
    sig: [/bank statement|account statement|brokerage statement|statement period/i, /ending balance|closing balance|available balance|account value|total value/i, /account (number|no\.?|ending in)|routing/i, /deposits|withdrawals/i],
    extract(t) { const d = latestDate(t); return { saldo: amount(t, [/ending balance/, /closing balance/, /new balance/, /available balance/, /total account value/, /account value/], { min: -1e7, max: 1e9 }), stand: dstr(d), _date: d, largeDeposit: /large deposit|wire (in|transfer)/i.test(t) }; },
    check(v) {
      const out = [];
      const m = months(v._date);
      if (m != null && m > 2) out.push(['warn', `Statement dated ${v.stand} – lenders usually want the two most recent monthly statements.`]);
      if (v.saldo == null) out.push(['warn', 'Ending balance not detected.']);
      out.push(['ok', 'Tip: large non-payroll deposits need a paper trail (gift letter or source of funds).']);
      return out;
    } },
  { id: 'grundbuch', label: 'Title commitment / preliminary title report', group: 'Property',
    sig: [/title commitment|commitment for title insurance|preliminary (title )?report|title report/i, /schedule (a|b)|exceptions/i, /vested in|vesting|fee simple/i, /legal description|parcel|apn/i, /deed of trust|mortgage|lien/i],
    extract(t) {
      const lasten = [['Easement', /easement/i], ['Right of way', /right[- ]of[- ]way/i], ['Life estate', /life estate/i], ['Lis pendens (pending lawsuit)', /lis pendens/i], ['Mechanic\'s lien', /mechanic'?s'? lien/i], ['Tax lien', /tax lien|irs lien|federal lien/i], ['Judgment', /judgment|judgement/i], ['Notice of default / foreclosure', /notice of default|foreclosure|trustee'?s sale|lis pendens.*foreclos/i], ['Bankruptcy', /bankruptcy/i], ['HOA lien', /(association|hoa) lien/i]].filter(([, re]) => re.test(t)).map(([n]) => n);
      const gs = [...t.matchAll(/(?:deed of trust|mortgage)[^\n]{0,100}?\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)/gi)].map((m) => usNum(m[1])).filter(Boolean);
      const d = latestDate(t);
      return { lasten, grundschulden: gs, abruf: dstr(d), _date: d };
    },
    check(v) {
      const out = [];
      const bad = v.lasten.filter((x) => /Lis pendens|foreclosure|Bankruptcy|Tax lien|Judgment|Life estate/i.test(x));
      if (bad.length) out.push(['bad', `Schedule B / requirements: ${bad.join(', ')} – must be cleared before closing or can block financing.`]);
      const other = v.lasten.filter((x) => !bad.includes(x));
      if (other.length) out.push(['warn', `Exceptions found: ${other.join(', ')} – check how they affect use and value.`]);
      if (!v.lasten.length) out.push(['ok', 'No typical liens or encumbrances detected.']);
      if (v.grundschulden.length) out.push(['warn', `Existing mortgage(s)/deed(s) of trust: ${v.grundschulden.map(fmtUsd).join(', ')} – to be paid off at closing (payoff statement).`]);
      const m = months(v._date);
      if (m != null && m > 3) out.push(['warn', `Report dated ${v.abruf} – ask the title company for an updated commitment before closing.`]);
      return out;
    } },
  { id: 'energie', label: 'Home inspection report', group: 'Property',
    sig: [/home inspection|inspection report|property inspection/i, /roof|foundation|hvac|furnace|water heater/i, /electrical|plumbing|panel/i, /(safety|major|significant) (concern|defect|issue)|recommend(ed)? (repair|evaluation)|deficien/i, /inspector|ashi|internachi|trec/i],
    extract(t) {
      const issues = [['Roof', /roof[^\n]{0,60}(leak|damage|end of (its )?life|replace)/i], ['Foundation / structure', /foundation[^\n]{0,60}(crack|settle|movement|repair)|structural/i], ['Electrical', /(double tap|knob and tube|federal pacific|zinsco|aluminum wiring|electrical hazard)/i], ['Plumbing / water', /(polybutylene|leak|galvanized|water damage)/i], ['HVAC', /(hvac|furnace|air condition|heat pump)[^\n]{0,60}(end of (its )?life|not (working|functioning)|replace)/i], ['Mold / moisture', /mold|moisture intrusion/i], ['Radon', /radon/i], ['Lead paint / asbestos', /lead[- ]based paint|asbestos/i], ['Pests / termites', /termite|wood[- ]destroying/i]].filter(([, re]) => re.test(t)).map(([n]) => n);
      const d = latestDate(t);
      return { klasse: null, issues, datum: dstr(d), _date: d };
    },
    check(v) {
      const out = [];
      const major = v.issues.filter((x) => /Roof|Foundation|Electrical|Mold/.test(x));
      if (major.length) out.push(['bad', `Major items: ${major.join(', ')} – get repair quotes and negotiate before the inspection period ends.`]);
      const other = v.issues.filter((x) => !major.includes(x));
      if (other.length) out.push(['warn', `Further items: ${other.join(', ')} – budget for repairs.`]);
      if (!v.issues.length) out.push(['ok', 'No typical major defects detected in the text.']);
      return out;
    } },
  { id: 'teilung', label: 'CC&Rs / condo declaration', group: 'HOA / condo',
    sig: [/declaration of (covenants|condominium)|cc&rs?|covenants,? conditions,? (and|&) restrictions/i, /bylaws|articles of incorporation/i, /common (elements|areas)|unit owner/i, /leasing|rental|short[- ]term/i],
    extract(t) { return { mea: null, sondernutzung: /limited common element/i.test(t), rentalCap: /rental (cap|limit|restriction)|leasing (cap|restriction)|no unit (shall|may) be leased|minimum lease term/i.test(t), strBan: /short[- ]term rental[^\n]{0,40}(prohibit|not permitted)|(airbnb|vrbo)[^\n]{0,40}prohibit|less than (30|thirty) days/i.test(t) }; },
    check(v) {
      const out = [];
      if (v.rentalCap) out.push(['bad', 'Rental restrictions found (cap, ban or minimum lease term) – check whether your rental plan is allowed.']);
      if (v.strBan) out.push(['warn', 'Short-term rentals are restricted.']);
      return out;
    } },
  { id: 'protokoll', label: 'HOA meeting minutes', group: 'HOA / condo',
    sig: [/minutes/i, /board (of directors )?meeting|annual meeting|homeowners'? association/i, /motion|approved|quorum|agenda/i],
    extract(t) {
      const flags = [['Special assessment', /special assessment/i], ['Major repair / project', /roof replacement|reserve study|siding|repaving|elevator|structural|balcon/i], ['Litigation', /lawsuit|litigation|attorney|court/i], ['Delinquent dues', /delinquen|past due|collections/i], ['Insurance increase', /insurance (premium )?(increase|renewal)|master policy/i]].filter(([, re]) => re.test(t)).map(([n]) => n);
      const d = latestDate(t);
      return { themen: flags, datum: dstr(d) };
    },
    check(v) { return v.themen.length ? [['warn', `Topics in the minutes: ${v.themen.join(', ')} – clarify the cost impact for the buyer.`]] : [['ok', 'No special assessment, major project or litigation detected.']]; } },
  { id: 'wirtschaftsplan', label: 'HOA budget / resale certificate', group: 'HOA / condo',
    sig: [/(annual )?budget|resale (certificate|disclosure)|estoppel|condo questionnaire/i, /(hoa|association|assessment|dues)/i, /reserve (fund|account|balance)|replacement reserve/i],
    extract(t) { return { hausgeld: amount(t, [/monthly (assessment|dues)/, /regular assessment/, /hoa dues/, /assessment/, /dues/], { min: 10, max: 5000 }), ruecklage: amount(t, [/reserve (fund|account) balance/, /reserve balance/, /reserves?/], { min: 0, max: 1e9 }), special: /special assessment/i.test(t) }; },
    check(v) {
      const out = [];
      if (v.ruecklage != null && v.ruecklage < 25000) out.push(['warn', 'Low reserve fund – risk of special assessments. Lenders review reserves for condo approval.']);
      if (v.special) out.push(['warn', 'Special assessment mentioned – ask who pays it (seller or buyer).']);
      return out;
    } },
  { id: 'miete', label: 'Lease agreement', group: 'Rental',
    sig: [/lease agreement|residential lease|rental agreement/i, /landlord|lessor/i, /tenant|lessee/i, /monthly rent|rent (shall be|is|amount)/i, /security deposit|term of (the )?lease/i],
    extract(t) { return { kaltmiete: amount(t, [/monthly rent/, /rent (?:shall be|is|amount)/, /base rent/, /rent/], { min: 100, max: 50000 }), staffel: /rent (shall )?increase|escalat/i.test(t), index: /\bcpi\b|consumer price index/i.test(t), deposit: amount(t, [/security deposit/], { min: 0, max: 100000 }), beginn: dstr(latestDate(t)) }; },
    check(v) { const o = []; if (v.index) o.push(['ok', 'CPI-based rent escalation clause.']); if (v.staffel) o.push(['ok', 'Scheduled rent increases agreed.']); if (!v.kaltmiete) o.push(['warn', 'Monthly rent not detected.']); if (v.deposit && v.kaltmiete && v.deposit > v.kaltmiete * 2) o.push(['warn', 'Security deposit above two months\' rent – many states cap deposits; check your state.']); return o; } },
  { id: 'kaufvertrag', label: 'Purchase agreement', group: 'Property',
    sig: [/purchase (and sale )?agreement|residential purchase contract|contract (of|for) sale|offer to purchase/i, /buyer/i, /seller/i, /purchase price/i, /earnest money|escrow|closing date|contingenc/i],
    extract(t) { return { kaufpreis: amount(t, [/purchase price (?:is|of|shall be)/, /purchase price/, /sales price/], { min: 10000, max: 5e8 }), inventar: amount(t, [/personal property/], { min: 100, max: 200000 }), earnest: amount(t, [/earnest money(?: deposit)?/], { min: 100, max: 5e7 }), inspectionDays: Number((/inspection (?:period|contingency)[^\n]{0,40}?(\d{1,2})\s*days/i.exec(t) || [])[1]) || null }; },
    check(v) { const o = v.kaufpreis ? [] : [['warn', 'Purchase price not detected.']]; if (v.inspectionDays) o.push(['ok', `Inspection period: ${v.inspectionDays} days – put the deadline in your calendar (/deadlines).`]); return o; } },
  { id: 'flaeche', label: 'Appraisal report', group: 'Property',
    sig: [/uniform residential appraisal report|appraisal report|form 1004|urar/i, /appraised value|market value|opinion of value/i, /gross living area|\bgla\b/i, /comparable|sales comparison/i],
    extract(t) { return { flaeche: amount(t, [/gross living area/, /\bgla\b/], { min: 200, max: 100000 }), appraised: amount(t, [/appraised value/, /opinion of (?:market )?value/, /market value/], { min: 10000, max: 5e8 }) }; },
    check(v) { const o = v.flaeche ? [] : [['warn', 'Gross living area not detected.']]; if (!v.appraised) o.push(['warn', 'Appraised value not detected.']); return o; } },
  { id: 'expose', label: 'Listing / MLS sheet', group: 'Property',
    sig: [/listing|mls|for sale/i, /list price|asking price|price/i, /sq\.? ?ft|square feet/i, /bed(room)?s?|bd\b/i, /year built/i, /hoa|taxes/i],
    extract(t) { return { kaufpreis: amount(t, [/list(?:ing)? price/, /asking price/, /price/], { min: 10000, max: 5e8 }), flaeche: amount(t, [/living area/, /square feet/, /sq\.? ?ft/], { min: 200, max: 100000 }), baujahr: Number((/year built\s*:?\s*(1[6-9]\d{2}|20\d{2})/i.exec(t) || [])[1]) || null }; },
    check() { return []; } },
  { id: 'selbstauskunft', label: 'Loan application (URLA 1003) / personal financial statement', group: 'Borrower',
    sig: [/uniform residential loan application|form 1003|\burla\b|personal financial statement/i, /borrower information|marital status|dependents/i, /employer|years (on|in) (this )?(job|line of work)/i, /liabilities|monthly payment|assets/i],
    extract(t) { return { kinder: Number((/dependents?\s*(?:\(number\))?\s*:?\s*(\d)/i.exec(t) || [])[1]) || null, verbindlichkeiten: amount(t, [/total monthly (?:payments|liabilities)/, /monthly debts/, /liabilities/], { min: 0, max: 100000 }) }; },
    check() { return []; } },
];

// Recognize a document. Returns { type, label, group, values, findings, confidence } or type 'unbekannt' (unknown).
export function analyseText(raw, name = '') {
  const t = norm(raw);
  if (t.replace(/\s/g, '').length < 40) return { type: 'scan', label: 'Not readable (scan/image)', group: '–', values: {}, findings: [['warn', 'No text in the PDF – probably a scan. Please request a digital copy or check the values manually.']], confidence: 0, name };
  const scored = TYPES.map((x) => ({ x, s: count(t, x.sig) + (new RegExp(x.label.split(/[ /(]/)[0], 'i').test(name) ? 1 : 0) })).sort((a, b) => b.s - a.s);
  const best = scored[0];
  if (!best || best.s < 2) return { type: 'unbekannt', label: 'Not identified', group: '–', values: {}, findings: [['warn', 'Document type not recognized – please assign it manually.']], confidence: 0, name };
  const values = best.x.extract(t);
  const findings = best.x.check(values);
  return { type: best.x.id, label: best.x.label, group: best.x.group, values, findings, confidence: Math.min(1, best.s / best.x.sig.length), name };
}

// Missing documents for a case profile (selbststaendig = self-employed, etw = condo/HOA, vermietet = rented).
export function missingDocs(types, { selbststaendig = false, etw = false, vermietet = false } = {}) {
  const set = new Set(types);
  const need = [];
  if (selbststaendig) need.push(['steuerbescheid', 'Federal tax returns (last 2 years)'], ['bwa', 'Year-to-date profit & loss / 1099s']);
  else need.push(['gehalt', 'Pay stubs (last 30 days)'], ['w2', 'W-2s (last 2 years)']);
  need.push(['konto', 'Bank statements (last 2 months)'], ['grundbuch', 'Title commitment'], ['energie', 'Home inspection report'], ['flaeche', 'Appraisal report'], ['kaufvertrag', 'Purchase agreement']);
  if (etw) need.push(['teilung', 'CC&Rs / condo declaration'], ['protokoll', 'HOA meeting minutes'], ['wirtschaftsplan', 'HOA budget / resale certificate']);
  if (vermietet) need.push(['miete', 'Lease agreement(s)']);
  return need.filter(([k]) => !set.has(k)).map(([, l]) => l);
}

// Merge all recognized documents into one case summary. Keys are kept for callers:
// nettoMonat = average net pay per pay stub, bruttoMonat = average gross pay, flaeche = sq ft, klasse = always null (no energy label in the US).
export function caseFacts(docs) {
  const by = (id) => docs.filter((d) => d.type === id);
  const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const netto = avg(by('gehalt').map((d) => d.values.netto).filter((x) => x > 0));
  const brutto = avg(by('gehalt').map((d) => d.values.brutto).filter((x) => x > 0));
  const kauf = by('kaufvertrag').map((d) => d.values.kaufpreis).find(Boolean) || by('expose').map((d) => d.values.kaufpreis).find(Boolean) || null;
  const flaeche = by('flaeche').map((d) => d.values.flaeche).find(Boolean) || by('expose').map((d) => d.values.flaeche).find(Boolean) || null;
  const ek = by('konto').map((d) => d.values.saldo).filter((x) => x > 0).reduce((a, b) => a + b, 0) || null;
  return {
    nettoMonat: netto, bruttoMonat: brutto, gehaltsMonate: by('gehalt').length, kaufpreis: kauf, flaeche, eigenkapital: ek,
    appraised: by('flaeche').map((d) => d.values.appraised).find(Boolean) || null,
    hausgeld: by('wirtschaftsplan').map((d) => d.values.hausgeld).find(Boolean) || null,
    kaltmiete: by('miete').map((d) => d.values.kaltmiete).find(Boolean) || null,
    klasse: null, lasten: by('grundbuch').flatMap((d) => d.values.lasten),
    inspection: by('energie').flatMap((d) => d.values.issues || []),
    baujahr: by('expose').map((d) => d.values.baujahr).find(Boolean) || null,
    etw: by('teilung').length > 0 || by('wirtschaftsplan').length > 0 || by('protokoll').length > 0,
    selbststaendig: by('bwa').length > 0 || (by('steuerbescheid').length > 0 && !by('gehalt').length),
    vermietet: by('miete').length > 0,
  };
}

// Cross-check between documents: values that appear in several documents are compared.
// Returns the sources per field (document type and file name) and whether they differ.
// Tolerance: price 0.5%, square feet 3% (rounding in listings). Only real finds, nothing estimated.
const XCHECK = [
  { key: 'kaufpreis', label: 'Purchase price', unit: '$', tol: 0.005, from: ['kaufvertrag', 'expose'] },
  { key: 'flaeche', label: 'Square feet', unit: 'sq ft', tol: 0.03, from: ['flaeche', 'expose'] },
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
// Recognition quality from the confidence of the document type match (0–1): 'high' | 'medium' | 'low'.
export const quality = (c) => (c == null ? null : c >= 0.75 ? 'high' : c >= 0.5 ? 'medium' : 'low');
