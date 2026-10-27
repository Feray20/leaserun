import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BLOCKER_TEXT, PERIOD_RE, closeAllowedAt, periodBounds, periodLabel, periodOf, previousPeriod } from '@/lib/creator/billing';
import { approveStatement, closePeriod, statementBlockers, type StatementRow } from '@/lib/creator/billing-server';
import { can } from '@/lib/creator/roles';
import { audit, j, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Creator Billing: Kennzahlen, Monatsabschluss-Kachel, Abrechnungen eines Monats (mit Sperrgründen), Aktionen.
export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'billing.read');
  if (!('role' in a)) return a;
  const q = new URL(req.url).searchParams.get('period');
  const period = q && PERIOD_RE.test(q) ? q : previousPeriod(periodOf(new Date()));
  const db = supabaseAdmin();
  const { from, to } = periodBounds(period);
  const [ov, st, docs, pays, unbilled, adj, setting] = await Promise.all([
    db.rpc('lr_creator_billing_overview', { p_period: period }),
    db.from('lr_creator_statements').select('*, lr_creators(display_name, first_name, last_name)').eq('period', period).order('payout_cents', { ascending: false }),
    db.from('lr_creator_documents').select('id, statement_id, doc_type, number, issued_at'),
    db.from('lr_creator_payouts').select('id, statement_id, status, amount_cents'),
    db.from('lr_creator_conversions').select('id, amount_net_cents, lr_creator_commissions(id)').eq('status', 'PENDING').gte('occurred_at', from.toISOString()).lt('occurred_at', to.toISOString()),
    db.from('lr_creator_adjustments').select('id, creator_id, period, kind, amount_cents, reason, created_at, lr_creators(display_name)').is('statement_id', null).order('created_at', { ascending: false }),
    db.from('lr_settings').select('key, value').in('key', SETTING_KEYS),
  ]);
  const cfg = settingsFrom((setting.data ?? []) as { key: string; value: unknown }[]);
  const delay = cfg.close_delay_days;
  const refunds = await db.from('lr_creator_refunds').select('id', { count: 'exact', head: true }).is('processed_at', null);
  const open = ((unbilled.data ?? []) as unknown as { amount_net_cents: number; lr_creator_commissions?: unknown }[]).filter((x) => !(Array.isArray(x.lr_creator_commissions) ? x.lr_creator_commissions.length : x.lr_creator_commissions));
  type Doc = { id: string; statement_id: string; doc_type: string; number: string; issued_at: string };
  const docRows = (docs.data ?? []) as unknown as Doc[];
  const payRows = (pays.data ?? []) as unknown as { id: string; statement_id: string; status: string; amount_cents: number }[];
  const rows = (st.data ?? []) as unknown as (StatementRow & { lr_creators?: { display_name: string | null; first_name: string | null; last_name: string | null } })[];
  const statements = [];
  let blockedCents = 0;
  for (const s of rows) {
    const b = s.status === 'READY' || s.status === 'INVOICED' ? (await statementBlockers(s)).list : [];
    if (b.length && b[0] !== 'nothing_to_pay') blockedCents += s.payout_cents;
    statements.push({
      id: s.id, creator_id: s.creator_id, name: s.lr_creators?.display_name || [s.lr_creators?.first_name, s.lr_creators?.last_name].filter(Boolean).join(' ') || 'Creator',
      status: s.status, billing_mode: s.billing_mode, conversions: s.conversions, revenue_net_cents: s.revenue_net_cents, commission_cents: s.commission_cents,
      adjustments_cents: s.adjustments_cents, net_cents: s.net_cents, vat_cents: s.vat_cents, gross_cents: s.gross_cents, payout_cents: s.payout_cents, tax_mode: s.tax_mode,
      blockers: b.filter((x) => x !== 'nothing_to_pay').map((x) => ({ key: x, text: BLOCKER_TEXT[x] })),
      documents: docRows.filter((d) => d.statement_id === s.id),
      payout: payRows.find((p) => p.statement_id === s.id) ?? null,
    });
  }
  return j({
    me: { role: a.role, manage: can(a.role, 'billing.manage'), settings: a.role === 'SUPER_ADMIN' },
    settings: cfg, open_refunds: refunds.error ? null : refunds.count ?? 0,
    period, label: periodLabel(period), close_allowed_at: closeAllowedAt(period, delay).toISOString(),
    overview: { ...(ov.data as Record<string, unknown>), blocked_cents: blockedCents },
    unbilled: { conversions: open.length, revenue_net_cents: open.reduce((x, y) => x + y.amount_net_cents, 0) },
    statements, open_adjustments: adj.data ?? [],
  });
}

// Einstellungen der Abrechnung (Automatik, Sperrfrist, Erinnerung, Vier-Augen-Prinzip)
const SETTING_KEYS = ['creator_auto_close', 'creator_close_delay_days', 'creator_invoice_reminder_days', 'creator_payout_four_eyes'];
function settingsFrom(rows: { key: string; value: unknown }[]) {
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    auto_close: v('creator_auto_close') === true,
    close_delay_days: Number(v('creator_close_delay_days') ?? 15) || 15,
    invoice_reminder_days: Number(v('creator_invoice_reminder_days') ?? 7) || 7,
    four_eyes: v('creator_payout_four_eyes') === true,
  };
}

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('settings'), auto_close: z.boolean(), close_delay_days: z.number().int().min(14).max(60), invoice_reminder_days: z.number().int().min(3).max(30), four_eyes: z.boolean() }),
  z.object({ action: z.literal('close'), period: z.string().regex(PERIOD_RE) }),
  z.object({ action: z.literal('approve'), statement_id: z.string().uuid() }),
  z.object({ action: z.literal('adjust'), creator_id: z.string().uuid(), period: z.string().regex(PERIOD_RE), kind: z.enum(['BONUS', 'CORRECTION']), amount_cents: z.number().int().refine((v) => v !== 0 && Math.abs(v) <= 10_000_000, 'Betrag ungültig.'), reason: z.string().trim().min(3).max(300) }),
  z.object({ action: z.literal('delete_adjustment'), id: z.string().uuid() }),
  z.object({ action: z.literal('billing_mode'), creator_id: z.string().uuid(), mode: z.enum(['INVOICE', 'CREDIT_NOTE']) }),
]);

export async function POST(req: Request) {
  const a = await requireCreatorAdmin(req, 'billing.manage');
  if (!('role' in a)) return a;
  const p = Action.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Ungültig.' }, 400);
  const d = p.data, db = supabaseAdmin();
  try {
    if (d.action === 'settings') {
      // Nur Super Admin: Die Einstellungen steuern Kontrollen (Sperrfrist, Vier-Augen-Prinzip).
      if (a.role !== 'SUPER_ADMIN') return j({ error: 'Nur Super Admins dürfen die Abrechnungs-Einstellungen ändern.' }, 403);
      const rows = [
        { key: 'creator_auto_close', value: d.auto_close }, { key: 'creator_close_delay_days', value: d.close_delay_days },
        { key: 'creator_invoice_reminder_days', value: d.invoice_reminder_days }, { key: 'creator_payout_four_eyes', value: d.four_eyes },
      ].map((r) => ({ ...r, updated_by: a.actor.ref, updated_at: new Date().toISOString() }));
      const { error } = await db.from('lr_settings').upsert(rows, { onConflict: 'key' });
      if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
      await audit('SETTINGS_CHANGED', null, a.actor, 'SUCCESS', { auto_close: d.auto_close, close_delay_days: d.close_delay_days, invoice_reminder_days: d.invoice_reminder_days, four_eyes: d.four_eyes });
      return j({ ok: true });
    }
    if (d.action === 'close') return j({ ok: true, ...(await closePeriod(d.period, a.actor)) });
    if (d.action === 'approve') {
      const { data: s } = await db.from('lr_creator_statements').select('*').eq('id', d.statement_id).maybeSingle();
      if (!s) return j({ error: 'Abrechnung nicht gefunden.' }, 404);
      await approveStatement(s as StatementRow, a.actor);
      return j({ ok: true });
    }
    if (d.action === 'adjust') {
      const { error } = await db.from('lr_creator_adjustments').insert({ creator_id: d.creator_id, period: d.period, kind: d.kind, amount_cents: d.amount_cents, reason: d.reason, created_by: a.actor.ref });
      if (error) return j({ error: 'Anpassung konnte nicht gespeichert werden.' }, 400);
      await audit('ADJUSTMENT_CREATED', d.creator_id, a.actor, 'SUCCESS', { period: d.period, kind: d.kind, amount_cents: d.amount_cents });
      return j({ ok: true });
    }
    if (d.action === 'delete_adjustment') {
      const { data } = await db.from('lr_creator_adjustments').delete().eq('id', d.id).is('statement_id', null).select('creator_id');
      if (!data?.length) return j({ error: 'Bereits verrechnet oder nicht gefunden.' }, 409);
      await audit('ADJUSTMENT_CREATED', (data[0] as { creator_id: string }).creator_id, a.actor, 'SUCCESS', { deleted: true });
      return j({ ok: true });
    }
    const { error } = await db.from('lr_creators').update({ billing_mode: d.mode }).eq('id', d.creator_id);
    if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    await audit('BILLING_MODE_CHANGED', d.creator_id, a.actor, 'SUCCESS', { mode: d.mode });
    return j({ ok: true });
  } catch (e) {
    const b = (e as { blockers?: string[] }).blockers;
    return j({ error: e instanceof Error ? e.message : 'Nicht möglich.', ...(b ? { blockers: b.map((x) => BLOCKER_TEXT[x as keyof typeof BLOCKER_TEXT] ?? x) } : {}) }, 409);
  }
}
