import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { pdfText } from '@/lib/pdf/text';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, DOCUMENT_BUCKET, supabaseAdmin } from '@/lib/supabase/admin';
import { TIER_LIMITS, effectiveTier, membershipFor } from '@/lib/b2b/core';
import { CATEGORIES, CATEGORY_LABEL, type Category } from '@/lib/documents/files';
import { storeExport } from '@/lib/storage/exports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Body = z.object({ versionId: z.string().uuid() });
const MAX_TOTAL = 150 * 1024 * 1024;
const A4: [number, number] = [595.28, 841.89];

// Gesamtdossier: registrierte Kreditmappe + hochgeladene Unterlagen des Objekts (PDF, JPG, PNG) in einem PDF
// mit durchgehender Seitennummerierung. Für Unternehmenskonten mit Pro/Enterprise.
export async function POST(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 503 });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  if (!allowRequest(`gesamt:${user.id}`, 4, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, { status: 429 });
  const m = await membershipFor(user.id);
  const tier = m && m.account.status === 'active' ? effectiveTier(m.account) : null;
  if (!(tier && TIER_LIMITS[tier].merger)) {
    return NextResponse.json({ error: 'Das Gesamtdossier ist im Tarif Kanzlei & Baufi Pro enthalten.' }, { status: 402 });
  }
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });

  const db = supabaseAdmin();
  const { data: v } = await db.from('lr_kreditmappe_versions').select('*').eq('id', p.data.versionId).eq('owner_id', user.id).maybeSingle();
  if (!v) return NextResponse.json({ error: 'Kreditmappe nicht gefunden. Bitte zuerst die Kreditmappe erstellen.' }, { status: 404 });
  const main = await db.storage.from('bank-ready-pdf').download(v.storage_path);
  if (main.error || !main.data) return NextResponse.json({ error: 'Kreditmappe nicht im Speicher gefunden.' }, { status: 404 });

  const { data: docs } = await db
    .from('lr_documents')
    .select('id, category, filename, mime_type, size_bytes, storage_key, created_at')
    .eq('owner_id', user.id)
    .eq('object_ref', v.object_ref)
    .order('created_at', { ascending: true })
    .limit(60);
  const order = (c: string) => CATEGORIES.indexOf(c as Category);
  const list = (docs ?? []).sort((a, b) => order(a.category) - order(b.category));
  if ((list.reduce((s, d) => s + Number(d.size_bytes || 0), 0)) > MAX_TOTAL) {
    return NextResponse.json({ error: 'Die Unterlagen sind zusammen größer als 150 MB. Bitte große Scans verkleinern.' }, { status: 413 });
  }

  try {
    const out = await PDFDocument.create();
    out.setTitle('Gesamtdossier');
    out.setProducer('LeaseRun');
    out.setCreator('LeaseRun');
    const font = await out.embedFont(StandardFonts.Helvetica);
    const bold = await out.embedFont(StandardFonts.HelveticaBold);

    const mainDoc = await PDFDocument.load(new Uint8Array(await main.data.arrayBuffer()));
    const mainPages = await out.copyPages(mainDoc, mainDoc.getPageIndices());
    mainPages.forEach((pg) => out.addPage(pg));

    // Anlagenverzeichnis
    const toc = out.addPage(A4);
    toc.drawText('Anlagen zum Dossier', { x: 50, y: 780, size: 16, font: bold, color: rgb(0.06, 0.17, 0.35) });
    const contents: { label: string; page: number; ok: boolean }[] = [];
    const skipped: string[] = [];

    for (const d of list) {
      const label = `${CATEGORY_LABEL[d.category as Category] ?? d.category}: ${d.filename}`;
      const dl = await db.storage.from(DOCUMENT_BUCKET).download(d.storage_key);
      if (dl.error || !dl.data) { skipped.push(`${label} (nicht abrufbar)`); continue; }
      const bytes = new Uint8Array(await dl.data.arrayBuffer());
      const startPage = out.getPageCount() + 1;
      try {
        if (d.mime_type === 'application/pdf') {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: false });
          const pages = await out.copyPages(src, src.getPageIndices());
          pages.forEach((pg) => out.addPage(pg));
        } else if (d.mime_type === 'image/jpeg' || d.mime_type === 'image/png') {
          const img = d.mime_type === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          const page = out.addPage(A4);
          const maxW = A4[0] - 60, maxH = A4[1] - 90;
          const sc = Math.min(maxW / img.width, maxH / img.height, 1);
          page.drawImage(img, { x: (A4[0] - img.width * sc) / 2, y: (A4[1] - img.height * sc) / 2 + 10, width: img.width * sc, height: img.height * sc });
        } else {
          skipped.push(`${label} (Format ${d.mime_type} wird nicht eingebunden)`);
          continue;
        }
        contents.push({ label, page: startPage, ok: true });
      } catch {
        skipped.push(`${label} (Datei verschlüsselt oder beschädigt)`);
      }
    }

    // Anlagenverzeichnis: Zeilen sammeln; reicht eine Seite nicht, folgen weitere Verzeichnisseiten direkt dahinter
    // (die Seitenangaben der Anlagen verschieben sich entsprechend). Dateinamen werden auf die Zeichen der
    // Standardschrift abgebildet – sonst bricht pdf-lib bei Namen wie „Gehaltsnachweis_Şahin.pdf“ ab.
    type Line = { t: string; f: typeof font; size: number };
    const PER_PAGE = 41;
    const build = (offset: number): Line[] => {
      const ls: Line[] = [];
      if (!contents.length) ls.push({ t: 'Zu diesem Objekt sind keine Unterlagen hochgeladen.', f: font, size: 10 });
      for (const c of contents) ls.push({ t: `${c.label}  ·  ab Seite ${c.page + offset}`, f: font, size: 10 });
      if (skipped.length) {
        ls.push({ t: '', f: font, size: 10 }, { t: 'Nicht eingebunden:', f: bold, size: 10 });
        for (const s of skipped) ls.push({ t: s, f: font, size: 10 });
      }
      ls.push({ t: '', f: font, size: 8 }, { t: 'Die Anlagen sind unverändert übernommene Kopien der hochgeladenen Dateien.', f: font, size: 8 });
      return ls;
    };
    const extra = Math.max(0, Math.ceil(build(0).length / PER_PAGE) - 1);
    const tocIndex = mainPages.length;
    const tocPages = [toc];
    for (let k = 1; k <= extra; k++) tocPages.push(out.insertPage(tocIndex + k, A4));
    const lines = build(extra);
    lines.forEach((l, i) => {
      const pg = tocPages[Math.floor(i / PER_PAGE)];
      const row = i % PER_PAGE;
      if (row === 0 && pg !== toc) pg.drawText('Anlagen zum Dossier (Fortsetzung)', { x: 50, y: 780, size: 16, font: bold, color: rgb(0.06, 0.17, 0.35) });
      if (!l.t) return;
      const raw = pdfText(l.t);
      let t = raw;
      while (t.length > 4 && l.f.widthOfTextAtSize(t, l.size) > A4[0] - 100) t = t.slice(0, -2);
      if (t !== raw) t = t.slice(0, -1) + '…';
      pg.drawText(t, { x: 50, y: 750 - row * 16, size: l.size, font: l.f, color: rgb(0.2, 0.25, 0.33) });
    });

    // Durchgehende Seitennummer und Kennung auf jeder Seite
    const total = out.getPageCount();
    out.getPages().forEach((pg, i) => {
      const { width } = pg.getSize();
      const text = `Gesamtdossier · Kreditmappe ${String(v.id).slice(0, 8)} · Seite ${i + 1} von ${total}`;
      const w = font.widthOfTextAtSize(text, 7);
      pg.drawRectangle({ x: width - w - 46, y: 4, width: w + 12, height: 12, color: rgb(1, 1, 1), opacity: 0.85 });
      pg.drawText(text, { x: width - w - 40, y: 7, size: 7, font, color: rgb(0.39, 0.45, 0.55) });
    });

    const pdf = await out.save();
    const sha = createHash('sha256').update(pdf).digest('hex');
    const url = await storeExport('gesamt', `LeaseRun_Gesamtdossier_${String(v.object_ref).slice(0, 30)}.pdf`, pdf, 'application/pdf');
    return NextResponse.json({ url, sha256: sha, pages: total, skipped: skipped.length }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('gesamt_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Gesamtdossier konnte nicht erstellt werden.' }, { status: 500 });
  }
}
