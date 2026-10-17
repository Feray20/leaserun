// Vertrag zur Auftragsverarbeitung nach Art. 28 Abs. 3 DSGVO (Version siehe AVV_VERSION in core.ts).
// Eine Quelle für die Ansicht im Portal und das PDF.

export const AVV_TITLE = 'Vertrag zur Auftragsverarbeitung (Art. 28 DSGVO)';

export const AVV_SECTIONS: { h: string; p: string[] }[] = [
  {
    h: '1. Parteien und Gegenstand',
    p: [
      'Verantwortlicher ist das im ImmoAdv-Unternehmenskonto registrierte Unternehmen („Auftraggeber“). Auftragsverarbeiter ist ImmoAdv, Inh. Feray Korkmaz, Georg-August-Zinn-Str. 25, 64354 Reinheim („ImmoAdv“).',
      'Gegenstand ist die Verarbeitung personenbezogener Daten, die der Auftraggeber über ImmoAdv erhebt oder dort ablegt: Anfragen über Partnerseite, Website-Widget und Exposé-QR-Codes, vom Auftraggeber angelegte Objekte, Unterlagen und Kreditmappen sowie deren Übermittlung an Kreditinstitute, die der Auftraggeber im Postkorb auswählt (Einreichung nur auf seine Weisung und nach seiner Bestätigung, dass die Einwilligung des Kunden vorliegt) sowie die Weiterleitung neuer Anfragen an eine vom Auftraggeber hinterlegte Webhook-Adresse.',
      'Die Laufzeit entspricht der Laufzeit des Nutzungsvertrags über das Unternehmenskonto.',
    ],
  },
  {
    h: '2. Art, Zweck und Umfang',
    p: [
      'Zweck: Entgegennahme, Speicherung und Anzeige von Finanzierungsanfragen; rechnerische Aufbereitung von Objekt- und Finanzierungsdaten; Erstellung und Ablage von PDF-Dokumenten; Benachrichtigung des Auftraggebers per E-Mail.',
      'Datenarten: Name, E-Mail-Adresse, Telefonnummer, Nachricht; Objektangaben (Adresse, Kaufpreis, Miete, Fläche); Finanzierungsangaben (Eigenkapital, Zins, Tilgung, Einkommen); hochgeladene Unterlagen; Einwilligungszeitpunkt und -text; gekürzter, gehashter IP-Wert zur Missbrauchsabwehr.',
      'Betroffene: Interessenten, Mandanten und Kunden des Auftraggebers sowie dessen Beschäftigte mit Zugang zum Konto.',
      'Eine Verarbeitung zu eigenen Zwecken von ImmoAdv findet nicht statt. Insbesondere werden Anfragen nicht an Dritte weitergegeben, nicht vermarktet und nicht zur Vermittlung genutzt.',
    ],
  },
  {
    h: '3. Weisungen',
    p: [
      'ImmoAdv verarbeitet die Daten nur auf dokumentierte Weisung des Auftraggebers. Weisungen ergeben sich aus diesem Vertrag und aus den Einstellungen und Aktionen im Portal (z. B. Löschen einer Anfrage, Abschalten des Widgets).',
      'Hält ImmoAdv eine Weisung für rechtswidrig, informiert ImmoAdv den Auftraggeber unverzüglich (Art. 28 Abs. 3 Satz 3 DSGVO).',
    ],
  },
  {
    h: '4. Pflichten von ImmoAdv',
    p: [
      'Zur Verarbeitung befugte Personen sind zur Vertraulichkeit verpflichtet.',
      'ImmoAdv trifft die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO gemäß Anlage 1.',
      'ImmoAdv unterstützt den Auftraggeber bei Anfragen Betroffener (Art. 12–22 DSGVO): Anfragen sind im Portal einsehbar, als CSV exportierbar und einzeln löschbar. Wendet sich eine betroffene Person direkt an ImmoAdv, leitet ImmoAdv die Anfrage unverzüglich weiter.',
      'ImmoAdv unterstützt den Auftraggeber bei den Pflichten nach Art. 32–36 DSGVO im Rahmen der verfügbaren Informationen.',
      'Verletzungen des Schutzes personenbezogener Daten meldet ImmoAdv dem Auftraggeber unverzüglich, möglichst innerhalb von 24 Stunden nach Kenntnis, mit den Angaben nach Art. 33 Abs. 3 DSGVO, soweit bekannt.',
      'ImmoAdv stellt alle erforderlichen Informationen zum Nachweis dieser Pflichten bereit und ermöglicht Überprüfungen nach vorheriger Abstimmung in angemessenem Umfang (Art. 28 Abs. 3 lit. h DSGVO).',
    ],
  },
  {
    h: '5. Unterauftragsverarbeiter',
    p: [
      'Der Auftraggeber genehmigt folgende Unterauftragsverarbeiter: Supabase Inc. (Datenbank und Dateispeicher, Serverstandort Frankfurt am Main, EU); Vercel Inc., USA (Hosting und Auslieferung, zertifiziert unter dem EU-US Data Privacy Framework, zusätzlich Standardvertragsklauseln); Resend Inc., USA (Versand von Benachrichtigungs-E-Mails, nur wenn aktiviert; Standardvertragsklauseln).',
      'Über beabsichtigte Änderungen informiert ImmoAdv mindestens 30 Tage vorher per E-Mail. Der Auftraggeber kann aus wichtigem datenschutzrechtlichem Grund widersprechen; kommt keine Einigung zustande, kann er den Nutzungsvertrag außerordentlich kündigen.',
      'ImmoAdv verpflichtet Unterauftragsverarbeiter vertraglich auf ein gleichwertiges Schutzniveau.',
    ],
  },
  {
    h: '6. Löschung und Rückgabe',
    p: [
      'Nach Vertragsende kann der Auftraggeber seine Anfragen 30 Tage lang exportieren. Danach löscht ImmoAdv die Daten des Auftraggebers, soweit keine gesetzliche Aufbewahrungspflicht besteht. Rechnungen an den Auftraggeber bewahrt ImmoAdv gemäß § 147 AO und § 14b UStG auf; sie enthalten keine Daten der Kunden des Auftraggebers.',
      'Der Auftraggeber kann einzelne Anfragen jederzeit im Portal löschen. Anfragen werden nach der im Portal gewählten Frist (Standard 24 Monate) automatisch gelöscht.',
    ],
  },
  {
    h: '7. Pflichten des Auftraggebers',
    p: [
      'Der Auftraggeber ist für die Rechtmäßigkeit der Erhebung verantwortlich, insbesondere für die Informationen nach Art. 13 DSGVO in seiner eigenen Datenschutzerklärung, wenn er das Widget auf seiner Website einbindet. ImmoAdv zeigt bei jeder Anfrage einen Einwilligungstext an, der den Auftraggeber als Empfänger benennt, und speichert Zeitpunkt und Wortlaut.',
    ],
  },
  {
    h: '8. Schlussbestimmungen',
    p: [
      'Bei Widersprüchen geht dieser Vertrag den Nutzungsbedingungen in Fragen des Datenschutzes vor. Es gilt deutsches Recht. Gerichtsstand ist, soweit zulässig, Darmstadt.',
      'Der Vertrag wird elektronisch durch Bestätigung im Portal geschlossen (Art. 28 Abs. 9 DSGVO). Zeitpunkt, Version und Konto werden protokolliert.',
    ],
  },
  {
    h: 'Anlage 1: Technische und organisatorische Maßnahmen',
    p: [
      'Vertraulichkeit: Zugriff nur nach Anmeldung; Daten je Unternehmenskonto getrennt, Zugriff ausschließlich serverseitig über geprüfte Schnittstellen; Datenbank mit Zeilensicherheit (RLS), private Speicherbereiche, Dateiabruf nur über zeitlich begrenzte signierte Links; Administratorzugang nur mit zweitem Faktor.',
      'Integrität: Transportverschlüsselung (TLS, HSTS); SHA-256-Prüfsummen für erzeugte PDF-Dokumente; Prüfung hochgeladener Dateien auf Dateityp anhand des Inhalts; strikte Content-Security-Policy.',
      'Verfügbarkeit und Belastbarkeit: Betrieb in Rechenzentren der Unterauftragsverarbeiter mit Verschlüsselung ruhender Daten; Begrenzung der Anfragen je Nutzer und IP (Missbrauchsschutz).',
      'Verfahren zur Überprüfung: Protokollierung administrativer Aktionen; regelmäßige Prüfung der Sicherheitshinweise der Datenbank.',
      'Datensparsamkeit: IP-Adressen werden nur gekürzt und gehasht gespeichert.',
    ],
  },
];
