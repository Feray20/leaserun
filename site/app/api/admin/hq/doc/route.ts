import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { strToU8, zipSync } from 'fflate';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured } from '@/lib/supabase/admin';
import { loadProposals } from '@/lib/admin/hq-store';
import { agentOf } from '@/lib/admin/hq-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dokument eines Agenten (Vorschlag mit doc) als PDF oder Word-Datei – nur für den Web-Admin, nichts geht nach außen.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const slug = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'dokument';
// Standardschrift kann nur WinAnsi: Zeichen außerhalb werden ersetzt statt den Export abzubrechen.
const WIN = /[\x20-\x7E\xA0-\xFF€‚„…–—‘’“”•™]/;
const safe = (s: string) => [...s.replace(/\t/g, '  ')].map((ch) => (WIN.test(ch) ? ch : ch === '→' ? '->' : ch === '✓' ? '+' : '?')).join('');

type Line = { kind: 'h1' | 'h2' | 'li' | 'p' | 'gap'; text: string };
function parse(body: string): Line[] {
  const out: Line[] = [];
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const t = raw.trim();
    if (!t) { out.push({ kind: 'gap', text: '' }); continue; }
    if (/^#\s/.test(t)) out.push({ kind: 'h1', text: t.replace(/^#\s+/, '') });
    else if (/^#{2,}\s/.test(t)) out.push({ kind: 'h2', text: t.replace(/^#+\s+/, '') });
    else if (/^([-*•]|\d+[.)])\s/.test(t)) out.push({ kind: 'li', text: t.replace(/^[-*•]\s+/, '• ') });
    else out.push({ kind: 'p', text: t.replace(/\*\*(.+?)\*\*/g, '$1') });
  }
  return out;
}

async function pdf(title: string, body: string, by: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setAuthor('LeaseRun'); doc.setCreator('LeaseRun Headquarters');
  const [reg, bold] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold)]);
  const W = 595, H = 842, M = 56, max = W - 2 * M, navy = rgb(15 / 255, 44 / 255, 89 / 255), ink = rgb(0.2, 0.25, 0.33);
  let page = doc.addPage([W, H]), y = H - M;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const wrap = (text: string, font: typeof reg, size: number, w: number) => {
    const words = safe(text).split(/\s+/), lines: string[] = []; let cur = '';
    for (const wd of words) { const t = cur ? `${cur} ${wd}` : wd; if (font.widthOfTextAtSize(t, size) > w && cur) { lines.push(cur); cur = wd; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  };
  const draw = (text: string, font: typeof reg, size: number, color = ink, indent = 0, after = 4) => {
    for (const l of wrap(text, font, size, max - indent)) { if (y < M + size) newPage(); page.drawText(l, { x: M + indent, y: y - size, size, font, color }); y -= size * 1.45; }
    y -= after;
  };
  page.drawText('LeaseRun', { x: M, y: y - 12, size: 12, font: bold, color: navy });
  page.drawText(safe(`Headquarters · ${by} · ${new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`), { x: M + 62, y: y - 12, size: 9, font: reg, color: rgb(0.45, 0.5, 0.58) });
  y -= 30; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.5, color: navy }); y -= 22;
  draw(title, bold, 19, navy, 0, 10);
  for (const l of parse(body)) {
    if (l.kind === 'gap') { y -= 4; continue; }
    if (l.kind === 'h1') { y -= 6; draw(l.text, bold, 15, navy, 0, 4); }
    else if (l.kind === 'h2') { y -= 4; draw(l.text, bold, 12.5, navy, 0, 3); }
    else if (l.kind === 'li') draw(l.text, reg, 11, ink, 12, 2);
    else draw(l.text, reg, 11, ink, 0, 5);
  }
  return doc.save();
}
// Echte Word-Datei (.docx, Office Open XML) – öffnet in Word ohne „Geschützte Ansicht“-Sperre wegen falschem Format.
const x = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (t: string, o: { b?: boolean; sz?: number; color?: string } = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.sz ? `<w:sz w:val="${o.sz}"/>` : ''}</w:rPr><w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (inner: string, o: { after?: number; ind?: number } = {}) => `<w:p><w:pPr><w:spacing w:after="${o.after ?? 120}"/>${o.ind ? `<w:ind w:left="${o.ind}"/>` : ''}</w:pPr>${inner}</w:p>`;
function word(title: string, body: string, by: string): Uint8Array {
  const parts = [
    para(run(`LeaseRun · Headquarters · ${by} · ${new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}`, { sz: 18, color: '64748B' })),
    para(run(title, { b: true, sz: 36, color: '0F2C59' }), { after: 240 }),
    ...parse(body).map((l) => l.kind === 'gap' ? '' : l.kind === 'h1' ? para(run(l.text, { b: true, sz: 30, color: '0F2C59' }), { after: 120 }) : l.kind === 'h2' ? para(run(l.text, { b: true, sz: 25, color: '0F2C59' }), { after: 100 }) : l.kind === 'li' ? para(run(l.text, { sz: 22 }), { after: 60, ind: 360 }) : para(run(l.text, { sz: 22 }))),
  ].join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parts}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:color w:val="334155"/><w:sz w:val="22"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(styles),
  });
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const u = new URL(req.url), id = u.searchParams.get('id') || '', f = u.searchParams.get('f') === 'word' ? 'word' : 'pdf';
  const p = (await loadProposals()).find((x) => x.id === id);
  if (!p?.doc) return j({ error: 'Dokument nicht gefunden.' }, 404);
  const a = agentOf(p.agent), by = a ? `${a.name} ${a.last} · ${a.role}` : 'LeaseRun Intelligence';
  const name = slug(p.doc.title);
  if (f === 'word') return new NextResponse(Buffer.from(word(p.doc.title, p.doc.body, by)), { headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="${name}.docx"`, 'Cache-Control': 'no-store' } });
  const bytes = await pdf(p.doc.title, p.doc.body, by);
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Cache-Control': 'no-store' } });
}
