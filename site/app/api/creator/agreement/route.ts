import { z } from 'zod';
import { anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { audit, creatorActor, currentAgreement, j, ownCreator, requireCreatorUser } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Zustimmung zur aktuellen Vereinbarungsfassung. Gespeichert wird die Prüfsumme des Textes, den der Creator gesehen hat –
// ändert sich der Text zwischen Anzeigen und Bestätigen, wird abgelehnt.
const Input = z.object({ agreement_id: z.string().uuid(), sha256: z.string().regex(/^[0-9a-f]{64}$/), accept: z.literal(true) });

export async function POST(req: Request) {
  const g = await requireCreatorUser(req, 'agreement', 10);
  if (!('user' in g)) return g;
  const c = await ownCreator(g.user.id);
  if (!c) return j({ error: 'Bitte zuerst die Bewerbung beginnen.' }, 404);
  if (!['DRAFT', 'INFO_REQUESTED', 'ACTIVE'].includes(c.status)) return j({ error: 'Die Vereinbarung kann gerade nicht bestätigt werden.' }, 409);
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte lies die Vereinbarung und bestätige sie.' }, 400);
  const a = await currentAgreement();
  if (!a || a.id !== p.data.agreement_id || a.body_sha256 !== p.data.sha256) return j({ error: 'Die Vereinbarung wurde inzwischen aktualisiert. Bitte lade die Seite neu und lies die aktuelle Fassung.' }, 409);
  const { error } = await supabaseAdmin().from('lr_creator_agreement_acceptances')
    .upsert({ creator_id: c.id, agreement_id: a.id, body_sha256: a.body_sha256, ip_hash: anonymizedIpHash(req) }, { onConflict: 'creator_id,agreement_id', ignoreDuplicates: true });
  if (error) return j({ error: 'Speichern fehlgeschlagen. Bitte erneut versuchen.' }, 500);
  await audit('AGREEMENT_ACCEPTED', c.id, creatorActor(), 'SUCCESS', { version: a.version, draft: a.is_draft });
  return j({ ok: true, version: a.version });
}
