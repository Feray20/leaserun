import { supabaseAdmin } from '@/lib/supabase/admin';
import { BLOCKER_TEXT, closeAllowedAt, commissionLines, describeRule, pickRule, reducedBase, periodLabel, periodOf, previousPeriod, suggestInvoiceNumber, type ConversionIn, type Rule } from '@/lib/creator/billing';
import { statementBlockers, type StatementRow } from '@/lib/creator/billing-server';
import { maskIban } from '@/lib/creator/iban';
import { j, requireActiveCreator } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// „Deine Abrechnung“: abgeschlossene Monate mit Status, Dokumenten und Auszahlung sowie eine Vorschau für noch offene Monate.
// Alle Beträge berechnet der Server. Die Vorschau ist ausdrücklich vorläufig (Erstattungen, Widerrufsfrist).
export async function GET(req: Request) {
  const g = await requireActiveCreator(req, 'billing', 60);
  if (!('creator' in g)) return g;
  const c = g.creator as typeof g.creator & { billing_mode?: string };
  const db = supabaseAdmin();
  const [st, docs, pays, open, rules, comm, setting] = await Promise.all([
    db.from('lr_creator_statements').select('*').eq('creator_id', c.id).order('period', { ascending: false }).limit(36),
    db.from('lr_creator_documents').select('id, statement_id, doc_type, number, issued_at').eq('creator_id', c.id),
    db.from('lr_creator_payouts').select('statement_id, amount_cents, status, iban_country, iban_last4, approved_at, paid_at').eq('creator_id', c.id),
    db.from('lr_creator_conversions').select('id, creator_id, campaign_slug, amount_net_cents, occurred_at, lr_creator_commissions(id)').eq('creator_id', c.id).eq('status', 'PENDING'),
    db.from('lr_creator_commission_rules').select('*'),
    db.from('lr_creator_commissions').select('commission_cents, status').eq('creator_id', c.id),
    db.from('lr_settings').select('value').eq('key', 'creator_close_delay_days').maybeSingle(),
  ]);
  const statements = (st.data ?? []) as unknown as (StatementRow & { billing_mode: string })[];
  type Doc = { id: string; statement_id: string; doc_type: string; number: string; issued_at: string };
  const docRows = (docs.data ?? []) as unknown as Doc[];
  type Pay = { statement_id: string; amount_cents: number; status: string; iban_country: string; iban_last4: string; approved_at: string | null; paid_at: string | null };
  const payRows = (pays.data ?? []) as unknown as Pay[];

  // Offene (noch nicht abgeschlossene) Monate: vorläufige Provision nach den aktuell gültigen Regeln
  const unbilled = ((open.data ?? []) as unknown as (ConversionIn & { lr_creator_commissions?: unknown })[])
    .filter((x) => !(Array.isArray(x.lr_creator_commissions) ? x.lr_creator_commissions.length : x.lr_creator_commissions));
  // Teilerstattungen mindern die vorläufige Grundlage (wie beim Monatsabschluss).
  if (unbilled.length) {
    const rf = await db.from('lr_creator_refunds').select('conversion_id, refunded_net_cents').eq('creator_id', c.id).is('processed_at', null).in('conversion_id', unbilled.map((x) => x.id));
    const sum = new Map<string, number>();
    for (const r of (rf.error ? [] : rf.data ?? []) as unknown as { conversion_id: string; refunded_net_cents: number }[]) sum.set(r.conversion_id, (sum.get(r.conversion_id) ?? 0) + r.refunded_net_cents);
    for (const x of unbilled) if (sum.has(x.id)) x.amount_net_cents = reducedBase(x.amount_net_cents, sum.get(x.id) ?? 0);
  }
  const est = commissionLines((rules.data ?? []) as unknown as Rule[], unbilled);
  const byPeriod = new Map<string, { period: string; conversions: number; revenue_net_cents: number; commission_cents: number }>();
  unbilled.forEach((x, i) => {
    const p = periodOf(new Date(x.occurred_at));
    const cur = byPeriod.get(p) ?? { period: p, conversions: 0, revenue_net_cents: 0, commission_cents: 0 };
    cur.conversions += 1; cur.revenue_net_cents += x.amount_net_cents; cur.commission_cents += est.find((l) => l.conversion_id === x.id)?.commission_cents ?? 0;
    byPeriod.set(p, cur);
    void i;
  });
  const delay = Number(setting.data?.value ?? 15) || 15;
  const openPeriods = [...byPeriod.values()].sort((a, b) => b.period.localeCompare(a.period)).map((o) => ({ ...o, label: periodLabel(o.period), close_from: closeAllowedAt(o.period, delay).toISOString() }));

  const sum = (s: string) => ((comm.data ?? []) as unknown as { commission_cents: number; status: string }[]).filter((x) => x.status === s).reduce((a, x) => a + x.commission_cents, 0);
  const actionable = statements.filter((s) => s.status === 'READY' || s.status === 'INVOICED');
  const blockerMap = new Map<string, string[]>();
  for (const s of actionable) {
    const b = await statementBlockers(s);
    blockerMap.set(s.id, b.list.filter((x) => x !== 'nothing_to_pay').map((x) => BLOCKER_TEXT[x]));
  }
  const nextPay = payRows.filter((p) => p.status !== 'PAID' && p.status !== 'FAILED').sort((a, b) => (a.approved_at || '').localeCompare(b.approved_at || ''))[0];
  const lastMonth = previousPeriod(periodOf(new Date()));
  const invoiceNumbers = docRows.filter((d) => d.doc_type === 'INVOICE').map((d) => d.number);

  // Aktuell gültige Regeln für diesen Creator: Standard bzw. eigene Regel sowie Abweichungen je Kampagne.
  const nowIso = new Date().toISOString();
  const valid = ((rules.data ?? []) as unknown as Rule[]).filter((r) => r.valid_from <= nowIso && (!r.valid_to || r.valid_to > nowIso) && (!r.creator_id || r.creator_id === c.id));
  const base = pickRule(valid.filter((r) => !r.campaign_slug), { id: '', creator_id: c.id, campaign_slug: null, amount_net_cents: 0, occurred_at: nowIso });
  const campRules = [...new Set(valid.filter((r) => r.campaign_slug).map((r) => r.campaign_slug as string))]
    .map((slug) => ({ slug, rule: pickRule(valid, { id: '', creator_id: c.id, campaign_slug: slug, amount_net_cents: 0, occurred_at: nowIso }) }))
    .filter((x) => x.rule).map((x) => ({ campaign: x.slug, text: describeRule(x.rule!), since: x.rule!.valid_from }));
  return j({
    commission: base ? { text: describeRule(base), since: base.valid_from, own: Boolean(base.creator_id), campaigns: campRules } : null,
    mode: c.billing_mode === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
    totals: {
      pending_cents: sum('PENDING') + openPeriods.reduce((a, o) => a + o.commission_cents, 0),
      approved_cents: sum('APPROVED'), paid_cents: sum('PAID'),
    },
    next_payout: nextPay ? { amount_cents: nextPay.amount_cents, status: nextPay.status, iban_masked: maskIban(nextPay.iban_country, nextPay.iban_last4) } : null,
    next_close: { period: lastMonth, label: periodLabel(lastMonth), from: closeAllowedAt(lastMonth, delay).toISOString() },
    open: openPeriods,
    invoice_suggestion: suggestInvoiceNumber(new Date().getFullYear(), invoiceNumbers),
    statements: statements.map((s) => {
      const p = payRows.find((x) => x.statement_id === s.id);
      return {
        id: s.id, period: s.period, label: periodLabel(s.period), status: s.status, billing_mode: s.billing_mode, conversions: s.conversions, revenue_net_cents: s.revenue_net_cents,
        commission_cents: s.commission_cents, adjustments_cents: s.adjustments_cents, net_cents: s.net_cents, vat_cents: s.vat_cents, vat_rate_bps: s.vat_rate_bps,
        gross_cents: s.gross_cents, payout_cents: s.payout_cents, tax_note: s.tax_note, closed_at: s.closed_at,
        documents: docRows.filter((d) => d.statement_id === s.id).map((d) => ({ id: d.id, doc_type: d.doc_type, number: d.number, issued_at: d.issued_at })),
        payout: p ? { status: p.status, amount_cents: p.amount_cents, iban_masked: maskIban(p.iban_country, p.iban_last4), paid_at: p.paid_at } : null,
        blockers: blockerMap.get(s.id) ?? [],
      };
    }),
  });
}
