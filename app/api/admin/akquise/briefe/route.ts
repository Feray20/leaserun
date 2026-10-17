import { NextResponse } from 'next/server';
import { z } from 'zod';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { isSuppressed } from '@/lib/marketing/suppression';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Serienbriefe (DIN 5008, A4) an ausgewählte Geschäftskontakte. Kontakte mit Werbewiderspruch werden übersprungen.
// Jeder Brief enthält einen QR-Code mit Kampagnen-Kennung und den Pflichthinweis zur Datenherkunft (Art. 14 DSGVO).
const NAVY = rgb(15 / 255, 44 / 255, 89 / 255), GREY = rgb(100 / 255, 116 / 255, 139 / 255), MM = 2.8346;
const safe = (t: string) => String(t || '').normalize('NFC').replace(/[^\x20-\x7E\xA0-\xFF€–—„“”‚‘’…•·\n]/g, '?');
const Body = z.object({
  ids: z.array(z.string().uuid()).min(1).max(300),
  subject: z.string().trim().min(3).max(140),
  body: z.string().trim().min(20).max(4000),
  campaign: z.string().regex(/^[a-z0-9-]{3,40}$/),
  signer: z.string().trim().max(120).optional().default('Feray Korkmaz'),
});

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    if (!para.trim()) { out.push(''); continue; }
    let line = '';
    for (const w of para.split(/\s+/)) {
      const t = line ? line + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
const anrede = (c: { salutation?: string | null; contact_name?: string | null }) => {
  const last = (c.contact_name || '').trim().split(/\s+/).pop();
  return c.salutation === 'Frau' && last ? `Sehr geehrte Frau ${last},` : c.salutation === 'Herr' && last ? `Sehr geehrter Herr ${last},` : 'Sehr geehrte Damen und Herren,';
};

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht konfiguriert.' }, { status: 503 });
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Bitte Betreff, Text (mind. 20 Zeichen) und Kampagne prüfen.' }, { status: 400 });
  const b = p.data, db = supabaseAdmin();
  const { data: rows } = await db.from('immo_crm_contacts').select('*').in('id', b.ids);
  const list0 = (rows ?? []).filter((c) => c.status !== 'widerspruch' && !c.objection_at && c.street && c.postal_code && c.city);
  const sup = await isSuppressed(list0);
  const list = list0.filter((_, i) => !sup[i]);
  const skipped = (rows ?? []).length - list.length;
  if (!list.length) return NextResponse.json({ error: 'Keine Kontakte mit vollständiger Anschrift (oder alle mit Werbewiderspruch).' }, { status: 400 });

  const origin = 'https://immoadv.de';
  const link = `${origin}/b2b?utm_source=brief&utm_medium=post&utm_campaign=${b.campaign}`;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Serienbrief ${b.campaign}`); pdf.setAuthor('ImmoAdv'); pdf.setCreator('ImmoAdv Web-Admin');
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const qr = await pdf.embedPng(await QRCode.toBuffer(link, { margin: 1, width: 300, errorCorrectionLevel: 'M' }));
  let logo = null;
  try { const r = await fetch(new URL('/brand/immoadv-mail-logo.png', req.url), { signal: AbortSignal.timeout(4000) }); if (r.ok) logo = await pdf.embedPng(new Uint8Array(await r.arrayBuffer())); } catch { logo = null; }
  const today = new Date().toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: 'long', year: 'numeric' });
  const W = 595.28, H = 841.89, L = 25 * MM, R = W - 20 * MM, TW = R - L;

  for (const c of list) {
    const pg: PDFPage = pdf.addPage([W, H]);
    const t = (s: string, x: number, y: number, size = 10, font = f, color = rgb(0.1, 0.1, 0.12)) => pg.drawText(safe(s), { x, y, size, font, color });
    if (logo) pg.drawImage(logo, { x: L, y: H - 22 * MM, width: 50 * MM, height: 10 * MM }); else t('ImmoAdv', L, H - 18 * MM, 18, fb, NAVY);
    t('ImmoAdv · Georg-August-Zinn-Str. 25 · 64354 Reinheim', L, H - 50 * MM, 7, f, GREY);
    const addr = [c.company, c.branch, c.contact_name ? `${c.salutation ? c.salutation + ' ' : ''}${c.contact_name}` : null, c.street, `${c.postal_code} ${c.city}`].filter(Boolean) as string[];
    addr.forEach((line, i) => t(line, L, H - 57 * MM - i * 12.5, 10));
    t(`Reinheim, ${today}`, R - f.widthOfTextAtSize(`Reinheim, ${today}`, 10), H - 98 * MM, 10);
    t(b.subject, L, H - 108 * MM, 11, fb, NAVY);
    let y = H - 120 * MM;
    const text = `${anrede(c)}\n\n${b.body.replace(/\{firma\}/g, c.company).replace(/\{ort\}/g, c.city || '')}\n\nMit freundlichen Grüßen\n\n\n${b.signer}\nImmoAdv`;
    for (const line of wrap(text, f, 10.5, TW - 34 * MM)) { if (y < 52 * MM) break; t(line, L, y, 10.5); y -= 14.5; }
    pg.drawImage(qr, { x: R - 28 * MM, y: 62 * MM, width: 28 * MM, height: 28 * MM });
    t('Mehr erfahren:', R - 28 * MM, 92 * MM, 8, fb, NAVY);
    t('immoadv.de/b2b', R - 28 * MM, 58 * MM, 8, f, GREY);
    const foot = `Hinweis zum Datenschutz: Ihre geschäftlichen Kontaktdaten (${c.source}) verarbeiten wir zur Ansprache zu ImmoAdv für Unternehmen auf Grundlage unseres berechtigten Interesses (Art. 6 Abs. 1 lit. f DSGVO). Sie können der Verwendung für Werbung jederzeit formlos widersprechen – an support@immoadv.de oder ImmoAdv, Georg-August-Zinn-Str. 25, 64354 Reinheim; wir senden Ihnen dann keine Werbung mehr. Weitere Informationen: immoadv.de/datenschutz`;
    let fy = 30 * MM;
    for (const line of wrap(foot, f, 7, TW)) { t(line, L, fy, 7, f, GREY); fy -= 9; }
    t('ImmoAdv · Feray Korkmaz · Georg-August-Zinn-Str. 25 · 64354 Reinheim · support@immoadv.de · immoadv.de/impressum', L, 10 * MM, 7, f, GREY);
  }
  const bytes = await pdf.save();
  const now = new Date().toISOString();
  await db.from('immo_crm_activities').insert(list.map((c) => ({ contact_id: c.id, type: 'brief', campaign: b.campaign, note: b.subject, actor: auth.user.email })));
  await db.from('immo_crm_contacts').update({ status: 'angeschrieben', updated_at: now }).in('id', list.filter((c) => c.status === 'neu').map((c) => c.id));
  await adminAudit(auth.user.email, 'crm_letters', null, { n: list.length, campaign: b.campaign });
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="immoadv-briefe-${b.campaign}.pdf"`, 'X-Letters': String(list.length), 'X-Skipped': String(skipped), 'Cache-Control': 'no-store' } });
}
