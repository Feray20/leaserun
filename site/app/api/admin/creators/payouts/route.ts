import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { periodLabel } from '@/lib/creator/billing';
import { markPayoutPaid, markPayoutReturned, reissuePayout } from '@/lib/creator/billing-server';
import { maskIban } from '@/lib/creator/iban';
import { can } from '@/lib/creator/roles';
import { painXml } from '@/lib/creator/sepa';
import { open, vaultConfigured } from '@/lib/creator/vault';
import { audit, j, noStore, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Payout Center: Auszahlungen freigeben, als SEPA-Sammelüberweisung exportieren, als bezahlt / fehlgeschlagen markieren.
// LeaseRun löst keine Zahlung selbst aus – die Datei wird im Online-Banking hochgeladen und dort freigegeben.
export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'billing.read');
  if (!('role' in a)) return a;
  const cols = 'id, statement_id, creator_id, amount_cents, iban_country, iban_last4, reference, status, created_at, approved_at, exported_at, paid_at, failed_reason, lr_creators(display_name), lr_creator_statements(period, billing_mode, status), lr_creator_payout_accounts(status)';
  const q = (c: string) => supabaseAdmin().from('lr_creator_payouts').select(c).order('created_at', { ascending: false }).limit(500);
  let res = await q(`${cols}, paid_via, bank_ref, returned_at, reissue_count`);
  if (res.error) res = await q(cols); // ohne Phase-4-Migration
  const data = res.data;
  type Row = { id: string; iban_country: string; iban_last4: string; lr_creator_payout_accounts?: { status: string } | null; lr_creator_statements?: { period: string } | null; [k: string]: unknown };
  return j({
    me: { manage: can(a.role, 'payouts.manage') },
    four_eyes: (await supabaseAdmin().from('lr_settings').select('value').eq('key', 'creator_payout_four_eyes').maybeSingle()).data?.value === true,
    debtor_configured: debtor() !== null,
    payouts: ((data ?? []) as unknown as Row[]).map((p) => ({ ...p, iban_masked: maskIban(p.iban_country, p.iban_last4), bank_status: p.lr_creator_payout_accounts?.status ?? null, period_label: p.lr_creator_statements ? periodLabel(p.lr_creator_statements.period) : '' })),
  });
}

function debtor() {
  const iban = (process.env.CREATOR_PAYOUT_IBAN || process.env.INVOICE_IBAN || '').replace(/\s+/g, '').toUpperCase();
  const bic = (process.env.CREATOR_PAYOUT_BIC || process.env.INVOICE_BIC || '').replace(/\s+/g, '').toUpperCase() || null;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(iban)) return null;
  return { name: process.env.CREATOR_PAYOUT_ACCOUNT_HOLDER || process.env.INVOICE_ACCOUNT_HOLDER || 'LeaseRun Feray Korkmaz', iban, bic };
}

const Input = z.object({
  action: z.enum(['approve', 'export', 'paid', 'failed', 'returned', 'reissue']),
  ids: z.array(z.string().uuid()).min(1).max(200),
  execution_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason: z.string().trim().max(300).optional(),
});

type P = { id: string; creator_id: string; statement_id: string; amount_cents: number; status: string; reference: string; created_by: string; payout_account_id: string; iban_country: string; iban_last4: string };

export async function POST(req: Request) {
  const pr = Input.safeParse(await req.json().catch(() => null));
  if (!pr.success) return j({ error: 'Ungültig.' }, 400);
  const d = pr.data;
  const a = await requireCreatorAdmin(req, d.action === 'export' ? 'bank.reveal' : 'payouts.manage');
  if (!('role' in a)) return a;
  if (!can(a.role, 'payouts.manage')) return j({ error: 'Für Auszahlungen fehlt Ihrer Rolle die Berechtigung.' }, 403);
  const db = supabaseAdmin();
  const { data: rows } = await db.from('lr_creator_payouts').select('*').in('id', d.ids);
  const list = (rows ?? []) as unknown as P[];
  if (list.length !== d.ids.length) return j({ error: 'Nicht alle Auszahlungen gefunden.' }, 404);

  if (d.action === 'approve') {
    const four = (await db.from('lr_settings').select('value').eq('key', 'creator_payout_four_eyes').maybeSingle()).data?.value === true;
    let n = 0;
    for (const p of list.filter((x) => x.status === 'READY' || x.status === 'FAILED')) {
      if (four && p.created_by === a.actor.ref) continue; // Vier-Augen-Prinzip: nicht die Person, die die Abrechnung freigegeben hat
      const { data } = await db.from('lr_creator_payouts').update({ status: 'APPROVED', approved_by: a.actor.ref, approved_at: new Date().toISOString(), failed_reason: null }).eq('id', p.id).eq('status', p.status).select('id');
      if (data?.length) { n++; await audit('PAYOUT_APPROVED', p.creator_id, a.actor, 'SUCCESS', { amount_cents: p.amount_cents }); }
    }
    return j({ ok: true, approved: n, skipped: list.length - n, four_eyes: four });
  }

  if (d.action === 'export') {
    const deb = debtor();
    if (!deb) return j({ error: 'Auszahlungskonto von LeaseRun fehlt (CREATOR_PAYOUT_IBAN oder INVOICE_IBAN in Vercel).' }, 503);
    if (!vaultConfigured()) return j({ error: 'Tresor nicht konfiguriert (CREATOR_PII_KEY).' }, 503);
    const ok = list.filter((p) => p.status === 'APPROVED' || p.status === 'EXPORTED');
    if (!ok.length) return j({ error: 'Nur freigegebene Auszahlungen können exportiert werden.' }, 409);
    const { data: accs } = await db.from('lr_creator_payout_accounts').select('id, creator_id, holder_name, iban_enc, bic, status').in('id', ok.map((p) => p.payout_account_id));
    const accMap = new Map(((accs ?? []) as unknown as { id: string; creator_id: string; holder_name: string; iban_enc: string; bic: string | null; status: string }[]).map((x) => [x.id, x]));
    const exportId = `IA-CR-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}`;
    const payments = [];
    for (const p of ok) {
      const acc = accMap.get(p.payout_account_id);
      if (!acc || acc.status === 'VERIFICATION_REQUIRED') return j({ error: 'Ein Konto ist nicht (mehr) geprüft. Bitte zuerst die Zahlungsdaten prüfen.' }, 409);
      if (!(await audit('BANK_DETAILS_VIEWED', p.creator_id, a.actor, 'SUCCESS', { purpose: 'sepa_export', payout: p.id.slice(0, 8) }))) return j({ error: 'Zugriff konnte nicht protokolliert werden.' }, 503);
      let iban: string;
      try { iban = open(acc.iban_enc, acc.creator_id); } catch { return j({ error: 'Zahlungsdaten konnten nicht entschlüsselt werden.' }, 500); }
      payments.push({ endToEndId: `CR${p.id.replace(/-/g, '').slice(0, 30)}`, name: acc.holder_name, iban, bic: acc.bic, amountCents: p.amount_cents, remittance: p.reference });
    }
    const exec = d.execution_date || new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const xmlText = painXml({ msgId: exportId, createdAt: new Date(), executionDate: exec, debtor: deb, payments });
    for (const p of ok) {
      await db.from('lr_creator_payouts').update({ status: 'EXPORTED', exported_at: new Date().toISOString(), export_id: exportId }).eq('id', p.id);
      await audit('PAYOUT_EXPORTED', p.creator_id, a.actor, 'SUCCESS', { export: exportId, amount_cents: p.amount_cents });
    }
    return new NextResponse(xmlText, { headers: { ...noStore, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${exportId}.xml"` } });
  }

  if (d.action === 'returned') {
    if (!d.reason) return j({ error: 'Bitte einen Grund angeben.' }, 400);
    let n = 0;
    try { for (const p of list.filter((x) => x.status === 'PAID')) if (await markPayoutReturned(p.id, a.actor, d.reason)) n++; }
    catch (e) { return j({ error: e instanceof Error ? e.message : 'Nicht möglich.' }, 409); }
    return j({ ok: true, returned: n });
  }
  if (d.action === 'reissue') {
    let n = 0; const errors: string[] = [];
    for (const p of list.filter((x) => x.status === 'RETURNED')) {
      try { await reissuePayout(p.id, a.actor); n++; } catch (e) { errors.push(e instanceof Error ? e.message : 'Nicht möglich.'); }
    }
    if (!n && errors.length) return j({ error: errors[0] }, 409);
    return j({ ok: true, reissued: n, skipped: list.length - n });
  }

  if (d.action === 'paid') {
    let n = 0;
    for (const p of list) if (await markPayoutPaid(p, a.actor, { via: 'MANUAL' })) n++;
    return j({ ok: true, paid: n });
  }

  if (!d.reason) return j({ error: 'Bitte einen Grund angeben.' }, 400);
  let n = 0;
  for (const p of list.filter((x) => x.status === 'APPROVED' || x.status === 'EXPORTED')) {
    const { data } = await db.from('lr_creator_payouts').update({ status: 'FAILED', failed_reason: d.reason }).eq('id', p.id).eq('status', p.status).select('id');
    if (data?.length) { n++; await audit('PAYOUT_FAILED', p.creator_id, a.actor, 'FAILED', { reason_code: 'manual' }); }
  }
  return j({ ok: true, failed: n });
}
