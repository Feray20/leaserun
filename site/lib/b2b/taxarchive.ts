import { zipSync, strToU8 } from 'fflate';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadInvoicePdf, type InvoiceRow } from '@/lib/b2b/invoice';
import { buchungsstapel, KONTEN, ustJournal, type Kontenrahmen } from '@/lib/b2b/datev';

const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Customer';

export type TaxArchive = { zip: Uint8Array; count: number; problems: string[] };

// Period from "YYYY-MM" (month), "YYYY-Q1" … "YYYY-Q4" (quarter) or "YYYY" (year).
export function periodRange(p: string): { from: string; to: string; label: string } {
  const d = (y: number, m: number, day: number) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(p);
  if (m) { const y = +m[1], mo = +m[2]; return { from: d(y, mo, 1), to: d(y, mo, lastDay(y, mo)), label: p }; }
  m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (m) { const y = +m[1], q = +m[2]; return { from: d(y, q * 3 - 2, 1), to: d(y, q * 3, lastDay(y, q * 3)), label: `${y}-Q${q}` }; }
  m = /^(\d{4})$/.exec(p);
  if (m) { const y = +m[1]; return { from: d(y, 1, 1), to: d(y, 12, 31), label: String(y) }; }
  throw new Error('Enter the period as a month (YYYY-MM), quarter (YYYY-Q1) or year (YYYY).');
}

// Archive for the CPA: all invoices of the period as PDF, file name starts with the invoice date
// (YYYY-MM-DD_InvoiceNumber_Customer.pdf), optionally a general journal and sales journal as CSV.
// scope: 'b2c' consumer invoices only, 'b2b' business invoices only, 'all' everything (scheduled CPA delivery).
export async function generateMonthlyTaxArchive(monat: string, skr: Kontenrahmen, withDatev = true, scope: 'b2c' | 'b2b' | 'all' = 'all'): Promise<TaxArchive> {
  const { from, to, label } = periodRange(monat);
  let base = supabaseAdmin()
    .from('lr_invoices')
    .select('*');
  if (scope === 'b2b') base = base.not('account_id', 'is', null);
  if (scope === 'b2c') base = base.is('account_id', null);
  const { data, error } = await base
    .gte('issue_date', from).lte('issue_date', to)
    .order('issue_date', { ascending: true })
    .order('invoice_number', { ascending: true })
    .limit(20000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InvoiceRow[];

  const files: Record<string, Uint8Array> = {};
  const problems: string[] = [];
  for (const r of rows) {
    const folder = r.kind === 'invoice' ? 'Invoices' : 'Corrections';
    const datum = String(r.issue_date || '').slice(0, 10) || label;
    const name = `${folder}/${datum}_${safe(String(r.invoice_number))}_${safe(r.buyer?.company ?? '')}.pdf`;
    if (r.source === 'stripe') {
      if (!r.stripe_pdf_url) { problems.push(`${r.invoice_number}: no PDF link from Stripe`); continue; }
      try {
        const res = await fetch(r.stripe_pdf_url, { signal: AbortSignal.timeout(10_000) });
        const buf = new Uint8Array(await res.arrayBuffer());
        if (res.ok && buf.length > 4 && String.fromCharCode(...buf.subarray(0, 4)) === '%PDF') files[name] = buf;
        else problems.push(`${r.invoice_number}: Stripe PDF not available (${res.status}), link: ${r.stripe_pdf_url}`);
      } catch {
        problems.push(`${r.invoice_number}: Stripe PDF not available, link: ${r.stripe_pdf_url}`);
      }
      continue;
    }
    const f = await loadInvoicePdf(r);
    if (!f) { problems.push(`${r.invoice_number}: PDF missing from archive`); continue; }
    if (!f.intact) problems.push(`${r.invoice_number}: CHECKSUM MISMATCH – file has been altered!`);
    files[name] = new Uint8Array(f.pdf);
  }
  if (withDatev) {
    files['General_Journal.csv'] = strToU8(buchungsstapel(rows, skr));
    files['Sales_Journal.csv'] = strToU8(ustJournal(rows, label));
  }
  files['README.txt'] = strToU8(
    `LeaseRun invoice archive ${label}${withDatev ? ` (${KONTEN[skr].label})` : ''}\r\nCreated: ${new Date().toISOString()}\r\nInvoices: ${rows.filter((r) => r.kind === 'invoice').length}, corrections: ${rows.filter((r) => r.kind !== 'invoice').length}\r\n\r\n` +
    'File names: InvoiceDate_InvoiceNumber_Customer.pdf – sorted by date. All amounts in USD.\r\n' +
    'General_Journal.csv (if included): Journal No, Date (MM/DD/YYYY), Account, Debit, Credit, Description, Customer – imports as a journal entry in QuickBooks Online or Xero.\r\n' +
    'Sales_Journal.csv (if included): one line per invoice with subtotal, sales tax and total, plus period totals.\r\n' +
    (problems.length ? `\r\nNotes:\r\n- ${problems.join('\r\n- ')}\r\n` : '\r\nAll PDFs complete, checksums OK.\r\n'),
  );
  return { zip: zipSync(files, { level: 6 }), count: rows.length, problems };
}

export { isHoliday, nthWorkday } from '@/lib/b2b/workdays';
