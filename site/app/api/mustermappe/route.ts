import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { allowRequest } from '@/lib/security/rate-limit';
import { ObjectSchema, ProfileSchema, buildKreditmappe } from '@/lib/kreditmappe/model';
import { KreditmappeDocument } from '@/lib/kreditmappe/pdf';
import { ReportDocument } from '@/lib/pdf/report';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { userFromRequest } from '@/lib/billing/auth';
import { paidAccess } from '@/lib/billing/paid';
import { loadGate } from '@/lib/gate/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MUSTER = 'MUSTER — FIKTIVER FALL — LEASERUN.DE';

// Ohne freigeschalteten Zugang nur ein Einblick: Anteil der Seiten laut Web-Admin → Freischaltung (Standard 20 %, mindestens 1), danach eine Hinweisseite.
// Kunden rufen das Beispiel mit Anmeldung ab (die Beispiel-Seite sendet den Zugang mit) und erhalten das ganze Dokument.
// Wichtig: Nicht freigeschaltete Inhalte werden nie in die Datei übernommen (kein Überdecken – überdeckter Text
// wäre per Kopieren/Textauszug weiter lesbar). Einseitige Muster liefern daher eine gekürzte Fassung (teaser = true).
async function preview(pdf: Uint8Array, pct: number, teaser = false): Promise<Uint8Array> {
  const src = await PDFDocument.load(pdf);
  const total = src.getPageCount();
  if (pct >= 100 && !teaser) return pdf;
  // teaser: Dokument ist bereits aus gekürzten Daten erzeugt → alle Seiten behalten. Sonst Anteil der Seiten,
  // bei nur einer Seite keine (ganze Seite wäre der volle Inhalt).
  const keep = teaser ? total : total === 1 ? 0 : Math.max(1, Math.min(total - 1, Math.round((total * pct) / 100)));
  const out = await PDFDocument.create();
  if (keep) (await out.copyPages(src, [...Array(keep).keys()])).forEach((pg) => out.addPage(pg));
  const { width: w, height: h } = src.getPage(0).getSize();
  const pg = out.addPage([w, h]);
  const bold = await out.embedFont(StandardFonts.HelveticaBold), reg = await out.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.06, 0.17, 0.35), grey = rgb(0.28, 0.33, 0.41);
  pg.drawRectangle({ x: 48, y: h / 2 - 110, width: w - 96, height: 220, color: rgb(0.94, 0.96, 0.99), borderColor: rgb(0.75, 0.85, 0.99), borderWidth: 1 });
  pg.drawText('Ende der Vorschau', { x: 72, y: h / 2 + 60, size: 22, font: bold, color: navy });
  const first = teaser ? 'Sie sehen einen Auszug dieses Musters.' : `Sie sehen ${keep} von ${total} Seiten dieses Musters.`;
  const lines = [first, 'Das vollständige Dokument – und dieselbe Unterlage für Ihr', 'eigenes Objekt – gibt es mit einem LeaseRun-Zugang.', '', 'leaserun.com/angebote'];
  lines.forEach((t, i) => pg.drawText(t, { x: 72, y: h / 2 + 22 - i * 20, size: 13, font: i === 4 ? bold : reg, color: i === 4 ? navy : grey }));
  return out.save();
}
async function isPaid(req: Request): Promise<boolean> {
  if ((await loadGate()).beispiele === 'offen') return true;
  if (!req.headers.get('authorization')) return false;
  try { const u = await userFromRequest(req); return u ? (await paidAccess(u)).areas.beispiele : false; } catch { return false; }
}
function pdfResponse(bytes: Uint8Array, disp: string, name: string, full: boolean, extra: Record<string, string> = {}) {
  return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disp}; filename="${full ? name : name.replace('.pdf', '_Vorschau.pdf')}"`, 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': full ? 'private, no-store' : 'public, max-age=600', Vary: 'Authorization', ...extra } });
}

// Muster-Objekt-Analyse mit denselben fiktiven Zahlen wie die Beispielseite.
function analyseBeispiel() {
  return {
    title: 'Eigentumswohnung Musterstraße 12, Musterstadt',
    subtitle: 'Fiktiver Beispielfall · 68 m² · Baujahr 1998 · vermietet',
    url: undefined,
    // Dieselben Eingaben wie die Muster-Kreditmappe unten – beide Beispiele zeigen identische Kennzahlen.
    chips: [['Kaufpreis', '178.200 €'], ['€/m²', '2.621 €'], ['Kaufpreisfaktor', '16,7'], ['Bruttorendite', '5,99 %'], ['Cashflow v. St.', '+189,83 €'], ['DSCR', '1,35'], ['Mindestkapital', '11.583 €'], ['Beleihungsauslauf', '71,08 %']] as [string, string][],
    sections: [
      { title: 'Kosten und Kapital', rows: [['Kaufnebenkosten', '11.583 € (6,5 %)'], ['Gesamtkosten', '189.783 €'], ['Eigenkapital', '71.000 €'], ['Darlehen', '118.783 €']] as [string, string][] },
      { title: 'Miete und Rendite', rows: [['Kaltmiete', '890 € / Monat (13,09 €/m²)'], ['Bruttomietrendite', '5,99 %'], ['Mietausfallwagnis', '2 %'], ['Nicht umlagefähig', '48 € / Monat']] as [string, string][] },
      { title: 'Finanzierung und Risiko', rows: [['Sollzins / Tilgung', '3,55 % / 2 %'], ['Monatsrate', '549,37 €'], ['Restschuld nach 10 Jahren', '90.312,99 €'], ['Rate bei 5,00 % Anschlusszins', '526,83 €']] as [string, string][] },
    ],
    hints: ['Fiktiver Beispielfall zur Veranschaulichung – keine echten Personen oder Objekte.', 'Rechnerische Orientierungswerte, keine Kreditzusage.'],
  };
}

// Öffentliche Beispiele (Beispiel-Seite): Muster-Kreditmappe (Standard) oder Muster-Objekt-Analyse (?art=analyse).
// Immer mit Wasserzeichen „MUSTER“ und LeaseRun-Logo-Raster; ?download=1 lädt herunter, sonst Anzeige im Browser.
export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!allowRequest(`mustermappe:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  }
  const q = new URL(req.url).searchParams;
  const disp = q.get('download') === '1' ? 'attachment' : 'inline';
  if (q.get('art') === 'analyse') {
    const full = await isPaid(req);
    const pct = full ? 100 : (await loadGate()).pdfProzent;
    const r = analyseBeispiel();
    // Ohne Zugang: nur ein Auszug (Anteil laut Web-Admin) – die übrigen Kennzahlen und Abschnitte stehen gar nicht erst in der PDF.
    const part = pct >= 100 ? r : {
      ...r,
      chips: r.chips.slice(0, Math.max(2, Math.round((r.chips.length * pct) / 100))),
      sections: r.sections.slice(0, Math.max(1, Math.round((r.sections.length * pct) / 100))),
    };
    const el = createElement(ReportDocument, { r: part, reportId: 'MUSTER-ANALYSE', createdAt: new Date().toISOString(), watermark: MUSTER }) as unknown as Parameters<typeof renderToBuffer>[0];
    const pdf = new Uint8Array(await renderToBuffer(el));
    return pdfResponse(pct >= 100 ? pdf : await preview(pdf, pct, true), disp, 'LeaseRun_Muster_Objekt-Analyse.pdf', pct >= 100);
  }
  const mappe = buildKreditmappe(
    ObjectSchema.parse({
      id: 'muster-0001',
      name: 'Eigentumswohnung Musterstraße 12, Musterstadt',
      price: 178200, rent: 890, area: 68, yearBuilt: 1998, purchaseCostPct: 6.5,
      nonRecoverable: 48, maintenance: 85, vacancyPct: 2,
      loan: 118783, interestPct: 3.55, repaymentPct: 2, lendingValue: 167120, equity: 71000,
      buildingSharePct: 80, marginalTaxPct: 35, renovationNet3y: 0,
      meaShare: 85, meaTotal: 1000, wegReserveTotal: 165000, wegPlannedTotal: 150000, wegSpecialTotal: 0,
      grundbuchAmt: 'Amtsgericht Musterstadt (fiktiv)', grundbuchBlatt: '0000', flur: '1', flurstueck: '1/1', ownership: 'Alleineigentum',
      heatingType: 'Gas-Brennwert', heatingYear: 2012, energyConsumption: 118, efficiencyClass: 'D', marketValue: 180000,
      grestPct: 5, notaryPct: 1.5, brokerPct: 0,
    }),
    ProfileSchema.parse({ employment: 'Angestellt', netIncome: 3650, equity: 71000, householdSize: 1 }),
  );
  const element = createElement(KreditmappeDocument, { m: mappe, watermark: MUSTER }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(element);
  const full = await isPaid(req);
  const bytes = full ? new Uint8Array(pdf) : await preview(new Uint8Array(pdf), (await loadGate()).pdfProzent);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return pdfResponse(bytes, disp, 'LeaseRun_Muster_Kreditmappe.pdf', full, { 'X-Document-SHA256': sha256 });
}
