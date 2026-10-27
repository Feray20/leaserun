import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { BRAND, Logo, SecureWatermark } from '@/lib/pdf/brand';

const C = { navy: BRAND.navy, text: '#334155', muted: '#64748B', hair: '#CBD5E1', bg: '#F8FAFC', okBg: '#DCFCE7', ok: '#166534', noneBg: '#F1F5F9', none: '#64748B' };
const DISCLAIMER = 'Reines technisches Analyse-, Informations- und Vorbereitungsinstrument. Keine Kreditvermittlung oder Darlehensberatung (§ 34i GewO, KWG), keine Steuerberatung (StBerG), keine Rechtsdienstleistung (RDG).';
const CONTACT = 'LeaseRun · Feray Korkmaz · Georg-August-Zinn-Str. 25 · 64354 Reinheim · support@leaserun.com · leaserun.com';

const s = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 36, paddingHorizontal: 36, fontFamily: 'Helvetica', fontSize: 8.5, color: C.text, lineHeight: 1.35 },
  bar: { backgroundColor: C.navy, color: '#FFFFFF', padding: 12, marginBottom: 12 },
  barKicker: { fontSize: 7, letterSpacing: 1.2, color: '#CBD5E1' },
  barTitle: { fontSize: 15, fontFamily: 'Helvetica-Bold', lineHeight: 1.25, marginTop: 3 },
  h2: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginTop: 10, marginBottom: 4 },
  p: { marginBottom: 4 },
  cols: { flexDirection: 'row' },
  col: { flex: 1, borderWidth: 0.5, borderColor: C.hair, padding: 8, marginRight: 8 },
  colLast: { flex: 1, borderWidth: 0.5, borderColor: C.hair, padding: 8 },
  colTitle: { fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 3 },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.hair, paddingVertical: 2.5, paddingHorizontal: 4 },
  zebra: { backgroundColor: '#F1F3F7' },
  head: { flexDirection: 'row', backgroundColor: C.navy, paddingVertical: 3, paddingHorizontal: 4 },
  headText: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  badge: { fontSize: 7, fontFamily: 'Helvetica-Bold', paddingVertical: 1, paddingHorizontal: 4, borderRadius: 2 },
  footer: { position: 'absolute', bottom: 18, left: 36, right: 36, fontSize: 6.5, color: C.muted, borderTopWidth: 0.5, borderTopColor: C.hair, paddingTop: 4 },
});

const Footer = () => (
  <View style={s.footer} fixed>
    <Text>{DISCLAIMER}</Text>
    <Text>{CONTACT} · Stand: Oktober 2026</Text>
  </View>
);

export function BankOnePager() {
  const status: [string, string, boolean][] = [
    ['Rechner, Cockpit, Stresstest, Banken-Ready-Score', 'Verfügbar', true],
    ['Kreditmappe als PDF mit SHA-256-Prüfsumme', 'Verfügbar', true],
    ['Dokument-Upload (Dateityp- und Prüfsummenprüfung, unveränderbare Originale)', 'Verfügbar', true],
    ['Berater-Datenraum mit QR-Freigabe, Ablauf, Widerruf, Zugriffsprotokoll', 'Verfügbar', true],
    ['Inhaltliche Auswertung (OCR) mit Quellenangabe je Wert', 'In Entwicklung', false],
    ['Co-Branding-Link für Partnerbanken (leaserun.com/p/…)', 'Verfügbar, Einrichtung auf Anfrage', true],
  ];
  return (
    <Document title="LeaseRun – Information für Banken und Finanzierungsberater" author="LeaseRun" language="de">
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}><Logo size={14} /><Text style={{ fontSize: 7, color: C.muted }}>leaserun.com · Stand Oktober 2026</Text></View>
        <View style={s.bar}>
          <Text style={s.barKicker}>INFORMATION FÜR BANKEN, SPARKASSEN UND FINANZIERUNGSBERATER</Text>
          <Text style={s.barTitle}>Ihre Kunden kommen vorbereitet ins Erstgespräch.</Text>
        </View>
        <Text style={s.p}>
          LeaseRun strukturiert Haushalts-, Bonitäts- und Objektdaten vor dem ersten Bankgespräch: Kennzahlen mit offengelegtem Rechenweg, Stresstest, Unterlagenstatus und eine Kreditmappe als PDF. Kunden können ausgewählte Unterlagen über einen befristeten, widerrufbaren Link mit QR-Code freigeben.
        </Text>

        <Text style={s.h2}>Was Sie erhalten</Text>
        <View style={s.cols}>
          <View style={s.col}><Text style={s.colTitle}>Kreditmappe</Text><Text>Vorhaben, Finanzierung, Objekt, NOI, CFADS, DSCR, ICR, LTV, Stresstest für Zins, Leerstand und Kosten, Haushaltsrechnung, Prüfpunkte, Unterlagenindex.</Text></View>
          <View style={s.col}><Text style={s.colTitle}>Datenraum</Text><Text>Nur freigegebene Kategorien (z. B. Objekt, WEG, Grundbuch), Ablauf nach 48 Stunden, 7 oder 30 Tagen, Abrufzähler, sofortiger Widerruf durch den Kunden.</Text></View>
          <View style={s.colLast}><Text style={s.colTitle}>Nachvollziehbarkeit</Text><Text>Jede Datei mit SHA-256-Prüfsumme; Zugriffe werden protokolliert (IP gekürzt und gehasht). Kennzahlen sind als LeaseRun-Risikopolitik gekennzeichnet.</Text></View>
        </View>

        <Text style={s.h2}>Kooperationsmodelle (Pilotphase)</Text>
        <View style={s.cols}>
          <View style={s.col}>
            <Text style={s.colTitle}>Modell A: Empfehlung</Text>
            <Text>Kostenfrei für die Bank. Sie empfehlen LeaseRun Interessenten zur Vorbereitung; die Kunden nutzen die regulären Angebote.</Text>
          </View>
          <View style={s.colLast}>
            <Text style={s.colTitle}>Modell B: Technische Servicepauschale</Text>
            <Text>Feste Pauschale je aufbereitetem Dossier oder als Kontingent, nach individueller Pilotvereinbarung. Keine erfolgsabhängige Vergütung.</Text>
          </View>
        </View>

        <Text style={s.h2}>Entwicklungsstand</Text>
        <View>
          <View style={s.head}><Text style={[s.headText, { flex: 4 }]}>Funktion</Text><Text style={[s.headText, { flex: 1, textAlign: 'right' }]}>Status</Text></View>
          {status.map(([f, st, on], i) => (
            <View key={f} style={[s.row, i % 2 ? s.zebra : {}]}>
              <Text style={{ flex: 4 }}>{f}</Text>
              <View style={{ flex: 1, alignItems: 'flex-end' }}><Text style={[s.badge, on ? { color: C.ok, backgroundColor: C.okBg } : { color: C.none, backgroundColor: C.noneBg }]}>{st}</Text></View>
            </View>
          ))}
        </View>

        <Text style={s.h2}>Rechtlicher Rahmen</Text>
        <Text style={s.p}>LeaseRun hat keine Erlaubnis nach § 34c oder § 34i GewO, vermittelt keine Darlehen, gibt keine Konditionszusagen und trifft keine Kreditentscheidungen. Kooperationen beschränken sich auf Empfehlungen oder feste technische Servicepauschalen, nicht auf Provisionen. Es bestehen keine Partnerschaften mit Plattformen wie Europace, eHyp oder Finmas. Die Kreditentscheidung liegt allein bei der Bank.</Text>
        <Text style={s.p}>Die Kennzahlen beruhen auf Angaben der Kunden; hochgeladene Unterlagen werden formal (Dateityp, Prüfsumme), aber nicht inhaltlich geprüft.</Text>

        <Text style={s.h2}>Kontakt für einen Pilot</Text>
        <Text>support@leaserun.com · leaserun.com/b2b · Muster-Kreditmappe: leaserun.com/api/mustermappe</Text>
        <Footer />
      </Page>
    </Document>
  );
}

const DOCS: [string, string, string, string][] = [
  // Unterlage, Angestellt/Beamte, Selbstständig, Hinweis
  ['Personalausweis oder Reisepass (Kopie)', 'erforderlich', 'erforderlich', 'gültig'],
  ['Selbstauskunft der Bank', 'erforderlich', 'erforderlich', 'vollständig, unterschrieben'],
  ['Gehaltsabrechnungen der letzten 3 Monate', 'erforderlich', '–', 'inkl. Dezember-Abrechnung bei Boni'],
  ['Arbeitsvertrag', 'erforderlich', '–', 'Probezeit beendet?'],
  ['Einkommensteuerbescheide der letzten 2–3 Jahre', 'fallweise', 'erforderlich', 'bei Selbstständigen zwingend'],
  ['Jahresabschlüsse / EÜR der letzten 2–3 Jahre', '–', 'erforderlich', 'mit aktueller BWA und Summen- und Saldenliste'],
  ['Eigenkapitalnachweis', 'erforderlich', 'erforderlich', 'Kontoauszüge oder Depotauszüge'],
  ['Bestehende Kredite und Leasingverträge', 'fallweise', 'fallweise', 'Restschuld und Rate'],
  ['Nachweis private Krankenversicherung', 'fallweise', 'fallweise', 'wird bei Beamten abgezogen'],
  ['Exposé und Objektbeschreibung', 'erforderlich', 'erforderlich', ''],
  ['Grundbuchauszug', 'erforderlich', 'erforderlich', 'nicht älter als 3 Monate; Abt. II und III prüfen'],
  ['Flurkarte', 'erforderlich', 'erforderlich', ''],
  ['Grundrisse und Wohnflächenberechnung', 'erforderlich', 'erforderlich', 'nach WoFlV'],
  ['Energieausweis', 'erforderlich', 'erforderlich', 'Pflicht nach GModG (bis 28.07.2026 GEG)'],
  ['Teilungserklärung (ETW)', 'fallweise', 'fallweise', 'nur Eigentumswohnung'],
  ['Protokolle der letzten 3 Eigentümerversammlungen (ETW)', 'fallweise', 'fallweise', 'Sonderumlagen, Sanierungen'],
  ['Wirtschaftsplan, Hausgeldabrechnung, Rücklagenstand (ETW)', 'fallweise', 'fallweise', ''],
  ['Mietvertrag (bei Vermietung)', 'fallweise', 'fallweise', 'Miethöhe, Staffel/Index'],
  ['Gebäudeversicherung', 'fallweise', 'fallweise', ''],
  ['Kaufvertragsentwurf', 'erforderlich', 'erforderlich', 'vor dem Notartermin'],
];

export function BeraterCheckliste() {
  return (
    <Document title="LeaseRun – Unterlagen-Checkliste Baufinanzierung" author="LeaseRun" language="de">
      <Page size="A4" style={s.page}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}><Logo size={14} /><Text style={{ fontSize: 7, color: C.muted }}>leaserun.com · Stand Oktober 2026</Text></View>
        <View style={s.bar}>
          <Text style={s.barKicker}>CHECKLISTE FÜR BERATUNG UND KUNDEN</Text>
          <Text style={s.barTitle}>Unterlagen für die Baufinanzierung</Text>
        </View>
        <Text style={s.p}>Typische Anforderungen nach Erwerbsstatus. Welche Unterlagen eine Bank konkret verlangt, legt sie selbst fest.</Text>
        <View>
          <View style={s.head}>
            <Text style={[s.headText, { flex: 3.2 }]}>Unterlage</Text>
            <Text style={[s.headText, { flex: 1.2 }]}>Angestellt / Beamte</Text>
            <Text style={[s.headText, { flex: 1.2 }]}>Selbstständig</Text>
            <Text style={[s.headText, { flex: 2.2 }]}>Hinweis</Text>
            <Text style={[s.headText, { flex: 0.6, textAlign: 'center' }]}>Liegt vor</Text>
          </View>
          {DOCS.map(([d, a, b, h], i) => (
            <View key={d} style={[s.row, i % 2 ? s.zebra : {}]}>
              <Text style={{ flex: 3.2 }}>{d}</Text>
              <Text style={{ flex: 1.2 }}>{a}</Text>
              <Text style={{ flex: 1.2 }}>{b}</Text>
              <Text style={{ flex: 2.2, color: C.muted }}>{h}</Text>
              <View style={{ flex: 0.6, alignItems: 'center' }}><View style={{ width: 8, height: 8, borderWidth: 0.75, borderColor: C.navy }} /></View>
            </View>
          ))}
        </View>
        <Text style={s.h2}>Hinweise nach Erwerbsstatus</Text>
        <Text style={s.p}>Befristet Angestellte: häufig zweiter Darlehensnehmer oder zusätzliche Sicherheiten. Berufseinsteiger: Fokus auf Eigenkapital und Kaufpreisgrenze. Selbstständige: meist mindestens 2–3 Jahre Geschäftstätigkeit. Rentner: Altersgrenzen und Restlaufzeit beachten.</Text>
        <Footer />
      </Page>
    </Document>
  );
}

// ---------- Vorlagen zum Ausfüllen von Hand (manuelle Variante) ----------
const fs = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  cell: { width: '50%', paddingHorizontal: 4, marginBottom: 7 },
  cellFull: { width: '100%', paddingHorizontal: 4, marginBottom: 7 },
  lab: { fontSize: 7, color: C.muted, marginBottom: 2 },
  line: { borderBottomWidth: 0.75, borderBottomColor: C.hair, height: 13 },
  sec: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: C.navy, marginTop: 8, marginBottom: 5, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: C.navy },
  calc: { flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 0.5, borderBottomColor: C.hair, paddingVertical: 4 },
  calcL: { flex: 3 }, calcF: { flex: 3, color: C.muted, fontSize: 7.5 }, calcV: { flex: 1.4, borderBottomWidth: 0.75, borderBottomColor: C.navy, height: 12, marginLeft: 6 },
  box: { width: 8, height: 8, borderWidth: 0.75, borderColor: C.navy, marginRight: 6 },
  chk: { flexDirection: 'row', alignItems: 'center', width: '50%', marginBottom: 5 },
});
const F = ({ l, full }: { l: string; full?: boolean }) => (
  <View style={full ? fs.cellFull : fs.cell}><Text style={fs.lab}>{l}</Text><View style={fs.line} /></View>
);
const Calc = ({ l, f }: { l: string; f: string }) => (
  <View style={fs.calc}><Text style={fs.calcL}>{l}</Text><Text style={fs.calcF}>{f}</Text><View style={fs.calcV} /></View>
);
const Head = ({ kicker, title }: { kicker: string; title: string }) => (
  <>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}><Logo size={14} /><Text style={{ fontSize: 7, color: C.muted }}>leaserun.com · Vorlage · Stand Oktober 2026</Text></View>
    <View style={s.bar}><Text style={s.barKicker}>{kicker}</Text><Text style={s.barTitle}>{title}</Text></View>
  </>
);

export function KreditmappeVorlage() {
  return (
    <Document title="LeaseRun – Kreditmappe zum Ausfüllen" author="LeaseRun" language="de">
      <Page size="A4" style={s.page}>
        <SecureWatermark docId="VORLAGE-KM" />
        <Head kicker="KREDITMAPPE · ZUM AUSFÜLLEN VON HAND" title="Kreditmappe für das Bankgespräch" />
        <Text style={s.p}>Tragen Sie Ihre Angaben ein und legen Sie die Unterlagen bei. Schneller geht es digital: In der LeaseRun-Anwendung werden alle Werte automatisch berechnet und als PDF ausgegeben.</Text>
        <Text style={fs.sec}>1. Persönliche Angaben</Text>
        <View style={fs.grid}>
          <F l="Name, Vorname" /><F l="Geburtsdatum" /><F l="Anschrift" full /><F l="Familienstand / Kinder" /><F l="Telefon / E-Mail" />
          <F l="Erwerbsstatus (angestellt, beamtet, selbstständig …)" /><F l="Arbeitgeber / beschäftigt seit" />
        </View>
        <Text style={fs.sec}>2. Objekt</Text>
        <View style={fs.grid}>
          <F l="Adresse des Objekts" full /><F l="Objektart (ETW, EFH, MFH)" /><F l="Baujahr" /><F l="Wohnfläche (m²) / Zimmer" /><F l="Energieeffizienzklasse" />
          <F l="Nutzung (selbst bewohnt / vermietet)" /><F l="Ist-Miete bzw. geplante Kaltmiete (€/Monat)" /><F l="Hausgeld (€/Monat)" /><F l="Erhaltungsrücklage der WEG (€)" />
        </View>
        <Text style={fs.sec}>3. Kosten und Finanzierung</Text>
        <Calc l="Kaufpreis" f="laut Kaufvertrag/Exposé" />
        <Calc l="Grunderwerbsteuer" f="Kaufpreis × Satz des Bundeslands (3,5–6,5 %)" />
        <Calc l="Notar und Grundbuch" f="ca. 2 % des Kaufpreises" />
        <Calc l="Makler (Käuferanteil)" f="laut Exposé, z. B. 3,57 %" />
        <Calc l="Gesamtkosten" f="Summe der Zeilen oben" />
        <Calc l="Eigenkapital" f="mind. Nebenkosten, besser + 10–20 % Kaufpreis" />
        <Calc l="Darlehen" f="Gesamtkosten – Eigenkapital" />
        <Calc l="Monatsrate" f="Darlehen × (Sollzins + Tilgung) ÷ 12" />
        <Footer />
      </Page>
      <Page size="A4" style={s.page}>
        <SecureWatermark docId="VORLAGE-KM" />
        <Text style={fs.sec}>4. Haushaltsrechnung (pro Monat)</Text>
        <Calc l="Nettoeinkommen (alle Antragsteller)" f="laut letzten 3 Gehaltsabrechnungen" />
        <Calc l="+ Kindergeld, sonstige Einnahmen" f="nur dauerhafte Einnahmen" />
        <Calc l="+ Mieteinnahmen" f="Banken rechnen meist mit 70–80 % der Kaltmiete" />
        <Calc l="– Lebenshaltung" f="Pauschale der Bank, z. B. je Person" />
        <Calc l="– Wohnkosten (falls weiter zur Miete)" f="Warmmiete" />
        <Calc l="– bestehende Kredite, Versicherungen, Sparraten" f="laut Verträgen" />
        <Calc l="– Rate der neuen Finanzierung" f="aus Abschnitt 3" />
        <Calc l="= Überschuss" f="sollte deutlich positiv sein" />
        <Text style={fs.sec}>5. Vermögen und Verbindlichkeiten</Text>
        <View style={fs.grid}><F l="Bankguthaben / Wertpapiere" /><F l="Bausparverträge / Lebensversicherungen" /><F l="Weitere Immobilien (Wert / Restschuld)" /><F l="Sonstige Verbindlichkeiten" /></View>
        <Text style={fs.sec}>6. Unterlagen (bitte beilegen)</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {['Ausweiskopie', 'Gehaltsabrechnungen (3 Monate)', 'Lohnsteuerbescheinigung', 'Kontoauszüge (3 Monate)', 'Eigenkapitalnachweis', 'Exposé', 'Grundbuchauszug', 'Flurkarte / Lageplan', 'Grundrisse und Wohnflächenberechnung', 'Teilungserklärung (ETW)', 'WEG-Protokolle, Wirtschaftsplan', 'Energieausweis', 'Mietvertrag (bei Vermietung)', 'Bei Selbstständigen: BWA, Bilanzen, Steuerbescheide'].map((d) => (
            <View key={d} style={fs.chk}><View style={fs.box} /><Text>{d}</Text></View>
          ))}
        </View>
        <View style={[fs.grid, { marginTop: 14 }]}><F l="Ort, Datum" /><F l="Unterschrift" /></View>
        <Text style={[s.p, { color: C.muted, marginTop: 6 }]}>Welche Unterlagen und Pauschalen eine Bank konkret ansetzt, legt sie selbst fest. Keine Kreditzusage.</Text>
        <Footer />
      </Page>
    </Document>
  );
}

export function AnalyseVorlage() {
  return (
    <Document title="LeaseRun – Objekt-Analyse zum Ausfüllen" author="LeaseRun" language="de">
      <Page size="A4" style={s.page}>
        <SecureWatermark docId="VORLAGE-AN" />
        <Head kicker="OBJEKT-ANALYSE · ZUM AUSFÜLLEN VON HAND" title="Lohnt sich die Immobilie?" />
        <Text style={s.p}>Rechnen Sie die wichtigsten Kennzahlen selbst nach. Digital erledigt das die LeaseRun-Anwendung automatisch – auch direkt aus einem Exposé.</Text>
        <Text style={fs.sec}>Objekt</Text>
        <View style={fs.grid}><F l="Adresse / Bezeichnung" full /><F l="Kaufpreis (€)" /><F l="Wohnfläche (m²)" /><F l="Kaltmiete (€/Monat)" /><F l="Nicht umlagefähige Kosten (€/Monat)" /><F l="Eigenkapital (€)" /><F l="Sollzins / Tilgung (%)" /></View>
        <Text style={fs.sec}>Kennzahlen</Text>
        <Calc l="Preis pro m²" f="Kaufpreis ÷ Wohnfläche" />
        <Calc l="Jahreskaltmiete" f="Kaltmiete × 12" />
        <Calc l="Bruttomietrendite" f="Jahreskaltmiete ÷ Kaufpreis × 100" />
        <Calc l="Kaufpreisfaktor" f="Kaufpreis ÷ Jahreskaltmiete (bis 22 eher günstig)" />
        <Calc l="Kaufnebenkosten" f="Kaufpreis × (GrESt + Notar/Grundbuch + Makler)" />
        <Calc l="Darlehen" f="Kaufpreis + Nebenkosten – Eigenkapital" />
        <Calc l="Monatsrate" f="Darlehen × (Zins + Tilgung) ÷ 12" />
        <Calc l="Instandhaltung + Mietausfall" f="ca. 1 €/m² + 2 % der Miete pro Monat" />
        <Calc l="Cashflow vor Steuern" f="Miete – Kosten – Instandhaltung – Mietausfall – Rate" />
        <Calc l="Kapitaldienstdeckung (DSCR)" f="(Miete – Kosten – Instandhaltung – Mietausfall) ÷ Rate (ab 1,2 solide)" />
        <Calc l="Nettomietrendite" f="(Jahresmiete – Jahreskosten) ÷ Gesamtkosten × 100" />
        <Text style={fs.sec}>Notizen</Text>
        <View style={fs.grid}><F l="" full /><F l="" full /><F l="" full /></View>
        <Text style={[s.p, { color: C.muted }]}>Ampelgrenzen sind Orientierungswerte (LeaseRun-Annahmen). Rechnerische Orientierung, keine Anlage- oder Finanzierungsberatung.</Text>
        <Footer />
      </Page>
    </Document>
  );
}
