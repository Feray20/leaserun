import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLATFORMS } from '@/lib/creator/model';
import { audit, creatorActor, j, requireActiveCreator } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Creator Studio: veröffentlichten Inhalt eintragen (Link). Die Werbekennzeichnung muss bestätigt werden.
const Input = z.object({
  platform: z.enum(PLATFORMS),
  url: z.string().trim().max(300).refine((v) => { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }, 'Bitte den vollständigen https-Link zum Beitrag angeben.'),
  title: z.string().trim().max(160).optional().nullable().transform((v) => (v ? v : null)),
  campaign_id: z.string().uuid().optional().nullable().transform((v) => v ?? null),
  published_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Bitte das Veröffentlichungsdatum angeben.'),
  ad_disclosure: z.literal(true, { errorMap: () => ({ message: 'Bitte bestätige, dass der Beitrag als Werbung gekennzeichnet ist.' }) }),
});
const Edit = z.object({ id: z.string().uuid(), url: Input.shape.url, title: Input.shape.title, ad_disclosure: Input.shape.ad_disclosure });

export async function POST(req: Request) {
  const g = await requireActiveCreator(req, 'content', 20);
  if (!('creator' in g)) return g;
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) { const i = p.error.issues[0]; return j({ error: i?.message || 'Bitte Eingaben prüfen.', field: i?.path?.join('.') || null }, 400); }
  const d = p.data;
  const day = new Date(`${d.published_on}T12:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.getTime() > Date.now() + 86_400_000 || day.getTime() < Date.now() - 400 * 86_400_000) return j({ error: 'Bitte ein gültiges Veröffentlichungsdatum angeben.', field: 'published_on' }, 400);
  const db = supabaseAdmin();
  if (d.campaign_id) {
    const { data: ok } = await db.rpc('lr_creator_can_see_campaign', { p_campaign: d.campaign_id, p_creator: g.creator.id });
    if (ok !== true) return j({ error: 'Diese Kampagne ist für dich nicht verfügbar.', field: 'campaign_id' }, 400);
  }
  const { error } = await db.from('lr_creator_content').insert({ ...d, creator_id: g.creator.id });
  if (error) return j({ error: /duplicate|unique/i.test(error.message) ? 'Diesen Beitrag hast du bereits eingetragen.' : 'Speichern fehlgeschlagen.' }, error.message.match(/duplicate|unique/i) ? 409 : 500);
  await audit('CONTENT_SUBMITTED', g.creator.id, creatorActor(), 'SUCCESS', { platform: d.platform, campaign: d.campaign_id ? d.campaign_id.slice(0, 8) : null });
  return j({ ok: true }, 201);
}

// Überarbeiteten Beitrag nach einer Anmerkung erneut einreichen (nur eigene, nur bei „Änderung erbeten“).
export async function PATCH(req: Request) {
  const g = await requireActiveCreator(req, 'content', 20);
  if (!('creator' in g)) return g;
  const p = Edit.safeParse(await req.json().catch(() => null));
  if (!p.success) { const i = p.error.issues[0]; return j({ error: i?.message || 'Bitte Eingaben prüfen.' }, 400); }
  const { data, error } = await supabaseAdmin().from('lr_creator_content')
    .update({ url: p.data.url, title: p.data.title, ad_disclosure: true, status: 'SUBMITTED', review_note: null, reviewed_at: null })
    .eq('id', p.data.id).eq('creator_id', g.creator.id).eq('status', 'CHANGES_REQUESTED').select('id');
  if (error || !data?.length) return j({ error: 'Dieser Beitrag kann gerade nicht geändert werden.' }, 409);
  await audit('CONTENT_SUBMITTED', g.creator.id, creatorActor(), 'SUCCESS', { resubmit: true });
  return j({ ok: true });
}
