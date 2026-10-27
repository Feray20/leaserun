import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { adminScope } from '@/lib/admin/scope';
import { B2C_FEATURES, cleanFeatures, FEATURE_KEYS } from '@/lib/billing/features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin (Bereich B2C): Zugriff eines Privatkontos manuell freischalten – unabhängig vom bezahlten Tarif.
// Stufe „starter“ = alle Kauf-Werkzeuge wie Käufer-Pass, „pro“ = alle Werkzeuge wie Investor Pro, „free“ = nur Einzelfreigaben.
// Einzelfreigaben (features): jede Funktion ausdrücklich an („on“) oder aus („off“), sonst gilt die Stufe.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Id = z.string().uuid();

async function guard(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return { err: auth };
  if (!adminConfigured()) return { err: j({ error: 'Nicht konfiguriert.' }, 503) };
  if (adminScope(req) && adminScope(req) !== 'b2c') return { err: j({ error: 'Freischaltungen für Privatkonten gibt es im Bereich B2C.' }, 403) };
  return { auth };
}

export async function GET(req: Request) {
  const g = await guard(req); if (g.err) return g.err;
  const id = Id.safeParse(new URL(req.url).searchParams.get('user'));
  const db = supabaseAdmin();
  if (id.success) {
    const { data } = await db.from('lr_access_grants').select('*').eq('user_id', id.data).maybeSingle();
    return j({ grant: data ?? null, catalog: B2C_FEATURES });
  }
  const { data } = await db.from('lr_access_grants').select('user_id, tier, credit_maps, leitfaden, valid_until, note, granted_by, updated_at, features').order('updated_at', { ascending: false }).limit(500);
  return j({ grants: data ?? [] });
}

const Set = z.object({
  user: z.string().uuid(),
  tier: z.enum(['free', 'starter', 'pro']),
  features: z.record(z.enum(FEATURE_KEYS as [string, ...string[]]), z.enum(['auto', 'on', 'off'])).optional(),
  creditMaps: z.number().int().min(0).max(1000).default(0),
  leitfaden: z.boolean().default(false),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function POST(req: Request) {
  const g = await guard(req); if (g.err) return g.err;
  const p = Set.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Ungültig.' }, 400);
  const d = p.data, db = supabaseAdmin();
  const { data: u } = await db.auth.admin.getUserById(d.user);
  if (!u?.user) return j({ error: 'Konto nicht gefunden.' }, 404);
  const { data: mem } = await db.from('lr_b2b_members').select('user_id').eq('user_id', d.user).maybeSingle();
  if (mem) return j({ error: 'Das ist ein Unternehmenskonto – Tarife für Unternehmen im Bereich B2B unter „Partner“ vergeben.' }, 409);
  const row = { user_id: d.user, tier: d.tier, credit_maps: d.creditMaps, leitfaden: d.leitfaden, valid_until: d.validUntil ? `${d.validUntil}T23:59:59+01:00` : null, note: d.note || null, features: cleanFeatures(d.features), granted_by: g.auth!.user.email, updated_at: new Date().toISOString() };
  const r = await db.from('lr_access_grants').upsert(row);
  if (r.error) return j({ error: r.error.message }, 500);
  await adminAudit(g.auth!.user.email, 'access_grant', d.user, { tier: d.tier, credits: d.creditMaps, bis: d.validUntil || 'unbefristet', features: cleanFeatures(d.features) });
  return j({ ok: true, grant: row });
}

export async function DELETE(req: Request) {
  const g = await guard(req); if (g.err) return g.err;
  const id = Id.safeParse(new URL(req.url).searchParams.get('user'));
  if (!id.success) return j({ error: 'Ungültig.' }, 400);
  const r = await supabaseAdmin().from('lr_access_grants').delete().eq('user_id', id.data);
  if (r.error) return j({ error: r.error.message }, 500);
  await adminAudit(g.auth!.user.email, 'access_revoke', id.data, {});
  return j({ ok: true });
}
