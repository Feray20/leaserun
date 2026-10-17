// Monatsexport für die Steuerkanzlei: Buchungsstapel und Umsatzsteuer-Journal als CSV (Semikolon, Komma als Dezimaltrenner).

export type Kontenrahmen = 'SKR03' | 'SKR04';
export const KONTEN: Record<Kontenrahmen, { forderung: string; erloes19: string }> = {
  SKR03: { forderung: '1400', erloes19: '8400' },
  SKR04: { forderung: '1200', erloes19: '4400' },
};

export type JournalRow = { invoice_number: string; kind: string; issue_date: string; net_cents: number; vat_cents: number; gross_cents: number; buyer: { company?: string } | null; source: string };

const money = (c: number) => (Math.abs(c) / 100).toFixed(2).replace('.', ',');
const ttmmjj = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(2, 4)}`;
const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).replace(/^[=+\-@]/, "'$&");

// Buchung: Forderung (Soll) an Erlöse 19 % (Haben, Automatikkonto). Storno/Gutschrift mit Kennzeichen H.
export function buchungsstapel(rows: JournalRow[], skr: Kontenrahmen): string {
  const k = KONTEN[skr];
  const head = ['Umsatz (ohne Soll/Haben-Kz)', 'Soll/Haben-Kennzeichen', 'WKZ Umsatz', 'Konto', 'Gegenkonto (ohne BU-Schlüssel)', 'Belegdatum', 'Belegfeld 1', 'Buchungstext'];
  const lines = rows.map((r) => [
    money(r.gross_cents), r.gross_cents < 0 ? 'H' : 'S', 'EUR', k.forderung, k.erloes19, ttmmjj(r.issue_date), r.invoice_number.slice(0, 36),
    `${r.kind === 'invoice' ? 'Rechnung' : r.kind === 'storno' ? 'Storno' : 'Gutschrift'} ${r.buyer?.company ?? ''}`.trim().slice(0, 60),
  ].map(cell).join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}

// Umsatzsteuer-Journal nach Rechnungsdatum (Soll-Versteuerung). Kennzahl 81: Bemessungsgrundlage 19 % in vollen Euro.
export function ustJournal(rows: JournalRow[], monat: string): string {
  const net = rows.reduce((s, r) => s + r.net_cents, 0);
  const vat = rows.reduce((s, r) => s + r.vat_cents, 0);
  const gross = rows.reduce((s, r) => s + r.gross_cents, 0);
  const sign = (c: number) => (c < 0 ? '-' : '') + money(c);
  const lines = [
    ['Rechnungsnummer', 'Art', 'Rechnungsdatum', 'Kunde', 'Netto', 'USt 19 %', 'Brutto', 'Quelle'].join(';'),
    ...rows.map((r) => [r.invoice_number, r.kind, r.issue_date, r.buyer?.company ?? '', sign(r.net_cents), sign(r.vat_cents), sign(r.gross_cents), r.source].map(cell).join(';')),
    '',
    ['Summe', '', '', '', sign(net), sign(vat), sign(gross), ''].join(';'),
    '',
    `Zeitraum;${monat}`,
    'Versteuerung;Soll (nach Rechnungsdatum)',
    `Kennzahl 81 (Bemessungsgrundlage 19 %, volle Euro);${Math.trunc(net / 100)}`,
    `Umsatzsteuer darauf;${sign(vat)}`,
    'Hinweis;Bitte vor Übernahme in die Voranmeldung durch die Steuerkanzlei prüfen lassen.',
  ];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
