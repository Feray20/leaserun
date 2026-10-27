import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kauf-Checkliste als PDF (Anreiz der Newsletter-Anmeldebox, Link in der Mail nach der Bestätigung).
// Gleicher Inhalt wie die frei zugängliche Seite /checklist – keine bezahlten Inhalte.
const DOCS: [string, [string, boolean][]][] = [
  ['Person und Bonität', [['Personalausweis / Reisepass (Kopie)', true], ['Selbstauskunft der Bank', true], ['Gehaltsabrechnungen der letzten 3 Monate', true], ['Arbeitsvertrag', false], ['Lohnsteuerbescheinigung', true], ['ESt-Bescheide letzte 2–3 Jahre', false], ['Kranken-/Pflegeversicherung', false], ['Eigenkapitalnachweis', true], ['Darlehens-/Leasingverträge', false], ['Kontoauszüge', false]]],
  ['Objekt', [['Exposé / Objektbeschreibung', true], ['Grundbuchauszug < 3 Monate', true], ['Flurkarte', false], ['Grundrisse & Wohnflächenberechnung', true], ['Energieausweis', true], ['Teilungserklärung', true], ['Protokolle letzte 3 Eigentümerversammlungen', true], ['Wirtschaftsplan, Hausgeldabrechnung, Rücklagenstand', true], ['Gebäudeversicherung', false], ['Kaufvertragsentwurf', false], ['Geplante Modernisierungen', false]]],
];

async function build(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Kauf-Checkliste: Unterlagen für die Baufinanzierung'); doc.setAuthor('LeaseRun');
  const pg = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold), reg = await doc.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.06, 0.17, 0.35), grey = rgb(0.28, 0.33, 0.41), line = rgb(0.8, 0.84, 0.9);
  let y = 790;
  pg.drawText('LeaseRun', { x: 48, y, size: 12, font: bold, color: navy }); y -= 32;
  pg.drawText('Kauf-Checkliste: Unterlagen für die Baufinanzierung', { x: 48, y, size: 18, font: bold, color: navy }); y -= 20;
  pg.drawText('21 Unterlagen, die Banken typischerweise sehen wollen. Zum Abhaken beim Sammeln.', { x: 48, y, size: 10.5, font: reg, color: grey }); y -= 30;
  for (const [h, items] of DOCS) {
    pg.drawText(h, { x: 48, y, size: 13, font: bold, color: navy }); y -= 22;
    for (const [t, req] of items) {
      pg.drawRectangle({ x: 50, y: y - 2, width: 10, height: 10, borderColor: navy, borderWidth: 1 });
      pg.drawText(t, { x: 70, y, size: 10.5, font: reg, color: rgb(0.1, 0.12, 0.16) });
      const tag = req ? 'erforderlich' : 'fallweise';
      pg.drawText(tag, { x: 547 - reg.widthOfTextAtSize(tag, 9), y, size: 9, font: req ? bold : reg, color: grey });
      pg.drawLine({ start: { x: 48, y: y - 7 }, end: { x: 547, y: y - 7 }, thickness: 0.5, color: line });
      y -= 22;
    }
    y -= 12;
  }
  ['Hinweis: Welche Unterlagen im Einzelfall nötig sind, hängt von Bank, Erwerbsstatus und Objekt ab.', 'Allgemeine Information – keine Kreditvermittlung, Steuer- oder Rechtsberatung.', 'Online mit Filter und Fortschritt: leaserun.com/checkliste'].forEach((t, i) => {
    pg.drawText(t, { x: 48, y: y - i * 15, size: 9, font: i === 2 ? bold : reg, color: i === 2 ? navy : grey });
  });
  return doc.save();
}

export async function GET(req: Request) {
  if (!allowRequest(`nlpdf:${anonymizedIpHash(req) ?? 'x'}`, 20, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  const disp = new URL(req.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new NextResponse(new Uint8Array(await build()), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disp}; filename="LeaseRun_Kauf-Checkliste.pdf"`, 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'public, max-age=3600' } });
}
