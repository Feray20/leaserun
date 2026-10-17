// Einheitliches PDF-Branding: Logo, Kopfzeile, Fußzeile, Wasserzeichen.
import { Defs, Image, LinearGradient, Polygon, Stop, Svg, Text, View, StyleSheet, G } from '@react-pdf/renderer';

export const BRAND = {
  navy: '#0F2C59', blue: '#0284C7', sky: '#38BDF8', text: '#334155', muted: '#64748B', hair: '#CBD5E1',
};

export const PDF_DISCLAIMER =
  'Reine technische Modellberechnung. Keine Kreditzusage, keine Kreditwürdigkeitsprüfung gem. § 505a BGB, keine Darlehensvermittlung gem. § 34i GewO, keine Rechts- oder Steuerberatung.';

const s = StyleSheet.create({
  header: { position: 'absolute', top: 14, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 5, borderBottomWidth: 1.2, borderBottomColor: BRAND.navy },
  logoRow: { flexDirection: 'row', alignItems: 'center' },
  word: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginLeft: 5 },
  meta: { fontSize: 7, color: BRAND.muted, textAlign: 'right', lineHeight: 1.3 },
  metaStrong: { fontFamily: 'Helvetica-Bold', color: BRAND.navy, fontSize: 7.5 },
  footer: { position: 'absolute', bottom: 14, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderTopWidth: 0.5, borderTopColor: BRAND.hair, paddingTop: 4, fontSize: 6.5, color: BRAND.muted },
  fLeft: { width: '22%' }, fMid: { width: '50%', textAlign: 'center' }, fRight: { width: '24%', textAlign: 'right' },
  wm: { position: 'absolute', top: 380, left: -60, width: 720, textAlign: 'center', fontSize: 34, fontFamily: 'Helvetica-Bold', color: BRAND.navy, opacity: 0.05, transform: 'rotate(-45deg)' },
});

// Bildmarke als Vektor (dieselben Polygone wie /brand/immoadv-icon.svg).
export function LogoMark({ size = 18 }: { size?: number }) {
  return (
    <Svg viewBox="-2 -2 104 88" style={{ width: size * 1.18, height: size }}>
      <Defs>
        <LinearGradient id="iag" x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={BRAND.navy} />
          <Stop offset="0.55" stopColor={BRAND.blue} />
          <Stop offset="1" stopColor={BRAND.sky} />
        </LinearGradient>
      </Defs>
      <G fill="url(#iag)">
        <Polygon points="50,8.3 63.1,19.4 62.6,22.5 49,34 45.2,31.1 5.3,68.9 2.5,70 3.1,51.7" />
        <Polygon points="98.8,0.7 93.4,37.3 83.6,29.8 50.8,62.3 43.7,57.9 17.2,82.6 0.2,82.6 42.2,38.4 50.3,40.1 69.6,19.5 64.6,8.1" />
        <Polygon points="82.3,37.6 99.5,53.6 99.6,84 88.6,83.6 62.5,57" />
      </G>
    </Svg>
  );
}

// Einfarbige Bildmarke (ohne Verlauf) für das Wasserzeichen-Raster – vermeidet doppelte Verlaufs-IDs je Seite.
export function LogoMarkFlat({ size = 18, color = BRAND.navy, opacity = 1 }: { size?: number; color?: string; opacity?: number }) {
  return (
    <Svg viewBox="-2 -2 104 88" style={{ width: size * 1.18, height: size }}>
      <G fill={color} fillOpacity={opacity}>
        <Polygon points="50,8.3 63.1,19.4 62.6,22.5 49,34 45.2,31.1 5.3,68.9 2.5,70 3.1,51.7" />
        <Polygon points="98.8,0.7 93.4,37.3 83.6,29.8 50.8,62.3 43.7,57.9 17.2,82.6 0.2,82.6 42.2,38.4 50.3,40.1 69.6,19.5 64.6,8.1" />
        <Polygon points="82.3,37.6 99.5,53.6 99.6,84 88.6,83.6 62.5,57" />
      </G>
    </Svg>
  );
}

export function Logo({ size = 16 }: { size?: number }) {
  return (
    <View style={s.logoRow}>
      <LogoMark size={size} />
      <Text style={[s.word, { fontSize: size * 0.72 }]}><Text style={{ color: BRAND.navy }}>Immo</Text><Text style={{ color: BRAND.blue }}>Adv</Text></Text>
    </View>
  );
}

// Datum/Uhrzeit in deutscher Zeit mit Zonenkürzel (MEZ/MESZ).
export function stamp(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const zone = get('timeZoneName').replace('GMT+2', 'MESZ').replace('GMT+1', 'MEZ');
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')} ${zone}`;
}

// whitelabel: nur bei im Unternehmensportal gebuchtem White-Label (has_whitelabel) – dann ohne ImmoAdv-Kennzeichnung.
// Im Kundenbereich (B2C) gibt es diese Möglichkeit nicht.
export type PartnerBrand = { name: string; logo?: string | null; color?: string | null; whitelabel?: boolean };

// Mit Partner (Co-Branding): Partnerlogo und -name dominant links, dezenter ImmoAdv-Hinweis rechts.
export function BrandHeader({ reportType, reportId, createdAt, partner }: { reportType: string; reportId?: string; createdAt: string; partner?: PartnerBrand | null }) {
  const line = partner?.color ? { borderBottomColor: partner.color } : {};
  return (
    <View style={[s.header, line]} fixed>
      {partner ? (
        <View style={s.logoRow}>
          {partner.logo ? <Image src={partner.logo} style={{ height: 22, maxWidth: 120, objectFit: 'contain', marginRight: 6 }} /> : null}
          <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: partner.color || BRAND.navy }}>{partner.name}</Text>
        </View>
      ) : (
        <Logo />
      )}
      <View>
        <Text style={[s.meta, s.metaStrong]}>{reportType}</Text>
        <Text style={s.meta}>{stamp(createdAt)}{reportId ? ` · ID ${reportId}` : ''}</Text>
        {partner && !partner.whitelabel ? <Text style={s.meta}>Strukturiert mit ImmoAdv-Software</Text> : null}
      </View>
    </View>
  );
}

export function BrandFooter({ hash, partner }: { hash?: string; partner?: PartnerBrand | null }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.fLeft}>{partner?.whitelabel ? partner.name : 'immoadv.de | support@immoadv.de'}</Text>
      <Text style={s.fMid}>{PDF_DISCLAIMER}</Text>
      <Text style={s.fRight} render={({ pageNumber, totalPages }) => `${hash ? `Daten-SHA-256: ${hash.slice(0, 16)}\n` : ''}Seite ${pageNumber} von ${totalPages}`} />
    </View>
  );
}

export function Watermark({ text, opacity = 0.05 }: { text: string; opacity?: number }) {
  return <Text style={[s.wm, { opacity }]} fixed>{text}</Text>;
}

// Schutz-Wasserzeichen für alle Kunden-PDFs: ImmoAdv-Bildmarke als Vektorgrafik, rasterförmig über die ganze Seite
// verteilt und Teil des Seiteninhalts (keine Anmerkung, kein markierbarer Text) – dazu Dokument-ID am Seitenrand.
// Entfällt nur bei gebuchtem White-Label (partner.whitelabel). Hinweis: Absoluten Schutz gegen Bearbeitung gibt es bei
// PDF nicht; maßgeblich für die Echtheit ist die Prüfung per QR/ID gegen die gespeicherte Prüfsumme.
const wmGrid = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
// clean: für zahlende Kunden – kein Logo-Raster und kein Schriftzug, nur die kleine Dokument-ID-Zeile zur Echtheitsprüfung.
export function SecureWatermark({ docId, label, partner, strong = false, clean = false }: { docId?: string; label?: string; partner?: PartnerBrand | null; strong?: boolean; clean?: boolean }) {
  if (clean && !label) {
    if (partner?.whitelabel) return null;
    return (
      <Text fixed style={{ position: 'absolute', top: 4, left: 42, right: 42, fontSize: 5.5, color: BRAND.muted, textAlign: 'right' }}>
        {`immoadv.de${docId ? ` · Dokument-ID ${docId}` : ''} · Echtheit prüfbar unter immoadv.de/pruefen`}
      </Text>
    );
  }
  if (partner?.whitelabel) return label ? <Watermark text={label} opacity={strong ? 0.13 : 0.06} /> : null;
  const op = strong ? 0.1 : 0.045;
  const rows = [70, 210, 350, 490, 630, 770];
  const cols = [30, 200, 370, 540];
  return (
    <>
      <View style={wmGrid} fixed>
        {rows.map((y, ri) => cols.map((x, ci) => (
          <View key={`${ri}-${ci}`} style={{ position: 'absolute', top: y, left: x + (ri % 2 ? 85 : 0), transform: 'rotate(-28deg)' }}>
            <LogoMarkFlat size={26} opacity={op} />
          </View>
        )))}
      </View>
      {label ? <Watermark text={label} opacity={strong ? 0.13 : 0.06} /> : null}
      <Text fixed style={{ position: 'absolute', top: 4, left: 42, right: 42, fontSize: 5.5, color: BRAND.muted, textAlign: 'right' }}>
        {`ImmoAdv · immoadv.de${docId ? ` · Dokument-ID ${docId}` : ''} · Echtheit prüfbar unter immoadv.de/pruefen`}
      </Text>
    </>
  );
}
