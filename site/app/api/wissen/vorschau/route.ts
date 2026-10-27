import { NextResponse } from 'next/server';
import { loadGate } from '@/lib/gate/config';
import { DETAILS, leseproben } from '@/lib/wissen/preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Öffentliche Leseproben der Wissenszentrale (Anzahl im Web-Admin einstellbar). Ist die Wissenszentrale im Web-Admin
// auf „offen“ gestellt, gibt es hier alle Antworten vollständig – sonst nur den ersten Satz der Leseproben.
export async function GET() {
  const g = await loadGate();
  const body = g.wissen === 'offen' ? { open: true, entries: DETAILS.map(({ q, l1, next, l2 }) => ({ q, l1, next, l2 })) } : { open: false, entries: leseproben(g.leseproben) };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=120', 'X-Robots-Tag': 'noindex' } });
}
