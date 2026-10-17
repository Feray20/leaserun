import { zipSync, strToU8 } from 'fflate';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadInvoicePdf, type InvoiceRow } from '@/lib/b2b/invoice';
import { buchungsstapel, ustJournal, type Kontenrahmen } from '@/lib/b2b/datev';

const safe = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Kunde';

export type TaxArchive = { zip: Uint8Array; count: number; problems: string[] };

// Zeitraum aus „JJJJ-MM“ (Monat), „JJJJ-Q1“ … „JJJJ-Q4“ (Quartal) oder „JJJJ“ (Jahr).
export function periodRange(p: string): { from: string; to: string; label: string } {
  const d = (y: number, m: number, day: number) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  let m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(p);
  if (m) { const y = +m[1], mo = +m[2]; return { from: d(y, mo, 1), to: d(y, mo, lastDay(y, mo)), label: p }; }
  m = /^(\d{4})-Q([1-4])$/.exec(p);
  if (m) { const y = +m[1], q = +m[2]; return { from: d(y, q * 3 - 2, 1), to: d(y, q * 3, lastDay(y, q * 3)), label: `${y}-Q${q}` }; }
  m = /^(\d{4})$/.exec(p);
  if (m) { const y = +m[1]; return { from: d(y, 1, 1), to: d(y, 12, 31), label: String(y) }; }
  throw new Error('Zeitraum als Monat (JJJJ-MM), Quartal (JJJJ-Q1) oder Jahr (JJJJ) angeben.');
}

// Archiv für die Steuerkanzlei: alle Rechnungen des Zeitraums als PDF, Dateiname beginnt mit dem Rechnungsdatum
// (JJJJ-MM-TT_Rechnungsnummer_Kunde.pdf), optional DATEV-Buchungsstapel und USt-Journal.
export async function generateMonthlyTaxArchive(monat: string, skr: Kontenrahmen, withDatev = true): Promise<TaxArchive> {
  const { from, to, label } = periodRange(monat);
  const { data, error } = await supabaseAdmin()
    .from('immo_invoices')
    .select('*')
    .gte('issue_date', from).lte('issue_date', to)
    .order('issue_date', { ascending: true })
    .order('invoice_number', { ascending: true })
    .limit(20000);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as InvoiceRow[];

  const files: Record<string, Uint8Array> = {};
  const problems: string[] = [];
  for (const r of rows) {
    const folder = r.kind === 'invoice' ? 'Rechnungen' : 'Korrekturen';
    const datum = String(r.issue_date || '').slice(0, 10) || label;
    const name = `${folder}/${datum}_${safe(String(r.invoice_number))}_${safe(r.buyer?.company ?? '')}.pdf`;
    if (r.source === 'stripe') {
      if (!r.stripe_pdf_url) { problems.push(`${r.invoice_number}: kein PDF-Link von Stripe`); continue; }
      try {
        const res = await fetch(r.stripe_pdf_url, { signal: AbortSignal.timeout(10_000) });
        const buf = new Uint8Array(await res.arrayBuffer());
        if (res.ok && buf.length > 4 && String.fromCharCode(...buf.subarray(0, 4)) === '%PDF') files[name] = buf;
        else problems.push(`${r.invoice_number}: Stripe-PDF nicht abrufbar (${res.status}), Link: ${r.stripe_pdf_url}`);
      } catch {
        problems.push(`${r.invoice_number}: Stripe-PDF nicht abrufbar, Link: ${r.stripe_pdf_url}`);
      }
      continue;
    }
    const f = await loadInvoicePdf(r);
    if (!f) { problems.push(`${r.invoice_number}: PDF fehlt im Archiv`); continue; }
    if (!f.intact) problems.push(`${r.invoice_number}: PRÜFSUMME WEICHT AB – Datei nicht unverändert!`);
    files[name] = new Uint8Array(f.pdf);
  }
  if (withDatev) {
    files['DATEV_Buchungsstapel.csv'] = strToU8(buchungsstapel(rows, skr));
    files['Journal_Umsatzsteuer.csv'] = strToU8(ustJournal(rows, label));
  }
  files['LIESMICH.txt'] = strToU8(
    `ImmoAdv Rechnungsarchiv ${label}${withDatev ? ` (${skr})` : ''}\r\nErstellt: ${new Date().toISOString()}\r\nRechnungen: ${rows.filter((r) => r.kind === 'invoice').length}, Korrekturen: ${rows.filter((r) => r.kind !== 'invoice').length}\r\n\r\n` +
    'Dateinamen: Rechnungsdatum_Rechnungsnummer_Kunde.pdf – nach Datum sortiert.\r\n' +
    'DATEV_Buchungsstapel.csv (falls enthalten): Spalten entsprechen dem DATEV-Buchungsstapel (Umsatz, Soll/Haben, WKZ, Konto, Gegenkonto, Belegdatum TTMMJJ, Belegfeld 1, Buchungstext).\r\n' +
    'Für den direkten DATEV-Import (EXTF) ergänzt die Kanzlei Berater- und Mandantennummer oder nutzt den ASCII-Import mit Feldzuordnung.\r\n' +
    (problems.length ? `\r\nHinweise:\r\n- ${problems.join('\r\n- ')}\r\n` : '\r\nAlle PDFs vollständig, Prüfsummen in Ordnung.\r\n'),
  );
  return { zip: zipSync(files, { level: 6 }), count: rows.length, problems };
}

export { isHoliday, nthWorkday } from '@/lib/b2b/workdays';
