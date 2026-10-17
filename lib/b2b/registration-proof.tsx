import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BRAND, Logo, SecureWatermark, stamp } from '@/lib/pdf/brand';

// Schriftlicher Registrierungsnachweis für Unternehmenskonten: alle Angaben, die bestätigten Erklärungen im Wortlaut,
// Zeitpunkte, technische Kennungen und eine Prüfsumme. Geht an die Geschäftsadresse von ImmoAdv und als Kopie an den Kunden.

export const CONSENT_TEXTS = {
  richtig: 'Ich versichere, dass alle Angaben zum Unternehmen und zu meiner Person vollständig und richtig sind. Mir ist bekannt, dass ImmoAdv das Konto bei falschen Angaben sperren kann.',
  unternehmer: 'Ich bestätige, dass ich als Unternehmer im Sinne des § 14 BGB handele. Mir ist bekannt, dass kein Widerrufsrecht besteht.',
  avv: 'Ich schließe für das Unternehmen den Auftragsverarbeitungsvertrag (Art. 28 DSGVO) in der oben angezeigten Fassung ab und bin dazu berechtigt.',
  agb: 'Ich habe die Nutzungsbedingungen für Unternehmen und die Datenschutzhinweise gelesen.',
} as const;

export type RegistrationProof = {
  proofId: string;
  createdAt: string;
  customerNumber: string;
  company: { name: string; legalForm: string; type: string; registerNumber: string | null; taxId: string | null; street: string; postalCode: string; city: string; slug: string };
  person: { name: string; email: string; phone: string | null };
  account: { userId: string; emailConfirmedAt: string | null; signedUpAt: string | null };
  consents: { key: keyof typeof CONSENT_TEXTS; at: string; version?: string }[];
  partnerCode: string | null;
  tech: { ipHash: string | null; userAgent: string | null };
  sha256: string;
};

const TYPE: Record<string, string> = { BANK: 'Kreditinstitut', BROKER: 'Finanzierungsvermittler (§ 34i GewO)', REALTOR: 'Immobilienmakler (§ 34c GewO)', OTHER: 'Sonstiges Unternehmen' };
export const typeLabel = (t: string) => TYPE[t] ?? t;

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontSize: 9.5, fontFamily: 'Helvetica', color: BRAND.text },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: BRAND.navy, paddingBottom: 8, marginBottom: 14 },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.navy, marginBottom: 4 },
  lead: { fontSize: 9.5, color: '#475569', marginBottom: 12, lineHeight: 1.4 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: BRAND.navy, marginTop: 12, marginBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#E2E8F0', paddingVertical: 3.5 },
  k: { width: 170, color: '#64748B' },
  v: { flex: 1, fontFamily: 'Helvetica-Bold' },
  consent: { borderWidth: 0.5, borderColor: '#CBD5E1', borderRadius: 4, padding: 7, marginBottom: 6 },
  ct: { lineHeight: 1.4 },
  cm: { marginTop: 3, fontSize: 8.5, color: BRAND.navy, fontFamily: 'Helvetica-Bold' },
  mono: { fontFamily: 'Courier', fontSize: 8.5 },
  foot: { position: 'absolute', left: 40, right: 40, bottom: 22, fontSize: 7.5, color: '#64748B', flexDirection: 'row', justifyContent: 'space-between' },
});

const Row = ({ k, v }: { k: string; v?: string | null }) => (
  <View style={s.row}><Text style={s.k}>{k}</Text><Text style={s.v}>{v && String(v).trim() ? v : '–'}</Text></View>
);

export function RegistrationProofDocument({ p }: { p: RegistrationProof }) {
  return (
    <Document title={`Registrierungsnachweis ${p.company.name}`} author="ImmoAdv" subject={`Nachweis ${p.proofId}`} language="de">
      <Page size="A4" style={s.page}>
        <SecureWatermark docId={p.proofId} label="REGISTRIERUNGSNACHWEIS" />
        <View style={s.head} fixed><Logo /><Text style={{ fontSize: 8.5, color: '#64748B' }}>Nachweis-ID {p.proofId}</Text></View>
        <Text style={s.h1}>Registrierungsnachweis Unternehmenskonto</Text>
        <Text style={s.lead}>
          Dieses Dokument hält fest, welche Angaben bei der Registrierung gemacht und welche Erklärungen abgegeben wurden. Es wurde automatisch im Moment der Registrierung erzeugt. Die Prüfsumme (SHA-256) über alle Angaben belegt, dass der Inhalt nachträglich nicht verändert wurde.
        </Text>

        <Text style={s.h2}>1. Unternehmen</Text>
        <Row k="Firmenname" v={p.company.name} />
        <Row k="Rechtsform" v={p.company.legalForm} />
        <Row k="Art" v={typeLabel(p.company.type)} />
        <Row k="Vermittler-Registernummer" v={p.company.registerNumber} />
        <Row k="USt-IdNr. / Steuernummer" v={p.company.taxId} />
        <Row k="Anschrift" v={`${p.company.street}, ${p.company.postalCode} ${p.company.city}`} />
        <Row k="Kundennummer" v={p.customerNumber} />
        <Row k="Partner-Adresse" v={`immoadv.de/partner?slug=${p.company.slug}`} />
        <Row k="Partnercode" v={p.partnerCode} />

        <Text style={s.h2}>2. Ansprechpartner und Zugang</Text>
        <Row k="Name" v={p.person.name} />
        <Row k="Konto-E-Mail" v={p.person.email} />
        <Row k="Telefon" v={p.person.phone} />
        <Row k="E-Mail bestätigt am" v={p.account.emailConfirmedAt ? stamp(p.account.emailConfirmedAt) : 'noch nicht bestätigt'} />
        <Row k="Benutzerkonto angelegt am" v={p.account.signedUpAt ? stamp(p.account.signedUpAt) : null} />
        <Row k="Benutzer-ID" v={p.account.userId} />

        <Text style={s.h2}>3. Abgegebene Erklärungen (Wortlaut)</Text>
        {p.consents.map((c) => (
          <View key={c.key} style={s.consent} wrap={false}>
            <Text style={s.ct}>{CONSENT_TEXTS[c.key]}</Text>
            <Text style={s.cm}>Bestätigt am {stamp(c.at)}{c.version ? ` · Fassung ${c.version}` : ''}</Text>
          </View>
        ))}

        <Text style={s.h2}>4. Technischer Nachweis</Text>
        <Row k="Zeitpunkt der Registrierung" v={`${stamp(p.createdAt)} (${p.createdAt} UTC)`} />
        <Row k="IP-Adresse (anonymisierter Hash)" v={p.tech.ipHash} />
        <Row k="Browser" v={p.tech.userAgent} />
        <View style={[s.row, { flexDirection: 'column' }]}>
          <Text style={s.k}>Prüfsumme SHA-256 über alle Angaben</Text>
          <Text style={s.mono}>{p.sha256}</Text>
        </View>
        <Text style={[s.lead, { marginTop: 10 }]}>
          Hinweis: Die Freischaltung für Partnerfunktionen erfolgt erst nach Prüfung der Gewerbenachweise durch ImmoAdv. Dieser Nachweis bestätigt die Angaben des Kunden, nicht deren Richtigkeit durch ImmoAdv.
        </Text>
        <View style={s.foot} fixed>
          <Text>ImmoAdv · Georg-August-Zinn-Str. 25 · 64354 Reinheim · support@immoadv.de</Text>
          <Text render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Klartext für die E-Mail (zusätzlich zum PDF).
export function proofText(p: RegistrationProof): string {
  return [
    `Registrierungsnachweis ${p.proofId}`,
    `Zeitpunkt: ${stamp(p.createdAt)} (${p.createdAt} UTC)`,
    '',
    'UNTERNEHMEN',
    `Firmenname: ${p.company.name}`,
    `Rechtsform: ${p.company.legalForm}`,
    `Art: ${typeLabel(p.company.type)}`,
    `Vermittler-Registernummer: ${p.company.registerNumber || '–'}`,
    `USt-IdNr./Steuernummer: ${p.company.taxId || '–'}`,
    `Anschrift: ${p.company.street}, ${p.company.postalCode} ${p.company.city}`,
    `Kundennummer: ${p.customerNumber}`,
    `Partnercode: ${p.partnerCode || '–'}`,
    '',
    'ANSPRECHPARTNER',
    `Name: ${p.person.name}`,
    `E-Mail: ${p.person.email} (${p.account.emailConfirmedAt ? 'bestätigt ' + stamp(p.account.emailConfirmedAt) : 'noch nicht bestätigt'})`,
    `Telefon: ${p.person.phone || '–'}`,
    `Benutzer-ID: ${p.account.userId}`,
    '',
    'ERKLÄRUNGEN',
    ...p.consents.map((c) => `[x] ${CONSENT_TEXTS[c.key]}${c.version ? ` (Fassung ${c.version})` : ''} – ${stamp(c.at)}`),
    '',
    `IP (anonymisierter Hash): ${p.tech.ipHash || '–'}`,
    `Browser: ${p.tech.userAgent || '–'}`,
    `SHA-256: ${p.sha256}`,
  ].join('\n');
}
