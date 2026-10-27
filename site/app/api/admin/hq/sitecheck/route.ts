import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminConfigured } from '@/lib/supabase/admin';
import { saveSiteCheck } from '@/lib/admin/optimizer';
import { cronAuthOk } from '@/lib/security/github-oidc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

// Ergebnis der automatischen Darstellungsprüfung (GitHub-Lauf mit scripts/site-check.mjs) entgegennehmen.
// Die Befunde erscheinen bei Agent Noah im Headquarters.
const Finding = z.object({ id: z.string().max(300), path: z.string().max(300), view: z.string().max(30).optional(), kind: z.string().max(40), level: z.enum(['hoch', 'mittel', 'niedrig']), detail: z.string().max(600), fix: z.string().max(300).optional() });
const Body = z.object({ at: z.string().max(40), base: z.string().max(200), pages: z.number().int().min(0).max(5000), views: z.array(z.string().max(30)).max(5), findings: z.array(Finding).max(200) });

// Anmeldung: siehe lib/security/github-oidc.ts (GitHub-Ausweis für den Zweck „leaserun-sitecheck“ oder SITECHECK_TOKEN).
export async function POST(req: Request) {
  const auth = await cronAuthOk(req, 'leaserun-sitecheck', [process.env.SITECHECK_TOKEN]);
  if (!auth.ok) return j({ error: 'Nicht berechtigt.', grund: auth.why }, 401);
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Daten.' }, 400);
  await saveSiteCheck(p.data);
  return j({ ok: true, findings: p.data.findings.length });
}
