import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BRAND, Logo, SecureWatermark, stamp } from '@/lib/pdf/brand';
import { pdfSafeDeep } from '@/lib/pdf/text';

// Written registration record for business accounts: all details, the confirmed statements word for word,
// timestamps, technical identifiers and a checksum. Sent to LeaseRun's support inbox and as a copy to the customer.

export const CONSENT_TEXTS = {
  richtig: 'I confirm that all information about the business and about me is complete and accurate. I understand that LeaseRun may lock the account if any information is false.',
  unternehmer: 'I confirm that I am acting on behalf of a business for business purposes, not as a consumer, and that I am authorized to bind the business.',
  avv: 'On behalf of the business, I accept the Data Processing Addendum (DPA) in the version shown above and am authorized to do so.',
  agb: 'I have read the Business Terms of Service and the Privacy Policy. I understand that LeaseRun does not originate or broker loans and that my business remains responsible for its own licensing (NMLS, state licenses), fair lending (ECOA/Regulation B) and FCRA compliance.',
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

const TYPE: Record<string, string> = { BANK: 'Lender, bank or credit union', BROKER: 'Mortgage broker / loan officer (NMLS)', REALTOR: 'Real estate agent / brokerage (state license)', ADVISOR: 'CPA / financial advisor', OTHER: 'Property manager / other firm' };
export const typeLabel = (t: string) => TYPE[t] ?? t;

const s = StyleSheet.create({
  page: { padding: 40, paddingBottom: 56, fontSize: 9.5, fontFamily: 'Helvetica', color: BRAND.text },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: BRAND.navy, paddingBottom: 8, marginBottom: 14 },
  h1: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: BRAND.navy, lineHeight: 1.25, marginBottom: 4 },
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

export function RegistrationProofDocument({ p: input }: { p: RegistrationProof }) {
  const p = pdfSafeDeep(input);
  return (
    <Document title={`Registration record ${p.company.name}`} author="LeaseRun" subject={`Record ${p.proofId}`} language="en-US">
      <Page size="LETTER" style={s.page}>
        <SecureWatermark docId={p.proofId} label="REGISTRATION RECORD" />
        <View style={s.head} fixed><Logo /><Text style={{ fontSize: 8.5, color: '#64748B' }}>Record ID {p.proofId}</Text></View>
        <Text style={s.h1}>Business Account Registration Record</Text>
        <Text style={s.lead}>
          This document records the details provided and the statements confirmed at registration. It was generated automatically at the moment of registration. The checksum (SHA-256) over all details shows that the content has not been changed afterwards.
        </Text>

        <Text style={s.h2}>1. Business</Text>
        <Row k="Legal business name" v={p.company.name} />
        <Row k="Entity type / state" v={p.company.legalForm} />
        <Row k="Type" v={typeLabel(p.company.type)} />
        <Row k="NMLS ID / license number" v={p.company.registerNumber} />
        <Row k="EIN (optional)" v={p.company.taxId} />
        <Row k="Address" v={`${p.company.street}, ${p.company.city} ${p.company.postalCode}`} />
        <Row k="Customer number" v={p.customerNumber} />
        <Row k="Partner URL" v={`leaserun.com/partners?slug=${p.company.slug}`} />
        <Row k="Partner code" v={p.partnerCode} />

        <Text style={s.h2}>2. Contact person and login</Text>
        <Row k="Name" v={p.person.name} />
        <Row k="Account email" v={p.person.email} />
        <Row k="Phone" v={p.person.phone} />
        <Row k="Email confirmed on" v={p.account.emailConfirmedAt ? stamp(p.account.emailConfirmedAt) : 'not confirmed yet'} />
        <Row k="User account created on" v={p.account.signedUpAt ? stamp(p.account.signedUpAt) : null} />
        <Row k="User ID" v={p.account.userId} />

        <Text style={s.h2}>3. Confirmed statements (exact wording)</Text>
        {p.consents.map((c) => (
          <View key={c.key} style={s.consent} wrap={false}>
            <Text style={s.ct}>{CONSENT_TEXTS[c.key]}</Text>
            <Text style={s.cm}>Confirmed on {stamp(c.at)}{c.version ? ` · Version ${c.version}` : ''}</Text>
          </View>
        ))}

        <Text style={s.h2}>4. Technical record</Text>
        <Row k="Time of registration" v={`${stamp(p.createdAt)} (${p.createdAt} UTC)`} />
        <Row k="IP address (anonymized hash)" v={p.tech.ipHash} />
        <Row k="Browser" v={p.tech.userAgent} />
        <View style={[s.row, { flexDirection: 'column' }]}>
          <Text style={s.k}>SHA-256 checksum over all details</Text>
          <Text style={s.mono}>{p.sha256}</Text>
        </View>
        <Text style={[s.lead, { marginTop: 10 }]}>
          Note: Partner features are unlocked only after LeaseRun has reviewed the business verification documents. This record confirms the details provided by the customer, not their accuracy as verified by LeaseRun.
        </Text>
        <View style={s.foot} fixed>
          <Text>LeaseRun · leaserun.com · support@leaserun.com</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

// Plain text for the email (in addition to the PDF).
export function proofText(p: RegistrationProof): string {
  return [
    `Registration record ${p.proofId}`,
    `Time: ${stamp(p.createdAt)} (${p.createdAt} UTC)`,
    '',
    'BUSINESS',
    `Legal business name: ${p.company.name}`,
    `Entity type / state: ${p.company.legalForm}`,
    `Type: ${typeLabel(p.company.type)}`,
    `NMLS ID / license number: ${p.company.registerNumber || '–'}`,
    `EIN: ${p.company.taxId || '–'}`,
    `Address: ${p.company.street}, ${p.company.city} ${p.company.postalCode}`,
    `Customer number: ${p.customerNumber}`,
    `Partner code: ${p.partnerCode || '–'}`,
    '',
    'CONTACT PERSON',
    `Name: ${p.person.name}`,
    `Email: ${p.person.email} (${p.account.emailConfirmedAt ? 'confirmed ' + stamp(p.account.emailConfirmedAt) : 'not confirmed yet'})`,
    `Phone: ${p.person.phone || '–'}`,
    `User ID: ${p.account.userId}`,
    '',
    'STATEMENTS',
    ...p.consents.map((c) => `[x] ${CONSENT_TEXTS[c.key]}${c.version ? ` (version ${c.version})` : ''} – ${stamp(c.at)}`),
    '',
    `IP (anonymized hash): ${p.tech.ipHash || '–'}`,
    `Browser: ${p.tech.userAgent || '–'}`,
    `SHA-256: ${p.sha256}`,
  ].join('\n');
}
