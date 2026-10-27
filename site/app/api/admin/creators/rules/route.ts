import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { can } from '@/lib/creator/roles';
import { audit, j, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Provisionsregeln: Prozent, fix, hybrid, gestaffelt; Standard, je Creator, je Kampagne, je Creator + Kampagne.
// Eine Änderung legt eine neue Version an und beendet die bisherige Regel desselben Geltungsbereichs.
export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'billing.read');
  if (!('role' in a)) return a;
  const db = supabaseAdmin();
  const [rules, creators, camps] = await Promise.all([
    db.from('lr_creator_commission_rules').select('*, lr_creators(display_name)').order('valid_from', { ascending: false }).limit(500),
    db.from('lr_creators').select('id, display_name').eq('status', 'ACTIVE').order('display_name'),
    db.from('lr_creator_campaigns').select('slug, name').order('created_at', { ascending: false }),
  ]);
  return j({ me: { manage: can(a.role, 'billing.manage') }, rules: rules.data ?? [], creators: creators.data ?? [], campaigns: camps.data ?? [] });
}

const Tier = z.object({ min_conversions: z.number().int().min(1).max(100000), percent_bps: z.number().int().min(0).max(10000) });
const Input = z.object({
  creator_id: z.string().uuid().nullable(),
  campaign_slug: z.string().regex(/^[a-z0-9-]{3,40}$/).nullable(),
  kind: z.enum(['PERCENT', 'FIXED', 'HYBRID', 'TIERED']),
  percent_bps: z.number().int().min(0).max(10000).default(0),
  fixed_cents: z.number().int().min(0).max(1000000).default(0),
  tiers: z.array(Tier).max(10).default([]),
  valid_from: z.string().datetime({ offset: true }).optional(),
  note: z.string().trim().max(300).nullable().optional(),
}).refine((r) => r.kind !== 'TIERED' || r.tiers.length > 0, { message: 'Bitte mindestens eine Staffel angeben.', path: ['tiers'] })
  .refine((r) => r.kind === 'FIXED' || r.kind === 'TIERED' || r.percent_bps > 0, { message: 'Bitte einen Prozentsatz angeben.', path: ['percent_bps'] })
  .refine((r) => (r.kind !== 'FIXED' && r.kind !== 'HYBRID') || r.fixed_cents > 0, { message: 'Bitte einen festen Betrag angeben.', path: ['fixed_cents'] });

export async function POST(req: Request) {
  const a = await requireCreatorAdmin(req, 'billing.manage');
  if (!('role' in a)) return a;
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Bitte Eingaben prüfen.' }, 400);
  const d = p.data, db = supabaseAdmin();
  const start = d.valid_from ? new Date(d.valid_from) : new Date();
  if (start.getTime() < Date.now() - 60_000) return j({ error: 'Regeln gelten nur für die Zukunft (ab jetzt), damit abgeschlossene Monate unverändert bleiben.' }, 400);
  // Vorgänger desselben Geltungsbereichs beenden
  let q = db.from('lr_creator_commission_rules').select('id, version').is('valid_to', null);
  q = d.creator_id ? q.eq('creator_id', d.creator_id) : q.is('creator_id', null);
  q = d.campaign_slug ? q.eq('campaign_slug', d.campaign_slug) : q.is('campaign_slug', null);
  const { data: prev } = await q;
  const version = Math.max(0, ...((prev ?? []) as unknown as { version: number }[]).map((r) => r.version)) + 1;
  for (const r of (prev ?? []) as unknown as { id: string }[]) await db.from('lr_creator_commission_rules').update({ valid_to: start.toISOString() }).eq('id', r.id).is('valid_to', null);
  const { error } = await db.from('lr_creator_commission_rules').insert({ ...d, note: d.note || null, version, valid_from: start.toISOString(), created_by: a.actor.ref });
  if (error) return j({ error: 'Regel konnte nicht gespeichert werden.' }, 400);
  await audit('COMMISSION_CHANGED', d.creator_id, a.actor, 'SUCCESS', { kind: d.kind, percent_bps: d.percent_bps, fixed_cents: d.fixed_cents, campaign: d.campaign_slug, version });
  return j({ ok: true, version });
}
