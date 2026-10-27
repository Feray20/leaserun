import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { can } from '@/lib/creator/roles';
import { audit, j, rangeOf, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kampagnen: Liste mit Kennzahlen („Welche Kampagne funktioniert?“), Anlegen/Bearbeiten, Creator zuordnen.
export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'creators.list');
  if (!('role' in a)) return a;
  const r = rangeOf(new URL(req.url).searchParams.get('range'));
  const db = supabaseAdmin();
  const [camps, members, assets, creators, stats] = await Promise.all([
    db.from('lr_creator_campaigns').select('*').order('created_at', { ascending: false }),
    db.from('lr_creator_campaign_members').select('campaign_id, creator_id'),
    db.from('lr_creator_assets').select('campaign_id, active'),
    db.from('lr_creators').select('id, display_name, ref_code').eq('status', 'ACTIVE').order('display_name'),
    can(a.role, 'conversions.read') ? db.rpc('lr_creator_campaign_stats', { p_from: r.from.toISOString(), p_to: r.to.toISOString() }) : Promise.resolve({ data: null }),
  ]);
  const mem = (members.data ?? []) as { campaign_id: string; creator_id: string }[];
  const ast = (assets.data ?? []) as { campaign_id: string | null; active: boolean }[];
  type Stat = { campaign: string | null; creators: number; visits: number; registrations: number; conversions: number; revenue_net_cents: number };
  const st = new Map(((stats.data ?? []) as Stat[]).map((s) => [s.campaign ?? '', s]));
  return j({
    me: { role: a.role, manage: can(a.role, 'campaigns.manage'), stats: can(a.role, 'conversions.read') },
    range: r.key,
    campaigns: ((camps.data ?? []) as { id: string; slug: string }[]).map((k) => ({
      ...k, member_ids: mem.filter((m) => m.campaign_id === k.id).map((m) => m.creator_id),
      assets: ast.filter((x) => x.campaign_id === k.id && x.active).length, stats: st.get(k.slug) ?? null,
    })),
    without_campaign: st.get('') ?? null,
    creators: creators.data ?? [],
  });
}

const Camp = z.object({
  id: z.string().uuid().optional(),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{3,40}$/, 'Kurzname: 3–40 Zeichen, nur a–z, 0–9 und Bindestrich.'),
  name: z.string().trim().min(3).max(120),
  summary: z.string().trim().max(600).nullable().optional(),
  brief: z.string().trim().max(8000).nullable().optional(),
  dos: z.string().trim().max(4000).nullable().optional(),
  donts: z.string().trim().max(4000).nullable().optional(),
  target_path: z.string().trim().regex(/^\/[A-Za-z0-9/_-]*$/, 'Ziel: interner Pfad wie /calculators/budget').max(120).default('/'),
  audience: z.enum(['ALL', 'SELECTED']),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ENDED']),
  starts_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  ends_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const Members = z.object({ campaign_id: z.string().uuid(), creator_ids: z.array(z.string().uuid()).max(2000) });

export async function POST(req: Request) {
  const a = await requireCreatorAdmin(req, 'campaigns.manage');
  if (!('role' in a)) return a;
  const p = Camp.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Bitte Eingaben prüfen.', field: p.error.issues[0]?.path?.join('.') }, 400);
  const { id, ...d } = p.data;
  const row = { ...d, summary: d.summary || null, brief: d.brief || null, dos: d.dos || null, donts: d.donts || null, starts_on: d.starts_on || null, ends_on: d.ends_on || null };
  const db = supabaseAdmin();
  const r = id ? await db.from('lr_creator_campaigns').update(row).eq('id', id).select('id').single() : await db.from('lr_creator_campaigns').insert(row).select('id').single();
  if (r.error) return j({ error: /duplicate|unique/i.test(r.error.message) ? 'Dieser Kurzname ist schon vergeben.' : /check/i.test(r.error.message) ? 'Bitte Zeitraum und Angaben prüfen.' : 'Speichern fehlgeschlagen.' }, 400);
  await audit('CAMPAIGN_CHANGED', null, a.actor, 'SUCCESS', { campaign: d.slug, status: d.status, created: !id });
  return j({ ok: true, id: (r.data as { id: string }).id });
}

export async function PUT(req: Request) {
  const a = await requireCreatorAdmin(req, 'campaigns.manage');
  if (!('role' in a)) return a;
  const p = Members.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const want = [...new Set(p.data.creator_ids)];
  const { data: cur } = await db.from('lr_creator_campaign_members').select('creator_id').eq('campaign_id', p.data.campaign_id);
  const have = new Set(((cur ?? []) as { creator_id: string }[]).map((x) => x.creator_id));
  const add = want.filter((x) => !have.has(x));
  const del = [...have].filter((x) => !want.includes(x));
  if (del.length) await db.from('lr_creator_campaign_members').delete().eq('campaign_id', p.data.campaign_id).in('creator_id', del);
  if (add.length) {
    const { error } = await db.from('lr_creator_campaign_members').insert(add.map((creator_id) => ({ campaign_id: p.data.campaign_id, creator_id, added_by: a.actor.ref })));
    if (error) return j({ error: 'Zuordnung fehlgeschlagen.' }, 400);
  }
  await audit('CAMPAIGN_MEMBERS_CHANGED', null, a.actor, 'SUCCESS', { campaign: p.data.campaign_id.slice(0, 8), added: add.length, removed: del.length });
  return j({ ok: true, added: add.length, removed: del.length });
}
