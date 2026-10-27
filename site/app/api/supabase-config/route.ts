import { NextResponse } from 'next/server';
import { directProviders } from '@/lib/auth/sso';

// Liefert nur die öffentliche (publishable/anon) Konfiguration an den Browser.
// Zusätzlich: welche Express-Anmeldungen (Apple, Google, Microsoft) in Supabase aktiv sind – serverseitig
// ermittelt und kurz zwischengespeichert, damit die Knöpfe nicht von einer einzelnen Browser-Anfrage abhängen
// (z. B. direkt nach dem Abmelden auf dem Handy).
let ssoCache: { at: number; list: string[] } | null = null;

async function ssoProviders(url: string, key: string): Promise<string[] | null> {
  if (ssoCache && Date.now() - ssoCache.at < 5 * 60 * 1000) return ssoCache.list;
  try {
    const r = await fetch(url + '/auth/v1/settings', { headers: { apikey: key }, cache: 'no-store', signal: AbortSignal.timeout(1500) });
    if (!r.ok) return ssoCache?.list ?? null;
    const st = await r.json();
    const list = ['apple', 'google', 'azure'].filter((p) => st?.external?.[p] === true);
    ssoCache = { at: Date.now(), list };
    return list;
  } catch {
    return ssoCache?.list ?? null;
  }
}

export async function GET() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Supabase ist noch nicht konfiguriert.' }, { status: 503 });
  const sso = await ssoProviders(url, key);
  // direct: Anbieter, die über die eigene Adresse laufen (Anzeige „weiter zu leaserun.com“ statt Supabase).
  return NextResponse.json({ url, key, ...(sso ? { sso } : {}), direct: directProviders() }, { headers: { 'cache-control': 'no-store' } });
}
