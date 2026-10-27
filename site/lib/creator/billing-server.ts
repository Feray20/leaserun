import { createHash, randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  blockers, closeAllowedAt, commissionLines, partialClawback, previousPeriod, periodOf, reducedBase, creditNoteNumber, eurText, periodBounds, periodLabel, statementStatusAfterClose, statementTotals, taxTreatment,
  type AdjustmentIn, type BillingMode, type BusinessIn, type ConversionIn, type Rule, type TaxTreatment,
} from '@/lib/creator/billing';
import { maskIban } from '@/lib/creator/iban';
import { renderDoc, type DocLine } from '@/lib/creator/pdf';
import { audit, SITE_ORIGIN, type Actor } from '@/lib/creator/server';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { readyMail, reminderMail } from '@/lib/creator/mails';
import { contactEmail } from '@/lib/creator/identity';

// Serverseitige Abrechnung: Monatsabschluss, Freigabe, Dokumente (Abrechnung, Rechnung, Gutschrift), Auszahlungen.
// Alle Beträge werden hier aus der Datenbank berechnet – nie aus Eingaben des Browsers übernommen.

export const DOC_BUCKET = 'creator-documents';
const db = () => supabaseAdmin();
const dDE = (d: Date | string) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }).format(new Date(d));
const PLAN: Record<string, string> = { starter: 'Käufer-Pass', pro: 'Investor Pro' };

export const ISSUER = { name: 'LeaseRun', owner: 'Feray Korkmaz', street: 'Georg-August-Zinn-Str. 25', city: '64354 Reinheim', country: 'DE', vatId: 'DE348036700' };

async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from('lr_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

export function servicePeriodText(period: string): string {
  const b = periodBounds(period);
  return `${dDE(b.from)} - ${dDE(new Date(b.to.getTime() - 1000))}`;
}

type CreatorFacts = { id: string; status: string; billing_mode: BillingMode; display_name: string | null; first_name: string | null; last_name: string | null; user_id: string };

async function factsFor(ids: string[]) {
  const [cr, bus, pay, agr] = await Promise.all([
    db().from('lr_creators').select('id, status, billing_mode, display_name, first_name, last_name, user_id').in('id', ids),
    db().from('lr_creator_business').select('*').in('creator_id', ids),
    db().from('lr_creator_payout_accounts').select('id, creator_id, status, iban_country, iban_last4, holder_name').in('creator_id', ids).neq('status', 'SUPERSEDED'),
    db().from('lr_creator_agreements').select('id').not('published_at', 'is', null).order('published_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const acc = agr.data ? await db().from('lr_creator_agreement_acceptances').select('creator_id').eq('agreement_id', agr.data.id).in('creator_id', ids) : { data: [] };
  const accepted = new Set(((acc.data ?? []) as unknown as { creator_id: string }[]).map((x) => x.creator_id));
  return {
    creators: new Map(((cr.data ?? []) as unknown as CreatorFacts[]).map((c) => [c.id, c])),
    business: new Map(((bus.data ?? []) as unknown as (BusinessIn & Record<string, unknown> & { creator_id: string })[]).map((b) => [b.creator_id, b])),
    payout: new Map(((pay.data ?? []) as unknown as { id: string; creator_id: string; status: string; iban_country: string; iban_last4: string; holder_name: string }[]).map((p) => [p.creator_id, p])),
    accepted,
  };
}

const noBusiness: BusinessIn = { country: 'DE', vat_status: 'not_applicable', vat_id: null, tax_number: null };

// ---------------- Erstattungen (Phase 4) ----------------
type OpenRefund = {
  id: string; conversion_id: string; creator_id: string; refunded_net_cents: number;
  conv: { status: string; commission: { commission_cents: number; base_cents: number } | null };
};
type RefundRow = {
  id: string; conversion_id: string; creator_id: string; refunded_net_cents: number;
  lr_creator_conversions: { status: string; lr_creator_commissions: { commission_cents: number; base_cents: number }[] | { commission_cents: number; base_cents: number } | null } | null;
};
// Offene (noch nicht verrechnete) Erstattungen. Fehlt die Tabelle (Phase-4-Migration noch nicht angewendet), gibt es keine.
async function openRefunds(): Promise<OpenRefund[]> {
  const { data, error } = await db().from('lr_creator_refunds')
    .select('id, conversion_id, creator_id, refunded_net_cents, lr_creator_conversions(status, lr_creator_commissions(commission_cents, base_cents))')
    .is('processed_at', null).order('created_at').limit(5000);
  if (error) return [];
  return ((data ?? []) as unknown as RefundRow[]).map((r) => {
    const cm = r.lr_creator_conversions?.lr_creator_commissions;
    const commission = Array.isArray(cm) ? cm[0] ?? null : cm ?? null;
    return { id: r.id, conversion_id: r.conversion_id, creator_id: r.creator_id, refunded_net_cents: r.refunded_net_cents, conv: { status: r.lr_creator_conversions?.status ?? 'PENDING', commission } };
  });
}
// Bereits anteilig zurückgeforderte Provision je Conversion (Summe der CLAWBACK-Anpassungen zu ihren Erstattungen).
async function clawedByConversion(conversionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!conversionIds.length) return out;
  const { data: rf, error } = await db().from('lr_creator_refunds').select('id, conversion_id').in('conversion_id', conversionIds);
  if (error || !rf?.length) return out;
  const byRefund = new Map(((rf ?? []) as unknown as { id: string; conversion_id: string }[]).map((r) => [r.id, r.conversion_id]));
  const { data: adj } = await db().from('lr_creator_adjustments').select('source_id, amount_cents').eq('kind', 'CLAWBACK').in('source_id', [...byRefund.keys()]);
  for (const a of (adj ?? []) as unknown as { source_id: string; amount_cents: number }[]) {
    const cid = byRefund.get(a.source_id);
    if (cid) out.set(cid, (out.get(cid) ?? 0) + Math.abs(a.amount_cents));
  }
  return out;
}
async function markRefunds(ids: string[], as: 'CLAWBACK' | 'REVERSED' | 'IGNORED'): Promise<void> {
  if (ids.length) await db().from('lr_creator_refunds').update({ processed_at: new Date().toISOString(), processed_as: as }).in('id', ids).is('processed_at', null);
}

// ---------------- Monatsabschluss ----------------
export async function closePeriod(period: string, actor: Actor, now = new Date()): Promise<{ closed: number; clawbacks: number; carried: number }> {
  const delay = Number(await setting('creator_close_delay_days', 15)) || 15;
  if (now < closeAllowedAt(period, delay)) throw new Error(`Abschluss ab ${dDE(closeAllowedAt(period, delay))} möglich (Widerrufsfrist).`);
  const { from, to } = periodBounds(period);

  // 1) Erstattungen: Teilerstattungen bereits abgerechneter Käufe anteilig, vollständige Erstattungen mit der
  //    restlichen Provision zurückfordern; Teilerstattungen noch offener Käufe mindern unten die Grundlage.
  const refunds = await openRefunds();
  let clawbacks = 0;
  const clawedSoFar = await clawedByConversion([...new Set(refunds.map((r) => r.conversion_id))]);
  for (const r of refunds) {
    const conv = r.conv;
    if (!conv.commission) { if (conv.status === 'REVERSED') await markRefunds([r.id], 'IGNORED'); continue; }
    if (conv.status === 'REVERSED') continue; // unten mit der restlichen Provision
    const already = clawedSoFar.get(r.conversion_id) ?? 0;
    const amt = partialClawback(conv.commission.commission_cents, conv.commission.base_cents, r.refunded_net_cents, already);
    if (amt > 0) {
      const ins = await db().from('lr_creator_adjustments').upsert({ creator_id: r.creator_id, period, kind: 'CLAWBACK', amount_cents: -amt, reason: 'Anteilige Rückforderung: Kauf wurde teilweise erstattet', source_id: r.id, created_by: actor.ref }, { onConflict: 'kind,source_id', ignoreDuplicates: true }).select('id');
      if (ins.data?.length) { clawbacks++; clawedSoFar.set(r.conversion_id, already + amt); }
    }
    await markRefunds([r.id], amt > 0 ? 'CLAWBACK' : 'IGNORED');
  }
  const { data: rev } = await db().from('lr_creator_commissions').select('id, conversion_id, creator_id, commission_cents, status, lr_creator_conversions!inner(status)')
    .neq('status', 'CLAWED_BACK').eq('lr_creator_conversions.status', 'REVERSED');
  const revRows = (rev ?? []) as unknown as { id: string; conversion_id: string; creator_id: string; commission_cents: number }[];
  const clawedRev = await clawedByConversion(revRows.map((c) => c.conversion_id));
  for (const c of revRows) {
    const rest = c.commission_cents - (clawedRev.get(c.conversion_id) ?? 0);
    if (rest > 0) {
      const ins = await db().from('lr_creator_adjustments').upsert({ creator_id: c.creator_id, period, kind: 'CLAWBACK', amount_cents: -rest, reason: 'Rückforderung: Kauf wurde erstattet', source_id: c.id, created_by: actor.ref }, { onConflict: 'kind,source_id', ignoreDuplicates: true }).select('id');
      if (ins.data?.length) clawbacks++;
    }
    await db().from('lr_creator_commissions').update({ status: 'CLAWED_BACK' }).eq('id', c.id);
    await markRefunds(refunds.filter((r) => r.conversion_id === c.conversion_id).map((r) => r.id), 'REVERSED');
  }

  // 2) Negative Salden früherer Monate übertragen
  const { data: neg } = await db().from('lr_creator_statements').select('id, creator_id, net_cents').lt('net_cents', 0).eq('carried_over', false).lt('period', period);
  let carried = 0;
  for (const s of (neg ?? []) as unknown as { id: string; creator_id: string; net_cents: number }[]) {
    await db().from('lr_creator_adjustments').upsert({ creator_id: s.creator_id, period, kind: 'CARRY_OVER', amount_cents: s.net_cents, reason: 'Übertrag negativer Saldo aus Vormonat', source_id: s.id, created_by: actor.ref }, { onConflict: 'kind,source_id', ignoreDuplicates: true });
    await db().from('lr_creator_statements').update({ carried_over: true }).eq('id', s.id);
    carried++;
  }

  // 3) Offene Conversions des Monats (noch nicht provisioniert) und offene Anpassungen
  const [convRes, adjRes, rulesRes, doneRes] = await Promise.all([
    db().from('lr_creator_conversions').select('id, creator_id, campaign_slug, amount_net_cents, occurred_at, plan, source, lr_creator_commissions(id)').eq('status', 'PENDING').gte('occurred_at', from.toISOString()).lt('occurred_at', to.toISOString()),
    db().from('lr_creator_adjustments').select('id, creator_id, kind, amount_cents, reason, period').is('statement_id', null).lte('period', period),
    db().from('lr_creator_commission_rules').select('*'),
    db().from('lr_creator_statements').select('creator_id').eq('period', period),
  ]);
  const done = new Set(((doneRes.data ?? []) as unknown as { creator_id: string }[]).map((x) => x.creator_id));
  const conversions = ((convRes.data ?? []) as unknown as (ConversionIn & { lr_creator_commissions?: { id: string }[] | { id: string } | null })[])
    .filter((c) => !(Array.isArray(c.lr_creator_commissions) ? c.lr_creator_commissions.length : c.lr_creator_commissions)).filter((c) => !done.has(c.creator_id));
  const adjustments = ((adjRes.data ?? []) as unknown as (AdjustmentIn & { id: string; creator_id: string })[]).filter((a) => !done.has(a.creator_id));
  const rules = (rulesRes.data ?? []) as unknown as Rule[];
  const ids = [...new Set([...conversions.map((c) => c.creator_id), ...adjustments.map((a) => a.creator_id)])];
  if (!ids.length) { await audit('PERIOD_CLOSED', null, actor, 'SUCCESS', { period, statements: 0 }); return { closed: 0, clawbacks, carried }; }

  const f = await factsFor(ids);
  // Teilerstattungen noch nicht abgerechneter Käufe mindern die Grundlage (und werden mit dem Abschluss verrechnet).
  const baseRefunds = new Map<string, { ids: string[]; net: number }>();
  for (const r of refunds) {
    if (r.conv.commission || r.conv.status === 'REVERSED') continue;
    const e = baseRefunds.get(r.conversion_id) ?? { ids: [], net: 0 };
    e.ids.push(r.id); e.net += r.refunded_net_cents; baseRefunds.set(r.conversion_id, e);
  }
  for (const c of conversions) { const e = baseRefunds.get(c.id); if (e) c.amount_net_cents = reducedBase(c.amount_net_cents, e.net); }
  const lines = commissionLines(rules, conversions);
  const payload = ids.map((cid) => {
    const c = f.creators.get(cid);
    const b = (f.business.get(cid) ?? noBusiness) as BusinessIn & Record<string, unknown>;
    const tax = taxTreatment({ country: String(b.country || 'DE'), vat_status: b.vat_status, vat_id: (b.vat_id as string) ?? null, tax_number: (b.tax_number as string) ?? null });
    const myLines = lines.filter((l) => l.creator_id === cid);
    const myAdj = adjustments.filter((a) => a.creator_id === cid);
    const t = statementTotals(myLines.map((l) => l.commission_cents), myAdj, tax);
    const mode: BillingMode = c?.billing_mode === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE';
    return {
      creator_id: cid, status: statementStatusAfterClose(mode, t.payout_cents), billing_mode: mode,
      conversions: myLines.length, revenue_net_cents: myLines.reduce((a, l) => a + l.base_cents, 0),
      commission_cents: t.commission_cents, adjustments_cents: t.adjustments_cents, net_cents: t.net_cents, vat_rate_bps: tax.rate_bps, vat_cents: t.vat_cents,
      gross_cents: t.gross_cents, payout_cents: t.payout_cents, tax_mode: tax.mode, tax_note: tax.note,
      billing_snapshot: {
        legal_name: b.legal_name ?? [c?.first_name, c?.last_name].filter(Boolean).join(' '), legal_form: b.legal_form ?? null, street: b.street ?? null, postal_code: b.postal_code ?? null,
        city: b.city ?? null, country: b.country ?? null, tax_number: b.tax_number ?? null, vat_id: b.vat_id ?? null, billing_email: b.billing_email ?? null, display_name: c?.display_name ?? null,
      },
      adjustment_ids: myAdj.map((a) => a.id),
      refund_ids: myLines.flatMap((l) => baseRefunds.get(l.conversion_id)?.ids ?? []),
      lines: myLines.map((l) => ({ conversion_id: l.conversion_id, rule_id: l.rule_id ?? '', rule_version: l.rule_version ?? '', base_cents: l.base_cents, commission_cents: l.commission_cents })),
    };
  });
  const { data, error } = await db().rpc('lr_creator_close_period', { p_period: period, p_actor: actor.ref, p_statements: payload });
  if (error) throw new Error(`Abschluss fehlgeschlagen: ${error.message}`);
  await audit('PERIOD_CLOSED', null, actor, 'SUCCESS', { period, statements: Number(data) || payload.length, clawbacks, carried });
  return { closed: Number(data) || payload.length, clawbacks, carried };
}

// ---------------- Dokumente ----------------
export type StatementRow = {
  id: string; creator_id: string; period: string; status: string; billing_mode: BillingMode; conversions: number; revenue_net_cents: number;
  commission_cents: number; adjustments_cents: number; net_cents: number; vat_rate_bps: number; vat_cents: number; gross_cents: number; payout_cents: number;
  tax_mode: string; tax_note: string; billing_snapshot: Record<string, string | null>; closed_at: string; approved_at: string | null; paid_at: string | null;
};

async function storeDoc(s: StatementRow, docType: 'STATEMENT' | 'INVOICE' | 'CREDIT_NOTE', number: string, bytes: Uint8Array, actorRef: string) {
  const id = randomUUID();
  const path = `docs/${id}/${docType.toLowerCase()}-${number.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`;
  const up = await db().storage.from(DOC_BUCKET).upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error('Dokument konnte nicht gespeichert werden.');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { data, error } = await db().from('lr_creator_documents').insert({ id, creator_id: s.creator_id, statement_id: s.id, doc_type: docType, number, storage_path: path, sha256,
    totals: { net_cents: s.net_cents, vat_cents: s.vat_cents, gross_cents: s.gross_cents, payout_cents: s.payout_cents }, created_by: actorRef }).select('*').single();
  if (error) { await db().storage.from(DOC_BUCKET).remove([path]); throw new Error(/unique|duplicate/i.test(error.message) ? 'Für diese Abrechnung gibt es bereits ein Dokument dieser Art.' : 'Dokument konnte nicht gespeichert werden.'); }
  return data as { id: string; number: string; storage_path: string };
}

async function statementLines(s: StatementRow): Promise<{ lines: DocLine[]; adj: DocLine[] }> {
  const [com, adj] = await Promise.all([
    db().from('lr_creator_commissions').select('base_cents, commission_cents, lr_creator_conversions(occurred_at, plan, source, campaign_slug)').eq('statement_id', s.id).order('created_at'),
    db().from('lr_creator_adjustments').select('kind, amount_cents, reason').eq('statement_id', s.id),
  ]);
  type C = { base_cents: number; commission_cents: number; lr_creator_conversions: { occurred_at: string; plan: string | null; source: string; campaign_slug: string | null } | null };
  const KIND: Record<string, string> = { BONUS: 'Bonus', CORRECTION: 'Korrektur', CLAWBACK: 'Rückforderung', CARRY_OVER: 'Übertrag' };
  return {
    lines: ((com.data ?? []) as unknown as C[]).map((c) => ({
      description: `Provision ${c.lr_creator_conversions ? dDE(c.lr_creator_conversions.occurred_at) : ''} · ${PLAN[c.lr_creator_conversions?.plan ?? ''] ?? c.lr_creator_conversions?.plan ?? 'Kauf'}`,
      detail: `Netto-Umsatz ${eurText(c.base_cents)} · über ${c.lr_creator_conversions?.source === 'code' ? 'Vorteilscode' : 'Creator-Link'}${c.lr_creator_conversions?.campaign_slug ? ` · Kampagne ${c.lr_creator_conversions.campaign_slug}` : ''}`,
      amountCents: c.commission_cents,
    })),
    adj: ((adj.data ?? []) as unknown as { kind: string; amount_cents: number; reason: string }[]).map((a) => ({ description: `${KIND[a.kind] ?? a.kind}: ${a.reason}`, amountCents: a.amount_cents })),
  };
}

const creatorParty = (s: StatementRow) => {
  const b = s.billing_snapshot;
  const ids = [b.tax_number ? `Steuernummer ${b.tax_number}` : null, b.vat_id ? `USt-IdNr. ${b.vat_id}` : null].filter(Boolean) as string[];
  return { name: [b.legal_name, b.legal_form].filter(Boolean).join(' ') || 'Creator', lines: [b.street, [b.postal_code, b.city].filter(Boolean).join(' '), b.country && b.country !== 'DE' ? b.country : null].filter(Boolean) as string[], taxIds: ids };
};
const immoParty = () => ({ name: ISSUER.name, lines: [`Inh. ${ISSUER.owner}`, ISSUER.street, ISSUER.city], taxIds: [`USt-IdNr. ${ISSUER.vatId}`] });
const totalsRows = (s: StatementRow): [string, string, boolean?][] => [
  ['Summe netto', eurText(s.net_cents)],
  ...(s.vat_cents ? [[`Umsatzsteuer ${(s.vat_rate_bps / 100).toLocaleString('de-DE')} %`, eurText(s.vat_cents)] as [string, string]] : []),
  ['Gesamtbetrag', eurText(s.gross_cents), true],
];

export async function ensureStatementPdf(s: StatementRow, actorRef: string) {
  const { data: have } = await db().from('lr_creator_documents').select('id, number, storage_path').eq('statement_id', s.id).eq('doc_type', 'STATEMENT').order('version', { ascending: false }).limit(1).maybeSingle();
  if (have) return have as { id: string; number: string; storage_path: string };
  const { lines, adj } = await statementLines(s);
  const number = `AB-${s.period}-${s.creator_id.slice(0, 8)}`;
  const bytes = await renderDoc({
    kind: 'STATEMENT', title: `Creator-Abrechnung ${periodLabel(s.period)}`, number, issueDate: dDE(new Date()), servicePeriod: servicePeriodText(s.period),
    issuer: immoParty(), recipient: creatorParty(s),
    meta: [['Conversions', String(s.conversions)], ['Netto-Umsatz', eurText(s.revenue_net_cents)], ['Verfahren', s.billing_mode === 'CREDIT_NOTE' ? 'Gutschrift' : 'Rechnung des Creators']],
    lines: [...lines, ...adj],
    totals: [['Provision', eurText(s.commission_cents)], ['Anpassungen', eurText(s.adjustments_cents)], ...totalsRows(s), ['Auszahlungsbetrag', eurText(s.payout_cents), true]],
    notes: [s.tax_note, 'Diese Abrechnung ist eine Übersicht und keine Rechnung. Grundlage sind die serverseitig erfassten, bezahlten und nicht erstatteten Käufe.'],
    footer: `LeaseRun · ${ISSUER.street} · ${ISSUER.city} · Abrechnung ${number}`,
  });
  return storeDoc(s, 'STATEMENT', number, bytes, actorRef);
}

// Rechnung des Creators (vom System vorausgefüllt, vom Creator bestätigt) – Aussteller ist der Creator.
export async function createCreatorInvoice(s: StatementRow, number: string, maskedAccount: string | null, actor: Actor) {
  if (s.billing_mode !== 'INVOICE') throw new Error('Für diese Abrechnung erstellt LeaseRun eine Gutschrift.');
  if (s.status !== 'READY' || s.payout_cents <= 0) throw new Error('Für diese Abrechnung kann gerade keine Rechnung erstellt werden.');
  const p = creatorParty(s);
  if (s.billing_snapshot.country === 'DE' && !p.taxIds.length) throw new Error('Für eine Rechnung brauchst du eine Steuernummer oder USt-IdNr. Bitte in deinem Profil unter Rechnungsdaten ergänzen und LeaseRun informieren.');
  const { lines, adj } = await statementLines(s);
  const bytes = await renderDoc({
    kind: 'INVOICE', title: 'Rechnung', number, issueDate: dDE(new Date()), servicePeriod: servicePeriodText(s.period),
    issuer: p, recipient: immoParty(),
    meta: [['Abrechnung', periodLabel(s.period)], ...(maskedAccount ? [['Zahlung an', maskedAccount] as [string, string]] : [])],
    lines: [{ description: `Werbeleistung im LeaseRun Creator-Partnerprogramm: Provision ${periodLabel(s.period)}`, detail: `${s.conversions} Conversion(s), Netto-Umsatz ${eurText(s.revenue_net_cents)}; Einzelaufstellung in der Creator-Abrechnung`, amountCents: s.commission_cents }, ...adj],
    totals: totalsRows(s),
    notes: [s.tax_note, maskedAccount ? `Zahlung auf das im LeaseRun Creator-Portal hinterlegte Konto ${maskedAccount}.` : 'Zahlung auf das im LeaseRun Creator-Portal hinterlegte Konto.', `Positionen: ${lines.length} Provisionszeile(n) gemäß Abrechnung.`],
    footer: `${p.name} · Rechnung ${number} · erstellt im LeaseRun Creator Hub`,
  });
  const doc = await storeDoc(s, 'INVOICE', number, bytes, actor.ref);
  const { data } = await db().from('lr_creator_statements').update({ status: 'INVOICED' }).eq('id', s.id).eq('status', 'READY').select('id');
  if (!data?.length) throw new Error('Status wurde inzwischen geändert.');
  await audit('INVOICE_CREATED', s.creator_id, actor, 'SUCCESS', { period: s.period, number, gross_cents: s.gross_cents });
  return doc;
}

// Gutschrift durch LeaseRun (§ 14 Abs. 2 Satz 2 UStG) – fortlaufende LeaseRun-Nummer.
async function createCreditNote(s: StatementRow, actor: Actor, maskedAccount: string | null) {
  const year = Number(s.period.slice(0, 4));
  const { data: n, error } = await db().rpc('lr_creator_next_number', { p_name: `creator_credit_note_${year}` });
  const seq = Number(n);
  if (error || !seq) throw new Error('Gutschriftnummer konnte nicht vergeben werden. Bitte erneut versuchen.');
  const number = creditNoteNumber(year, seq);
  const { adj } = await statementLines(s);
  const bytes = await renderDoc({
    kind: 'CREDIT_NOTE', title: 'Gutschrift', number, issueDate: dDE(new Date()), servicePeriod: servicePeriodText(s.period),
    issuer: immoParty(), recipient: creatorParty(s),
    meta: [['Abrechnung', periodLabel(s.period)], ...(maskedAccount ? [['Auszahlung an', maskedAccount] as [string, string]] : [])],
    lines: [{ description: `Werbeleistung im LeaseRun Creator-Partnerprogramm: Provision ${periodLabel(s.period)}`, detail: `${s.conversions} Conversion(s), Netto-Umsatz ${eurText(s.revenue_net_cents)}`, amountCents: s.commission_cents }, ...adj],
    totals: totalsRows(s),
    notes: ['Gutschrift im Sinne von § 14 Abs. 2 Satz 2 UStG.', `Leistender: ${creatorParty(s).name}${creatorParty(s).taxIds.length ? ` (${creatorParty(s).taxIds.join(', ')})` : ''}.`, s.tax_note],
    footer: `LeaseRun · ${ISSUER.street} · ${ISSUER.city} · Gutschrift ${number}`,
  });
  return storeDoc(s, 'CREDIT_NOTE', number, bytes, actor.ref);
}

// ---------------- Freigabe und Auszahlung ----------------
export async function statementBlockers(s: StatementRow) {
  const f = await factsFor([s.creator_id]);
  const c = f.creators.get(s.creator_id);
  const pay = f.payout.get(s.creator_id) ?? null;
  const { data: inv } = await db().from('lr_creator_documents').select('id').eq('statement_id', s.id).eq('doc_type', 'INVOICE').limit(1);
  const tax: TaxTreatment = { mode: s.tax_mode as TaxTreatment['mode'], rate_bps: s.vat_rate_bps, note: s.tax_note };
  return { list: blockers({ creatorActive: c?.status === 'ACTIVE', payoutStatus: pay?.status ?? null, agreementAccepted: f.accepted.has(s.creator_id), tax, mode: s.billing_mode, hasInvoice: Boolean(inv?.length), payoutCents: s.payout_cents }), pay, creator: c };
}

export async function approveStatement(s: StatementRow, actor: Actor) {
  if (!['READY', 'INVOICED'].includes(s.status)) throw new Error('Diese Abrechnung kann nicht (mehr) freigegeben werden.');
  const b = await statementBlockers(s);
  if (b.list.length) throw Object.assign(new Error('Freigabe gesperrt.'), { blockers: b.list });
  const masked = b.pay ? maskIban(b.pay.iban_country, b.pay.iban_last4) : null;
  if (s.billing_mode === 'CREDIT_NOTE') await createCreditNote(s, actor, masked);
  const now = new Date().toISOString();
  const { data } = await db().from('lr_creator_statements').update({ status: 'APPROVED', approved_at: now, approved_by: actor.ref }).eq('id', s.id).eq('status', s.status).select('id');
  if (!data?.length) throw new Error('Status wurde inzwischen geändert.');
  await db().from('lr_creator_commissions').update({ status: 'APPROVED' }).eq('statement_id', s.id).eq('status', 'PENDING');
  const ins = await db().from('lr_creator_payouts').insert({ statement_id: s.id, creator_id: s.creator_id, amount_cents: s.payout_cents, payout_account_id: b.pay!.id,
    iban_country: b.pay!.iban_country, iban_last4: b.pay!.iban_last4, reference: `LeaseRun Creator ${periodLabel(s.period)} ${s.id.slice(0, 8)}`, created_by: actor.ref }).select('id').single();
  if (ins.error) throw new Error('Auszahlung konnte nicht angelegt werden.');
  await audit('STATEMENT_APPROVED', s.creator_id, actor, 'SUCCESS', { period: s.period, payout_cents: s.payout_cents });
  if (s.billing_mode === 'INVOICE') await audit('INVOICE_APPROVED', s.creator_id, actor, 'SUCCESS', { period: s.period });
  await audit('PAYOUT_CREATED', s.creator_id, actor, 'SUCCESS', { period: s.period, amount_cents: s.payout_cents });
  return ins.data;
}

// ---------------- Auszahlung als bezahlt vermerken (manuell oder aus dem Kontoauszug) ----------------
export type PayoutForPaid = { id: string; creator_id: string; statement_id: string; amount_cents: number; status: string; reference: string; iban_country: string; iban_last4: string };
export async function markPayoutPaid(p: PayoutForPaid, actor: Actor, o: { paidAt?: string | null; via: 'MANUAL' | 'BANK_STATEMENT'; bankRef?: string | null }): Promise<boolean> {
  if (p.status !== 'APPROVED' && p.status !== 'EXPORTED') return false;
  const paidAt = o.paidAt ? new Date(`${o.paidAt.slice(0, 10)}T12:00:00Z`).toISOString() : new Date().toISOString();
  const patch: Record<string, unknown> = { status: 'PAID', paid_by: actor.ref, paid_at: paidAt, paid_via: o.via, bank_ref: o.bankRef ? o.bankRef.slice(0, 120) : null };
  let res = await db().from('lr_creator_payouts').update(patch).eq('id', p.id).eq('status', p.status).select('id');
  if (res.error && /paid_via|bank_ref/.test(res.error.message)) { // ohne Phase-4-Migration
    delete patch.paid_via; delete patch.bank_ref;
    res = await db().from('lr_creator_payouts').update(patch).eq('id', p.id).eq('status', p.status).select('id');
  }
  if (!res.data?.length) return false;
  await db().from('lr_creator_statements').update({ status: 'PAID', paid_at: paidAt }).eq('id', p.statement_id).eq('status', 'APPROVED');
  await db().from('lr_creator_commissions').update({ status: 'PAID' }).eq('statement_id', p.statement_id).eq('status', 'APPROVED');
  await audit('PAYOUT_PAID', p.creator_id, actor, 'SUCCESS', { amount_cents: p.amount_cents, via: o.via });
  const to = await creatorContact(p.creator_id);
  if (to) {
    await sendMail(to.email, 'Deine Auszahlung von LeaseRun', `Hallo ${to.name},\n\nwir haben ${eurText(p.amount_cents)} an dein Konto ${maskIban(p.iban_country, p.iban_last4)} überwiesen (Verwendungszweck: ${p.reference}). Je nach Bank ist der Betrag in 1–2 Bankarbeitstagen gutgeschrieben.\n\nDeine Abrechnungen findest du im Creator-Portal: ${SITE_ORIGIN}/creator#abrechnung`, [], { title: 'Auszahlung überwiesen' }).catch(() => false);
  }
  return true;
}

// Rückläufer nach „bezahlt“ (Bank hat die Überweisung zurückgegeben): Abrechnung wieder offen, Konto zur Prüfung,
// Creator wird gebeten, die Zahlungsdaten zu prüfen. Danach wird dieselbe Auszahlung erneut angestoßen.
export async function markPayoutReturned(payoutId: string, actor: Actor, reason: string): Promise<boolean> {
  const { data, error } = await db().rpc('lr_creator_payout_returned', { p_payout: payoutId, p_reason: reason });
  if (error) throw new Error(error.message.includes('Nur bezahlte') ? 'Nur bezahlte Auszahlungen können als zurückgekommen markiert werden.' : 'Nicht möglich (Phase-4-Migration angewendet?).');
  const r = data as { creator_id: string; amount_cents: number; changed: boolean };
  if (!r.changed) return false;
  await audit('PAYOUT_RETURNED', r.creator_id, actor, 'FAILED', { amount_cents: r.amount_cents });
  const to = await creatorContact(r.creator_id);
  if (to) {
    await sendMail(to.email, 'Deine Auszahlung ist zurückgekommen', `Hallo ${to.name},\n\ndeine Auszahlung über ${eurText(r.amount_cents)} wurde von der Bank zurückgegeben. Bitte prüfe im Creator-Portal deine Zahlungsdaten (Kontoinhaber und IBAN) und ändere sie bei Bedarf. Sobald sie geprüft sind, zahlen wir erneut aus – an deiner Abrechnung ändert sich nichts.\n\n${SITE_ORIGIN}/creator#auszahlung`, [], { title: 'Auszahlung zurückgekommen' }).catch(() => false);
  }
  return true;
}

export async function reissuePayout(payoutId: string, actor: Actor): Promise<void> {
  const { data, error } = await db().rpc('lr_creator_payout_reissue', { p_payout: payoutId, p_actor: actor.ref });
  if (error) {
    const known = ['Die Zahlungsdaten müssen zuerst geprüft werden.', 'Der Creator hat keine Zahlungsdaten hinterlegt.', 'Nur zurückgekommene Auszahlungen können neu angestoßen werden.'];
    throw new Error(known.find((k) => error.message.includes(k)) ?? 'Nicht möglich.');
  }
  const r = data as { creator_id: string; amount_cents: number };
  await audit('PAYOUT_REISSUED', r.creator_id, actor, 'SUCCESS', { amount_cents: r.amount_cents });
}

async function creatorContact(creatorId: string): Promise<{ email: string; name: string } | null> {
  const { data: c } = await db().from('lr_creators').select('user_id, first_name, display_name').eq('id', creatorId).maybeSingle();
  if (!c?.user_id) return null;
  const { data: u } = await db().auth.admin.getUserById(c.user_id);
  const em = u?.user ? await contactEmail(u.user) : '';
  return em ? { email: em, name: c.first_name || c.display_name || '' } : null;
}

// ---------------- Automatik (täglicher Lauf): Monatsabschluss, Hinweise, Erinnerungen ----------------
export const SYSTEM_BILLING: Actor = { kind: 'system', ref: 'cron:creator-billing', role: 'SYSTEM' };

export async function runCreatorBilling(now = new Date()): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // 1) Automatischer Monatsabschluss (nur wenn eingeschaltet, einmal je Monat, frühestens nach der Sperrfrist)
  if ((await setting('creator_auto_close', false)) === true) {
    const period = previousPeriod(periodOf(now));
    const delay = Number(await setting('creator_close_delay_days', 15)) || 15;
    if (now < closeAllowedAt(period, delay)) out.close = 'nicht fällig';
    else {
      const { data: done } = await db().from('lr_creator_audit').select('id').eq('event_type', 'PERIOD_CLOSED').contains('meta', { period }).limit(1);
      if (done?.length) out.close = 'bereits abgeschlossen';
      else out.close = await closePeriod(period, SYSTEM_BILLING, now).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    }
  } else out.close = 'aus';
  if (!mailConfigured()) return { ...out, mail: 'nicht eingerichtet' };

  // 2) Hinweis „Abrechnung bereit“ (nur jüngere Abrechnungen, damit beim Einschalten keine Altlasten verschickt werden)
  const since = new Date(now.getTime() - 30 * 864e5).toISOString();
  const { data: fresh, error: fe } = await db().from('lr_creator_statements').select('id, creator_id, period, billing_mode, payout_cents, status')
    .is('notified_at', null).in('status', ['READY', 'INVOICED', 'APPROVED']).gte('closed_at', since).limit(500);
  if (fe) return { ...out, notify: 'Phase-4-Migration fehlt' };
  let notified = 0;
  for (const s of (fresh ?? []) as unknown as { id: string; creator_id: string; period: string; billing_mode: BillingMode; payout_cents: number }[]) {
    const to = await creatorContact(s.creator_id);
    const m = readyMail(s.billing_mode, s.period, s.payout_cents, to?.name ?? '');
    const ok = to ? await sendMail(to.email, m.subject, m.text, [], { title: m.title }).catch(() => false) : true;
    if (!ok) continue;
    const { data } = await db().from('lr_creator_statements').update({ notified_at: now.toISOString() }).eq('id', s.id).is('notified_at', null).select('id');
    if (data?.length && to) { notified++; await audit('CREATOR_NOTIFIED', s.creator_id, SYSTEM_BILLING, 'SUCCESS', { kind: 'statement_ready', period: s.period }); }
  }

  // 3) Eine Erinnerung, wenn die Rechnung des Creators nach N Tagen noch fehlt
  const days = Number(await setting('creator_invoice_reminder_days', 7)) || 7;
  const before = new Date(now.getTime() - days * 864e5).toISOString();
  const { data: due } = await db().from('lr_creator_statements').select('id, creator_id, period')
    .eq('status', 'READY').eq('billing_mode', 'INVOICE').is('reminded_at', null).lt('notified_at', before).limit(500);
  let reminded = 0;
  for (const s of (due ?? []) as unknown as { id: string; creator_id: string; period: string }[]) {
    const to = await creatorContact(s.creator_id);
    const m = reminderMail(s.period, to?.name ?? '');
    const ok = to ? await sendMail(to.email, m.subject, m.text, [], { title: m.title }).catch(() => false) : true;
    if (!ok) continue;
    const { data } = await db().from('lr_creator_statements').update({ reminded_at: now.toISOString() }).eq('id', s.id).is('reminded_at', null).select('id');
    if (data?.length && to) { reminded++; await audit('CREATOR_NOTIFIED', s.creator_id, SYSTEM_BILLING, 'SUCCESS', { kind: 'invoice_reminder', period: s.period }); }
  }
  return { ...out, notified, reminded };
}
