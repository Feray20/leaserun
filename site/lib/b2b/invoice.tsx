import '@/lib/env-alias';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { createElement } from 'react';
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BRAND, Logo } from '@/lib/pdf/brand';
import { pdfSafeDeep, pdfText } from '@/lib/pdf/text';
import { epcPayload, totals, VAT_RATE } from '@/lib/b2b/epc';
export { epcPayload, totals, VAT_RATE };

// Rechnungen nach § 14 UStG mit lückenloser Nummer (RE-YYYY-MM-XXXXX), unveränderbarer Ablage
// (Datenbank-Trigger + SHA-256) und GiroCode (EPC-QR) für Überweisungen.

export const SELLER = {
  name: 'LeaseRun',
  owner: 'Feray Korkmaz',
  street: 'Georg-August-Zinn-Str. 25',
  city: '64354 Reinheim',
  country: 'Deutschland',
  vatId: 'DE348036700',
  email: 'support@leaserun.com',
  web: 'leaserun.com',
};
export const INVOICE_BUCKET = 'immo-invoices';

export function bankDetails() {
  const iban = (process.env.INVOICE_IBAN || '').replace(/\s+/g, '').toUpperCase();
  const bic = (process.env.INVOICE_BIC || '').replace(/\s+/g, '').toUpperCase();
  const bank = process.env.INVOICE_BANK_NAME || '';
  if (!/^DE[0-9]{20}$/.test(iban)) return null;
  return { iban, bic, bank, holder: process.env.INVOICE_ACCOUNT_HOLDER || SELLER.owner };
}

export type Buyer = { company: string; legalForm?: string; contact?: string; street?: string | null; postalCode: string; city: string; country?: string; vatId?: string | null; customerNumber?: string | null };
export type Item = { description: string; quantity: number; unitNetCents: number };
export type PaymentMethod = 'STRIPE_CARD' | 'SEPA_B2B' | 'INVOICE_BANK_TRANSFER';

export type InvoiceRow = {
  id: string; invoice_number: string; kind: 'invoice' | 'storno' | 'credit'; refers_to: string | null; source: 'manual' | 'stripe';
  account_id: string | null; buyer: Buyer; items: Item[]; net_cents: number; vat_rate: number; vat_cents: number; gross_cents: number;
  payment_method: PaymentMethod; payment_status: 'PAID' | 'PENDING' | 'OVERDUE' | 'CANCELLED'; issue_date: string; service_period: string | null;
  due_date: string | null; paid_at: string | null; pdf_path: string | null; pdf_sha256: string | null; stripe_invoice_id: string | null;
  stripe_pdf_url: string | null; created_by: string | null; created_at: string;
};

const eur = (c: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(c / 100);
const dmy = (iso: string) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));

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
  // Firmen- und Personennamen (z. B. „Yılmaz GmbH“) und Positionstexte in der PDF-Schrift darstellbar machen.
  const r = pdfSafeDeep(input), refNumber = refIn ? pdfText(refIn) : refIn;
  const b = r.buyer;
  const title = r.kind === 'storno' ? 'Stornorechnung' : r.kind === 'credit' ? 'Gutschrift' : 'Rechnung';
  return (
    <Document title={`${title} ${r.invoice_number}`} author={SELLER.name} creator="LeaseRun" producer="LeaseRun">
      <Page size="A4" style={s.page}>
        <View style={s.top}>
          <View>
            <Logo size={18} />
            <Text style={s.sender}>{SELLER.name} · {SELLER.owner} · {SELLER.street} · {SELLER.city}</Text>
            <View style={s.addr}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{b.company}{b.legalForm && !b.company.includes(b.legalForm) ? ` ${b.legalForm}` : ''}</Text>
              {b.contact ? <Text>z. Hd. {b.contact}</Text> : null}
              {b.street ? <Text>{b.street}</Text> : null}
              <Text>{b.postalCode} {b.city}</Text>
              <Text>{b.country || 'Deutschland'}</Text>
            </View>
          </View>
          <View style={s.meta}>
            {[
              [`${title}snummer`, r.invoice_number],
              ['Rechnungsdatum', dmy(r.issue_date)],
              ['Leistungszeitraum', r.service_period || dmy(r.issue_date)],
              ['Kundennummer', b.customerNumber || '–'],
              ...(b.vatId ? [['USt-IdNr. Kunde', b.vatId]] : []),
              ...(refNumber ? [['Bezug auf', refNumber]] : []),
            ].map(([k, v]) => (
              <View key={k} style={s.metaRow}><Text style={{ color: BRAND.muted }}>{k}</Text><Text>{v}</Text></View>
            ))}
          </View>
        </View>

        <Text style={s.h1}>{title} {r.invoice_number}</Text>
        {r.kind === 'storno' && refNumber ? <Text style={{ marginBottom: 8 }}>Hiermit stornieren wir die Rechnung {refNumber} vollständig.</Text> : null}

        <View style={s.head}><Text style={s.cPos}>Pos.</Text><Text style={s.cDesc}>Leistung</Text><Text style={s.cQty}>Menge</Text><Text style={s.cUnit}>Einzelpreis netto</Text><Text style={s.cSum}>Gesamt netto</Text></View>
        {r.items.map((it, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={s.cPos}>{i + 1}</Text><Text style={s.cDesc}>{it.description}</Text>
            <Text style={s.cQty}>{String(it.quantity).replace('.', ',')}</Text><Text style={s.cUnit}>{eur(it.unitNetCents)}</Text>
            <Text style={s.cSum}>{eur(Math.round(it.quantity * it.unitNetCents))}</Text>
          </View>
        ))}
        <View style={s.sums}>
          <View style={s.sumRow}><Text>Summe netto</Text><Text>{eur(r.net_cents)}</Text></View>
          <View style={s.sumRow}><Text>Umsatzsteuer {String(r.vat_rate).replace('.', ',')} %</Text><Text>{eur(r.vat_cents)}</Text></View>
          <View style={[s.sumRow, s.gross]}><Text>Gesamtbetrag</Text><Text>{eur(r.gross_cents)}</Text></View>
        </View>

        {r.kind === 'invoice' ? (
          <View style={s.pay} wrap={false}>
            {qr ? <Image src={qr} style={{ width: 84, height: 84, marginRight: 12 }} /> : null}
            <View style={{ flex: 1 }}>
              {r.payment_method === 'INVOICE_BANK_TRANSFER' && bank ? (
                <>
                  <Text style={{ fontFamily: 'Helvetica-Bold', color: BRAND.navy }}>Zahlbar ohne Abzug bis {r.due_date ? dmy(r.due_date) : 'sofort'}</Text>
                  <Text>Kontoinhaber: {bank.holder}</Text>
                  <Text>IBAN: {bank.iban.replace(/(.{4})/g, '$1 ').trim()}{bank.bic ? ` · BIC: ${bank.bic}` : ''}{bank.bank ? ` · ${bank.bank}` : ''}</Text>
                  <Text>Verwendungszweck: {r.invoice_number}</Text>
                  {qr ? <Text style={{ color: BRAND.muted, fontSize: 7.5, marginTop: 3 }}>GiroCode mit der Banking-App scannen: Empfänger, Betrag und Verwendungszweck werden übernommen.</Text> : null}
                </>
              ) : r.payment_method === 'SEPA_B2B' ? (
                <Text>Der Betrag wird per SEPA-Firmenlastschrift eingezogen.</Text>
              ) : (
                <Text>Der Betrag wurde bzw. wird über das hinterlegte Zahlungsmittel beglichen.</Text>
              )}
            </View>
          </View>
        ) : null}

        <Text style={{ marginTop: 18, fontSize: 8, color: BRAND.muted }}>
          Leistung an Unternehmer (§ 14 BGB). Software-Nutzung (Analyse- und Vorbereitungswerkzeug), keine Finanzierungsvermittlung und keine Rechts- oder Steuerberatung.
        </Text>

        <View style={s.footer} fixed>
          <Text>{SELLER.name} · Inh. {SELLER.owner}{'\n'}{SELLER.street} · {SELLER.city}</Text>
          <Text>USt-IdNr. {SELLER.vatId}{'\n'}{SELLER.email} · {SELLER.web}</Text>
          <Text render={({ pageNumber, totalPages }) => `${r.invoice_number}\nSeite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(r: InvoiceRow, refNumber?: string): Promise<Buffer> {
  const bank = bankDetails();
  let qr: string | undefined;
  if (r.kind === 'invoice' && r.payment_method === 'INVOICE_BANK_TRANSFER' && bank && r.gross_cents > 0) {
    qr = await QRCode.toDataURL(epcPayload({ name: bank.holder, iban: bank.iban, bic: bank.bic, cents: r.gross_cents, reference: r.invoice_number }), { errorCorrectionLevel: 'M', margin: 1, width: 300 });
  }
  const el = createElement(InvoiceDocument, { r, refNumber, qr, bank }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(el);
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid_pdf_output');
  return pdf;
}

const addDays = (d: number) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

// Rechnung oder Storno anlegen: Nummer + Datensatz atomar (Datenbankfunktion), danach PDF ablegen.
export async function issueInvoice(o: {
  kind: 'invoice' | 'storno'; buyer: Buyer; items: Item[]; accountId: string | null; paymentMethod: PaymentMethod;
  servicePeriod?: string; paymentTermsDays?: number; refersTo?: InvoiceRow | null; createdBy: string; paid?: boolean;
}): Promise<InvoiceRow> {
  if (o.kind === 'invoice' && o.paymentMethod === 'INVOICE_BANK_TRANSFER' && !bankDetails()) throw new Error('Bankverbindung fehlt (INVOICE_IBAN in Vercel setzen).');
  const items = o.kind === 'storno' && o.refersTo ? o.refersTo.items.map((i) => ({ ...i, unitNetCents: -Math.abs(i.unitNetCents) })) : o.items;
  if (!items.length) throw new Error('Keine Positionen.');
  const t = totals(items);
  const db = supabaseAdmin();
  const { data, error } = await db.rpc('lr_create_invoice', {
    p: {
      kind: o.kind, source: 'manual', refers_to: o.refersTo?.id ?? '', account_id: o.accountId ?? '', buyer: o.buyer, items,
      net_cents: t.net, vat_rate: VAT_RATE, vat_cents: t.vat, gross_cents: t.gross, payment_method: o.paymentMethod,
      payment_status: o.kind === 'storno' ? 'CANCELLED' : o.paid ? 'PAID' : 'PENDING', service_period: o.servicePeriod ?? o.refersTo?.service_period ?? '',
      due_date: o.kind === 'invoice' ? addDays(o.paymentTermsDays ?? 14) : '', paid_at: o.paid ? new Date().toISOString() : '', created_by: o.createdBy,
    },
  });
  if (error || !data) throw new Error(error?.message || 'Rechnung konnte nicht angelegt werden.');
  const row = data as InvoiceRow;
  const pdf = await renderInvoicePdf(row, o.refersTo?.invoice_number);
  const sha = createHash('sha256').update(pdf).digest('hex');
  const path = `${row.issue_date.slice(0, 4)}/${row.invoice_number}.pdf`;
  const up = await db.storage.from(INVOICE_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`Rechnung ${row.invoice_number} angelegt, PDF-Ablage fehlgeschlagen: ${up.error.message}`);
  await db.from('lr_invoices').update({ pdf_path: path, pdf_sha256: sha }).eq('id', row.id);
  if (o.kind === 'storno' && o.refersTo) await db.from('lr_invoices').update({ payment_status: 'CANCELLED' }).eq('id', o.refersTo.id);
  return { ...row, pdf_path: path, pdf_sha256: sha };
}

// Abgelegtes PDF laden und gegen die gespeicherte Prüfsumme prüfen.
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
    vatId: a.tax_id && /^DE[0-9]{9}$/.test(a.tax_id) ? a.tax_id : null, customerNumber: a.customer_number,
  };
}
