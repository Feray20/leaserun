import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { AVV_SECTIONS, AVV_TITLE } from '@/lib/b2b/avv-text';
import { AVV_VERSION, type B2BAccount } from '@/lib/b2b/core';
import { requireMember } from '@/lib/b2b/http';
import { BRAND, Logo, stamp } from '@/lib/pdf/brand';
import { pdfSafeDeep } from '@/lib/pdf/text';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 50, fontFamily: 'Helvetica', fontSize: 9, color: BRAND.text, lineHeight: 1.45 },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: BRAND.navy, lineHeight: 1.25, marginTop: 16, marginBottom: 4 },
  h2: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: BRAND.navy, marginTop: 10, marginBottom: 3 },
  p: { marginBottom: 3 },
  box: { borderWidth: 0.5, borderColor: BRAND.hair, padding: 8, marginTop: 8, borderRadius: 3 },
  footer: { position: 'absolute', bottom: 20, left: 50, right: 50, fontSize: 7, color: BRAND.muted, flexDirection: 'row', justifyContent: 'space-between' },
});

function AvvPdf({ a: input }: { a: B2BAccount }) {
  const a = pdfSafeDeep(input);
  return (
    <Document title={`DPA ${a.company_name}`} author="LeaseRun">
      <Page size="LETTER" style={s.page}>
        <Logo size={16} />
        <Text style={s.h1}>{AVV_TITLE}</Text>
        <Text>Version {a.avv_version || AVV_VERSION}</Text>
        <View style={s.box}>
          <Text>Customer: {a.company_name} ({a.legal_form}), {a.street ? `${a.street}, ` : ''}{a.city} {a.postal_code}</Text>
          <Text>Customer number: {a.customer_number}</Text>
          <Text>Accepted electronically on: {a.avv_accepted_at ? stamp(a.avv_accepted_at) : '–'} by confirmation in the portal</Text>
        </View>
        {AVV_SECTIONS.map((sec) => (
          <View key={sec.h} wrap>
            <Text style={s.h2}>{sec.h}</Text>
            {sec.p.map((t, i) => <Text key={i} style={s.p}>{t}</Text>)}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>LeaseRun · leaserun.com · support@leaserun.com</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Without sign-in: DPA text to review before accepting. Signed in with ?pdf=1: the accepted version as PDF.
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('pdf') !== '1') {
    return NextResponse.json({ version: AVV_VERSION, title: AVV_TITLE, sections: AVV_SECTIONS }, { headers: { 'Cache-Control': 'public, max-age=600' } });
  }
  const ctx = await requireMember(req, { allowLocked: true, bucket: 'b2b-avv', limit: 10, onboarding: true });
  if (ctx instanceof Response) return ctx;
  const el = createElement(AvvPdf, { a: ctx.account }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(el);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="LeaseRun_DPA_${ctx.account.customer_number}.pdf"`, 'Cache-Control': 'no-store' },
  });
}
