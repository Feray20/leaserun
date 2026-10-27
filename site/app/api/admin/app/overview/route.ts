import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { buildOverview } from '@/lib/admin/app-overview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Admin-App „Control Center“: Status, Kennzahlen, Aufmerksamkeit, Hinweise und letzte Aktivität in einer Antwort.
// Jede Rolle darf abrufen; der Inhalt richtet sich nach den Bereichen der Rolle (siehe lib/admin/app-overview.ts).
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'stats');
  if (auth instanceof NextResponse) return auth;
  try {
    return NextResponse.json(await buildOverview(auth.role), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.warn('app_overview', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Systemstatus konnte gerade nicht geladen werden.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
