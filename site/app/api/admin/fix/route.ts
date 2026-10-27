import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { analyse, applyFixes } from '@/lib/admin/fixer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Headquarters → „Prüfen & erledigen“ (einzige Prüfstelle im Web-Admin) / „Alles erledigen“ (Logik in lib/admin/fixer.ts, auch von den HQ-Mitarbeitern genutzt).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// „Ablehnen“: Feray will einen Punkt nicht – er verschwindet 7 Tage aus der Liste (gespeichert, nichts wird gelöscht).
const DIS_KEY = 'ck_dismissed', D7 = 7 * 864e5;
async function dismissed(): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', DIS_KEY).maybeSingle();
  const v = { ...((data?.value as Record<string, number>) || {}) }; for (const [k, t] of Object.entries(v)) if (Date.now() - t > D7) delete v[k]; return v;
}
const visible = <T extends { id: string }>(f: T[], dis: Record<string, number>) => f.filter((x) => !dis[x.id]);

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  try { const u = new URL(req.url); const [{ findings, checkedAt }, dis] = await Promise.all([analyse({ origin: u.origin, fresh: u.searchParams.get('fresh') === '1' }), dismissed()]); return j({ findings: visible(findings, dis), checkedAt }); }
  catch (e) { console.warn('admin_fix_check', (e as Error).message); return j({ error: 'Prüfung gerade nicht möglich.' }, 502); }
}

const Body = z.object({ ids: z.array(z.string().max(40)).max(30).optional(), all: z.boolean().optional(), dismiss: z.string().max(40).optional() });
export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  if (p.data.dismiss) {
    const dis = await dismissed(); dis[p.data.dismiss] = Date.now();
    await supabaseAdmin().from('lr_settings').upsert({ key: DIS_KEY, value: dis, updated_at: new Date().toISOString(), updated_by: 'admin' });
    await adminAudit(auth.user.email, 'check_dismiss', null, { id: p.data.dismiss });
    const { findings, checkedAt } = await analyse({ origin: new URL(req.url).origin });
    return j({ results: [], findings: visible(findings, dis), checkedAt });
  }
  try { const [r, dis] = await Promise.all([applyFixes(auth.user.email, { ...p.data, origin: new URL(req.url).origin }), dismissed()]); return j({ ...r, findings: visible(r.findings, dis) }); }
  catch (e) { console.warn('admin_fix_apply', (e as Error).message); return j({ error: 'Erledigen gerade nicht möglich.' }, 502); }
}
