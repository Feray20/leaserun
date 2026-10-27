// Preis- und Leistungsverzeichnis der LeaseRun Card.
// Versionen werden nie überschrieben: Für eine Änderung wird eine neue Version angehängt.
// amount = null bedeutet „Noch nicht festgelegt“ – es werden keine Beispiel- oder Fantasiepreise veröffentlicht.
// Sobald die Tabellen lr_card_pricing_* eingespielt sind, kann die Quelle auf die Datenbank umgestellt werden (gleiche Struktur).
import { createHash } from 'node:crypto';

export type PricingItem = { product: 'all' | 'debit' | 'charge'; name: string; amount: number | null; unit?: string; note?: string };
export type PricingChapter = { no: number; title: string; intro?: string; items: PricingItem[] };
export type PricingVersion = { documentId: string; version: string; status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; effectiveFrom: string | null; createdAt: string; chapters: PricingChapter[] };

const OPEN = 'Wird vor dem Start vertraglich festgelegt und hier veröffentlicht.';

export const PRICING_VERSIONS: PricingVersion[] = [
  {
    documentId: 'PLV-CARD-DE-001',
    version: '1.0',
    status: 'DRAFT',
    effectiveFrom: null,
    createdAt: '2026-10-18',
    chapters: [
      { no: 1, title: 'Allgemeine Informationen', intro: 'Die LeaseRun Card befindet sich in Vorbereitung. Dieses Verzeichnis ist ein Entwurf und noch nicht gültig. Verbindlich werden ausschließlich die Preise der veröffentlichten Fassung mit Gültigkeitsdatum. Alle Preise in Euro inklusive gesetzlicher Umsatzsteuer, soweit diese anfällt.', items: [] },
      { no: 2, title: 'Kontoführung', items: [
        { product: 'debit', name: 'Monatliche Grundgebühr Debit', amount: 0, unit: 'pro Monat', note: 'Zero-Fee-Wachstumsphase: keine monatliche Grundgebühr.' },
        { product: 'charge', name: 'Monatliche Grundgebühr Charge', amount: 0, unit: 'pro Monat', note: 'Zero-Fee-Wachstumsphase: keine monatliche Grundgebühr.' },
      ] },
      { no: 3, title: 'Kartenbereitstellung', items: [
        { product: 'all', name: 'Physische Karte (Erstausstattung)', amount: null, note: OPEN },
        { product: 'all', name: 'Virtuelle Karte', amount: null, note: 'Nur sofern vom Kartenherausgeber unterstützt.' },
      ] },
      { no: 4, title: 'Karteneinsatz im Inland', items: [
        { product: 'debit', name: 'Zahlung in Euro', amount: 0, unit: 'je Zahlung' },
        { product: 'charge', name: 'Zahlung in Euro', amount: null, note: OPEN },
      ] },
      { no: 5, title: 'Karteneinsatz im Ausland', items: [{ product: 'all', name: 'Zahlung in Euro im Euro-Raum', amount: null, note: OPEN }] },
      { no: 6, title: 'Fremdwährungen', items: [
        { product: 'all', name: 'Fremdwährungsentgelt', amount: null, note: OPEN },
        { product: 'all', name: 'Referenzwechselkurs', amount: null, unit: 'Methode', note: 'Die Methode zur Kursbestimmung wird vor dem Start vertraglich festgelegt.' },
      ] },
      { no: 7, title: 'Bargeldabhebungen', intro: 'Betreiber von Geldautomaten können unabhängig hiervon eigene Entgelte verlangen.', items: [
        { product: 'all', name: 'Kostenlose Abhebungen pro Monat', amount: null, unit: 'Anzahl', note: OPEN },
        { product: 'all', name: 'Jede weitere Abhebung', amount: null, note: OPEN },
      ] },
      { no: 8, title: 'SEPA', items: [{ product: 'all', name: 'SEPA-Lastschrift zur Abrechnung bzw. Aufladung', amount: null, note: OPEN }] },
      { no: 9, title: 'Rücklastschriften', intro: 'Bei einer Rücklastschrift werden getrennt ausgewiesen: Bankentgelte, tatsächlich angefallene Fremdkosten und ein etwaiges LeaseRun-Entgelt.', items: [
        { product: 'all', name: 'Weitergabe tatsächlicher Bank- und Fremdkosten', amount: null, unit: 'in tatsächlicher Höhe', note: 'Nur soweit rechtlich zulässig.' },
        { product: 'all', name: 'LeaseRun-Entgelt', amount: null, note: OPEN },
      ] },
      { no: 10, title: 'Ersatzkarten', items: [{ product: 'all', name: 'Ersatzkarte', amount: null, note: OPEN }] },
      { no: 11, title: 'Expressversand', items: [{ product: 'all', name: 'Expressversand einer Karte', amount: null, note: OPEN }] },
      { no: 12, title: 'Sicherheitskaution', intro: 'Nur bei der Charge Card. Die Sicherheitskaution und das monatliche Ausgabenlimit sind unterschiedliche Größen: Das Limit kann höchstens so hoch sein wie die Kaution.', items: [{ product: 'charge', name: 'Verwahrung der Sicherheitskaution', amount: null, note: OPEN }] },
      { no: 13, title: 'Limitänderungen', items: [{ product: 'all', name: 'Änderung des Monatslimits im Rahmen der Kaution', amount: 0 }] },
      { no: 14, title: 'Monatsabrechnung', items: [
        { product: 'charge', name: 'Monatsabrechnung als PDF', amount: 0 },
        { product: 'charge', name: 'Papierabrechnung auf Wunsch', amount: null, note: OPEN },
      ] },
      { no: 15, title: 'Digitale LeaseRun-Vorteile', intro: 'Karteninhaber erhalten 20 % Vorteil auf qualifizierte digitale LeaseRun-Produkte (Kreditmappe, Käufer-Pass, Investor Pro), solange die Karte aktiv ist. Ausgenommen sind Tarife für Unternehmen.', items: [] },
      { no: 16, title: 'Beschwerden', intro: 'Beschwerden richten Sie an support@leaserun.com. Wir bestätigen den Eingang und antworten in der Regel innerhalb von 15 Geschäftstagen. Weitere Beschwerdestellen werden mit dem Start benannt.', items: [] },
      { no: 17, title: 'Datenschutz', intro: 'Informationen zur Verarbeitung Ihrer Daten finden Sie unter leaserun.com/datenschutz. Vollständige Kartennummern und Bankdaten werden von LeaseRun nicht gespeichert.', items: [] },
      { no: 18, title: 'Rechtliche Hinweise', intro: 'LeaseRun ist ein technisches Analyse-, Organisations- und Vorbereitungssystem. Karten-, Zahlungs- und Identifizierungsleistungen werden erst angeboten, wenn ein entsprechend zugelassener Partner angeschlossen ist. Bis dahin werden keine Karten ausgegeben, keine Zahlungen abgewickelt und keine Gelder verwahrt.', items: [] },
      { no: 19, title: 'Versionshistorie', intro: 'Version 1.0 – Entwurf vom 18.10.2026, noch nicht gültig.', items: [] },
    ],
  },
];

export const currentPricing = (): PricingVersion => PRICING_VERSIONS[PRICING_VERSIONS.length - 1];

// Prüfsumme über den Inhalt (für Dokument-ID und Echtheitsnachweis im PDF).
export function pricingHash(v: PricingVersion): string {
  return createHash('sha256').update(JSON.stringify({ d: v.documentId, v: v.version, s: v.status, e: v.effectiveFrom, c: v.chapters })).digest('hex');
}
