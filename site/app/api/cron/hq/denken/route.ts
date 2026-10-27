import { NextResponse } from 'next/server';
import { adminConfigured } from '@/lib/supabase/admin';
import { panicLevel, panicState } from '@/lib/security/panic';
import { cronAuthOk } from '@/lib/security/github-oidc';
import { runAnalyses, runDaily } from '@/lib/admin/hq-shift';
import { runReviewBatch } from '@/lib/admin/hq-think';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Headquarters · Denken. Eigener Lauf (Supabase pg_cron „hq-denken“, alle 5 Min., versetzt zur Wache), damit Claude die volle
// Zeit hat: zuerst neue wichtige Funde analysieren und beheben (einer je Lauf), sonst ein Schritt der Tagesrunde.
// Kosten hält gate() im Rahmen; ohne Arbeit endet der Lauf sofort.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
async function run(req: Request) {
  const auth = await cronAuthOk(req, 'leaserun-hq', [process.env.CRON_SECRET, process.env.HQ_CRON_TOKEN]);
  if (!auth.ok) return j({ error: 'Nicht berechtigt.', grund: auth.why }, 401);
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  if (panicLevel(await panicState().catch(() => ({ active: false }))) === 2) return j({ skipped: 'panic' });
  const origin = process.env.PUBLIC_SITE_URL || 'https://leaserun.com';
  const t0 = Date.now();
  // Laufende Entwurfs-Überarbeitung hat Vorrang (Feray hat sie angestoßen).
  const review = await runReviewBatch('wache', origin, t0 + 105_000).catch(() => null);
  if (review && review.done > 0) return j({ ok: true, ms: Date.now() - t0, review });
  const analysed = await runAnalyses('wache', origin, 1).catch((e) => ({ done: [] as string[], skipped: (e as Error).message }));
  const daily = analysed.done.length ? { done: [], skipped: 'nach Analyse' } : await runDaily('wache', origin, 1).catch((e) => ({ done: [] as string[], skipped: (e as Error).message }));
  return j({ ok: true, ms: Date.now() - t0, analysed, daily });
}
export const GET = run;
export const POST = run;
