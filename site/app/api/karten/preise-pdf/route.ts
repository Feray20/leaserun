import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { currentPricing, pricingHash } from '@/lib/cards/pricing';
import { formatEur } from '@/lib/cards/money';
import { pdfText } from '@/lib/pdf/text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Preis- und Leistungsverzeichnis der LeaseRun Card als A4-PDF (Dokument-ID, Version, Gültigkeit, Seitenzahlen, Prüfsumme).
const NAVY = rgb(15 / 255, 44 / 255, 89 / 255), BLUE = rgb(2 / 255, 132 / 255, 199 / 255), TEXT = rgb(51 / 255, 65 / 255, 85 / 255), MUTED = rgb(100 / 255, 116 / 255, 139 / 255), HAIR = rgb(226 / 255, 232 / 255, 240 / 255), SOFT = rgb(248 / 255, 250 / 255, 252 / 255);
const LOGO = 'M50 8.3 L63.1 19.4 L62.6 22.5 L49 34 L45.2 31.1 L5.3 68.9 L2.5 70 L3.1 51.7 Z M98.8 0.7 L93.4 37.3 L83.6 29.8 L50.8 62.3 L43.7 57.9 L17.2 82.6 L0.2 82.6 L42.2 38.4 L50.3 40.1 L69.6 19.5 L64.6 8.1 Z M82.3 37.6 L99.5 53.6 L99.6 84 L88.6 83.6 L62.5 57 Z';
const W = 595.28, H = 841.89, M = 48;
const PRODUCT: Record<string, string> = { all: 'Debit & Charge', debit: 'Debit', charge: 'Charge' };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

export async function GET() {
  const v = currentPricing();
  const hash = pricingHash(v);
  const doc = await PDFDocument.create();
  doc.setTitle(`LeaseRun Card – Preis- und Leistungsverzeichnis ${v.version}`); doc.setAuthor('LeaseRun'); doc.setCreator('LeaseRun'); doc.setProducer('LeaseRun');
  doc.setSubject(v.documentId); doc.setKeywords([v.documentId, `v${v.version}`, hash]); doc.setLanguage('de-DE');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const draft = v.status !== 'PUBLISHED';
  let page!: PDFPage, y = 0;
  const pages: PDFPage[] = [];
  const newPage = () => {
    page = doc.addPage([W, H]); pages.push(page);
    if (draft) page.drawText('ENTWURF – NICHT GÜLTIG', { x: 110, y: 330, size: 46, font: bold, color: NAVY, opacity: 0.05, rotate: degrees(35) });
    page.drawSvgPath(LOGO, { x: M, y: H - 34, scale: 0.26, color: BLUE });
    page.drawText('LeaseRun', { x: M + 32, y: H - 54, size: 13, font: bold, color: NAVY });
    page.drawText('Card', { x: M + 32 + bold.widthOfTextAtSize('LeaseRun ', 13), y: H - 54, size: 13, font, color: BLUE });
    const t = 'Preis- und Leistungsverzeichnis';
    page.drawText(t, { x: W - M - font.widthOfTextAtSize(t, 10), y: H - 50, size: 10, font, color: MUTED });
    page.drawLine({ start: { x: M, y: H - 66 }, end: { x: W - M, y: H - 66 }, thickness: 1.5, color: NAVY });
    y = H - 92;
  };
  const need = (h: number) => { if (y - h < 70) newPage(); };
  newPage();

  page.drawText('LeaseRun Card', { x: M, y, size: 22, font: bold, color: NAVY }); y -= 26;
  page.drawText('Preis- und Leistungsverzeichnis', { x: M, y, size: 15, font, color: TEXT }); y -= 24;
  const meta = [['Dokument-ID', v.documentId], ['Version', v.version], ['Status', draft ? 'Entwurf – noch nicht gültig' : 'Veröffentlicht'], ['Gültig ab', v.effectiveFrom ? new Date(v.effectiveFrom).toLocaleDateString('de-DE') : 'noch nicht festgelegt'], ['Erstellt', new Date(v.createdAt).toLocaleDateString('de-DE')]];
  page.drawRectangle({ x: M, y: y - meta.length * 15 - 8, width: W - 2 * M, height: meta.length * 15 + 14, color: SOFT, borderColor: HAIR, borderWidth: 1 });
  y -= 8;
  for (const [k, val] of meta) { page.drawText(k, { x: M + 12, y, size: 9.5, font, color: MUTED }); page.drawText(pdfText(val), { x: M + 120, y, size: 9.5, font: bold, color: NAVY }); y -= 15; }
  y -= 18;

  for (const ch of v.chapters) {
    need(60);
    page.drawText(pdfText(`${ch.no}. ${ch.title}`), { x: M, y, size: 12.5, font: bold, color: NAVY }); y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: HAIR }); y -= 15;
    if (ch.intro) for (const l of wrap(pdfText(ch.intro), font, 9.5, W - 2 * M)) { need(14); page.drawText(l, { x: M, y, size: 9.5, font, color: TEXT }); y -= 13; }
    if (ch.intro) y -= 4;
    for (const it of ch.items) {
      // formatEur nutzt für negative Beträge das Minuszeichen U+2212 – in der Standardschrift nicht darstellbar.
      const price = pdfText(it.amount == null ? 'Noch nicht festgelegt' : `${formatEur(it.amount)}${it.unit ? ' ' + it.unit : ''}`);
      const nameLines = wrap(pdfText(it.name), font, 10, 250), noteLines = it.note ? wrap(pdfText(it.note), font, 8.5, 250) : [];
      const h = nameLines.length * 13 + noteLines.length * 11 + 8;
      need(h);
      let yy = y;
      for (const l of nameLines) { page.drawText(l, { x: M, y: yy, size: 10, font, color: TEXT }); yy -= 13; }
      for (const l of noteLines) { page.drawText(l, { x: M, y: yy, size: 8.5, font, color: MUTED }); yy -= 11; }
      page.drawText(PRODUCT[it.product], { x: M + 270, y, size: 9, font, color: MUTED });
      const pf = it.amount == null ? font : bold;
      page.drawText(price, { x: W - M - pf.widthOfTextAtSize(price, 10), y, size: 10, font: pf, color: it.amount == null ? MUTED : NAVY });
      y -= h;
      page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.3, color: HAIR });
    }
    y -= 12;
  }

  need(40);
  for (const l of wrap(`Prüfsumme (SHA-256) dieser Fassung: ${hash}`, font, 8, W - 2 * M)) { page.drawText(l, { x: M, y, size: 8, font, color: MUTED }); y -= 11; }

  pages.forEach((p, i) => {
    const f = `leaserun.com · ${v.documentId} · Version ${v.version} · Gültig ab ${v.effectiveFrom ? new Date(v.effectiveFrom).toLocaleDateString('de-DE') : '–'}`;
    p.drawLine({ start: { x: M, y: 44 }, end: { x: W - M, y: 44 }, thickness: 0.5, color: HAIR });
    p.drawText(f, { x: M, y: 30, size: 8, font, color: MUTED });
    const n = `Seite ${i + 1} / ${pages.length}`;
    p.drawText(n, { x: W - M - font.widthOfTextAtSize(n, 8), y: 30, size: 8, font, color: MUTED });
  });

  const bytes = await doc.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="LeaseRun-Card-Preisverzeichnis-${v.version}.pdf"`,
      'Cache-Control': 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800',
      'X-Robots-Tag': 'noindex',
    },
  });
}
