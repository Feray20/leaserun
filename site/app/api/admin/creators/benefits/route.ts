import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { audit, j, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Community-Vorteil je Creator. Damit der Code beim Kauf wirkt, muss in Stripe ein gleichnamiger Aktionscode
// (Promotion Code) existieren – die Bezahlseite erlaubt Aktionscodes bereits. Die Zuordnung des Kaufs erfolgt über den Code.
const Input = z.object({
  id: z.string().uuid().optional(),
  creator_id: z.string().uuid(),
  campaign_id: z.string().uuid().nullable().optional(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Code: 3–20 Zeichen, nur A–Z und 0–9.'),
  benefit: z.string().trim().min(3).max(200),
  terms: z.string().trim().max(2000).nullable().optional(),
  starts_at: z.string().datetime({ offset: true }).optional(),
  ends_at: z.string().datetime({ offset: true }).nullable().optional(),
  active: z.boolean().default(true),
});

export async function POST(req: Request) {
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Bitte Eingaben prüfen.', field: p.error.issues[0]?.path?.join('.') }, 400);
  const a = await requireCreatorAdmin(req, 'campaigns.manage', p.data.creator_id);
  if (!('role' in a)) return a;
  const { id, ...d } = p.data;
  const row = { ...d, campaign_id: d.campaign_id ?? null, terms: d.terms || null, ends_at: d.ends_at || null, ...(d.starts_at ? { starts_at: d.starts_at } : {}) };
  const db = supabaseAdmin();
  const r = id ? await db.from('lr_creator_benefits').update(row).eq('id', id).eq('creator_id', d.creator_id) : await db.from('lr_creator_benefits').insert(row);
  if (r.error) return j({ error: /duplicate|unique/i.test(r.error.message) ? 'Dieser Code ist schon vergeben.' : 'Bitte Zeitraum und Angaben prüfen.' }, 400);
  await audit('BENEFIT_CHANGED', d.creator_id, a.actor, 'SUCCESS', { code: d.code, active: d.active, created: !id });
  return j({ ok: true });
}
