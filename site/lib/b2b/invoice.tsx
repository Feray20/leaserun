import '@/lib/env-alias';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { createElement } from 'react';
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRAND, Logo } from '@/lib/pdf/brand';
import { pdfSafeDeep, pdfText } from '@/lib/pdf/text';
import { paymentLinkPayload, totals, VAT_RATE } from '@/lib/b2b/epc';
export { paymentLinkPayload, totals, VAT_RATE };

// US invoices / receipts with gap-free numbering (INV-YYYY-MM-XXXXX), tamper-evident storage
// (database trigger + SHA-256) and an optional QR code that opens the online payment link. No VAT; amounts in USD.

// Seller block on invoices. Owner privacy: no personal name and no residential address – company contact only.
// A business mailing address can be set via INVOICE_SELLER_ADDRESS (e.g. a registered agent or PO box).
export const SELLER = {
  name: 'LeaseRun',
  address: process.env.INVOICE_SELLER_ADDRESS || '',
  country: 'United States',
  email: 'support@leaserun.com',
  web: 'leaserun.com',
};
export const INVOICE_BUCKET = 'immo-invoices';

// Payment instructions for pay-by-invoice: ACH/wire details are never printed from code defaults; they come from env.
// INVOICE_PAYMENT_LINK (https) = online payment page (card or ACH via Stripe); INVOICE_ACH_* = optional bank details.
export function bankDetails() {
  const link = (process.env.INVOICE_PAYMENT_LINK || '').trim();
  const routing = (process.env.INVOICE_ACH_ROUTING || '').replace(/\s+/g, '');
  const account = (process.env.INVOICE_ACH_ACCOUNT || '').replace(/\s+/g, '');
  const bank = process.env.INVOICE_BANK_NAME || '';
  const okLink = /^https:\/\//.test(link);
  const okAch = /^[0-9]{9}$/.test(routing) && /^[0-9]{4,17}$/.test(account);
  if (!okLink && !okAch) return null;
  return { link: okLink ? link : '', routing: okAch ? routing : '', account: okAch ? account : '', bank, holder: process.env.INVOICE_ACCOUNT_HOLDER || SELLER.name };
}

export type Buyer = { company: string; legalForm?: string; contact?: string; street?: string | null; postalCode: string; city: string; country?: string; vatId?: string | null; customerNumber?: string | null };
// vatId holds the optional EIN (federal Employer Identification Number) for US buyers; the field name stays for the database.
export type Item = { description: string; quantity: number; unitNetCents: number };
export type PaymentMethod = 'STRIPE_CARD' | 'SEPA_B2B' | 'INVOICE_BANK_TRANSFER';

export type InvoiceRow = {
  id: string; invoice_number: string; kind: 'invoice' | 'storno' | 'credit'; refers_to: string | null; source: 'manual' | 'stripe';
  account_id: string | null; buyer: Buyer; items: Item[]; net_cents: number; vat_rate: number; vat_cents: number; gross_cents: number;
  payment_method: PaymentMethod; payment_status: 'PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED'; issue_date: string; service_period: string | null;
  due_date: string | null; paid_at: string | null; pdf_path: string | null; pdf_sha256: string | null; stripe_invoice_id: string | null;
  stripe_pdf_url: string | null; created_by: string | null; created_at: string;
};

const eur = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
const dmy = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 70, paddingHorizontal: 50, fontFamily: 'Helvetica', fontSize: 9.5, color: BRAND.text, lineHeight: 1.4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  sender: { fontSize: 7, color: BRAND.muted, marginTop: 34, marginBottom: 4, textDecoration: 'underline' },
  addr: { fontSize: 10, lineHeight: 1.45 },
  meta: { width: 200, fontSize: 8.5 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.navy, lineHeight: 1.25, marginTop: 28, marginBottom: 10 },
  head: { flexDirection: 'row', backgroundColor: BRAND.navy, color: '#fff', paddingVertical: 4, paddingHorizontal: 6, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  row: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: BRAND.hair },
  cPos: { width: 26 }, cDesc: { flex: 1 }, cQty: { width: 42, textAlign: 'right' }, cUnit: { width: 76, textAlign: 'right' }, cSum: { width: 80, textAlign: 'right' },
  sums: { marginLeft: 'auto', width: 230, marginTop: 8 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  gross: { fontFamily: 'Helvetica-Bold', color: BRAND.navy, borderTopWidth: 1, borderTopColor: BRAND.navy, paddingTop: 4, marginTop: 2 },
  pay: { flexDirection: 'row', marginTop: 22, borderWidth: 0.5, borderColor: BRAND.hair, borderRadius: 3, padding: 10 },
  footer: { position: 'absolute', bottom: 24, left: 50, right: 50, borderTopWidth: 0.5, borderTopColor: BRAND.hair, paddingTop: 5, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: BRAND.muted },
});

function InvoiceDocument({ r: input, refNumber: refIn, qr, bank }: { r: InvoiceRow; refNumber?: string; qr?: string; bank: ReturnType<typeof bankDetails> }) {
  // Make company and personal names (e.g. "Yılmaz LLC") and line texts renderable in the PDF font.
  const r = pdfSafeDeep(input), refNumber = refIn ? pdfText(refIn) : refIn;
  const b = r.buyer;
  const title = r.kind === 'storno' ? 'Void Invoice' : r.kind === 'credit' ? 'Credit Memo' : 'Invoice';
  return (
    <Document title={`${title} ${r.invoice_number}`} author={SELLER.name} creator="LeaseRun" producer="LeaseRun">
      <Page size="LETTER" style={s.page}>
        <View style={s.top}>
          <View>
            <Logo size={18} />
            <Text style={s.sender}>{SELLER.name}{SELLER.address ? ` · ${SELLER.address}` : ''} · {SELLER.email}</Text>
            <View style={s.addr}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{b.company}{b.legalForm && !b.company.includes(b.legalForm) ? ` ${b.legalForm}` : ''}</Text>
              {b.contact ? <Text>Attn: {b.contact}</Text> : null}
              {b.street ? <Text>{b.street}</Text> : null}
              <Text>{b.city} {b.postalCode}</Text>
              <Text>{b.country || 'United States'}</Text>
            </View>
          </View>
          <View style={s.meta}>
            {[
              [`${title} number`, r.invoice_number],
              ['Invoice date', dmy(r.issue_date)],
              ['Service period', r.service_period || dmy(r.issue_date)],
              ['Customer number', b.customerNumber || '–'],
              ...(b.vatId ? [['Customer EIN', b.vatId]] : []),
              ...(refNumber ? [['Refers to', refNumber]] : []),
            ].map(([k, v]) => (
              <View key={k} style={s.metaRow}><Text style={{ color: BRAND.muted }}>{k}</Text><Text>{v}</Text></View>
            ))}
          </View>
        </View>

        <Text style={s.h1}>{title} {r.invoice_number}</Text>
        {r.kind === 'storno' && refNumber ? <Text style={{ marginBottom: 8 }}>This voids invoice {refNumber} in full.</Text> : null}

        <View style={s.head}><Text style={s.cPos}>#</Text><Text style={s.cDesc}>Description</Text><Text style={s.cQty}>Qty</Text><Text style={s.cUnit}>Unit price</Text><Text style={s.cSum}>Amount</Text></View>
        {r.items.map((it, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cPos}>{i + 1}</Text><Text style={s.cDesc}>{it.description}</Text>
            <Text style={s.cQty}>{String(it.quantity)}</Text><Text style={s.cUnit}>{eur(it.unitNetCents)}</Text>
            <Text style={s.cSum}>{eur(Math.round(it.quantity * it.unitNetCents))}</Text>
          </View>
        ))}
        <View style={s.sums}>
          <View style={s.sumRow}><Text>Subtotal</Text><Text>{eur(r.net_cents)}</Text></View>
          {r.vat_cents ? <View style={s.sumRow}><Text>Sales tax{r.vat_rate ? ` (${r.vat_rate}%)` : ''}</Text><Text>{eur(r.vat_cents)}</Text></View> : null}
          <View style={[s.sumRow, s.gross]}><Text>Total (USD)</Text><Text>{eur(r.gross_cents)}</Text></View>
        </View>

        {r.kind === 'invoice' ? (
          <View style={s.pay} wrap={false}>
            {qr ? <Image src={qr} style={{ width: 84, height: 84, marginRight: 12 }} /> : null}
            <View style={{ flex: 1 }}>
              {r.payment_method === 'INVOICE_BANK_TRANSFER' && bank ? (
                <>
                  <Text style={{ fontFamily: 'Helvetica-Bold', color: BRAND.navy }}>Payment due {r.due_date ? `by ${dmy(r.due_date)}` : 'upon receipt'}</Text>
                  {bank.link ? <Text>Pay online (card or ACH): {bank.link}</Text> : null}
                  {bank.routing ? <Text>ACH: {bank.holder}{bank.bank ? ` · ${bank.bank}` : ''} · Routing {bank.routing} · Account {bank.account}</Text> : null}
                  <Text>Please reference: {r.invoice_number}</Text>
                  {qr ? <Text style={{ color: BRAND.muted, fontSize: 7.5, marginTop: 3 }}>Scan the QR code with your phone camera to open the payment page for this invoice.</Text> : null}
                </>
              ) : r.payment_method === 'SEPA_B2B' ? (
                <Text>The amount will be debited from your bank account via ACH.</Text>
              ) : (
                <Text>The amount has been or will be charged to your payment method on file.</Text>
              )}
            </View>
          </View>
        ) : null}

        <Text style={{ marginTop: 18, fontSize: 8, color: BRAND.muted }}>
          Business customer. Software subscription (analysis and preparation tool). LeaseRun does not originate or broker loans and does not provide legal, tax or investment advice.
        </Text>

        <View style={s.footer} fixed>
          <Text>{SELLER.name}{SELLER.address ? `\n${SELLER.address}` : ''}</Text>
          <Text>{SELLER.email} · {SELLER.web}</Text>
          <Text render={({ pageNumber, totalPages }) => `${r.invoice_number}\nPage ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(r: InvoiceRow, refNumber?: string): Promise<Buffer> {
  const bank = bankDetails();
  let qr: string | undefined;
  if (r.kind === 'invoice' && r.payment_method === 'INVOICE_BANK_TRANSFER' && bank?.link && r.gross_cents > 0) {
    const payload = paymentLinkPayload({ url: bank.link, cents: r.gross_cents, reference: r.invoice_number });
    if (payload) qr = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 300 });
  }
  const el = createElement(InvoiceDocument, { r, refNumber, qr, bank }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(el);
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid_pdf_output');
  return pdf;
}

const addDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

// Create an invoice or void: number + record atomically (database function), then store the PDF.
export async function issueInvoice(o: {
  kind: 'invoice' | 'storno'; buyer: Buyer; items: Item[]; accountId: string | null; paymentMethod: PaymentMethod;
  servicePeriod?: string; paymentTermsDays?: number; refersTo?: InvoiceRow | null; createdBy: string; paid?: boolean;
}): Promise<InvoiceRow> {
  if (o.kind === 'invoice' && o.paymentMethod === 'INVOICE_BANK_TRANSFER' && !bankDetails()) throw new Error('Payment details missing (set INVOICE_PAYMENT_LINK or INVOICE_ACH_ROUTING/INVOICE_ACH_ACCOUNT in Vercel).');
  const items = o.kind === 'storno' && o.refersTo ? o.refersTo.items.map((i) => ({ ...i, unitNetCents: -Math.abs(i.unitNetCents) })) : o.items;
  if (!items.length) throw new Error('No line items.');
  const t = totals(items);
  const db = supabaseAdmin();
  const { data, error } = await db.rpc('lr_create_invoice', {
    p: {
      kind: o.kind, source: 'manual', refers_to: o.refersTo?.id ?? '', account_id: o.accountId ?? '', buyer: o.buyer, items,
      net_cents: t.net, vat_rate: VAT_RATE, vat_cents: t.vat, gross_cents: t.gross, payment_method: o.paymentMethod,
      payment_status: o.kind === 'storno' ? 'CANCELLED' : o.paid ? 'PAID' : 'PENDING', service_period: o.servicePeriod ?? o.refersTo?.service_period ?? '',
      due_date: o.kind === 'invoice' ? addDays(o.paymentTermsDays ?? 30) : '', paid_at: o.paid ? new Date().toISOString() : '', created_by: o.createdBy,
    },
  });
  if (error || !data) throw new Error(error?.message || 'The invoice could not be created.');
  const row = data as InvoiceRow;
  const pdf = await renderInvoicePdf(row, o.refersTo?.invoice_number);
  const sha = createHash('sha256').update(pdf).digest('hex');
  const path = `${row.issue_date.slice(0, 4)}/${row.invoice_number}.pdf`;
  const up = await db.storage.from(INVOICE_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`Invoice ${row.invoice_number} created, but storing the PDF failed: ${up.error.message}`);
  await db.from('lr_invoices').update({ pdf_path: path, pdf_sha256: sha }).eq('id', row.id);
  if (o.kind === 'storno' && o.refersTo) await db.from('lr_invoices').update({ payment_status: 'CANCELLED' }).eq('id', o.refersTo.id);
  return { ...row, pdf_path: path, pdf_sha256: sha };
}

// Load the stored PDF and check it against the saved checksum.
export async function loadInvoicePdf(r: InvoiceRow): Promise<{ pdf: Buffer; intact: boolean } | null> {
  if (!r.pdf_path) return null;
  const dl = await supabaseAdmin().storage.from(INVOICE_BUCKET).download(r.pdf_path);
  if (dl.error || !dl.data) return null;
  const pdf = Buffer.from(await dl.data.arrayBuffer());
  return { pdf, intact: createHash('sha256').update(pdf).digest('hex') === r.pdf_sha256 };
}

export function buyerFromAccount(a: { company_name: string; legal_form: string; advisor_name: string; street: string | null; postal_code: string; city: string; tax_id: string | null; customer_number: string }): Buyer {
  return {
    company: a.company_name, legalForm: a.legal_form, contact: a.advisor_name, street: a.street, postalCode: a.postal_code, city: a.city,
    vatId: a.tax_id && /^[0-9]{2}-?[0-9]{7}$/.test(a.tax_id) ? a.tax_id : null, customerNumber: a.customer_number,
  };
}
