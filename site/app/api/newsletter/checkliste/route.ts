import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Home-buying document checklist as a PDF (incentive of the newsletter signup box, linked in the email after confirmation).
// Same content as the public page /checklist – no paid content. Text stays within WinAnsi (standard PDF fonts).
const DOCS: [string, [string, boolean][]][] = [
  ['You & your finances', [['Government-issued photo ID (driver\'s license or passport)', true], ['Pay stubs covering the last 30 days', true], ['W-2s for the last 2 years', true], ['Federal tax returns for the last 2 years (all schedules)', false], ['Bank statements, last 2 months (all pages)', true], ['Retirement / brokerage statements (reserves)', false], ['Gift letter and donor bank statement, if a gift is used', false], ['Letter of explanation for credit or income gaps', false], ['List of current debts (auto, student, credit cards)', true], ['Self-employed: profit & loss statement, 1099s, business returns', false]]],
  ['The property', [['Signed purchase agreement (purchase contract)', true], ['Listing sheet / property details', true], ['Earnest money deposit receipt', true], ['Homeowners insurance quote (binder before closing)', true], ['HOA documents, dues and budget (condo / HOA)', true], ['Home inspection report', false], ['Appraisal (ordered by the lender)', true], ['Title commitment / preliminary title report', true], ['Property tax bill or estimate', false], ['Rental property: leases and rent roll', false], ['Planned repairs or renovation estimates', false]]],
];

async function build(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Home-Buying Checklist: Documents for Your Mortgage'); doc.setAuthor('LeaseRun');
  const pg = doc.addPage([612, 792]); // US Letter
  const bold = await doc.embedFont(StandardFonts.HelveticaBold), reg = await doc.embedFont(StandardFonts.Helvetica);
  const navy = rgb(0.06, 0.17, 0.35), grey = rgb(0.28, 0.33, 0.41), line = rgb(0.8, 0.84, 0.9);
  const R = 564;
  let y = 744;
  pg.drawText('LeaseRun', { x: 48, y, size: 12, font: bold, color: navy }); y -= 30;
  pg.drawText('Home-Buying Checklist: Documents for Your Mortgage', { x: 48, y, size: 17, font: bold, color: navy }); y -= 19;
  pg.drawText('21 documents lenders typically ask for. Check them off as you collect them.', { x: 48, y, size: 10.5, font: reg, color: grey }); y -= 26;
  for (const [h, items] of DOCS) {
    pg.drawText(h, { x: 48, y, size: 13, font: bold, color: navy }); y -= 20;
    for (const [t, req] of items) {
      pg.drawRectangle({ x: 50, y: y - 2, width: 10, height: 10, borderColor: navy, borderWidth: 1 });
      pg.drawText(t, { x: 70, y, size: 10, font: reg, color: rgb(0.1, 0.12, 0.16) });
      const tag = req ? 'required' : 'if applicable';
      pg.drawText(tag, { x: R - reg.widthOfTextAtSize(tag, 9), y, size: 9, font: req ? bold : reg, color: grey });
      pg.drawLine({ start: { x: 48, y: y - 6 }, end: { x: R, y: y - 6 }, thickness: 0.5, color: line });
      y -= 20;
    }
    y -= 10;
  }
  ['Note: which documents you need depends on the lender, loan type, employment and property.', 'General information only - LeaseRun is not a lender or mortgage broker; not financial, tax or legal advice.', 'Online with filters and progress: leaserun.com/checklist'].forEach((t, i) => {
    pg.drawText(t, { x: 48, y: y - i * 15, size: 9, font: i === 2 ? bold : reg, color: i === 2 ? navy : grey });
  });
  return doc.save();
}

export async function GET(req: Request) {
  if (!allowRequest(`nlpdf:${anonymizedIpHash(req) ?? 'x'}`, 20, 60_000)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  const disp = new URL(req.url).searchParams.get('download') === '1' ? 'attachment' : 'inline';
  return new NextResponse(new Uint8Array(await build()), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${disp}; filename="LeaseRun_Home-Buying-Checklist.pdf"`, 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'public, max-age=3600' } });
}
