import { NextResponse } from 'next/server';
import { logSecurity } from '@/lib/security/seclog';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit, type B2BAccount } from '@/lib/b2b/core';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { customerScope, scopeError } from '@/lib/admin/scope';
import { bankDetails, buyerFromAccount, issueInvoice, loadInvoicePdf, type InvoiceRow } from '@/lib/b2b/invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// GoBD-Archiv: alle Rechnungen (unlöschbar), Abruf des PDFs mit Prüfsummen-Kontrolle.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'finance');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const u = new URL(req.url);
  const db = supabaseAdmin();
  const id = u.searchParams.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return j({ error: 'Ungültig.' }, 400);
    const { data } = await db.from('lr_invoices').select('*').eq('id', id).maybeSingle();
    if (!data) return j({ error: 'Nicht gefunden.' }, 404);
    const r = data as InvoiceRow;
    if (r.stripe_pdf_url) return NextResponse.redirect(r.stripe_pdf_url, 302);
    const f = await loadInvoicePdf(r);
    if (!f) return j({ error: 'PDF nicht verfügbar.' }, 404);
    return new NextResponse(new Uint8Array(f.pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${String(r.issue_date || "").slice(0, 10)}_${r.invoice_number}.pdf"`, 'X-Integrity': f.intact ? 'ok' : 'mismatch', 'Access-Control-Expose-Headers': 'X-Integrity', 'Cache-Control': 'no-store' },
    });
  }
  const q = (u.searchParams.get('q') || '').trim();
  const scope = customerScope(req);
  if (!scope) return j(scopeError, 400);
  let query = db.from('lr_invoices').select('id, invoice_number, kind, refers_to, source, account_id, buyer, net_cents, vat_cents, gross_cents, payment_method, payment_status, issue_date, due_date, paid_at, pdf_sha256, stripe_pdf_url, created_at').order('created_at', { ascending: false }).limit(1000);
  query = scope === 'b2b' ? query.not('account_id', 'is', null) : query.is('account_id', null);
  if (q) query = query.ilike('invoice_number', `%${q.replace(/[%_]/g, '')}%`);
  const { data, error } = await query;
  if (error) return j({ error: error.message }, 500);
  return j({ invoices: data ?? [], bankConfigured: Boolean(bankDetails()) });
}

const Item = z.object({ description: z.string().trim().min(2).max(300), quantity: z.number().positive().max(10_000), unitNetCents: z.number().int().min(0).max(100_000_000) });
const Create = z.object({
  action: z.literal('create'),
  accountId: z.string().uuid(),
  items: z.array(Item).min(1).max(30),
  paymentMethod: z.enum(['INVOICE_BANK_TRANSFER', 'SEPA_B2B', 'STRIPE_CARD']),
  servicePeriod: z.string().trim().max(60).optional(),
  paid: z.boolean().optional(),
});
const Storno = z.object({ action: z.literal('storno'), invoiceId: z.string().uuid() });
const Paid = z.object({ action: z.literal('paid'), invoiceId: z.string().uuid() });
const Remind = z.object({ action: z.literal('remind'), invoiceId: z.string().uuid() });

const eur = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const dmy = (d: string | null) => (d ? d.split('-').reverse().join('.') : 'sofort');

// Rechnung bzw. Erinnerung mit PDF an die Konto-E-Mail des Unternehmens senden.
async function mailInvoice(r: InvoiceRow, kind: 'new' | 'remind'): Promise<boolean> {
  if (!mailConfigured() || !r.account_id) return false;
  const { data: a } = await supabaseAdmin().from('lr_b2b_accounts').select('email, advisor_name').eq('id', r.account_id).maybeSingle();
  if (!a?.email) return false;
  const f = await loadInvoicePdf(r);
  if (!f) return false;
  const title = r.kind === 'storno' ? 'Stornorechnung' : 'Rechnung';
  const text = kind === 'new'
    ? `Guten Tag ${a.advisor_name},\n\nanbei erhalten Sie unsere ${title} ${r.invoice_number} über ${eur(r.gross_cents)}.${r.kind === 'invoice' && r.payment_method === 'INVOICE_BANK_TRANSFER' ? `\nZahlbar bis ${dmy(r.due_date)}. Den GiroCode auf der Rechnung können Sie mit Ihrer Banking-App scannen.` : ''}\n\nAlle Rechnungen finden Sie auch im Unternehmensportal: https://leaserun.com/business-portal#tarif\n\nMit freundlichen Grüßen\nLeaseRun`
    : `Guten Tag ${a.advisor_name},\n\nbei der Durchsicht unserer Buchhaltung haben wir festgestellt, dass die Rechnung ${r.invoice_number} vom ${dmy(r.issue_date)} über ${eur(r.gross_cents)} (fällig am ${dmy(r.due_date)}) noch offen ist.\nSicher handelt es sich um ein Versehen. Bitte überweisen Sie den Betrag in den nächsten 7 Tagen; die Rechnung liegt erneut bei.\nSollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.\n\nMit freundlichen Grüßen\nLeaseRun · support@leaserun.com`;
  return sendMail(a.email, kind === 'new' ? `${title} ${r.invoice_number}` : `Zahlungserinnerung: Rechnung ${r.invoice_number}`, text, [{ filename: `${r.invoice_number}.pdf`, content: f.pdf }], { area: 'b2b' });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'finance');
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null);
  const db = supabaseAdmin();
  try {
    // GoBD: alle gespeicherten Rechnungs-PDFs gegen die festgeschriebene SHA-256-Prüfsumme abgleichen.
    if (body?.action === 'verify') {
      const { data: rows } = await db.from('lr_invoices').select('*').order('created_at', { ascending: false }).limit(2000);
      const bad: string[] = []; const missing: string[] = []; let ok = 0;
      for (const r of (rows ?? []) as InvoiceRow[]) {
        const f = await loadInvoicePdf(r).catch(() => null);
        if (!f) { if (r.pdf_path) missing.push(r.invoice_number); continue; }
        if (f.intact) ok++; else bad.push(r.invoice_number);
      }
      if (bad.length) logSecurity('invoice_tampered', 'invoices', { detail: bad.slice(0, 20).join(', ') });
      await adminAudit(auth.user.email, 'invoice_verify', 'all', { ok, bad: bad.length, missing: missing.length });
      return j({ ok, bad, missing });
    }
    if (body?.action === 'create') {
      const p = Create.safeParse(body);
      if (!p.success) return j({ error: 'Bitte Positionen und Zahlungsart prüfen.' }, 400);
      const { data: a } = await db.from('lr_b2b_accounts').select('*').eq('id', p.data.accountId).maybeSingle();
      if (!a) return j({ error: 'Konto nicht gefunden.' }, 404);
      if (p.data.paymentMethod === 'INVOICE_BANK_TRANSFER' && !a.allow_invoice_payment) return j({ error: 'Kauf auf Rechnung ist für dieses Konto nicht freigeschaltet.' }, 409);
      const row = await issueInvoice({
        kind: 'invoice', buyer: buyerFromAccount(a as B2BAccount), items: p.data.items, accountId: a.id, paymentMethod: p.data.paymentMethod,
        servicePeriod: p.data.servicePeriod, paymentTermsDays: a.payment_terms_days, createdBy: auth.user.email, paid: p.data.paid,
      });
      const mailed = await mailInvoice(row, 'new');
      await adminAudit(auth.user.email, 'invoice_create', row.id, { number: row.invoice_number, gross: row.gross_cents, mailed });
      return j({ ok: true, invoice: row, mailed }, 201);
    }
    if (body?.action === 'storno') {
      const p = Storno.safeParse(body);
      if (!p.success) return j({ error: 'Ungültig.' }, 400);
      const { data: orig } = await db.from('lr_invoices').select('*').eq('id', p.data.invoiceId).maybeSingle();
      if (!orig) return j({ error: 'Rechnung nicht gefunden.' }, 404);
      const o = orig as InvoiceRow;
      if (o.kind !== 'invoice' || o.payment_status === 'CANCELLED') return j({ error: 'Diese Rechnung kann nicht (mehr) storniert werden.' }, 409);
      if (o.source === 'stripe') return j({ error: 'Stripe-Rechnungen bitte in Stripe stornieren (Gutschrift); sie wird automatisch archiviert.' }, 409);
      const row = await issueInvoice({ kind: 'storno', buyer: o.buyer, items: o.items, accountId: o.account_id, paymentMethod: o.payment_method, refersTo: o, createdBy: auth.user.email });
      const mailed = await mailInvoice(row, 'new');
      await adminAudit(auth.user.email, 'invoice_storno', row.id, { number: row.invoice_number, refers: o.invoice_number, mailed });
      return j({ ok: true, invoice: row, mailed }, 201);
    }
    if (body?.action === 'paid') {
      const p = Paid.safeParse(body);
      if (!p.success) return j({ error: 'Ungültig.' }, 400);
      const r = await db.from('lr_invoices').update({ payment_status: 'PAID', paid_at: new Date().toISOString() }).eq('id', p.data.invoiceId).in('payment_status', ['PENDING', 'OVERDUE']);
      if (r.error) return j({ error: r.error.message }, 500);
      await adminAudit(auth.user.email, 'invoice_paid', p.data.invoiceId);
      return j({ ok: true });
    }
    if (body?.action === 'remind') {
      const p = Remind.safeParse(body);
      if (!p.success) return j({ error: 'Ungültig.' }, 400);
      if (!mailConfigured()) return j({ error: 'E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY, NOTIFY_FROM_EMAIL).' }, 409);
      const { data } = await db.from('lr_invoices').select('*').eq('id', p.data.invoiceId).maybeSingle();
      const r = data as InvoiceRow | null;
      if (!r || !['PENDING', 'OVERDUE'].includes(r.payment_status)) return j({ error: 'Rechnung ist nicht offen.' }, 409);
      const { count } = await db.from('lr_admin_audit').select('id', { count: 'exact', head: true }).eq('action', 'invoice_remind').eq('target', r.id);
      const ok = await mailInvoice(r, 'remind');
      if (!ok) return j({ error: 'Versand fehlgeschlagen (keine Konto-E-Mail oder PDF fehlt).' }, 502);
      await adminAudit(auth.user.email, 'invoice_remind', r.id, { number: r.invoice_number, stufe: (count ?? 0) + 1 });
      return j({ ok: true, stufe: (count ?? 0) + 1 });
    }
    return j({ error: 'Unbekannte Aktion.' }, 400);
  } catch (e) {
    return j({ error: e instanceof Error ? e.message : 'Fehler' }, 500);
  }
}
