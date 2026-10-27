// US address check for forms (billing address, company details): ZIP code format (12345 or 12345-6789), ZIP must exist,
// city and state must match the ZIP, street needs a house number. ZIP lookup uses the free Zippopotam.us service (ZIP only,
// no personal data, no key). If the service is unreachable, nothing is blocked (unavailable = true); an offline ZIP-prefix
// table still checks that the ZIP belongs to the chosen state. Street names are not verified (no free official USPS street
// list without an account), so streetOk is always null.
// Field names (plzValid, postalCode) are kept for compatibility with existing callers.
const BASE = 'https://api.zippopotam.us/us/';
const cache = new Map<string, { until: number; v: unknown }>();

export const STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
};

// First three ZIP digits → state (USPS sectional centers). [from, to, state]; a few prefixes overlap borders, so this is only
// used as an offline plausibility check.
const ZIP3: [number, number, string][] = [
  [5, 5, 'NY'], [6, 7, 'PR'], [8, 8, 'VI'], [9, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 54, 'VT'],
  [55, 55, 'MA'], [56, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 200, 'DC'],
  [201, 201, 'VA'], [202, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'],
  [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'],
  [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [569, 569, 'DC'],
  [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 715, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'],
  [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'], [885, 885, 'TX'], [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'],
  [969, 969, 'GU'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
];
export function stateOfZip(zip: string): string | null {
  const m = /^(\d{3})\d{2}(?:-\d{4})?$/.exec(String(zip || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  return ZIP3.find(([a, b]) => n >= a && n <= b)?.[2] ?? null;
}

// Normalize spellings for comparison: case, punctuation and common USPS street suffix abbreviations.
const SUFFIX: Record<string, string> = { street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', court: 'ct', boulevard: 'blvd', place: 'pl', terrace: 'ter', circle: 'cir', parkway: 'pkwy', highway: 'hwy', north: 'n', south: 's', east: 'e', west: 'w', saint: 'st', mount: 'mt', fort: 'ft' };
export const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean).map((w) => SUFFIX[w] || w).join('');

async function get<T>(path: string): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.v as T;
  const r = await fetch(BASE + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (r.status === 404) { cache.set(path, { until: Date.now() + 24 * 3600_000, v: null }); return null; }
  if (!r.ok) throw new Error(`zip lookup ${r.status}`);
  const v = (await r.json()) as T;
  cache.set(path, { until: Date.now() + 24 * 3600_000, v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return v;
}

// US street line: house number first ("123 Main St", "1600-B Oak Ave", "W123 N456 Elm Rd"), unit optional.
export function splitStreet(s: string): { name: string; no: string } {
  const t = String(s || '').trim();
  const m = /^([A-Za-z]?\d+[A-Za-z]?(?:[-/]\d*[A-Za-z]?)?(?:\s+[NSEW]\d+)?)\s+(.+)$/.exec(t);
  return m ? { name: m[2].trim(), no: m[1] } : { name: t, no: '' };
}

export type AddressCheck = {
  unavailable: boolean; plzValid: boolean; cities: string[]; state: string | null; stateOk: boolean; cityOk: boolean; streetOk: boolean | null; houseNumber: boolean;
  suggestions: string[]; message: string | null;
};

type ZipResp = { places?: { 'place name': string; 'state abbreviation': string }[] };

export async function checkAddress({ postalCode, city, street, state }: { postalCode: string; city?: string; street?: string; state?: string }): Promise<AddressCheck> {
  const zip = String(postalCode || '').trim();
  const st = String(state || '').trim().toUpperCase();
  const out: AddressCheck = { unavailable: false, plzValid: false, cities: [], state: null, stateOk: true, cityOk: false, streetOk: null, houseNumber: false, suggestions: [], message: null };
  if (!/^\d{5}(-\d{4})?$/.test(zip)) { out.message = 'Please enter a 5-digit ZIP code (or ZIP+4).'; return out; }
  out.houseNumber = Boolean(splitStreet(street || '').no);
  const offline = stateOfZip(zip);
  try {
    const r = await get<ZipResp>(zip.slice(0, 5));
    const places = r?.places || [];
    out.cities = [...new Set(places.map((p) => p['place name']))];
    out.state = places[0]?.['state abbreviation'] || offline;
    out.plzValid = out.cities.length > 0;
    if (!out.plzValid) { out.message = `ZIP code ${zip} does not exist.`; return out; }
  } catch {
    out.unavailable = true; out.plzValid = Boolean(offline); out.cityOk = true; out.state = offline;
    out.stateOk = !st || !offline || offline === st;
    out.message = !offline ? `ZIP code ${zip} does not exist.` : !out.stateOk ? `ZIP code ${zip} belongs to ${STATES[offline] || offline}.` : null;
    return out;
  }
  out.stateOk = !st || !out.state || out.state === st;
  // ZIP codes often cover several place names; accept the USPS default name or any listed place.
  out.cityOk = !city || out.cities.some((c) => norm(c) === norm(city) || norm(c).startsWith(norm(city)) || norm(city).startsWith(norm(c)));
  out.message = !out.stateOk ? `ZIP code ${zip} belongs to ${STATES[out.state!] || out.state}.`
    : !out.cityOk ? `ZIP code ${zip} belongs to: ${out.cities.join(', ')}.`
    : !out.houseNumber && street ? 'Please add the house number (e.g. 123 Main St).' : null;
  return out;
}

// Server-side check before saving. confirmed = the customer explicitly confirmed a city name not listed for the ZIP.
export async function addressError(a: { postalCode: string; city: string; street: string; state?: string }, confirmed = false): Promise<string | null> {
  const r = await checkAddress(a);
  if (!r.plzValid) return r.message || 'Unknown ZIP code.';
  if (!r.stateOk) return r.message || 'ZIP code and state do not match.';
  if (r.unavailable) return null;
  if (!r.cityOk && !confirmed) return `City does not match ZIP code ${a.postalCode} (${r.cities.join(', ')}). Please check or confirm.`;
  if (!r.houseNumber) return 'Please add the house number.';
  return null;
}
export const confirmedFlag = (v: unknown) => v === true || v === 'on' || v === 'true';
