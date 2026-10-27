import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// LeaseRun OS: Statusleiste, App-Zähler und „Prüfen & korrigieren“ (regelbasiert, ohne KI).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const { runOsChecks } = await import('@/lib/admin/os-checks');
  try { return j(await runOsChecks({ fix: false, origin: new URL(req.url).origin })); } catch (e) { return j({ error: e instanceof Error ? e.message : 'Fehler' }, 500); }
}

export async function POST(req: Request) {
  const a = await requireAdmin(req); if (a instanceof NextResponse) return a;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const { runOsChecks } = await import('@/lib/admin/os-checks');
  const { adminAudit } = await import('@/lib/b2b/core');
  try {
    const r = await runOsChecks({ fix: true, origin: new URL(req.url).origin });
    await adminAudit(a.user.email, 'os_check_fix', null, { fixes: r.fixes.filter((f) => f.at === r.at).length });
    return j(r);
  } catch (e) { return j({ error: e instanceof Error ? e.message : 'Fehler' }, 500); }
}
