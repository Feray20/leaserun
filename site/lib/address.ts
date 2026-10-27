// Adressprüfung für Deutschland (ähnlich USPS): PLZ muss existieren, Ort muss zur PLZ passen, Straße wird gegen das
// amtliche Straßenverzeichnis geprüft (OpenPLZ API, offene Daten der Länder, ohne Schlüssel). Hausnummer ist Pflicht.
// Ist der Dienst nicht erreichbar, wird nicht blockiert (unavailable = true) – die Formatprüfung gilt weiterhin.
const BASE = 'https://openplzapi.org/de';
const cache = new Map<string, { until: number; v: unknown }>();
const rx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const norm = (s: string) => String(s || '').toLowerCase().normalize('NFC')
  .replace(/ß/g, 'ss').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/\bstr\.?(?=\s|$)/g, 'strasse').replace(/strasse\b/g, 'str').replace(/[^a-z0-9]+/g, '');

async function get<T>(path: string): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && hit.until > Date.now()) return hit.v as T;
  const r = await fetch(BASE + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`openplz ${r.status}`);
  const v = (await r.json()) as T;
  cache.set(path, { until: Date.now() + 24 * 3600_000, v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return v;
}

export function splitStreet(s: string): { name: string; no: string } {
  const m = /^(.*?)[\s,]*(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)\s*$/.exec(String(s || '').trim());
  return m ? { name: m[1].trim(), no: m[2].replace(/\s+/g, '') } : { name: String(s || '').trim(), no: '' };
}

export type AddressCheck = {
  unavailable: boolean; plzValid: boolean; cities: string[]; cityOk: boolean; streetOk: boolean | null; houseNumber: boolean;
  suggestions: string[]; message: string | null;
};

export async function checkAddress({ postalCode, city, street }: { postalCode: string; city?: string; street?: string }): Promise<AddressCheck> {
  const plz = String(postalCode || '').trim();
  const out: AddressCheck = { unavailable: false, plzValid: false, cities: [], cityOk: false, streetOk: null, houseNumber: false, suggestions: [], message: null };
  if (!/^\d{5}$/.test(plz)) { out.message = 'Bitte eine fünfstellige Postleitzahl angeben.'; return out; }
  const st = splitStreet(street || '');
  out.houseNumber = Boolean(st.no);
  try {
    const locs = (await get<{ name: string }[]>(`/Localities?postalCode=${encodeURIComponent(`^${plz}$`)}&pageSize=50`)) || [];
    out.cities = [...new Set(locs.map((l) => l.name))];
    out.plzValid = out.cities.length > 0;
    if (!out.plzValid) { out.message = `Die Postleitzahl ${plz} gibt es nicht.`; return out; }
    out.cityOk = !city || out.cities.some((c) => norm(c) === norm(city) || norm(c).startsWith(norm(city)) || norm(city).startsWith(norm(c)));
    if (st.name.length >= 3) {
      const exact = (await get<{ name: string }[]>(`/Streets?name=${encodeURIComponent(`^${rx(st.name)}$`)}&postalCode=${encodeURIComponent(`^${plz}$`)}&pageSize=5`)) || [];
      out.streetOk = exact.length > 0;
      if (!out.streetOk) {
        // Schreibweisen (Str./Straße, Umlaute) tolerieren und Vorschläge mit gleichem Anfang liefern.
        const base = st.name.replace(/[-\s]*(str\.?|strasse|straße)$/i, '');
        const prefix = base.slice(0, Math.max(3, Math.min(12, base.length)));
        const pre = (await get<{ name: string }[]>(`/Streets?name=${encodeURIComponent(`^${rx(prefix)}`)}&postalCode=${encodeURIComponent(`^${plz}$`)}&pageSize=50`)) || [];
        const names = [...new Set(pre.map((s) => s.name))];
        const same = names.find((n) => norm(n) === norm(st.name));
        if (same) out.streetOk = true;
        else out.suggestions = names.sort((a, b) => sim(b, st.name) - sim(a, st.name)).slice(0, 5);
      }
    }
  } catch { out.unavailable = true; out.plzValid = true; out.cityOk = true; return out; }
  out.message = !out.cityOk ? `Zur PLZ ${plz} gehört: ${out.cities.join(', ')}.` : out.streetOk === false ? 'Diese Straße ist unter der PLZ nicht verzeichnet. Bitte prüfen.' : !out.houseNumber ? 'Bitte die Hausnummer angeben.' : null;
  return out;
}

// Einfaches Ähnlichkeitsmaß (gemeinsame Bigramme) für Vorschläge.
function sim(a: string, b: string): number {
  const g = (s: string) => { const t = norm(s); const r = new Set<string>(); for (let i = 0; i < t.length - 1; i++) r.add(t.slice(i, i + 2)); return r; };
  const A = g(a), B = g(b); let n = 0; A.forEach((x) => { if (B.has(x)) n++; });
  return (2 * n) / (A.size + B.size || 1);
}

// Serverseitige Prüfung vor dem Speichern. confirmed = Kunde hat eine nicht verzeichnete Straße ausdrücklich bestätigt.
export async function addressError(a: { postalCode: string; city: string; street: string }, confirmed = false): Promise<string | null> {
  const r = await checkAddress(a);
  if (r.unavailable) return null;
  if (!r.plzValid) return r.message || 'Postleitzahl unbekannt.';
  if (!r.cityOk) return `Ort passt nicht zur PLZ ${a.postalCode} (${r.cities.join(', ')}).`;
  if (!r.houseNumber) return 'Bitte die Hausnummer angeben.';
  if (r.streetOk === false && !confirmed) return 'Diese Straße ist unter der PLZ nicht verzeichnet. Bitte prüfen oder ausdrücklich bestätigen.';
  return null;
}
export const confirmedFlag = (v: unknown) => v === true || v === 'on' || v === 'true';
