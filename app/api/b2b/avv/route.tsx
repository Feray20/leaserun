import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import { AVV_SECTIONS, AVV_TITLE } from '@/lib/b2b/avv-text';
import { AVV_VERSION, type B2BAccount } from '@/lib/b2b/core';
import { requireMember } from '@/lib/b2b/http';
import { BRAND, Logo, stamp } from '@/lib/pdf/brand';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 50, paddingHorizontal: 50, fontFamily: 'Helvetica', fontSize: 9, color: BRAND.text, lineHeight: 1.45 },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: BRAND.navy, marginTop: 16, marginBottom: 4 },
  h2: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: BRAND.navy, marginTop: 10, marginBottom: 3 },
  p: { marginBottom: 3 },
  box: { borderWidth: 0.5, borderColor: BRAND.hair, padding: 8, marginTop: 8, borderRadius: 3 },
  footer: { position: 'absolute', bottom: 20, left: 50, right: 50, fontSize: 7, color: BRAND.muted, flexDirection: 'row', justifyContent: 'space-between' },
});

function AvvPdf({ a }: { a: B2BAccount }) {
  return (
    <Document title={`AVV ${a.company_name}`} author="ImmoAdv">
      <Page size="A4" style={s.page}>
        <Logo size={16} />
        <Text style={s.h1}>{AVV_TITLE}</Text>
        <Text>Version {a.avv_version || AVV_VERSION}</Text>
        <View style={s.box}>
          <Text>Auftraggeber: {a.company_name} ({a.legal_form}), {a.street ? `${a.street}, ` : ''}{a.postal_code} {a.city}</Text>
          <Text>Kundennummer: {a.customer_number}</Text>
          <Text>Elektronisch geschlossen am: {a.avv_accepted_at ? stamp(a.avv_accepted_at) : '–'} durch Bestätigung im Portal</Text>
        </View>
        {AVV_SECTIONS.map((sec) => (
          <View key={sec.h} wrap>
            <Text style={s.h2}>{sec.h}</Text>
            {sec.p.map((t, i) => <Text key={i} style={s.p}>{t}</Text>)}
          </View>
        ))}
        <View style={s.footer} fixed>
          <Text>ImmoAdv · Georg-August-Zinn-Str. 25 · 64354 Reinheim · support@immoadv.de</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Ohne Anmeldung: Vertragstext zur Ansicht vor Abschluss. Mit Anmeldung und ?pdf=1: unterzeichnete Fassung als PDF.
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get('pdf') !== '1') {
    return NextResponse.json({ version: AVV_VERSION, title: AVV_TITLE, sections: AVV_SECTIONS }, { headers: { 'Cache-Control': 'public, max-age=600' } });
  }
  const ctx = await requireMember(req, { allowLocked: true, bucket: 'b2b-avv', limit: 10, onboarding: true });
  if (ctx instanceof Response) return ctx;
  const el = createElement(AvvPdf, { a: ctx.account }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(el);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="ImmoAdv_AVV_${ctx.account.customer_number}.pdf"`, 'Cache-Control': 'no-store' },
  });
}
