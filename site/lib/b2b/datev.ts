// Monthly export for the CPA / bookkeeper: general journal and sales (revenue) journal as CSV
// (comma separated, dot as decimal separator, dates MM/DD/YYYY) – imports into QuickBooks Online, Xero or a spreadsheet.
// No VAT in the US; a sales tax column is included (only non-zero when Stripe Tax collected sales tax).
// The module name and exported function names are kept for compatibility (formerly a German DATEV export).

// Chart-of-accounts preset. Keys kept for compatibility: 'SKR03' = standard US small-business chart,
// 'SKR04' = alternative numbering. Account names follow common QuickBooks defaults.
export type Kontenrahmen = 'SKR03' | 'SKR04';
export const KONTEN: Record<Kontenrahmen, { forderung: string; erloes19: string; salesTax: string; label: string }> = {
  SKR03: { forderung: '1200 Accounts Receivable', erloes19: '4000 Subscription Revenue', salesTax: '2200 Sales Tax Payable', label: 'Standard chart (1200/4000)' },
  SKR04: { forderung: '1100 Accounts Receivable', erloes19: '4100 Software Revenue', salesTax: '2100 Sales Tax Payable', label: 'Alternative chart (1100/4100)' },
};

export type JournalRow = { invoice_number: string; kind: string; issue_date: string; net_cents: number; vat_cents: number; gross_cents: number; buyer: { company?: string } | null; source: string };

const money = (c: number) => (c / 100).toFixed(2);
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
// CSV cell: quote when needed and neutralize spreadsheet formulas (CSV injection).
const cell = (v: string) => { const t = v.replace(/^[=+\-@]/, "'$&"); return /[,"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const kindLabel = (k: string) => (k === 'invoice' ? 'Invoice' : k === 'storno' ? 'Void' : 'Credit memo');

// General journal: debit Accounts Receivable, credit revenue (and sales tax payable). Voids/credits are reversed.
export function buchungsstapel(rows: JournalRow[], skr: Kontenrahmen): string {
  const k = KONTEN[skr];
  const head = ['Journal No', 'Date', 'Account', 'Debit', 'Credit', 'Description', 'Customer'];
  const lines: string[] = [];
  for (const r of rows) {
    const neg = r.gross_cents < 0;
    const desc = `${kindLabel(r.kind)} ${r.invoice_number}`.slice(0, 60);
    const cust = (r.buyer?.company ?? '').slice(0, 60);
    const ar = Math.abs(r.gross_cents), rev = Math.abs(r.net_cents), tax = Math.abs(r.vat_cents);
    const row = (acct: string, debit: number, credit: number) => [r.invoice_number.slice(0, 36), mdy(r.issue_date), acct, debit ? money(debit) : '', credit ? money(credit) : '', desc, cust].map(cell).join(',');
    lines.push(row(k.forderung, neg ? 0 : ar, neg ? ar : 0));
    lines.push(row(k.erloes19, neg ? rev : 0, neg ? 0 : rev));
    if (tax) lines.push(row(k.salesTax, neg ? tax : 0, neg ? 0 : tax));
  }
  return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n';
}

// Sales journal by invoice date (accrual basis) with totals for the period.
export function ustJournal(rows: JournalRow[], monat: string): string {
  const net = rows.reduce((s, r) => s + r.net_cents, 0);
  const vat = rows.reduce((s, r) => s + r.vat_cents, 0);
  const gross = rows.reduce((s, r) => s + r.gross_cents, 0);
  const lines = [
    ['Invoice number', 'Type', 'Invoice date', 'Customer', 'Subtotal', 'Sales tax', 'Total', 'Source'].join(','),
    ...rows.map((r) => [r.invoice_number, kindLabel(r.kind), mdy(r.issue_date), r.buyer?.company ?? '', money(r.net_cents), money(r.vat_cents), money(r.gross_cents), r.source].map(cell).join(',')),
    '',
    ['Total', '', '', '', money(net), money(vat), money(gross), ''].join(','),
    '',
    `Period,${cell(monat)}`,
    'Basis,Accrual (by invoice date)',
    'Currency,USD',
    `Revenue (before sales tax),${money(net)}`,
    `Sales tax collected,${money(vat)}`,
    'Note,Please have your CPA review before filing.',
  ];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
