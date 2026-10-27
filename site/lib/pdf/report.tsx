// Allgemeiner, gebrandeter Bericht aus bereits formatierten Abschnitten (z. B. Objekt-Analyse).
import { Document, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BRAND, BrandFooter, BrandHeader, SecureWatermark, type PartnerBrand } from '@/lib/pdf/brand';
import { pdfSafeDeep } from '@/lib/pdf/text';

export type ReportInput = {
  title: string;
  subtitle?: string;
  url?: string;
  chips: [string, string][];
  sections: { title: string; rows: [string, string][] }[];
  hints: string[];
  note?: string;
};

const s = StyleSheet.create({
  page: { paddingTop: 58, paddingBottom: 66, paddingHorizontal: 42, fontFamily: 'Helvetica', fontSize: 8.5, color: BRAND.text, lineHeight: 1.35 },
  title: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: BRAND.navy, lineHeight: 1.25 },
  sub: { fontSize: 8.5, color: BRAND.muted, marginTop: 2 },
  link: { fontSize: 7.5, color: BRAND.blue, marginTop: 3 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginBottom: 4 },
  chip: { width: '24%', marginRight: '1%', marginBottom: 5, borderWidth: 0.5, borderColor: BRAND.hair, borderTopWidth: 2, borderTopColor: BRAND.navy, padding: 5 },
  chipL: { fontSize: 6.5, color: BRAND.muted },
  chipV: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: '#0F172A', marginTop: 1 },
  cols: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  sec: { width: '49%', marginTop: 8 },
  h: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: BRAND.navy, marginBottom: 3 },
  row: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: BRAND.hair, paddingVertical: 2.2, paddingHorizontal: 3 },
  zebra: { backgroundColor: '#F4F6F9' },
  rl: { width: '58%' },
  rv: { width: '40%', textAlign: 'right', fontFamily: 'Helvetica-Bold', color: '#0F172A' },
  hint: { marginBottom: 2 },
  note: { marginTop: 10, fontSize: 7, color: BRAND.muted },
});

export function ReportDocument({ r: input, reportId, createdAt, hash, partner, reportType = 'Objekt-Analyse', watermark, clean }: { r: ReportInput; reportId: string; createdAt: string; hash?: string; partner?: PartnerBrand | null; reportType?: string; watermark?: string; clean?: boolean }) {
  // Werte kommen teils aus dem Browser: nur darstellbare Zeichen ausgeben (sonst fehlen z. B. negative Beträge).
  const r = pdfSafeDeep(input);
  return (
    <Document title={`LeaseRun – ${r.title}`} author="LeaseRun" language="de">
      <Page size="A4" style={s.page}>
        <SecureWatermark docId={reportId} partner={partner} label={watermark} strong={Boolean(watermark)} clean={clean} />
        <BrandHeader reportType={reportType} reportId={reportId} createdAt={createdAt} partner={partner} />
        <Text style={s.title}>{r.title}</Text>
        {r.subtitle ? <Text style={s.sub}>{r.subtitle}</Text> : null}
        {r.url ? <Link src={r.url} style={s.link}>Inserat: {r.url.length > 95 ? r.url.slice(0, 95) + '…' : r.url}</Link> : null}
        <View style={s.chips}>
          {r.chips.map(([l, v], i) => (
            <View key={i} style={s.chip}><Text style={s.chipL}>{l}</Text><Text style={s.chipV}>{v}</Text></View>
          ))}
        </View>
        <View style={s.cols}>
          {r.sections.map((sec, i) => (
            <View key={i} style={s.sec} wrap={false}>
              <Text style={s.h}>{sec.title}</Text>
              {sec.rows.map(([l, v], j) => (
                <View key={j} style={j % 2 ? [s.row, s.zebra] : s.row}><Text style={s.rl}>{l}</Text><Text style={s.rv}>{v}</Text></View>
              ))}
            </View>
          ))}
        </View>
        {r.hints.length ? (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={s.h}>Hinweise</Text>
            {r.hints.map((h, i) => <Text key={i} style={s.hint}>• {h}</Text>)}
          </View>
        ) : null}
        <Text style={s.note}>{r.note || 'Alle Werte beruhen auf den eingegebenen Angaben; Inseratsinhalte werden nicht übernommen. Modellrechnung ohne Gewähr.'}</Text>
        <BrandFooter hash={hash} partner={partner} />
      </Page>
    </Document>
  );
}
