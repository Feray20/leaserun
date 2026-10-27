import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit, j, rangeOf, requireCreatorAdmin, UUID_RE } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Attribution und Conversions eines Creators (für Finance/Creator-Management). Kunden erscheinen nur als gekürzte Kennung.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return j({ error: 'Nicht gefunden.' }, 404);
  const a = await requireCreatorAdmin(req, 'conversions.read', id);
  if (!('role' in a)) return a;
  const r = rangeOf(new URL(req.url).searchParams.get('range'));
  const db = supabaseAdmin();
  const [perf, conv] = await Promise.all([
    db.rpc('lr_creator_performance', { p_creator: id, p_from: r.from.toISOString(), p_to: r.to.toISOString() }),
    db.from('lr_creator_conversions').select('id, user_id, campaign_slug, source, plan, currency, amount_net_cents, status, occurred_at, reversed_at').eq('creator_id', id).gte('occurred_at', r.from.toISOString()).lt('occurred_at', r.to.toISOString()).order('occurred_at', { ascending: false }).limit(500),
  ]);
  return j({
    range: r.key, performance: perf.data ?? null,
    conversions: ((conv.data ?? []) as { user_id: string | null }[]).map(({ user_id, ...x }) => ({ ...x, customer: user_id ? `K-${user_id.slice(0, 8)}` : 'gelöscht' })),
  });
}

const Reverse = z.object({ conversion_id: z.string().uuid(), reason: z.string().trim().min(3).max(300) });

// Manuelle Rücknahme (z. B. Erstattung außerhalb von Stripe, Missbrauch). Endgültig und protokolliert.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return j({ error: 'Nicht gefunden.' }, 404);
  const a = await requireCreatorAdmin(req, 'conversions.manage', id);
  if (!('role' in a)) return a;
  const p = Reverse.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte einen Grund angeben.' }, 400);
  const { data } = await supabaseAdmin().from('lr_creator_conversions').update({ status: 'REVERSED', reversed_at: new Date().toISOString() })
    .eq('id', p.data.conversion_id).eq('creator_id', id).eq('status', 'PENDING').select('id');
  if (!data?.length) return j({ error: 'Bereits zurückgenommen oder nicht gefunden.' }, 409);
  await audit('CONVERSION_REVERSED', id, a.actor, 'SUCCESS', { reason_code: 'manual' });
  return j({ ok: true });
}
