import { NextResponse } from 'next/server';

// Ungefährer Standort für Rechner (nur Komfort, kein SEO): Vercel leitet aus der IP-Adresse der Anfrage Land, Region
// und Stadt ab und reicht sie als Kopfzeilen weiter. Hier wird daraus nur das Bundesland (für die Grunderwerbsteuer)
// und der Ortsname zur Anzeige gemacht. Nichts wird gespeichert oder protokolliert, kein fremder Dienst wird angefragt.
// Ohne Angaben (Ausland, VPN, lokale Entwicklung) liefert die Schnittstelle null – die Rechner funktionieren unverändert.
export const dynamic = 'force-dynamic';

const REGION: Record<string, string> = {
  BW: 'baden-wuerttemberg', BY: 'bayern', BE: 'berlin', BB: 'brandenburg', HB: 'bremen', HH: 'hamburg', HE: 'hessen',
  MV: 'mecklenburg-vorpommern', NI: 'niedersachsen', NW: 'nordrhein-westfalen', RP: 'rheinland-pfalz', SL: 'saarland',
  SN: 'sachsen', ST: 'sachsen-anhalt', SH: 'schleswig-holstein', TH: 'thueringen',
};

export function GET(req: Request) {
  const h = req.headers;
  const country = (h.get('x-vercel-ip-country') || '').toUpperCase();
  const code = (h.get('x-vercel-ip-country-region') || '').toUpperCase().replace(/^DE-/, '');
  let city: string | null = null;
  try { city = decodeURIComponent(h.get('x-vercel-ip-city') || '') || null; } catch { city = null; }
  // Nur Buchstaben, Leerzeichen, Bindestriche und Punkte; begrenzte Länge – die Anzeige erfolgt zusätzlich als Text.
  if (city && !/^[\p{L} .'-]{2,60}$/u.test(city)) city = null;
  const land = country === 'DE' ? REGION[code] || null : null;
  return NextResponse.json({ land, city: land ? city : null }, { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
}
