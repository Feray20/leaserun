// Zusatzprodukt „Notar-Checkliste & Banken-Verhandlungsleitfaden“ (9 €, nur zusammen mit Kreditmappe oder Käufer-Pass).
// Wird nur an Käufer ausgeliefert (/api/me/leitfaden). Allgemeine Information, keine Rechts- oder Finanzierungsberatung.
export const LEITFADEN_VERSION = '2026-10';

export type Abschnitt = { titel: string; einleitung?: string; punkte: [string, string][] };

export const LEITFADEN: { titel: string; hinweis: string; abschnitte: Abschnitt[] } = {
  titel: 'Notar-Checkliste & Banken-Verhandlungsleitfaden',
  hinweis: 'Allgemeine Information zur Vorbereitung. Keine Rechtsberatung, keine Kredit- oder Steuerberatung. Maßgeblich sind Ihr Kaufvertragsentwurf, das Darlehensangebot mit ESIS-Merkblatt und die Auskünfte von Notar, Bank und Steuerberatung.',
  abschnitte: [
    {
      titel: '1. Vor dem Bankgespräch',
      einleitung: 'Je vollständiger Ihre Unterlagen, desto schneller und meist besser das Angebot.',
      punkte: [
        ['Kreditmappe vollständig', 'Selbstauskunft, Einkommensnachweise (letzte 3 Gehaltsabrechnungen, bei Selbstständigen 2–3 Jahresabschlüsse und Steuerbescheide), Eigenkapitalnachweis, Exposé, Grundbuchauszug, Flurkarte, Grundrisse, Wohnflächenberechnung, Energieausweis, bei Eigentumswohnungen Teilungserklärung, Protokolle der letzten Eigentümerversammlungen und Wirtschaftsplan.'],
        ['Eigenen Rahmen kennen', 'Maximale Monatsrate aus Ihrer Haushaltsrechnung, gewünschte Zinsbindung, Sondertilgungswunsch und den Betrag, den Sie höchstens an Eigenkapital einsetzen möchten – ohne Ihre Notreserve.'],
        ['Mehrere Angebote einholen', 'Mindestens zwei bis drei Angebote (Hausbank, weitere Bank, Vermittler). Nur Angebote mit gleicher Zinsbindung, gleicher Tilgung und gleichem Darlehensbetrag sind vergleichbar.'],
      ],
    },
    {
      titel: '2. Im Bankgespräch verhandeln',
      punkte: [
        ['Effektivzins vergleichen', 'Nicht den Sollzins, sondern den effektiven Jahreszins vergleichen – er enthält Kosten wie Bearbeitungs- oder Schätzgebühren.'],
        ['Zinsbindung abwägen', 'Längere Bindung = mehr Planungssicherheit, meist etwas höherer Zins. Nach 10 Jahren können Sie nach § 489 BGB mit sechs Monaten Frist kündigen.'],
        ['Sondertilgung', 'Kostenfreie Sondertilgung (z. B. 5 % pro Jahr) und Tilgungssatzwechsel vereinbaren – erhöht die Flexibilität.'],
        ['Bereitstellungszinsen', 'Fragen Sie nach der bereitstellungszinsfreien Zeit (oft 3–12 Monate) – wichtig bei Neubau oder späterer Auszahlung.'],
        ['Beleihungsauslauf', 'Mehr Eigenkapital senkt den Beleihungsauslauf und oft den Zins. Fragen Sie, ab welcher Schwelle (z. B. 60 %, 80 %) sich die Kondition verbessert.'],
        ['Koppelgeschäfte', 'Restschuldversicherung, Bausparvertrag oder Kontowechsel sind nicht Pflicht. Lassen Sie sich zeigen, wie sich der Effektivzins mit und ohne Zusatzprodukt verändert.'],
        ['Schriftlich festhalten', 'Verbindliche Konditionen nur aus dem Angebot mit ESIS-Merkblatt übernehmen. Annahmefrist notieren.'],
      ],
    },
    {
      titel: '3. Vor dem Notartermin',
      einleitung: 'Der Notar muss Ihnen den Entwurf des Kaufvertrags in der Regel zwei Wochen vor der Beurkundung zur Verfügung stellen (§ 17 Abs. 2a BeurkG bei Verbraucherverträgen).',
      punkte: [
        ['Finanzierungszusage liegt vor', 'Kaufvertrag erst unterschreiben, wenn die Finanzierung verbindlich zugesagt ist.'],
        ['Kaufpreis und Fälligkeit', 'Kaufpreis, Zahlungsfrist und Fälligkeitsvoraussetzungen (Auflassungsvormerkung eingetragen, Lastenfreistellung gesichert, Vorkaufsrechte geklärt) prüfen.'],
        ['Mitverkauftes Inventar', 'Einbauküche oder Möbel separat mit Wert ausweisen – das kann die Grunderwerbsteuer senken, wenn der Wert angemessen ist.'],
        ['Grundbuch', 'Abteilung II (Rechte wie Wegerechte, Wohnrechte) und Abteilung III (Grundschulden) prüfen. Was bleibt bestehen, was wird gelöscht?'],
        ['Eigentumswohnung', 'Teilungserklärung, Sondernutzungsrechte, Höhe der Erhaltungsrücklage, beschlossene Sonderumlagen und laufende Beschlussklagen prüfen.'],
        ['Übergabe', 'Termin für Besitzübergang, Nutzen-und-Lasten-Wechsel und Übergabeprotokoll (Zählerstände, Schlüssel) festlegen.'],
        ['Grundschuldbestellung', 'Die Bank schickt die Grundschuldbestellung meist direkt an den Notar. Sie wird oft im selben Termin beurkundet – Unterlagen der Bank rechtzeitig anfordern.'],
      ],
    },
    {
      titel: '4. Nach dem Notartermin',
      punkte: [
        ['Grunderwerbsteuer', 'Bescheid des Finanzamts abwarten und fristgerecht zahlen – erst danach gibt es die Unbedenklichkeitsbescheinigung für die Eigentumsumschreibung.'],
        ['Auszahlung', 'Auszahlungsvoraussetzungen der Bank erfüllen (meist Grundschuld eingetragen oder Notarbestätigung) und Kaufpreisfälligkeit des Notars abwarten.'],
        ['Versicherungen', 'Wohngebäudeversicherung (bei Eigentumswohnung über die Gemeinschaft) und Haftpflicht prüfen, Hausrat anpassen.'],
        ['Fristen eintragen', 'Ende der Zinsbindung, Sondertilgungstermin und – bei Vermietung – Fristen für Mieterhöhungen in LeaseRun unter „Objekte“ eintragen.'],
      ],
    },
  ],
};
