import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { generateMonthlyTaxArchive } from '@/lib/b2b/taxarchive';
import type { Kontenrahmen } from '@/lib/b2b/datev';
import { storeExport } from '@/lib/storage/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Monatsarchiv für die Steuerkanzlei als ZIP-Download.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const u = new URL(req.url);
  const monat = u.searchParams.get('monat') || '';
  if (u.searchParams.get('info') === '1') {
    return j({ advisorEmail: process.env.TAX_ADVISOR_EMAIL || null, workday: Number(process.env.TAX_DISPATCH_WORKDAY || 3), skr: process.env.TAX_SKR === 'SKR04' ? 'SKR04' : 'SKR03', mail: Boolean(process.env.RESEND_API_KEY), cron: Boolean(process.env.CRON_SECRET) });
  }
  const skr = (u.searchParams.get('skr') === 'SKR04' ? 'SKR04' : 'SKR03') as Kontenrahmen;
  try {
    const withDatev = u.searchParams.get('datev') !== '0';
    const a = await generateMonthlyTaxArchive(monat, skr, withDatev);
    await adminAudit(auth.user.email, 'datev_export', monat, { skr, count: a.count, problems: a.problems.length });
    const url = await storeExport('datev', `ImmoAdv_Rechnungen_${monat}.zip`, a.zip, 'application/zip');
    return j({ url, count: a.count, problems: a.problems });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : 'Fehler' }, 400);
  }
}
