import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { testKeyMode } from '@/lib/billing/stripe';
import { TESTKAUF_KEY, testkaufState } from '@/lib/billing/testmode';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → System → „Testkauf jetzt möglich“: ein Schalter statt eigenem Reiter.
// An: Käufe von Administratoren laufen über den Stripe-Testmodus (Testkarte). Aus: alles live und voll geprüft.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  return j({ ...(await testkaufState()), available: Boolean(testKeyMode()) });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'finance');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = z.object({ on: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  if (p.data.on && !testKeyMode()) return j({ error: 'Kein Stripe-Testschlüssel hinterlegt (STRIPE_TEST_SECRET_KEY in Vercel).' }, 409);
  const value = { on: p.data.on, by: auth.user.email, at: new Date().toISOString() };
  const r = await supabaseAdmin().from('lr_settings').upsert({ key: TESTKAUF_KEY, value, updated_at: value.at, updated_by: auth.user.email });
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  await adminAudit(auth.user.email, p.data.on ? 'testkauf_on' : 'testkauf_off', null, {});
  return j({ ok: true, ...value });
}
