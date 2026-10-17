// Unternehmensportal: Branchen-Ansicht. Jeder Berater wählt seine Branche (jederzeit wechselbar);
// danach passen sich Startseite, Bezeichnungen und das Praxis-Toolkit an.
// Inhalte: Erfahrungswerte und Normen, Stand Oktober 2026. Keine Rechts- oder Steuerberatung; bankindividuelle Vorgaben gehen vor.

export const BRANCHEN = {
  bank: {
    label: 'Bank & Sparkasse', short: 'Bank', icon: '🏦',
    desc: 'Baufinanzierungsberater in Filiale oder Immobilienzentrum',
    kunden: 'Kunden',
    focus: [['Fall-Analyse', 'Unterlagen des Kunden hochladen – Analyse, Kundenfassung und Präsentation im Design Ihres Hauses.', '#fall'], ['Vollständige Fälle vor dem Votum', 'Kunden bereiten Selbstauskunft und Unterlagen in ImmoAdv vor – Sie sehen die Bankreife, bevor der Termin beginnt.', '#kunden'], ['Anfragen aus der Region', 'Widget und QR-Code auf Filial-Website oder im Schaufenster liefern vorqualifizierte Anfragen.', '#werkzeuge'], ['Kreditprozess & Pflichten', 'Kreditprozess nach MaRisk, Kreditwürdigkeitsprüfung, Beleihungswert – kompakt im Praxis-Toolkit.', '#wissen']],
    chapters: ['charts', 'bankProzess', 'bankBelwert', 'sonder', 'einwandBank', 'ns', 'unterlagen', 'recht'],
    recht: ['KWG / CRR', 'MaRisk BTO 1', '§§ 491 ff., 505a–505e BGB', '§ 511 BGB', 'Art. 28 DSGVO'],
  },
  vermittler: {
    label: 'Finanzierungsvermittler', short: 'Vermittler', icon: '🤝',
    desc: 'Immobiliardarlehensvermittler nach § 34i GewO',
    kunden: 'Kunden',
    focus: [['Fall-Analyse', 'PDF-Paket des Kunden hochladen: Prüfung, Varianten und Präsentation in Minuten.', '#fall'], ['Bankreife Fälle für die Plattform', 'Unterlagen und Kennzahlen liegen strukturiert vor, bevor Sie Angebote einholen.', '#kunden'], ['Leads über Ihre Partnerseite', 'Eigene Partnerseite mit Budgetrechner – Anfragen kommen mit Eckdaten in Ihren Postkorb.', '#werkzeuge'], ['Bankauswahl & § 34i-Pflichten', 'Profilierung nach Kundentyp, Vermittlungsvertrag, Dokumentation – im Praxis-Toolkit.', '#wissen']],
    chapters: ['charts', 'vermBankwahl', 'vermPflichten', 'sonder', 'einwandVerm', 'ns', 'unterlagen', 'recht'],
    recht: ['§ 34i GewO', '§§ 491 ff., 505a–505e BGB', '§ 511 BGB', '§§ 655a–655e BGB', 'Art. 28 DSGVO'],
  },
  makler: {
    label: 'Immobilienmakler', short: 'Makler', icon: '🏠',
    desc: 'Makler nach § 34c GewO – Verkauf und Vermietung',
    kunden: 'Interessenten',
    focus: [['Fall-Analyse', 'Unterlagen eines Interessenten oder Objekts hochladen: Vollständigkeit, Lasten, Energieausweis.', '#fall'], ['Kaufinteressenten vorqualifizieren', 'QR-Code am Exposé: Interessenten rechnen ihr Budget durch, bevor sie besichtigen.', '#werkzeuge'], ['Finanzierbarkeit sichtbar machen', 'Sie sehen mit Einwilligung, wie weit ein Interessent mit Finanzierung und Unterlagen ist.', '#kunden'], ['Pflichten in Inserat und Vertrag', 'GEG-Pflichtangaben, Textform, Halbteilung, Geldwäschegesetz – im Praxis-Toolkit.', '#wissen']],
    chapters: ['maklerQuali', 'maklerPflichten', 'maklerWert', 'einwandMakler', 'charts', 'unterlagen', 'recht'],
    recht: ['§ 34c GewO', '§§ 656a–656d BGB', '§ 87 GEG', 'GwG', 'Art. 28 DSGVO'],
  },
  finanzberater: {
    label: 'Finanz- & Vermögensberater', short: 'Finanzberater', icon: '📈',
    desc: 'Berater nach § 34d / § 34f / § 34h GewO mit Immobilien als Anlageklasse',
    kunden: 'Mandanten',
    focus: [['Fall-Analyse', 'Unterlagen des Mandanten hochladen – Varianten und Präsentation mit Ihrem Logo.', '#fall'], ['Kapitalanlage durchrechnen', 'Cashflow nach Steuern, Rendite und Stresstest für Ihre Mandanten – mit Kreditmappe für die Bank.', '/app/dashboard#suche'], ['Mandanten begleiten', 'Fortschritt und fehlende Unterlagen Ihrer Mandanten sehen (mit Einwilligung).', '#kunden'], ['Kennzahlen & Steuern', 'Renditekennzahlen, AfA, Spekulationsfrist, 15-%-Grenze – im Praxis-Toolkit.', '#wissen']],
    chapters: ['fbKennzahlen', 'fbSteuern', 'fbRisiko', 'fbErlaubnis', 'charts', 'einwandFb', 'recht'],
    recht: ['§ 34i GewO', '§ 34f / § 34h GewO', '§ 34d GewO', 'Art. 28 DSGVO'],
  },
  allgemein: {
    label: 'Sonstiges Unternehmen', short: 'Allgemein', icon: '💼',
    desc: 'Kanzlei, Hausverwaltung, Bauträger oder anderes',
    kunden: 'Kunden',
    focus: [['Fall-Analyse', 'Unterlagen hochladen, sofort auswerten, Präsentation erstellen.', '#fall'], ['Kunden einladen', 'Per Link, Widget oder QR-Code – Kunden bereiten ihre Finanzierung selbst vor.', '#kunden'], ['Anfragen bearbeiten', 'Vorbereitete Anfragen mit Eckdaten und Einwilligung im Postkorb.', '#anfragen'], ['Praxis-Toolkit', 'Gesprächsgrafiken, Sonderfälle und Pflichten-Check.', '#wissen']],
    chapters: ['charts', 'sonder', 'einwand', 'ns', 'unterlagen', 'recht'],
    recht: null,
  },
};
export const BRANCHE_KEYS = Object.keys(BRANCHEN);
export const brancheFromType = (t) => ({ BANK: 'bank', BROKER: 'vermittler', REALTOR: 'makler' })[t] || 'allgemein';

// ---------- Fachinhalte je Kapitel ----------
// typ 'table': { t, intro, head, rows } · 'cards': { t, intro, items:[[titel, text]] } · 'steps': { t, intro, items:[[titel, text]] }
export const KAPITEL = {
  bankProzess: { typ: 'steps', t: 'Kreditprozess nach MaRisk – wo ImmoAdv Zeit spart', intro: 'Typischer Ablauf einer Wohnimmobilienfinanzierung im Haus. Die Trennung von Markt und Marktfolge (MaRisk BTO 1.1) bleibt unberührt – ImmoAdv beschleunigt den Teil vor dem Votum.', items: [
    ['Antrag und Selbstauskunft (Markt)', 'Vollständigkeit vor der Votierung: Der Kunde hat Selbstauskunft, Einkommensnachweise und Objektunterlagen bereits strukturiert hochgeladen; fehlende Unterlagen-Arten sind markiert.'],
    ['Kreditwürdigkeitsprüfung (§ 505b BGB)', 'Auf Grundlage nachgewiesener Einnahmen, Ausgaben und Verpflichtungen; absehbare Veränderungen (Rente, Elternzeit, Ende der Zinsbindung) einbeziehen. Bei negativem Ergebnis darf das Darlehen nicht gewährt werden (§ 505a BGB).'],
    ['Objektbewertung und Beleihungswert', 'Marktwert nach ImmoWertV, Beleihungswert nach BelWertV mit Sicherheitsabschlag; für kleinere Wohnimmobilienfinanzierungen ist eine vereinfachte Wertermittlung zulässig (§ 24 BelWertV).'],
    ['Votum und Kreditentscheidung', 'Bei risikorelevantem Geschäft zwei Voten (Markt und Marktfolge). Offenlegung der wirtschaftlichen Verhältnisse nach § 18 KWG ab 750.000 € Kreditvolumen.'],
    ['ESIS und Angebot', 'Das ESIS-Merkblatt rechtzeitig vor Vertragsschluss aushändigen (Art. 247 § 1 EGBGB); Angebot mit Effektivzins, Sondertilgung, Bereitstellungszinsen.'],
    ['Auszahlung', 'Auszahlungsvoraussetzungen: Grundschuld eingetragen bzw. Notarbestätigung, Eigenmittel eingesetzt, ggf. Bautenstand. ImmoAdv-Kreditmappe mit Prüfsumme dient als Dokumentation des Einreichungsstands.'],
  ] },
  bankBelwert: { typ: 'table', t: 'Beleihungswert und Zinsstaffel – Gesprächshilfe', intro: 'Wie Eigenkapital den Beleihungsauslauf und damit die Kondition verschiebt. Staffelgrenzen sind hausindividuell; die Grenzen hier sind gängige Stufen.', head: ['Beleihungsauslauf', 'Einordnung', 'Argument im Kundengespräch'], rows: [
    ['bis 60 %', 'Realkreditteil (Deckungsgrenze § 14 PfandBG)', 'Beste Konditionsstufe – zusätzliches Eigenkapital lohnt sich bis hierhin am stärksten.'],
    ['60–80 %', 'Standardbereich', 'Häufigste Stufe; jede Senkung um einige Prozentpunkte kann die nächste Staffel erreichen.'],
    ['80–90 %', 'Erhöhter Auslauf', 'Spürbarer Aufschlag; Tilgung und Haushaltsüberschuss gewinnen an Gewicht.'],
    ['90–100 %', 'Hoher Auslauf', 'Nur mit sehr guter Bonität; Nebenkosten müssen aus Eigenmitteln kommen.'],
    ['über 100 %', 'Vollfinanzierung inkl. Nebenkosten', 'Kleiner Anbieterkreis, deutlicher Aufschlag; Förderbausteine prüfen.'],
  ] },
  vermBankwahl: { typ: 'table', t: 'Bankauswahl nach Kundenprofil', intro: 'Wo sich die Profilierung bei den Banken lohnt. Konkrete Annahmerichtlinien ändern sich laufend – vor der Einreichung auf der Plattform bzw. beim Produktgeber prüfen.', head: ['Kundenprofil', 'Worauf achten', 'Hinweis'], rows: [
    ['Angestellt, gute Bonität, Auslauf bis 80 %', 'Konditionsspreizung zwischen den Banken ist groß – breit vergleichen.', 'Zinsbindung, Sondertilgung und bereitstellungszinsfreie Zeit mitvergleichen, nicht nur den Sollzins.'],
    ['Selbstständige, Freiberufler', 'Banken mit Ganzheitsbetrachtung und Erfahrung mit BWA / EÜR bevorzugen.', 'Durchschnitt der letzten Jahre statt Spitzenjahr ansetzen; Steuerbescheide vollständig.'],
    ['Hoher Beleihungsauslauf', 'Kleiner Anbieterkreis; Aufschläge steigen stufenweise.', 'Schon kleine Eigenkapitalerhöhung kann die nächste Stufe erreichen.'],
    ['Kapitalanleger mit Bestand', 'Banken, die Mieten bonitätswirksam anrechnen und Bestand gesamthaft rechnen.', 'Objektliste mit Restschulden, Mieten und Bewirtschaftung beilegen.'],
    ['Förderdarlehen (KfW, Landesförderbanken)', 'Durchleitung über die Hausbank bzw. den Finanzierungspartner.', 'Antragszeitpunkt beachten – häufig vor Vorhabensbeginn; Programmbedingungen prüfen.'],
    ['Anschlussfinanzierung', 'Forward-Aufschläge vergleichen; Prolongationsangebot der Bestandsbank als Untergrenze.', 'Grundschuldabtretung statt Neubestellung spart Kosten.'],
  ] },
  vermPflichten: { typ: 'table', t: 'Pflichten als Immobiliardarlehensvermittler', intro: 'Kurzüberblick für die tägliche Praxis.', head: ['Thema', 'Norm', 'Praxis'], rows: [
    ['Erlaubnis, Sachkunde, Haftpflicht', '§ 34i GewO, ImmVermV', 'Erlaubnis der IHK bzw. Gewerbebehörde, Sachkundeprüfung, Berufshaftpflichtversicherung, Eintrag im Vermittlerregister.'],
    ['Weiterbildung', '§ 34i GewO i. V. m. ImmVermV', '15 Stunden je Kalenderjahr; Nachweise aufbewahren.'],
    ['Erstinformation', 'ImmVermV, Art. 247 § 13b EGBGB', 'Statusangaben, Registernummer, Vergütung und ob nur bestimmte Darlehensgeber vermittelt werden – vor Vertragsschluss.'],
    ['Darlehensvermittlungsvertrag', '§§ 655a–655e BGB', 'Textform; Vergütung nur bei Auszahlung des vermittelten Darlehens; Nebenentgelte nur in engen Grenzen.'],
    ['Beratungsleistungen', '§ 511 BGB', 'Empfehlung auf Basis einer ausreichenden Zahl von Darlehensverträgen; Bedarf und Situation dokumentieren.'],
    ['Datenschutz', 'Art. 28 DSGVO', 'Für Anfragen über Ihre Partnerseite ist ImmoAdv Auftragsverarbeiter (AVV im Portal).'],
  ] },
  maklerQuali: { typ: 'steps', t: 'Kaufinteressenten vorqualifizieren', intro: 'Besichtigungen mit Interessenten, deren Finanzierung trägt – ohne selbst zu beraten.', items: [
    ['QR-Code am Exposé', 'Der Interessent rechnet Budget und Rate für genau dieses Objekt durch; Sie erhalten die Anfrage mit Eckdaten (mit Einwilligung).'],
    ['Eigenkapital für Nebenkosten', 'Grunderwerbsteuer (3,5–6,5 % je Bundesland), Notar und Grundbuch (rund 2 %) und ggf. Provision sollten aus Eigenmitteln kommen.'],
    ['Finanzierungsbestätigung richtig lesen', 'Eine Finanzierungsbestätigung ist in der Regel unverbindlich; belastbar ist erst die Darlehenszusage mit Objektprüfung.'],
    ['Unterlagen früh bereitstellen', 'Grundbuchauszug, Teilungserklärung, Protokolle, Wirtschaftsplan und Energieausweis beschleunigen die Bankprüfung des Käufers.'],
    ['Finanzierungspartner einbinden', 'Leiten Sie Interessenten an einen Finanzierer weiter – die ImmoAdv-Kreditmappe spart dort den ersten Termin.'],
  ] },
  maklerPflichten: { typ: 'table', t: 'Pflichten in Inserat, Vertrag und Geldwäscheprävention', intro: 'Die häufigsten Stolperstellen im Maklergeschäft.', head: ['Thema', 'Norm', 'Praxis'], rows: [
    ['Energieausweis in Immobilienanzeigen', '§ 87 GEG', 'Pflichtangaben: Art des Ausweises, Endenergiebedarf bzw. -verbrauch, wesentlicher Energieträger, Baujahr, Effizienzklasse (bei Wohngebäuden).'],
    ['Textform des Maklervertrags', '§ 656a BGB', 'Bei Wohnung und Einfamilienhaus mit Verbrauchern: Maklervertrag in Textform.'],
    ['Halbteilung der Provision', '§§ 656c, 656d BGB', 'Käufer zahlt höchstens so viel wie der Verkäufer; Abwälzung nur bis zur Hälfte und erst nach Zahlungsnachweis des Verkäufers.'],
    ['Geldwäschegesetz', '§ 2 Abs. 1 Nr. 14 GwG', 'Identifizierung der Vertragsparteien, Risikoanalyse, Aufzeichnungspflichten; Verdachtsmeldung an die FIU. Bei Vermietung ab 10.000 € Monatsmiete.'],
    ['Weiterbildung', '§ 34c Abs. 2a GewO', '20 Stunden innerhalb von drei Kalenderjahren.'],
    ['Widerruf bei Fernabsatz', '§§ 312g, 355 BGB', 'Widerrufsbelehrung, wenn der Maklervertrag mit Verbrauchern per E-Mail, Telefon oder online geschlossen wird.'],
  ] },
  maklerWert: { typ: 'table', t: 'Wertermittlung nach ImmoWertV – welches Verfahren wann', intro: 'Für die Preisargumentation gegenüber Verkäufer und Käufer.', head: ['Verfahren', 'Typische Objekte', 'Kern'], rows: [
    ['Vergleichswertverfahren', 'Eigentumswohnungen, Reihenhäuser, Bauland', 'Kaufpreise vergleichbarer Objekte, angepasst über Indexreihen und Umrechnungskoeffizienten.'],
    ['Ertragswertverfahren', 'Mehrfamilienhäuser, vermietete Objekte, Gewerbe', 'Reinertrag (Rohertrag minus Bewirtschaftungskosten) kapitalisiert mit dem Liegenschaftszins, zuzüglich Bodenwert.'],
    ['Sachwertverfahren', 'Freistehende Einfamilienhäuser ohne ausreichende Vergleichsdaten', 'Herstellungskosten abzüglich Alterswertminderung plus Bodenwert, angepasst mit Sachwertfaktor.'],
  ] },
  fbKennzahlen: { typ: 'table', t: 'Renditekennzahlen für Kapitalanlagen', intro: 'Einheitlich gerechnet – damit Angebote vergleichbar werden.', head: ['Kennzahl', 'Formel', 'Einordnung'], rows: [
    ['Bruttomietrendite', 'Jahreskaltmiete ÷ Kaufpreis', 'Schnellfilter; ignoriert Nebenkosten und nicht umlagefähige Kosten.'],
    ['Kaufpreisfaktor', 'Kaufpreis ÷ Jahreskaltmiete', 'Kehrwert der Bruttorendite; regional sehr unterschiedlich.'],
    ['Nettomietrendite', '(Jahreskaltmiete − nicht umlagefähige Kosten) ÷ (Kaufpreis + Nebenkosten)', 'Realistischere Objektrendite vor Finanzierung und Steuern.'],
    ['Cashflow vor Steuern', 'Kaltmiete − nicht umlagefähige Kosten − Rücklage − Zins − Tilgung', 'Monatliche Zuzahlung bzw. Überschuss des Mandanten.'],
    ['Cashflow nach Steuern', 'Cashflow vor Steuern ± Steuereffekt (AfA, Zinsen, Werbungskosten)', 'Entscheidend für die Tragbarkeit beim Mandanten.'],
    ['DSCR', 'Nettomietertrag ÷ Kapitaldienst', 'Unter 1,0 trägt die Miete den Kapitaldienst nicht allein.'],
    ['Eigenkapitalrendite', 'Jahresüberschuss inkl. Tilgung ÷ eingesetztes Eigenkapital', 'Zeigt den Hebel – und dessen Risiko bei Zinsanstieg.'],
  ] },
  fbSteuern: { typ: 'table', t: 'Steuerliche Eckpunkte bei vermieteten Wohnimmobilien', intro: 'Orientierung für das Mandantengespräch – die steuerliche Beratung bleibt beim Steuerberater (StBerG).', head: ['Thema', 'Norm', 'Eckwert'], rows: [
    ['Lineare AfA Wohngebäude', '§ 7 Abs. 4 EStG', '3 % bei Fertigstellung ab 2023, 2 % bei Fertigstellung 1925–2022, 2,5 % vor 1925 – nur auf den Gebäudeanteil.'],
    ['Degressive AfA Neubau', '§ 7 Abs. 5a EStG', '5 % vom Restwert für Wohngebäude mit Baubeginn bzw. Kauf im Fertigstellungsjahr zwischen 1.10.2023 und 30.9.2029.'],
    ['Sonder-AfA Mietwohnungsneubau', '§ 7b EStG', 'Zusätzliche Abschreibung unter Baukosten- und Effizienzbedingungen; Voraussetzungen im Einzelfall prüfen.'],
    ['Anschaffungsnahe Herstellungskosten', '§ 6 Abs. 1 Nr. 1a EStG', 'Instandsetzung über 15 % (netto) der Gebäude-Anschaffungskosten in den ersten drei Jahren wird nicht sofort abziehbar, sondern abgeschrieben.'],
    ['Private Veräußerungsgeschäfte', '§ 23 EStG', 'Verkauf innerhalb von 10 Jahren steuerpflichtig; Ausnahme bei Eigennutzung im Verkaufsjahr und den beiden Vorjahren.'],
    ['Werbungskosten', '§ 9 EStG', 'Schuldzinsen, Erhaltungsaufwand, Verwaltung, nicht umlagefähige Nebenkosten – Tilgung ist nicht abziehbar.'],
  ] },
  fbRisiko: { typ: 'cards', t: 'Immobilie im Vermögensaufbau – Risiken offen ansprechen', intro: 'Was in die Geeignetheitsbetrachtung gehört.', items: [
    ['Klumpenrisiko', 'Eine einzelne Wohnung bindet oft einen großen Teil des Vermögens an einem Standort.'],
    ['Liquidität', 'Immobilien sind nicht kurzfristig veräußerbar; Rücklage für Instandhaltung und Mietausfall einplanen.'],
    ['Zinsänderung', 'Restschuld am Ende der Zinsbindung und Anschlussrate im Stresstest zeigen.'],
    ['Mietausfall und Leerstand', 'Cashflow mit mehreren Monaten Leerstand pro Jahr rechnen.'],
    ['Regulierung', 'Mietpreisbremse, Kappungsgrenzen und energetische Anforderungen begrenzen Mietsteigerung bzw. erzeugen Kosten.'],
    ['Exit', 'Spekulationsfrist, Vorfälligkeitsentschädigung und Marktphase beim Verkauf mitdenken.'],
  ] },
  fbErlaubnis: { typ: 'table', t: 'Erlaubnisse abgrenzen', intro: 'Wer darf was – wichtig, wenn Mandanten eine Finanzierung brauchen.', head: ['Erlaubnis', 'Gegenstand', 'Hinweis'], rows: [
    ['§ 34d GewO', 'Versicherungsvermittlung und -beratung', 'Absicherung der Finanzierung (Risikolebens-, BU-Versicherung).'],
    ['§ 34f / § 34h GewO', 'Finanzanlagenvermittlung bzw. Honorar-Finanzanlagenberatung', 'Keine Erlaubnis zur Vermittlung von Immobiliardarlehen.'],
    ['§ 34i GewO', 'Immobiliardarlehensvermittlung und -beratung', 'Für die Vermittlung von Baufinanzierungen erforderlich – ohne § 34i an einen Vermittler oder eine Bank übergeben.'],
    ['§ 34c GewO', 'Makler, Darlehensvermittlung außerhalb von Immobiliar-Verbraucherdarlehen', 'Für den Nachweis bzw. die Vermittlung von Kaufobjekten.'],
  ] },
  einwandBank: { typ: 'cards', t: 'Einwände im Bankgespräch', items: [
    ['„Online-Vermittler sind günstiger.“', 'Gesamtpaket vergleichen: Effektivzins aus dem ESIS, Sondertilgung, Bereitstellungszinsen, Tilgungswechsel – plus feste Ansprechperson vor Ort und Bestandsbeziehung.'],
    ['„Warum brauchen Sie so viele Unterlagen?“', 'Die Bank ist zur Kreditwürdigkeitsprüfung verpflichtet (§ 505b BGB). Vollständige Unterlagen beschleunigen die Zusage – ImmoAdv zeigt dem Kunden, was fehlt.'],
    ['„Ich warte, bis die Zinsen fallen.“', 'Rate bei ±1 Prozentpunkt zeigen; Forward-Darlehen oder variabler Baustein als Option – ohne Zinsprognose.'],
    ['„Die Rate soll so niedrig wie möglich sein.“', 'Restschuld nach 10 Jahren bei 1 % vs. 3 % Tilgung zeigen; Tilgungswechsel und Sondertilgung als Mittelweg.'],
  ] },
  einwandVerm: { typ: 'cards', t: 'Einwände im Vermittlergespräch', items: [
    ['„Warum nicht direkt zur Hausbank?“', 'Vergleich vieler Darlehensgeber, auch für Sonderfälle; das Angebot der Hausbank kann Teil des Vergleichs sein.'],
    ['„Was kostet mich der Vermittler?“', 'Vergütung und Interessenkonflikte werden vorab offengelegt (Erstinformation, §§ 655a ff. BGB); häufig zahlt der Darlehensgeber die Provision.'],
    ['„Ich will erst noch andere Angebote einholen.“', 'ESIS-Merkblätter nebeneinanderlegen – Effektivzins, Sondertilgung, Bereitstellungszins; Angebotsfristen beachten.'],
    ['„Lange Zinsbindung ist zu teuer.“', 'Aufschlag gegen Anschlussrisiko stellen; nach 10 Jahren besteht das Kündigungsrecht nach § 489 BGB.'],
  ] },
  einwandMakler: { typ: 'cards', t: 'Einwände von Käufern und Verkäufern', items: [
    ['„Der Preis ist zu hoch.“', 'Vergleichswerte und Wertermittlungsverfahren offenlegen; Rate und Budget mit dem Interessenten konkret durchrechnen.'],
    ['„Ich kläre erst meine Finanzierung.“', 'QR-Code bzw. Widget anbieten: Budget in wenigen Minuten, Unterlagenliste, Weitergabe an einen Finanzierer.'],
    ['„Warum zahle ich Provision?“', 'Halbteilung nach § 656c BGB: Käufer zahlt höchstens so viel wie der Verkäufer; Leistung transparent beschreiben.'],
    ['„Wir verkaufen privat.“', 'Wertermittlung, Unterlagenbeschaffung, GEG- und GwG-Pflichten, vorqualifizierte Käufer – Aufwand und Risiko konkret machen.'],
  ] },
  einwandFb: { typ: 'cards', t: 'Einwände von Mandanten', items: [
    ['„Bei den Zinsen lohnt sich eine Immobilie nicht.“', 'Cashflow nach Steuern und Eigenkapitalrendite für das konkrete Objekt zeigen – nicht pauschal argumentieren.'],
    ['„Ich will keine Schulden.“', 'Hebel und Risiko neutral gegenüberstellen; Variante mit höherem Eigenkapital rechnen.'],
    ['„Die Steuerersparnis macht es rentabel.“', 'Steuereffekt ist ein Baustein, kein Selbstzweck – Objekt muss auch ohne Steuervorteil tragfähig sein.'],
    ['„Ich kaufe lieber ETFs.“', 'Liquidität, Diversifikation und Aufwand fair vergleichen; Immobilie als Beimischung einordnen.'],
  ] },
};
