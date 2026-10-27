import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Summary report per connected client (one page): status, lender readiness, missing document types.
// Based only on the progress data the client shares with consent – no documents.
const PH = ['Getting oriented', 'Reviewing properties', 'Lender meeting', 'Owning'];
const NAVY = rgb(15 / 255, 44 / 255, 89 / 255), GREY = rgb(100 / 255, 116 / 255, 139 / 255), LINE = rgb(226 / 255, 232 / 255, 240 / 255);
// Standard font (WinAnsi): replace characters it cannot render so the report never fails (e.g. ş → s).
const safe = (t: string) => t.normalize('NFKD').replace(/[\u0300-\u036f]/g, (m, o, all) => (/[aouAOU]\u0308/.test(all.slice(o - 1, o + 1)) ? m : '')).normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF€–—„“”‚‘’…•·]/g, '?');
const de = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' }) : '–');

export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-client-report', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Invalid request.' }, 400);
  const db = supabaseAdmin();
  const { data: row } = await db.from('lr_b2b_clients').select('id, client_user_id, client_name, client_email, status, consent_at, last_request_at').eq('id', id).eq('account_id', ctx.account.id).maybeSingle();
  if (!row || row.status !== 'verbunden' || !row.client_user_id) return json({ error: 'Client is not connected.' }, 404);
  const { data: ud } = await db.from('lr_user_data').select('progress, updated_at').eq('user_id', row.client_user_id).maybeSingle();
  const s = ((ud?.progress as { summary?: Record<string, unknown> } | null)?.summary || {}) as { stage?: number; best?: number; objects?: number; docs?: number; profile?: boolean; missing?: string[] };

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Summary report ${row.client_name || row.client_email || 'Client'}`); pdf.setAuthor('LeaseRun'); pdf.setCreator('LeaseRun business portal');
  const page = pdf.addPage([612, 792]);
  const draw = (t: string, o: Parameters<typeof page.drawText>[1]) => page.drawText(safe(t), o);
  const f = await pdf.embedFont(StandardFonts.Helvetica), b = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, L = 56;
  let y = 740;
  try {
    const r = await fetch(new URL('/brand/leaserun-mail-logo.png', req.url), { signal: AbortSignal.timeout(4000) });
    if (r.ok) { const img = await pdf.embedPng(new Uint8Array(await r.arrayBuffer())); page.drawImage(img, { x: L, y: y - 22, width: 150, height: 30 }); }
  } catch { draw('LeaseRun', { x: L, y: y - 16, size: 20, font: b, color: NAVY }); }
  draw('Financing Readiness Summary', { x: W - L - b.widthOfTextAtSize('Financing Readiness Summary', 11), y: y - 8, size: 11, font: b, color: NAVY });
  draw(`As of ${de(new Date().toISOString())}`, { x: W - L - f.widthOfTextAtSize(`As of ${de(new Date().toISOString())}`, 9), y: y - 22, size: 9, font: f, color: GREY });
  y -= 40; page.drawRectangle({ x: L, y, width: W - 2 * L, height: 2, color: NAVY });
  y -= 34;
  draw(row.client_name || row.client_email || 'Client', { x: L, y, size: 20, font: b, color: NAVY });
  y -= 18; if (row.client_name && row.client_email) { draw(row.client_email, { x: L, y, size: 10, font: f, color: GREY }); y -= 14; }
  draw(`Advised by ${ctx.account.company_name} · connected since ${de(row.consent_at)}`, { x: L, y, size: 10, font: f, color: GREY });

  // Lender readiness bar
  y -= 40; const best = Math.max(0, Math.min(100, Number(s.best ?? 0)));
  draw('Lender readiness (best property)', { x: L, y, size: 11, font: b, color: NAVY });
  const bestTxt = s.best == null ? '–' : `${best}%`;
  draw(bestTxt, { x: W - L - b.widthOfTextAtSize(safe(bestTxt), 22), y: y - 4, size: 22, font: b, color: NAVY });
  y -= 20; page.drawRectangle({ x: L, y, width: W - 2 * L, height: 10, color: LINE });
  page.drawRectangle({ x: L, y, width: (W - 2 * L) * best / 100, height: 10, color: best >= 90 ? rgb(22 / 255, 163 / 255, 74 / 255) : best >= 60 ? rgb(245 / 255, 158 / 255, 11 / 255) : rgb(2 / 255, 132 / 255, 199 / 255) });
  y -= 16; draw(best >= 90 ? 'Lender-ready – documents and details largely complete.' : best >= 60 ? 'Almost lender-ready – a few documents or details are missing.' : 'In preparation.', { x: L, y, size: 9.5, font: f, color: GREY });

  // Key figures
  y -= 34;
  const rows: [string, string][] = [
    ['Stage', s.stage ? `${s.stage} of 4 · ${PH[s.stage - 1]}` : '–'],
    ['Properties', s.objects == null ? '–' : String(s.objects)],
    ['Uploaded documents', s.docs == null ? '–' : String(s.docs)],
    ['Financial profile', s.profile == null ? '–' : s.profile ? 'completed' : 'open'],
    ['Last active', de(ud?.updated_at)],
    ['Last reminded', de(row.last_request_at)],
  ];
  for (const [k, v] of rows) {
    draw(k, { x: L, y, size: 10.5, font: f, color: GREY });
    draw(v, { x: L + 200, y, size: 10.5, font: b, color: rgb(15 / 255, 23 / 255, 42 / 255) });
    y -= 8; page.drawRectangle({ x: L, y, width: W - 2 * L, height: 0.6, color: LINE }); y -= 16;
  }

  // Missing documents
  y -= 14; draw('Missing document types', { x: L, y, size: 11, font: b, color: NAVY }); y -= 18;
  const miss = Array.isArray(s.missing) ? s.missing.slice(0, 10) : null;
  if (!miss) draw('No data yet – the client has not added a property with documents.', { x: L, y, size: 10, font: f, color: GREY });
  else if (!miss.length) draw('All document types are present.', { x: L, y, size: 10, font: f, color: rgb(21 / 255, 128 / 255, 61 / 255) });
  else for (const m of miss) { draw(`–  ${m}`, { x: L + 4, y, size: 10.5, font: f, color: rgb(124 / 255, 45 / 255, 18 / 255) }); y -= 16; }

  // Note
  const note = ['Based on progress data the client shares in LeaseRun with consent (stage, lender readiness, number and',
    'types of documents). The documents themselves were not reviewed. Not a loan offer or credit decision and not',
    'advice. LeaseRun is software for analysis and preparation; it does not originate or broker loans.'];
  let ny = 92; for (const n of note) { draw(n, { x: L, y: ny, size: 8, font: f, color: GREY }); ny -= 11; }
  page.drawRectangle({ x: L, y: 104, width: W - 2 * L, height: 0.6, color: LINE });
  draw('LeaseRun · leaserun.com · support@leaserun.com', { x: L, y: 40, size: 8, font: f, color: GREY });

  const bytes = await pdf.save();
  const name = `LeaseRun-Summary-${(row.client_name || 'Client').replace(/[^A-Za-z0-9-]+/g, '-').slice(0, 40)}.pdf`;
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'Cache-Control': 'no-store' } });
}
