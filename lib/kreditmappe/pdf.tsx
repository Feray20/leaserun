import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { Kreditmappe } from './model';
import { LIVING_BASE, LIVING_PER_PERSON, RENT_RECOGNITION } from './model';
import { BRAND, BrandFooter, BrandHeader, SecureWatermark, type PartnerBrand } from '@/lib/pdf/brand';

const C = {
  navy: BRAND.navy, slate: '#1E3A8A', text: '#334155', muted: '#64748B', hair: '#CBD5E1', line: '#E2E8F0', bg: '#F8FAFC',
  ok: '#166534', okBg: '#DCFCE7', warn: '#854D0E', warnBg: '#FEF9C3', bad: '#991B1B', badBg: '#FEE2E2', none: '#64748B', noneBg: '#F1F5F9',
};

const s = StyleSheet.create({
  page: { paddingTop: 58, paddingBottom: 66, paddingHorizontal: 42, fontFamily: 'Helvetica', fontSize: 9, color: C.text, lineHeight: 1.35 },
  header: { position: 'absolute', top: 16, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7.5, color: C.muted, borderBottomWidth: 0.5, borderBottomColor: C.hair, paddingBottom: 4 },
  footer: { position: 'absolute', bottom: 18, left: 42, right: 42, fontSize: 7, color: C.muted, borderTopWidth: 0.5, borderTopColor: C.hair, paddingTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { width: '80%' },
  h1: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.navy, marginBottom: 4 },
  h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.navy, marginTop: 14, marginBottom: 6 },
  kicker: { fontSize: 7.5, letterSpacing: 1.2, color: C.muted, marginBottom: 6 },
  muted: { color: C.muted },
  table: { borderTopWidth: 0.5, borderTopColor: C.hair },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.hair, paddingVertical: 4, paddingHorizontal: 6 },
  zebra: { backgroundColor: '#F1F3F7' },
  head: { backgroundColor: C.navy, flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6 },
  headText: { color: '#FFFFFF', fontFamily: 'Helvetica-Bold', fontSize: 8 },
  label: { flex: 3 },
  value: { flex: 2, textAlign: 'right' },
  badge: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', paddingVertical: 1.5, paddingHorizontal: 5, borderRadius: 2 },
  box: { borderWidth: 0.5, borderColor: C.hair, borderRadius: 3, padding: 8, marginTop: 6 },
  kpis: { flexDirection: 'row', marginTop: 10 },
  kpi: { flex: 1, borderWidth: 0.5, borderColor: C.hair, padding: 8, marginRight: 6, borderRadius: 3 },
  kpiValue: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: C.navy, marginTop: 2 },
  small: { fontSize: 7.5, color: C.muted, marginTop: 4 },
});

const fmt = (v: number, d = 2) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const eur = (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : `${fmt(v)} €`);
const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : `${fmt(v * 100)} %`);
const dec = (v: number | null) => (v === null || !Number.isFinite(v) ? '–' : fmt(v));

type Tone = 'ok' | 'warn' | 'bad' | 'none';
const toneStyle = (t: Tone) => ({
  ok: { color: C.ok, backgroundColor: C.okBg }, warn: { color: C.warn, backgroundColor: C.warnBg },
  bad: { color: C.bad, backgroundColor: C.badBg }, none: { color: C.none, backgroundColor: C.noneBg },
})[t];
const Badge = ({ t, children }: { t: Tone; children: string }) => <Text style={[s.badge, toneStyle(t)]}>{children}</Text>;

function Rows({ rows, head }: { rows: [string, string][]; head?: [string, string] }) {
  return (
    <View style={s.table}>
      {head && (
        <View style={s.head}><Text style={[s.headText, s.label]}>{head[0]}</Text><Text style={[s.headText, s.value]}>{head[1]}</Text></View>
      )}
      {rows.map(([l, v], i) => (
        <View key={l} style={[s.row, i % 2 ? s.zebra : {}]} wrap={false}>
          <Text style={s.label}>{l}</Text><Text style={s.value}>{v}</Text>
        </View>
      ))}
    </View>
  );
}

function Frame({ m, reportId, watermark, partner, clean }: { m: Kreditmappe; reportId: string; watermark?: string; partner?: PartnerBrand | null; clean?: boolean }) {
  return (
    <>
      <SecureWatermark docId={reportId} label={watermark} partner={partner} clean={clean} strong={Boolean(watermark && /^(VORSCHAU|MUSTER)/.test(watermark))} />
      <BrandHeader reportType={partner?.whitelabel ? "Kreditmappe" : "BankReady · Kreditmappe"} reportId={reportId} createdAt={m.createdAt} partner={partner} />
      <BrandFooter hash={m.dataHash} partner={partner} />
    </>
  );
}

export type Verification = { versionNo: number; versionId: string; url: string; qrDataUrl: string };

export function KreditmappeDocument({ m, verify, watermark, partner, clean }: { m: Kreditmappe; verify?: Verification; watermark?: string; partner?: PartnerBrand | null; clean?: boolean }) {
  const rid = verify?.versionId ?? m.reportId;
  const { object: o, profile: p, financing: f, metrics: x, household: h } = m;
  const vetoTone: Tone = m.vetoLevel === 'HARD_VETO' ? 'bad' : m.vetoLevel === 'CONDITIONAL_VETO' ? 'warn' : m.vetoLevel === 'WARNING' ? 'warn' : 'ok';
  const vetoLabel = { HARD_VETO: 'Hartes Veto', CONDITIONAL_VETO: 'Bedingtes Veto', WARNING: 'Hinweise', NONE: 'Keine Abweichung' }[m.vetoLevel];
  const dscrTone: Tone = x.dscr >= 1.2 ? 'ok' : x.dscr >= 1 ? 'warn' : 'bad';

  return (
    <Document title={`Kreditmappe – ${o.name}`} author="ImmoAdv" subject="Kreditmappe zur Vorbereitung des Bankgesprächs" language="de">
      <Page size="A4" style={s.page}>
        <Frame m={m} reportId={rid} watermark={watermark} partner={partner} clean={clean} />
        <Text style={s.kicker}>KREDITMAPPE · VORBEREITUNG BANKGESPRÄCH</Text>
        <Text style={s.h1}>{o.name}</Text>
        <Text style={s.muted}>Erwerbsstatus: {p.employment} · Haushalt: {p.householdSize} {p.householdSize === 1 ? 'Person' : 'Personen'}</Text>

        <View style={s.kpis}>
          <View style={s.kpi}><Text style={s.muted}>Gesamtaufwand</Text><Text style={s.kpiValue}>{eur(f.totalCost)}</Text></View>
          <View style={s.kpi}><Text style={s.muted}>Monatsrate</Text><Text style={s.kpiValue}>{eur(f.monthlyRate)}</Text></View>
          <View style={s.kpi}><Text style={s.muted}>DSCR</Text><Text style={s.kpiValue}>{dec(x.dscr)}</Text></View>
          <View style={[s.kpi, { marginRight: 0 }]}><Text style={s.muted}>Vorläufiger Score</Text><Text style={s.kpiValue}>{m.score.value} / 100</Text></View>
        </View>
        <Text style={s.small}>{m.score.note}</Text>

        {verify && (
          <View style={[s.box, { flexDirection: 'row', alignItems: 'center' }]} wrap={false}>
            <Image src={verify.qrDataUrl} style={{ width: 62, height: 62, marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', color: C.navy }}>Echtheitsprüfung · Version {verify.versionNo}</Text>
              <Text>QR-Code scannen oder {verify.url.replace(/^https?:\/\//, '')} aufrufen und diese PDF-Datei auswählen. Die Prüfsumme (SHA-256) der Datei wird im Browser berechnet und mit der bei Erstellung gespeicherten verglichen.</Text>
              <Text style={{ fontSize: 7, color: C.muted, marginTop: 2 }}>Kennung: {verify.versionId} · Strukturiert mit ImmoAdv-Software. Die Prüfseite zeigt keine Kunden- oder Finanzdaten.</Text>
            </View>
          </View>
        )}

        <Text style={s.h2}>1. Zusammenfassung</Text>
        <View style={[s.row, { borderTopWidth: 0.5, borderTopColor: C.hair }]}>
          <Text style={s.label}>Gesamteinstufung (ImmoAdv-Risikopolitik)</Text>
          <View style={[s.value, { alignItems: 'flex-end' }]}><Badge t={vetoTone}>{vetoLabel}</Badge></View>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Kapitaldienstdeckung</Text>
          <View style={[s.value, { alignItems: 'flex-end' }]}><Badge t={dscrTone}>{x.dscr >= 1.2 ? 'Tragfähig' : x.dscr >= 1 ? 'Knapp' : 'Nicht gedeckt'}</Badge></View>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Haushaltsüberschuss pro Monat</Text>
          <View style={[s.value, { alignItems: 'flex-end' }]}><Badge t={h.surplus >= 0 ? 'ok' : 'bad'}>{eur(h.surplus)}</Badge></View>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Unterlagen</Text>
          <View style={[s.value, { alignItems: 'flex-end' }]}><Badge t="none">Ungeprüft</Badge></View>
        </View>

        <Text style={s.h2}>2. Vorhaben und Finanzierung</Text>
        <Rows head={['Position', 'Betrag']} rows={[
          ['Kaufpreis', eur(o.price)],
          [o.grestPct + o.notaryPct + o.brokerPct > 0 ? `Kaufnebenkosten (GrESt ${fmt(o.grestPct)} %, Notar/Grundbuch ${fmt(o.notaryPct)} %, Makler ${fmt(o.brokerPct)} %)` : `Kaufnebenkosten (${fmt(o.purchaseCostPct)} %)`, eur(f.purchaseCosts)],
          ['Gesamtaufwand', eur(f.totalCost)],
          ['Eigenkapital', eur(f.equity)],
          ['Darlehen', eur(f.loan)],
          ['Finanzierungslücke', f.gap > 0.5 ? eur(f.gap) : 'keine'],
          ['Sollzins / anfängliche Tilgung', `${fmt(o.interestPct)} % / ${fmt(o.repaymentPct)} %`],
          ['Monatsrate (Zins und Tilgung)', eur(f.monthlyRate)],
          ['Restschuld nach 10 Jahren', eur(f.balanceAfter10y)],
        ]} />
      </Page>

      <Page size="A4" style={s.page}>
        <Frame m={m} reportId={rid} watermark={watermark} partner={partner} clean={clean} />
        <Text style={s.h2}>3. Objekt</Text>
        <Rows head={['Merkmal', 'Wert']} rows={[
          ['Bezeichnung', o.name],
          ['Wohnfläche', o.area > 0 ? `${fmt(o.area)} m²` : 'nicht angegeben'],
          ['Baujahr', o.yearBuilt > 0 ? String(o.yearBuilt) : 'nicht angegeben'],
          ['Kaufpreis je m²', eur(x.pricePerSqm)],
          ['Nettokaltmiete pro Monat', eur(o.rent)],
          ['Nicht umlagefähige Kosten pro Monat', eur(o.nonRecoverable)],
          ['Instandhaltung pro Monat', eur(o.maintenance)],
          ['Instandhaltung je m² und Monat', eur(x.maintenancePerSqm)],
          ['Leerstand / Mietausfallwagnis', `${fmt(o.vacancyPct)} %`],
          ['Beleihungswert', o.lendingValue > 0 ? eur(o.lendingValue) : 'nicht angegeben'],
          ['Marktwert (Angabe)', o.marketValue > 0 ? eur(o.marketValue) : 'nicht angegeben'],
          ['Grundbuch (Amtsgericht, Blatt)', [o.grundbuchAmt, o.grundbuchBlatt].filter(Boolean).join(', ') || 'nicht angegeben'],
          ['Flur / Flurstück', [o.flur, o.flurstueck].filter(Boolean).join(' / ') || 'nicht angegeben'],
          ['Eigentumsstruktur', o.ownership || 'nicht angegeben'],
          ['Grundstücksfläche / Nutzfläche', `${o.landArea > 0 ? fmt(o.landArea) + ' m²' : '–'} / ${o.usableArea > 0 ? fmt(o.usableArea) + ' m²' : '–'}`],
          ['Sanierungsjahr', o.renovationYear > 0 ? String(o.renovationYear) : 'nicht angegeben'],
          ['Heizung (Art, Baujahr)', [o.heatingType, o.heatingYear > 0 ? String(o.heatingYear) : ''].filter(Boolean).join(', ') || 'nicht angegeben'],
          ['Energie (Verbrauch / Primärenergie, kWh/m²a)', o.energyConsumption > 0 || o.primaryEnergy > 0 ? `${o.energyConsumption > 0 ? fmt(o.energyConsumption, 0) : '–'} / ${o.primaryEnergy > 0 ? fmt(o.primaryEnergy, 0) : '–'}` : 'nicht angegeben'],
          ['Effizienzklasse', o.efficiencyClass || 'nicht angegeben'],
        ]} />

        <Text style={s.h2}>4. Wirtschaftlichkeit</Text>
        <Rows head={['Kennzahl', 'Wert']} rows={[
          ['Bruttomietrendite', pct(x.grossYield)],
          ['NOI (Nettomietertrag p. a.)', eur(x.noi)],
          ['CFADS (verfügbar für Kapitaldienst p. a.)', eur(x.cfads)],
          ['Kapitaldienst p. a.', eur(x.debtService)],
          ['DSCR (CFADS ÷ Kapitaldienst)', dec(x.dscr)],
          ['ICR (NOI ÷ Zinsaufwand)', dec(x.icr)],
          ['LTV (Darlehen ÷ Kaufpreis)', pct(x.ltvPurchase)],
          ['Beleihungsauslauf (Darlehen ÷ Beleihungswert)', pct(x.ltvLending)],
          ['Cashflow vor Steuern pro Monat', eur(x.monthlyCashflow)],
          ['Nettomietrendite (NOI ÷ Gesamtinvestition)', pct(x.netYield)],
          ['Debt Yield (NOI ÷ Darlehen)', pct(x.debtYield)],
          ['Cash-on-Cash (Cashflow vor Steuern ÷ Eigenkapital)', pct(x.cashOnCash)],
          ['Break-even-Zins (Cashflow vor Steuern = 0)', pct(x.breakEvenRate)],
        ]} />
        {m.valuation && (
          <>
            <Text style={[s.h2, { fontSize: 10.5 }]}>Ertragswert (vereinfacht, Systematik ImmoWertV)</Text>
            <Rows head={['Position', 'Wert']} rows={[
              ['Reinertrag p. a. (Miete − Bewirtschaftung inkl. mind. 2 % Mietausfall)', eur(m.valuation.reinertrag)],
              [`Bodenwert (Kaufpreis × ${fmt(100 - o.buildingSharePct, 0)} %)`, eur(m.valuation.landValue)],
              [`Bodenwertverzinsung (${fmt(m.valuation.capRatePct)} %)`, eur(m.valuation.bodenverzinsung)],
              [`Barwertfaktor (${fmt(m.valuation.remainingLife, 0)} Jahre Restnutzungsdauer)`, fmt(m.valuation.faktor, 4)],
              ['Ertragswert', eur(m.valuation.value)],
              ['Kaufpreis im Verhältnis zum Ertragswert', `${m.valuation.deviation >= 0 ? '+' : ''}${fmt(m.valuation.deviation * 100)} %`],
            ]} />
            <Text style={s.small}>Liegenschaftszins und Restnutzungsdauer sind Angaben des Nutzers (Quelle: Gutachterausschuss). Kein Verkehrswertgutachten und kein Beleihungswert nach BelWertV.</Text>
          </>
        )}
        <Text style={s.small}>Kennzahlen und Schwellenwerte sind ImmoAdv-interne Risikopolitik, keine gesetzlichen Vorgaben. Bankindividuelle Kreditrichtlinien können abweichen.</Text>

        <Text style={s.h2}>5. Stresstest (Zins, Leerstand, Kosten)</Text>
        <View style={s.table}>
          <View style={s.head}>
            <Text style={[s.headText, { flex: 1.2 }]}>Szenario</Text>
            <Text style={[s.headText, { flex: 3 }]}>Annahmen</Text>
            <Text style={[s.headText, { flex: 1.5, textAlign: 'right' }]}>Cashflow p. a.</Text>
            <Text style={[s.headText, { flex: 0.8, textAlign: 'right' }]}>DSCR</Text>
          </View>
          {m.stress.map((r, i) => (
            <View key={r.name} style={[s.row, i % 2 ? s.zebra : {}]} wrap={false}>
              <Text style={{ flex: 1.2 }}>{r.name}</Text>
              <Text style={{ flex: 3 }}>{r.assumption}</Text>
              <Text style={{ flex: 1.5, textAlign: 'right' }}>{eur(r.cashflow)}</Text>
              <Text style={{ flex: 0.8, textAlign: 'right' }}>{dec(r.dscr)}</Text>
            </View>
          ))}
        </View>
      </Page>
      <Page size="A4" style={s.page}>
        <Frame m={m} reportId={rid} watermark={watermark} partner={partner} clean={clean} />
        <Text style={s.h2}>Steuerliche Modellrechnung (erstes Jahr)</Text>
        {m.tax ? (
          <>
            <Rows head={['Position', 'Betrag']} rows={[
              ['Gebäudeanteil am Kaufpreis', eur(m.tax.buildingValue)],
              ['Bodenanteil (nicht abschreibbar)', eur(m.tax.landValue)],
              ['AfA-Bemessungsgrundlage (inkl. anteiliger Nebenkosten)', eur(m.tax.afaBasis)],
              [`Lineare AfA ${fmt(m.tax.afaRatePct)} % (§ 7 Abs. 4 EStG)`, eur(m.tax.annualAfa)],
              ['Einkünfte aus Vermietung (Modell)', eur(m.tax.taxableResult)],
              [`Steuerwirkung bei ${fmt(o.marginalTaxPct)} % Grenzsteuersatz`, eur(m.tax.taxEffect)],
              ['Cashflow nach Steuern pro Monat', eur(m.tax.monthlyCashflowAfterTax)],
              ['15-%-Grenze (Instandsetzung netto, 3 Jahre)', eur(m.tax.threshold15)],
              ['Geplante Instandsetzung netto (3 Jahre)', eur(m.tax.renovationNet3y)],
            ]} />
            <Text style={s.small}>Vereinfachtes Modell: Zinsen des ersten Jahres, keine Sonder-AfA, keine Verlustverrechnungsgrenzen. Die Kaufpreisaufteilung sollte mit der Arbeitshilfe des BMF oder einem Gutachten belegt werden. Keine Steuerberatung.</Text>
          </>
        ) : (
          <Text style={s.muted}>Nicht berechnet: Gebäudeanteil und Grenzsteuersatz wurden nicht angegeben.</Text>
        )}

        <Text style={s.h2}>Eigentümergemeinschaft (WEG)</Text>
        {m.weg ? (
          <Rows head={['Position', 'Ihr Anteil']} rows={[
            ['Miteigentumsanteil', `${fmt(o.meaShare, 0)} / ${fmt(o.meaTotal, 0)} (${fmt(m.weg.share * 100)} %)`],
            ['Erhaltungsrücklage (anteilig)', eur(m.weg.reserveShare)],
            ['Geplante Maßnahmen (anteilig)', eur(m.weg.plannedShare)],
            ['Rechnerische Unterdeckung', eur(m.weg.underfunding)],
            ['Beschlossene Sonderumlage (anteilig)', eur(m.weg.specialShare)],
          ]} />
        ) : (
          <Text style={s.muted}>Nicht berechnet: keine Angaben zum Miteigentumsanteil (nur bei Eigentumswohnungen relevant).</Text>
        )}

        <Text style={s.h2}>Score-Treiber (vorläufiger Score {m.score.value} / 100)</Text>
        <View style={s.table}>
          <View style={s.head}>
            <Text style={[s.headText, { flex: 3 }]}>Komponente</Text>
            <Text style={[s.headText, { flex: 1, textAlign: 'right' }]}>Teilwert</Text>
            <Text style={[s.headText, { flex: 1.4, textAlign: 'right' }]}>Punkte</Text>
          </View>
          {m.scoreDrivers.map((d, i) => (
            <View key={d.label} style={[s.row, i % 2 ? s.zebra : {}]} wrap={false}>
              <Text style={{ flex: 3 }}>{d.label}</Text>
              <Text style={{ flex: 1, textAlign: 'right' }}>{fmt(d.value, 0)} / 100</Text>
              <Text style={{ flex: 1.4, textAlign: 'right' }}>{fmt(d.points, 1)} von {fmt(d.max, 0)}</Text>
            </View>
          ))}
        </View>
        <Text style={s.small}>Gewichtung nach ImmoAdv-Risikopolitik; kein Bankscore.</Text>
      </Page>


      <Page size="A4" style={s.page}>
        <Frame m={m} reportId={rid} watermark={watermark} partner={partner} clean={clean} />
        <Text style={s.h2}>6. Haushaltsrechnung (monatlich)</Text>
        <Rows head={['Position', 'Betrag']} rows={[
          ['Nettoeinkommen', eur(h.income)],
          [`Mieteinnahme, angesetzt mit ${fmt(RENT_RECOGNITION * 100, 0)} %`, eur(h.recognizedRent)],
          ['Lebenshaltungspauschale', `− ${eur(h.living)}`],
          ['Objektkosten (nicht umlagefähig und Instandhaltung)', `− ${eur(h.costs)}`],
          ['Darlehensrate', `− ${eur(h.rate)}`],
          ['Überschuss', eur(h.surplus)],
        ]} />
        <Text style={s.small}>
          Pauschale als ImmoAdv-Annahme: {fmt(LIVING_BASE, 0)} € für die erste Person, {fmt(LIVING_PER_PERSON, 0)} € je weitere Person. Bestehende Kredite, Warmmiete und Versicherungen sind nicht enthalten, sofern nicht im Einkommen berücksichtigt. Banken setzen eigene Pauschalen an.
        </Text>

        <Text style={s.h2}>7. Prüfpunkte vor Bankgespräch und Notartermin</Text>
        {m.vetos.length === 0 && <Text>Keine Abweichungen aus den eingegebenen Werten erkannt.</Text>}
        {m.vetos.map((v) => (
          <View key={v.id} style={s.box} wrap={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold', color: C.navy }}>{v.title}</Text>
              <Badge t={v.level === 'HARD_VETO' ? 'bad' : 'warn'}>{v.level === 'HARD_VETO' ? 'Hartes Veto' : v.level === 'CONDITIONAL_VETO' ? 'Bedingtes Veto' : 'Hinweis'}</Badge>
            </View>
            <Text>Befund: {v.reason}</Text>
            {v.financialImpactEur !== undefined && <Text>Finanzielle Auswirkung: {eur(v.financialImpactEur)}</Text>}
            <Text>Quelle: Nutzereingaben ({v.evidenceIds.map((e) => e.replace('eingabe:', '').replace('annahme:', 'Annahme ')).join(', ')})</Text>
            <Text>Klärungsbedarf: {v.recommendation}</Text>
          </View>
        ))}

        <Text style={s.h2}>8. Unterlagenindex</Text>
        <View style={s.table}>
          {m.documents.map((d, i) => (
            <View key={d.name} style={[s.row, i % 2 ? s.zebra : {}]} wrap={false}>
              <Text style={s.label}>{d.name}</Text>
              <View style={[s.value, { alignItems: 'flex-end' }]}><Badge t="none">{d.status}</Badge></View>
            </View>
          ))}
        </View>
        <Text style={s.small}>Status bezieht sich auf die inhaltliche Prüfung. Hochgeladene Dateien sind in Abschnitt 9 mit Prüfsumme aufgeführt.</Text>

        <Text style={s.h2}>9. Hochgeladene Unterlagen</Text>
        {m.uploads.length === 0 && <Text style={s.muted}>Keine Unterlagen im Konto hochgeladen.</Text>}
        {m.uploads.length > 0 && (
          <View style={s.table}>
            {m.uploads.map((u, i) => (
              <View key={u.sha256 + i} style={[s.row, i % 2 ? s.zebra : {}]} wrap={false}>
                <Text style={{ flex: 3 }}>{u.filename} ({u.category})</Text>
                <Text style={{ flex: 2, textAlign: 'right', fontSize: 7 }}>SHA-256 {u.sha256.slice(0, 24)}…</Text>
              </View>
            ))}
          </View>
        )}
      </Page>
    </Document>
  );
}
