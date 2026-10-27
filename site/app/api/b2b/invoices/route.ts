import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';
import { loadInvoicePdf, type InvoiceRow } from '@/lib/b2b/invoice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rechnungen des eigenen Unternehmens (nur Kontoinhaber). Auch bei gesperrtem Konto abrufbar.
export async function GET(req: Request) {
  const ctx = await requireMember(req, { owner: true, allowLocked: true, bucket: 'b2b-inv' });
  if (ctx instanceof Response) return ctx;
  const id = new URL(req.url).searchParams.get('id');
  const db = supabaseAdmin();
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültige Anfrage.' }, 400);
    const { data } = await db.from('lr_invoices').select('*').eq('id', id).eq('account_id', ctx.account.id).maybeSingle();
    if (!data) return json({ error: 'Rechnung nicht gefunden.' }, 404);
    const r = data as InvoiceRow;
    if (r.stripe_pdf_url) return NextResponse.redirect(r.stripe_pdf_url, 302);
    const f = await loadInvoicePdf(r);
    if (!f) return json({ error: 'PDF nicht verfügbar.' }, 404);
    return new NextResponse(new Uint8Array(f.pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${String(r.issue_date || "").slice(0, 10)}_${r.invoice_number}.pdf"`, 'X-Integrity': f.intact ? 'ok' : 'mismatch', 'Cache-Control': 'no-store' },
    });
  }
  const { data } = await db
    .from('lr_invoices')
    .select('id, invoice_number, kind, issue_date, service_period, net_cents, vat_cents, gross_cents, payment_method, payment_status, due_date, paid_at, source, stripe_pdf_url')
    .eq('account_id', ctx.account.id)
    .order('issue_date', { ascending: false })
    .limit(200);
  return json({ invoices: data ?? [] });
}
