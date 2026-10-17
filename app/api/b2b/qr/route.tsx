import QRCode from 'qrcode';
import { NextResponse } from 'next/server';
import { Document, Image, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { effectiveTier } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { BRAND } from '@/lib/pdf/brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const n = (v: string | null, max: number) => {
  const x = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(x) && x > 0 && x <= max ? String(Math.round(x)) : '';
};

// Exposé-/Schaufenster-QR: öffnet die Partnerseite mit vorbefüllten Objektdaten.
export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-qr', limit: 30 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (!effectiveTier(a) || !a.slug) return json({ error: 'QR-Codes gibt es ab einem gebuchten Tarif.' }, 402);
  const u = new URL(req.url);
  const target = new URL(`/p/${a.slug}`, u.origin);
  target.searchParams.set('src', 'qr');
  const price = n(u.searchParams.get('preis'), 50_000_000);
  const rent = n(u.searchParams.get('miete'), 1_000_000);
  const area = n(u.searchParams.get('flaeche'), 100_000);
  const ref = (u.searchParams.get('ref') || '').replace(/[^\p{L}\p{N} .,/-]/gu, '').slice(0, 60);
  const land = (u.searchParams.get('land') || '').replace(/[^a-z-]/g, '').slice(0, 30);
  if (price) target.searchParams.set('preis', price);
  if (rent) target.searchParams.set('miete', rent);
  if (area) target.searchParams.set('flaeche', area);
  if (land) target.searchParams.set('land', land);
  if (ref) target.searchParams.set('ref', ref);
  const url = target.toString();
  const format = u.searchParams.get('format') || 'svg';
  const opts = { errorCorrectionLevel: 'M' as const, margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } };
  const name = `QR_${a.slug}${ref ? '_' + ref.replace(/[^A-Za-z0-9]+/g, '_') : ''}`;
  if (format === 'json') return json({ url });
  if (format === 'png') {
    const png = await QRCode.toBuffer(url, { ...opts, width: 1200, type: 'png' });
    return new NextResponse(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Content-Disposition': `attachment; filename="${name}.png"`, 'Cache-Control': 'no-store' } });
  }
  if (format === 'pdf') {
    const dataUrl = await QRCode.toDataURL(url, { ...opts, width: 900 });
    const doc = (
      <Document title={name}>
        <Page size="A6" style={{ padding: 24, fontFamily: 'Helvetica', alignItems: 'center' }}>
          <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: a.brand_color || BRAND.navy, marginBottom: 6 }}>{a.company_name}</Text>
          <Image src={dataUrl} style={{ width: 190, height: 190 }} />
          <View style={{ marginTop: 8, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold' }}>Finanzierung in 2 Minuten durchrechnen</Text>
            {ref ? <Text style={{ fontSize: 8, color: BRAND.muted, marginTop: 3 }}>Objekt: {ref}</Text> : null}
            <Text style={{ fontSize: 6.5, color: BRAND.muted, marginTop: 6, textAlign: 'center' }}>Rechnerische Orientierung, keine Kreditzusage. Technik: ImmoAdv</Text>
          </View>
        </Page>
      </Document>
    );
    const pdf = await renderToBuffer(doc as unknown as Parameters<typeof renderToBuffer>[0]);
    return new NextResponse(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${name}.pdf"`, 'Cache-Control': 'no-store' } });
  }
  const svg = await QRCode.toString(url, { ...opts, type: 'svg' });
  return new NextResponse(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Content-Disposition': `attachment; filename="${name}.svg"`, 'Cache-Control': 'no-store' } });
}
