import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import { userFromRequest } from '@/lib/billing/auth';
import { paidAccess } from '@/lib/billing/paid';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';
// Gleiche Feldbeschreibung wie im Browser (Wiedereinlesen).
import { FORMS, LAENDER } from '@/public/src/form-spec.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ausfüllbares PDF-Formular (AcroForm) für BankReady-Kreditmappe und RenditeRadar-Analyse.
// Zahlende Kunden (mit Anmeldung) erhalten es ohne Wasserzeichen; ohne Tarif mit ImmoAdv-Wasserzeichen.
const NAVY = rgb(15 / 255, 44 / 255, 89 / 255), BLUE = rgb(2 / 255, 132 / 255, 199 / 255), TEXT = rgb(51 / 255, 65 / 255, 85 / 255), MUTED = rgb(100 / 255, 116 / 255, 139 / 255), HAIR = rgb(203 / 255, 213 / 255, 225 / 255);
const LOGO = 'M50 8.3 L63.1 19.4 L62.6 22.5 L49 34 L45.2 31.1 L5.3 68.9 L2.5 70 L3.1 51.7 Z M98.8 0.7 L93.4 37.3 L83.6 29.8 L50.8 62.3 L43.7 57.9 L17.2 82.6 L0.2 82.6 L42.2 38.4 L50.3 40.1 L69.6 19.5 L64.6 8.1 Z M82.3 37.6 L99.5 53.6 L99.6 84 L88.6 83.6 L62.5 57 Z';
const W = 595.28, H = 841.89, M = 42;

type Spec = { id: string; product: string; title: string; intro: string; sections: [string, [string, string, string, number][]][] };

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

async function build(spec: Spec, clean: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(spec.title); doc.setAuthor('ImmoAdv'); doc.setCreator('ImmoAdv'); doc.setProducer('ImmoAdv');
  doc.setSubject(spec.id); doc.setKeywords([spec.id, clean ? 'clean' : 'watermark']); doc.setLanguage('de-DE');
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  let page: PDFPage, y = 0, no = 0;

  const decorate = (p: PDFPage) => {
    if (!clean) {
      // Wasserzeichen (Gratis-Nutzung): Raster aus Bildmarken, schräg, sehr hell.
      for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
        p.drawSvgPath(LOGO, { x: 40 + c * 150 + (r % 2 ? 70 : 0), y: H - 80 - r * 140, scale: 0.42, color: NAVY, opacity: 0.045, rotate: degrees(28) });
      }
      p.drawText('VORLAGE · IMMOADV.DE', { x: 120, y: 300, size: 46, font: bold, color: NAVY, opacity: 0.05, rotate: degrees(35) });
    }
    p.drawSvgPath(LOGO, { x: M, y: H - 30, scale: 0.26, color: BLUE });
    p.drawText('ImmoAdv', { x: M + 32, y: H - 50, size: 13, font: bold, color: NAVY });
    p.drawText(spec.product, { x: W - M - bold.widthOfTextAtSize(spec.product, 11), y: H - 46, size: 11, font: bold, color: BLUE });
    p.drawLine({ start: { x: M, y: H - 60 }, end: { x: W - M, y: H - 60 }, thickness: 1.5, color: NAVY });
    no++;
    const foot = `${clean ? 'immoadv.de' : 'Vorlage mit Wasserzeichen · Ohne Wasserzeichen im Tarif · immoadv.de'} · Formular ${spec.id.split(':')[1]} · Seite ${no}`;
    p.drawText(foot, { x: M, y: 24, size: 7, font, color: MUTED });
  };
  const newPage = () => { page = doc.addPage([W, H]); decorate(page); y = H - 84; };
  newPage();

  page!.drawText(spec.title, { x: M, y, size: 16, font: bold, color: NAVY }); y -= 20;
  for (const l of wrap(spec.intro, font, 9.5, W - 2 * M)) { page!.drawText(l, { x: M, y, size: 9.5, font, color: TEXT }); y -= 13; }
  y -= 6;

  const colW = (W - 2 * M - 16) / 2;
  for (const [title, fields] of spec.sections) {
    if (y < 140) newPage();
    page!.drawText(title, { x: M, y, size: 11.5, font: bold, color: NAVY }); y -= 6;
    page!.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: HAIR }); y -= 16;
    let col = 0;
    for (const [name, label, type, span] of fields) {
      const full = span === 2;
      if (full && col === 1) { col = 0; y -= 40; }
      if (y < 70) { newPage(); col = 0; }
      const x = M + (col === 1 ? colW + 16 : 0), w = full ? W - 2 * M : colW;
      if (type === 'c') {
        const cb = form.createCheckBox(name);
        cb.addToPage(page!, { x, y: y - 18, width: 13, height: 13, borderColor: NAVY, borderWidth: 1, backgroundColor: rgb(1, 1, 1) });
        page!.drawText(label, { x: x + 20, y: y - 15, size: 9.5, font, color: TEXT });
      } else {
        page!.drawText(label, { x, y, size: 8.5, font, color: MUTED });
        const box = { x, y: y - 22, width: w, height: 18, borderColor: HAIR, borderWidth: 1, backgroundColor: rgb(0.97, 0.98, 0.99), textColor: NAVY, font };
        if (type === 'l' || type.startsWith('s:')) {
          const dd = form.createDropdown(name);
          const opts = type === 'l' ? LAENDER.map(([, n]) => n) : type.slice(2).split('|');
          dd.addOptions(opts);
          dd.addToPage(page!, box);
        } else {
          const tf = form.createTextField(name);
          tf.addToPage(page!, box);
          tf.setFontSize(10);
        }
      }
      if (full) { y -= 40; col = 0; } else if (col === 1) { y -= 40; col = 0; } else col = 1;
    }
    if (col === 1) y -= 40;
    y -= 8;
  }
  if (y < 110) newPage();
  y -= 4;
  for (const l of wrap('Hinweis: Die Angaben bleiben Ihre eigenen Angaben. ImmoAdv berechnet daraus Kennzahlen und Unterlagen zur Vorbereitung – keine Kreditzusage, keine Anlage-, Steuer- oder Rechtsberatung. Handschriftlich ausgefüllte und eingescannte Formulare können nicht automatisch gelesen werden; bitte digital ausfüllen und speichern.', font, 8, W - 2 * M)) {
    page!.drawText(l, { x: M, y, size: 8, font, color: MUTED }); y -= 11;
  }
  form.updateFieldAppearances(font);
  return doc.save({ useObjectStreams: false });
}

export async function GET(req: Request, ctx: { params: Promise<{ doc: string }> }) {
  const { doc } = await ctx.params;
  const spec = (FORMS as unknown as Record<string, Spec>)[doc];
  if (!spec) return NextResponse.json({ error: 'Unbekanntes Formular.' }, { status: 404 });
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`formular:${ip}`, 20, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  let clean = false;
  if (req.headers.get('authorization')) {
    const user = await userFromRequest(req);
    if (user) clean = (await paidAccess(user).catch(() => ({ paid: false }))).paid;
  }
  const pdf = await build(spec, clean);
  const name = `ImmoAdv_${spec.product}_Formular.pdf`;
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${new URL(req.url).searchParams.get('download') ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Form-Clean': clean ? '1' : '0',
    },
  });
}
