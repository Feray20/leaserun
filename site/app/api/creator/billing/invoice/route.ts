import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { INVOICE_NO_RE } from '@/lib/creator/billing';
import { createCreatorInvoice, type StatementRow } from '@/lib/creator/billing-server';
import { maskIban } from '@/lib/creator/iban';
import { creatorActor, currentPayout, j, requireActiveCreator } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rechnung per Klick: alle Angaben kommen aus der abgeschlossenen Abrechnung und den hinterlegten Rechnungsdaten.
// Der Creator bestätigt nur die Rechnungsnummer (eigene, fortlaufende Reihe) und die Richtigkeit.
const Input = z.object({ statement_id: z.string().uuid(), number: z.string().trim().regex(INVOICE_NO_RE, 'Rechnungsnummer: 3–40 Zeichen, Buchstaben, Ziffern, - _ / .'), confirm: z.literal(true) });

export async function POST(req: Request) {
  const g = await requireActiveCreator(req, 'invoice', 6);
  if (!('creator' in g)) return g;
  const p = Input.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Bitte Angaben prüfen.', field: 'number' }, 400);
  const db = supabaseAdmin();
  const { data: s } = await db.from('lr_creator_statements').select('*').eq('id', p.data.statement_id).eq('creator_id', g.creator.id).maybeSingle();
  if (!s) return j({ error: 'Abrechnung nicht gefunden.' }, 404);
  const { data: dup } = await db.from('lr_creator_documents').select('id').eq('creator_id', g.creator.id).eq('doc_type', 'INVOICE').eq('number', p.data.number).limit(1);
  if (dup?.length) return j({ error: 'Diese Rechnungsnummer hast du bereits verwendet.', field: 'number' }, 409);
  const pay = await currentPayout(g.creator.id);
  try {
    const doc = await createCreatorInvoice(s as StatementRow, p.data.number, pay ? maskIban(pay.iban_country, pay.iban_last4) : null, creatorActor());
    return j({ ok: true, document_id: doc.id, number: doc.number });
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : 'Rechnung konnte nicht erstellt werden.' }, 409);
  }
}
