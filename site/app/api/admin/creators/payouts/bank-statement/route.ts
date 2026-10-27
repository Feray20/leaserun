import { createHash } from 'node:crypto';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { eurText, periodLabel } from '@/lib/creator/billing';
import { markPayoutPaid, markPayoutReturned, type PayoutForPaid } from '@/lib/creator/billing-server';
import { CAMT_MAX_BYTES, matchPayouts, parseCamt053 } from '@/lib/creator/camt';
import { audit, j, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Kontoauszug (camt.053) hochladen → exportierte Auszahlungen werden über die Ende-zu-Ende-Referenz bzw.
// Verwendungszweck + Betrag gefunden. Erst die Vorschau, dann „Übernehmen“: Der Server liest die Datei dabei erneut
// und gleicht neu ab – aus dem Browser wird nur die Datei übernommen, nie ein Ergebnis. Rückläufer werden dabei
// ebenfalls übernommen: bezahlte Auszahlungen → „zurückgekommen“, exportierte → „fehlgeschlagen“.
const Input = z.object({
  xml: z.string().min(50).max(CAMT_MAX_BYTES),
  confirm: z.boolean().default(false),
});

const ERR: Record<string, string> = {
  camt_empty: 'Die Datei ist leer.',
  camt_too_large: 'Die Datei ist zu groß (höchstens 3 MB).',
  camt_doctype: 'Die Datei enthält nicht erlaubte XML-Bestandteile.',
  camt_format: 'Das ist kein Kontoauszug im Format camt.053. Bitte im Online-Banking „Kontoauszug als camt.053 (XML)“ herunterladen.',
};

type Row = PayoutForPaid & { lr_creators?: { display_name: string | null; first_name: string | null } | null; lr_creator_statements?: { period: string } | null };

export async function POST(req: Request) {
  const pr = Input.safeParse(await req.json().catch(() => null));
  if (!pr.success) return j({ error: 'Bitte eine camt.053-Datei (XML, höchstens 3 MB) auswählen.' }, 400);
  const a = await requireCreatorAdmin(req, 'payouts.manage');
  if (!('role' in a)) return a;

  let st;
  try { st = parseCamt053(pr.data.xml); } catch (e) { return j({ error: ERR[e instanceof Error ? e.message : ''] ?? 'Die Datei konnte nicht gelesen werden.' }, 400); }

  const db = supabaseAdmin();
  const { data } = await db.from('lr_creator_payouts')
    .select('id, creator_id, statement_id, amount_cents, status, reference, iban_country, iban_last4, lr_creators(display_name, first_name), lr_creator_statements(period)')
    .in('status', ['APPROVED', 'EXPORTED', 'PAID']).gte('created_at', new Date(Date.now() - 400 * 864e5).toISOString()).limit(5000);
  const all = (data ?? []) as unknown as Row[];
  const open = all.filter((p) => p.status !== 'PAID');
  const byId = new Map(all.map((p) => [p.id, p]));
  const r = matchPayouts(st.transactions, open, all.filter((p) => p.status === 'PAID'));
  const sha = createHash('sha256').update(pr.data.xml).digest('hex');
  const { data: prev } = await db.from('lr_creator_bank_imports').select('created_at').eq('file_sha256', sha).maybeSingle();
  const debtorIban = (process.env.CREATOR_PAYOUT_IBAN || process.env.INVOICE_IBAN || '').replace(/\s+/g, '').toUpperCase();
  const label = (id: string | null) => {
    const p = id ? byId.get(id) : undefined;
    return p ? { creator: p.lr_creators?.display_name || p.lr_creators?.first_name || 'Creator', period: p.lr_creator_statements ? periodLabel(p.lr_creator_statements.period) : '', reference: p.reference } : null;
  };
  const summary = {
    statement: st.id, account_last4: st.ibanLast4,
    account_warning: st.ibanLast4 && debtorIban && !debtorIban.endsWith(st.ibanLast4) ? 'Der Auszug gehört nicht zum hinterlegten Auszahlungskonto.' : null,
    transactions: st.transactions.length, unrelated: r.unrelated, already_imported: prev?.created_at ?? null,
    matches: r.matches.map((m) => ({ ...m, amount: eurText(m.amount_cents), ...label(m.payout_id) })),
    issues: r.issues.map((i) => ({ ...i, amount: eurText(i.amount_cents), ...label(i.payout_id) })),
  };
  if (!pr.data.confirm) return j({ preview: true, ...summary });

  let paid = 0;
  for (const m of r.matches) {
    const p = byId.get(m.payout_id);
    if (p && (await markPayoutPaid(p, a.actor, { via: 'BANK_STATEMENT', paidAt: m.booking_date, bankRef: m.bank_ref }))) paid++;
  }
  // Rückläufer: bezahlte Auszahlungen → zurückgekommen (Abrechnung wieder offen, Konto zur Prüfung);
  // exportierte, noch nicht bezahlte Auszahlungen → fehlgeschlagen.
  let returned = 0;
  for (const i of r.issues.filter((x) => x.kind === 'returned' && x.payout_id)) {
    const p = byId.get(i.payout_id as string);
    if (!p) continue;
    if (p.status === 'PAID') { if (await markPayoutReturned(p.id, a.actor, 'Rückläufer laut Kontoauszug').catch(() => false)) returned++; }
    else {
      const { data: f } = await db.from('lr_creator_payouts').update({ status: 'FAILED', failed_reason: 'Rückläufer laut Kontoauszug' }).eq('id', p.id).eq('status', p.status).select('id');
      if (f?.length) { returned++; await audit('PAYOUT_FAILED', p.creator_id, a.actor, 'FAILED', { reason_code: 'bank_return' }); }
    }
  }
  const ins = await db.from('lr_creator_bank_imports').upsert({
    file_sha256: sha, statement_id: st.id?.slice(0, 80) ?? null, account_last4: st.ibanLast4 && /^[0-9A-Z]{4}$/.test(st.ibanLast4) ? st.ibanLast4 : null,
    entries: st.transactions.length, matched: paid, imported_by: a.actor.ref,
  }, { onConflict: 'file_sha256', ignoreDuplicates: true });
  if (ins.error) console.warn('creator_bank_import', ins.error.message);
  await audit('BANK_STATEMENT_IMPORTED', null, a.actor, 'SUCCESS', { transactions: st.transactions.length, paid, returned, issues: r.issues.length });
  return j({ ok: true, paid, returned, ...summary });
}
