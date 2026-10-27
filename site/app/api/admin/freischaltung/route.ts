import '@/lib/env-alias';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { loadGate, saveGate } from '@/lib/gate/config';
import { leseproben } from '@/lib/wissen/preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Web-Admin → Freischaltung: was Besucher ohne Zugang sehen (Vorschau) und was für alle offen ist.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const g = await loadGate();
  return j({ config: g, leseproben: leseproben(g.leseproben).map((x) => x.q) });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const body = await req.json().catch(() => null);
  const g = await saveGate(body, auth.user.email);
  await adminAudit(auth.user.email, 'gate_save', null, g);
  return j({ ok: true, config: g, leseproben: leseproben(g.leseproben).map((x) => x.q) });
}
