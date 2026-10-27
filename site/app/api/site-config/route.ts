import { NextResponse } from 'next/server';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { loadGate } from '@/lib/gate/config';

// Öffentliche Einstellungen für alle Seiten: Google Analytics 4 (nur die Mess-ID, wenn im Web-Admin eingeschaltet)
// und welche Bereiche ohne Zugang nur als Vorschau laufen (Web-Admin → Freischaltung).
// Geladen wird Google Analytics erst nach ausdrücklicher Einwilligung im Banner (§ 25 TDDDG).
export const dynamic = 'force-dynamic';
let memo: { v: { ga: string | null; gate: { wissen: string; rechner: string; beispiele: string } }; t: number } | null = null;
// Ausfallsicher: Kommt die Datenbank nicht rechtzeitig, gilt der letzte bekannte Stand (oder die Standardwerte) –
// die Seite meldet nie einen Fehler, nur weil diese Einstellungen gerade nicht frisch abrufbar sind.
const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Zeitlimit')), ms))]);
export async function GET() {
  if (!memo || Date.now() - memo.t > 60_000) {
    try {
      let ga: string | null = null;
      if (adminConfigured()) {
        const { data } = await within(Promise.resolve(supabaseAdmin().from('lr_settings').select('value').eq('key', 'ga4').maybeSingle()), 3000);
        const v = (data?.value || {}) as { id?: string; on?: boolean };
        ga = v.on && typeof v.id === 'string' && /^G-[A-Z0-9]{4,14}$/.test(v.id) ? v.id : null;
      }
      const g = await within(loadGate(), 3000);
      memo = { v: { ga, gate: { wissen: g.wissen, rechner: g.rechner, beispiele: g.beispiele } }, t: Date.now() };
    } catch (e) {
      console.warn('site_config', (e as Error).message);
      if (!memo) return NextResponse.json({ ga: null }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' } });
    }
  }
  return NextResponse.json(memo!.v, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' } });
}
