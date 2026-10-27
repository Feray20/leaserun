import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ASSET_BUCKET, audit, creatorActor, j, requireActiveCreator } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Asset herunterladen: Freigabe wird serverseitig geprüft (aktiv + für alle oder über eine sichtbare Kampagne),
// danach ein signierter Link mit 60 Sekunden Gültigkeit. Der Speicher selbst ist privat.
const Input = z.object({ id: z.string().uuid() });

export async function POST(req: Request) {
  const g = await requireActiveCreator(req, 'asset', 30);
  if (!('creator' in g)) return g;
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const { data: a } = await db.from('lr_creator_assets').select('id, campaign_id, title, kind, storage_path, active').eq('id', p.data.id).maybeSingle();
  if (!a || !a.active || !a.storage_path) return j({ error: 'Nicht gefunden.' }, 404);
  if (a.campaign_id) {
    const { data: ok } = await db.rpc('lr_creator_can_see_campaign', { p_campaign: a.campaign_id, p_creator: g.creator.id });
    if (ok !== true) return j({ error: 'Nicht gefunden.' }, 404);
  }
  const name = String(a.storage_path).split('/').pop() || 'asset';
  const { data, error } = await db.storage.from(ASSET_BUCKET).createSignedUrl(a.storage_path, 60, { download: name });
  if (error || !data?.signedUrl) return j({ error: 'Download gerade nicht möglich.' }, 502);
  await audit('ASSET_DOWNLOADED', g.creator.id, creatorActor(), 'SUCCESS', { asset: String(a.id).slice(0, 8), kind: a.kind });
  return j({ url: data.signedUrl, expires_in: 60 });
}
