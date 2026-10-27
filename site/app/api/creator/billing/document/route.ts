import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DOC_BUCKET, ensureStatementPdf, type StatementRow } from '@/lib/creator/billing-server';
import { audit, creatorActor, j, requireActiveCreator } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dokument herunterladen (eigene Abrechnung, Rechnung, Gutschrift) über einen signierten Link mit 60 Sekunden Gültigkeit.
// Die Abrechnungsübersicht (PDF) wird beim ersten Abruf erzeugt und danach unverändert abgelegt.
const Input = z.union([z.object({ document_id: z.string().uuid() }), z.object({ statement_id: z.string().uuid(), doc_type: z.literal('STATEMENT') })]);

export async function POST(req: Request) {
  const g = await requireActiveCreator(req, 'doc', 20);
  if (!('creator' in g)) return g;
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  let doc: { id: string; storage_path: string; number: string } | null = null;
  if ('document_id' in p.data) {
    const { data } = await db.from('lr_creator_documents').select('id, storage_path, number').eq('id', p.data.document_id).eq('creator_id', g.creator.id).maybeSingle();
    doc = data;
  } else {
    const { data: s } = await db.from('lr_creator_statements').select('*').eq('id', p.data.statement_id).eq('creator_id', g.creator.id).maybeSingle();
    if (s) doc = await ensureStatementPdf(s as StatementRow, 'system:statement').catch(() => null);
  }
  if (!doc) return j({ error: 'Dokument nicht gefunden.' }, 404);
  const { data, error } = await db.storage.from(DOC_BUCKET).createSignedUrl(doc.storage_path, 60, { download: `${doc.number}.pdf` });
  if (error || !data?.signedUrl) return j({ error: 'Download gerade nicht möglich.' }, 502);
  await audit('DOCUMENT_DOWNLOADED', g.creator.id, creatorActor(), 'SUCCESS', { document: doc.id.slice(0, 8) });
  return j({ url: data.signedUrl });
}
