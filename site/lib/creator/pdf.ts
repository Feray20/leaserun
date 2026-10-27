import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { eurText } from '@/lib/creator/billing';

// PDFs der Creator-Abrechnung (Abrechnung, Rechnung des Creators, Gutschrift von LeaseRun) mit pdf-lib.
// Schrift: Helvetica (WinAnsi) – Zeichen außerhalb des Zeichensatzes werden ersetzt.
// Zahlungsdaten erscheinen nur maskiert; ausgezahlt wird auf das im Portal hinterlegte, geprüfte Konto.

export type Party = { name: string; lines: string[]; taxIds?: string[] };
export type DocLine = { description: string; detail?: string; amountCents: number };
export type DocInput = {
  kind: 'STATEMENT' | 'INVOICE' | 'CREDIT_NOTE';
  title: string;
  number: string;
  issueDate: string;          // TT.MM.JJJJ
  servicePeriod: string;      // z. B. „01.10.2026 – 31.10.2026“
  issuer: Party;              // Aussteller
  recipient: Party;           // Empfänger
  meta: [string, string][];   // weitere Kopfangaben
  lines: DocLine[];
  totals: [string, string, boolean?][]; // Bezeichnung, Betrag, fett
  notes: string[];
  footer: string;
};

const NAVY = rgb(15 / 255, 44 / 255, 89 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const LINE = rgb(226 / 255, 232 / 255, 240 / 255);
const W = 595.28, H = 841.89, M = 50;

// WinAnsi-taugliche Zeichen (Umlaute, €, • sind enthalten); Unbekanntes wird ersetzt.
export function pdfSafe(s: string): string {
  return String(s ?? '').replace(/[–—]/g, '-').replace(/[„“”]/g, '"').replace(/[‚‘’]/g, "'").replace(/→/g, '->').replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ€•]/g, '?');
}

function wrap(text: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = [];
  for (const para of pdfSafe(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= max) line = t;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

export async function renderDoc(d: DocInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(pdfSafe(`${d.title} ${d.number}`)); pdf.setAuthor('LeaseRun'); pdf.setCreator('LeaseRun Creator Hub'); pdf.setProducer('LeaseRun');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const text = (t: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(pdfSafe(t), { x, y: yy, size: o.size ?? 10, font: o.f ?? font, color: o.color ?? rgb(0.06, 0.09, 0.16) });
  const right = (t: string, xr: number, yy: number, o: { size?: number; f?: PDFFont } = {}) => {
    const s = pdfSafe(t); const f = o.f ?? font; const size = o.size ?? 10;
    page.drawText(s, { x: xr - f.widthOfTextAtSize(s, size), y: yy, size, font: f, color: rgb(0.06, 0.09, 0.16) });
  };
  const ensure = (need: number) => { if (y - need < M + 40) { page = pdf.addPage([W, H]); y = H - M; } };

  // Kopf
  // Kopf trägt den Aussteller: bei der Rechnung des Creators der Creator, sonst LeaseRun.
  text(d.kind === 'INVOICE' ? d.issuer.name : 'LeaseRun', M, y, { size: 16, f: bold, color: NAVY });
  right(d.kind === 'STATEMENT' ? 'Creator-Abrechnung' : d.kind === 'CREDIT_NOTE' ? 'Gutschrift' : 'Rechnung', W - M, y, { size: 10, f: bold });
  y -= 30;
  text(`${d.issuer.name} · ${d.issuer.lines.join(' · ')}`, M, y, { size: 7.5, color: MUTED });
  y -= 16;
  const recTop = y;
  text(d.recipient.name, M, y, { f: bold }); y -= 13;
  for (const l of d.recipient.lines) { text(l, M, y); y -= 13; }
  for (const t of d.recipient.taxIds ?? []) { text(t, M, y, { size: 8.5, color: MUTED }); y -= 12; }
  // Metadaten rechts
  let ym = recTop;
  for (const [k, v] of [['Nummer', d.number], ['Datum', d.issueDate], ['Leistungszeitraum', d.servicePeriod], ...d.meta] as [string, string][]) {
    text(k, W - M - 210, ym, { size: 8.5, color: MUTED }); right(v, W - M, ym, { size: 9 }); ym -= 13;
  }
  y = Math.min(y, ym) - 20;
  text(d.title, M, y, { size: 15, f: bold, color: NAVY }); y -= 22;

  // Aussteller-Steuerangaben (Pflichtangabe bei Rechnungen/Gutschriften)
  if (d.issuer.taxIds?.length) { text(`Aussteller: ${d.issuer.name} · ${d.issuer.taxIds.join(' · ')}`, M, y, { size: 8.5, color: MUTED }); y -= 18; }

  // Positionen
  page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: NAVY });
  text('Beschreibung', M + 6, y + 1, { size: 9, f: bold, color: rgb(1, 1, 1) });
  page.drawText('Betrag', { x: W - M - 6 - bold.widthOfTextAtSize('Betrag', 9), y: y + 1, size: 9, font: bold, color: rgb(1, 1, 1) });
  y -= 22;
  for (const l of d.lines) {
    const desc = wrap(l.description, font, 9.5, W - 2 * M - 110);
    const det = l.detail ? wrap(l.detail, font, 8, W - 2 * M - 110) : [];
    ensure(desc.length * 12 + det.length * 10 + 8);
    right(eurText(l.amountCents), W - M - 6, y, { size: 9.5 });
    for (const t of desc) { text(t, M + 6, y, { size: 9.5 }); y -= 12; }
    for (const t of det) { text(t, M + 6, y, { size: 8, color: MUTED }); y -= 10; }
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: W - M, y: y + 3 }, thickness: 0.5, color: LINE });
    y -= 6;
  }
  // Summen
  ensure(d.totals.length * 15 + 20);
  y -= 6;
  for (const [k, v, b] of d.totals) {
    text(k, W - M - 230, y, { size: 10, f: b ? bold : font }); right(v, W - M - 6, y, { size: 10, f: b ? bold : font }); y -= 15;
  }
  y -= 10;
  for (const n of d.notes) {
    const ls = wrap(n, font, 8.5, W - 2 * M);
    ensure(ls.length * 11 + 4);
    for (const t of ls) { text(t, M, y, { size: 8.5, color: MUTED }); y -= 11; }
    y -= 4;
  }
  // Fußzeile auf jeder Seite
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const s = pdfSafe(`${d.footer} · Seite ${i + 1} von ${pages.length}`);
    p.drawText(s, { x: M, y: 28, size: 7, font, color: MUTED });
  });
  return pdf.save({ useObjectStreams: false });
}
