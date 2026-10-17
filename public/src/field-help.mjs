// Erklärung an jedem Eingabefeld: „?“ neben der Beschriftung öffnet eine kurze Antwort mit Link in den Wissensbereich.
// Funktioniert für alle Formulare im Konto (Finanzprofil, Objekte, Steuer), auch wenn sie später nachgeladen werden.
const W = (slug) => `/wissen/${slug}`;
const H = {
  // Finanzprofil
  employment: ['Ihre Einkommensart. Banken bewerten Angestellte, Beamte und Selbstständige unterschiedlich – das beeinflusst Unterlagen und Konditionen.', 'warum-unterscheidet-die-bank-nach-beruf-und-einkommensart'],
  netIncome: ['Was monatlich auf Ihrem Konto ankommt (bei Paaren zusammen), ohne Kindergeld und Einmalzahlungen. Selbstständige: Gewinn nach Steuern der letzten Jahre ÷ 12.', 'was-trage-ich-bei-nettoeinkommen-und-eigenkapital-ein'],
  equity: ['Geld, das Sie in den Kauf stecken können, ohne Ihren Notgroschen (3–6 Monatsausgaben) anzutasten: Guthaben, Tagesgeld, Wertpapiere, Bausparguthaben.', 'was-trage-ich-bei-nettoeinkommen-und-eigenkapital-ein'],
  targetPrice: ['Der Kaufpreis, den Sie anpeilen – ohne Nebenkosten. ImmoAdv rechnet die Nebenkosten und die Rate dazu.', 'wie-viel-immobilie-kann-ich-mir-leisten'],
  householdSize: ['Alle Personen, die von Ihrem Einkommen leben. Banken setzen pro Person eine Pauschale für Lebenshaltung an.', 'was-ist-eine-haushaltsrechnung-und-was-gehoert-hinein'],
  // Objekt
  objName: ['Ein Name, an dem Sie das Objekt wiedererkennen, z. B. Straße und Ort.', null],
  objPrice: ['Kaufpreis laut Exposé oder Kaufvertrag, ohne Nebenkosten.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  objRent: ['Monatliche Kaltmiete (ohne Nebenkosten). Bei Eigennutzung die Miete, die Sie sparen, oder 0.', 'wie-verdient-eine-vermietete-immobilie-geld'],
  of_area: ['Wohnfläche laut Wohnflächenberechnung oder Exposé in m².', null],
  of_yearBuilt: ['Jahr der Fertigstellung. Bestimmt den AfA-Satz (2 %, 2,5 % oder 3 %).', 'wie-funktioniert-die-afa'],
  of_purchaseCostPct: ['Summe aus Grunderwerbsteuer, Notar/Grundbuch und Makler in Prozent des Kaufpreises, meist 7–15 %.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  of_nonRecoverable: ['Kosten, die Sie als Vermieter selbst tragen (z. B. Verwaltergebühr) – pro Monat.', 'was-sind-nicht-umlagefaehige-kosten-und-instandhaltung-pro-monat'],
  of_maintenance: ['Rücklage für Reparaturen pro Monat, typisch 0,80–1,50 € je m², bei Altbau mehr.', 'was-sind-nicht-umlagefaehige-kosten-und-instandhaltung-pro-monat'],
  of_vacancyPct: ['Puffer für Leerstand und ausfallende Mieten, üblich 2–4 % der Jahresmiete.', 'was-ist-ein-mietausfallwagnis'],
  of_loan: ['Darlehensbetrag. Leer lassen: ImmoAdv rechnet Kaufpreis + Nebenkosten − Eigenkapital.', 'was-bedeuten-die-felder-sollzins-tilgung-und-zinsbindung'],
  of_interestPct: ['Vereinbarter Zinssatz pro Jahr (Sollzins) aus dem Bankangebot.', 'was-bedeuten-die-felder-sollzins-tilgung-und-zinsbindung'],
  of_repaymentPct: ['Prozentsatz, mit dem Sie im ersten Jahr tilgen – üblich 1,5–3 %.', 'was-bedeuten-die-felder-sollzins-tilgung-und-zinsbindung'],
  of_lendingValue: ['Vorsichtiger Wert, mit dem die Bank rechnet – steht im Angebot bzw. Wertgutachten.', 'was-sind-beleihungswert-marktwert-und-miteigentumsanteil'],
  of_equity: ['Eigenkapital, das Sie in genau dieses Objekt stecken.', 'wie-viel-eigenkapital-brauche-ich'],
  of_buildingSharePct: ['Anteil des Gebäudes am Kaufpreis (ohne Grundstück). Nur dieser Teil wird abgeschrieben.', 'wie-ermittle-ich-den-gebaeudeanteil-am-kaufpreis'],
  of_marginalTaxPct: ['Steuersatz auf Ihren nächsten Euro Einkommen – bestimmt, wie viel Steuer Werbungskosten sparen.', 'was-ist-mein-grenzsteuersatz-und-wo-finde-ich-ihn'],
  of_renovationNet3y: ['Was Sie in den ersten drei Jahren nach dem Kauf netto für Instandsetzung ausgeben (wichtig für die 15-%-Grenze).', 'was-ist-die-15-grenze-bei-renovierungen'],
  of_meaShare: ['Zähler Ihres Miteigentumsanteils aus der Teilungserklärung, z. B. 85 bei 85/1.000.', 'was-sind-beleihungswert-marktwert-und-miteigentumsanteil'],
  of_meaTotal: ['Nenner des Miteigentumsanteils, meist 1.000 oder 10.000.', 'was-sind-beleihungswert-marktwert-und-miteigentumsanteil'],
  of_wegReserveTotal: ['Stand der gesamten Erhaltungsrücklage der Eigentümergemeinschaft (Jahresabrechnung).', 'eigentumswohnung-was-sagen-teilungserklaerung-protokolle-und-ruecklage'],
  of_wegPlannedTotal: ['Summe der in Protokollen genannten geplanten Maßnahmen der Gemeinschaft.', 'eigentumswohnung-was-sagen-teilungserklaerung-protokolle-und-ruecklage'],
  of_wegSpecialTotal: ['Bereits beschlossene Sonderumlage der Gemeinschaft insgesamt.', 'eigentumswohnung-was-sagen-teilungserklaerung-protokolle-und-ruecklage'],
  of_grestPct: ['Grunderwerbsteuer Ihres Bundeslands: 3,5–6,5 % des Kaufpreises.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  of_notaryPct: ['Notar und Grundbuch zusammen, meist rund 1,5–2 % des Kaufpreises.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  of_brokerPct: ['Ihr Anteil an der Maklerprovision inkl. USt – bei Wohnungen höchstens die Hälfte der Gesamtprovision.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  of_marketValue: ['Heute am Markt erzielbarer Preis (Verkehrswert), z. B. aus einem Gutachten.', 'was-sind-beleihungswert-marktwert-und-miteigentumsanteil'],
  of_grundbuchAmt: ['Amtsgericht, bei dem das Grundbuch geführt wird – steht oben auf dem Grundbuchauszug.', 'was-gehoert-in-eine-kreditmappe'],
  of_grundbuchBlatt: ['Blattnummer aus dem Grundbuchauszug.', 'was-gehoert-in-eine-kreditmappe'],
  of_flur: ['Flur aus dem Bestandsverzeichnis des Grundbuchs bzw. der Flurkarte.', 'was-gehoert-in-eine-kreditmappe'],
  of_flurstueck: ['Flurstücksnummer aus dem Bestandsverzeichnis.', 'was-gehoert-in-eine-kreditmappe'],
  of_ownership: ['Wem das Objekt gehört, z. B. Alleineigentum oder je zur Hälfte.', 'was-gehoert-in-eine-kreditmappe'],
  of_landArea: ['Grundstücksgröße in m² (Grundbuch, Bestandsverzeichnis).', null],
  of_usableArea: ['Flächen, die nicht zur Wohnfläche zählen, z. B. Keller, Hobbyraum.', null],
  of_renovationYear: ['Jahr der letzten umfassenden Modernisierung – wichtig für Bewertung und Restnutzungsdauer.', null],
  of_heatingType: ['Z. B. Gas, Öl, Wärmepumpe, Fernwärme – aus Energieausweis oder Exposé.', null],
  of_heatingYear: ['Einbaujahr des Wärmeerzeugers – alte Heizungen können Austauschpflichten auslösen.', null],
  of_energyConsumption: ['Endenergie-Kennwert aus dem Energieausweis in kWh/(m²·a).', null],
  of_primaryEnergy: ['Primärenergie-Kennwert aus dem Energieausweis.', null],
  of_efficiencyClass: ['Klasse A+ bis H aus dem Energieausweis.', null],
  of_purchaseDate: ['Tag der notariellen Beurkundung – Start der 10-Jahres-Frist und der 15-%-Frist.', 'welches-datum-trage-ich-bei-kaufvertrag-und-darlehensauszahlung-ein'],
  of_payoutDate: ['Tag der vollständigen Auszahlung des Darlehens – Start der Zinsbindung.', 'welches-datum-trage-ich-bei-kaufvertrag-und-darlehensauszahlung-ein'],
  of_fixedYears: ['Jahre, für die der Zins fest vereinbart ist.', 'was-passiert-wenn-die-zinsbindung-endet'],
  of_lastRentChange: ['Datum der letzten Mieterhöhung – bestimmt, wann die nächste möglich ist.', 'was-ist-die-kappungsgrenze'],
  of_vergleichsmieteQm: ['Ortsübliche Vergleichsmiete je m² aus dem Mietspiegel.', 'was-ist-die-kappungsgrenze'],
  of_mietpreisbremse: ['Gilt in Ihrer Gemeinde die Mietpreisbremse? Die Landesverordnung bzw. der Mietspiegel sagt es.', 'wie-funktioniert-die-mietpreisbremse'],
  of_abt2Open: ['Gibt es Einträge in Abteilung II des Grundbuchs (z. B. Wegerecht, Wohnrecht), die noch nicht geklärt sind?', 'wie-pruefe-ich-eine-eigentumswohnung'],
  of_liegenschaftszinsPct: ['Zinssatz des Gutachterausschusses für die Ertragswertberechnung, meist 1,5–4 %.', 'wie-bewerte-ich-ein-portfolio'],
  of_restnutzungsdauer: ['Wie viele Jahre das Gebäude wirtschaftlich noch genutzt werden kann.', 'wie-bewerte-ich-ein-portfolio'],
  // Werbungskosten-Checkliste
  wk_zins: ['Gezahlte Darlehenszinsen des Jahres (Zinsbescheinigung der Bank) – nicht die Tilgung.', 'welche-werbungskosten-kann-ich-bei-einer-vermieteten-wohnung-absetzen'],
  wk_haus: ['Hausgeld ohne Zuführung zur Erhaltungsrücklage (Jahresabrechnung der Verwaltung).', 'welcher-teil-des-hausgelds-ist-absetzbar'],
  wk_grundst: ['Grundsteuer laut Bescheid der Gemeinde (auch wenn der Mieter sie über die Nebenkosten zahlt).', 'welcher-teil-des-hausgelds-ist-absetzbar'],
  wk_vers: ['Wohngebäude- und Haus-/Grundbesitzerhaftpflicht, ggf. Vermieterrechtsschutz.', 'welche-werbungskosten-kann-ich-bei-einer-vermieteten-wohnung-absetzen'],
  wk_verw: ['Kosten einer Hausverwaltung oder Mietverwaltung, die nicht im Hausgeld enthalten sind.', 'welche-werbungskosten-kann-ich-bei-einer-vermieteten-wohnung-absetzen'],
  wk_erhalt: ['Reparaturen, Wartung, Austausch vorhandener Teile – Material und Handwerker, nicht eigene Arbeitszeit.', 'was-ist-der-unterschied-zwischen-erhaltungsaufwand-und'],
  wk_fahrt: ['Gefahrene Kilometer zum Objekt × 0,30 € (Besichtigung, Übergabe, Reparatur, Eigentümerversammlung).', 'wie-setze-ich-fahrten-zu-meiner-vermieteten-wohnung-ab'],
  wk_konto: ['Kontoführung des Mietkontos, Porto, Telefon für die Vermietung.', 'welche-werbungskosten-kann-ich-bei-einer-vermieteten-wohnung-absetzen'],
  wk_beratung: ['Steuerberatung für die Anlage V (anteilig, wenn die Rechnung mehr umfasst).', 'welche-werbungskosten-kann-ich-bei-einer-vermieteten-wohnung-absetzen'],
  wk_makler: ['Makler oder Inserate für die Suche nach einem Mieter (nicht der Makler beim Kauf).', 'gehoeren-die-kaufnebenkosten-zu-den-werbungskosten'],
  // Steuer-Werkzeuge
  s_inv_land: ['Bundesland des Objekts – bestimmt den Grunderwerbsteuersatz.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  s_inv_wert: ['Wert mitgekaufter beweglicher Gegenstände (z. B. Einbauküche, Markise) – darauf fällt keine Grunderwerbsteuer an.', 'kann-ich-die-kosten-einer-neuen-einbaukueche-absetzen'],
  s_vm_ist: ['Miete, die Ihr Angehöriger zahlt. Für die 66-%-Grenze zählt Kaltmiete plus umlagefähige Nebenkosten – beide Felder gleich (kalt oder warm) befüllen.', 'was-gilt-bei-vermietung-an-angehoerige'],
  s_vm_markt: ['Ortsübliche Miete laut Mietspiegel für eine vergleichbare Wohnung (gleich gerechnet wie das Feld links).', 'was-gilt-bei-vermietung-an-angehoerige'],
  s_eh_betrag: ['Kosten einer größeren Reparatur, die Sie verteilen möchten.', 'kann-ich-groessere-reparaturen-auf-mehrere-jahre-verteilen'],
  s_eh_jahre: ['Auf wie viele Jahre (2–5) der Betrag gleichmäßig verteilt wird.', 'kann-ich-groessere-reparaturen-auf-mehrere-jahre-verteilen'],
  s_15_price: ['Kaufpreis des Objekts.', 'was-ist-die-15-grenze-bei-renovierungen'],
  s_15_nk: ['Kaufnebenkosten in Prozent.', 'welche-nebenkosten-kommen-zum-kaufpreis-dazu'],
  s_15_geb: ['Gebäudeanteil am Kaufpreis in Prozent.', 'wie-ermittle-ich-den-gebaeudeanteil-am-kaufpreis'],
  s_15_spent: ['Seit dem Kauf ausgegebene Instandsetzungskosten ohne Umsatzsteuer.', 'was-ist-die-15-grenze-bei-renovierungen'],
  s_sp_kauf: ['Datum des notariellen Kaufvertrags.', 'wann-ist-ein-verkauf-steuerfrei'],
  s_sp_verkauf: ['Geplantes Datum des Verkaufsvertrags.', 'wann-ist-ein-verkauf-steuerfrei'],
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let n = 0;
export function attachHelp(root = document) {
  for (const [id, [text, slug]] of Object.entries(H)) {
    const el = root.querySelector ? root.querySelector('#' + CSS.escape(id)) : null;
    if (!el || el.dataset.fh) continue;
    el.dataset.fh = '1';
    const label = el.closest('label');
    const host = label || el.parentElement;
    if (!host) continue;
    const bid = 'fh' + (++n);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fh-btn'; btn.textContent = '?'; btn.setAttribute('aria-label', 'Was bedeutet das?'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', bid);
    const box = document.createElement('span');
    box.className = 'fh-box'; box.id = bid; box.hidden = true;
    box.innerHTML = `${esc(text)}${slug ? ` <a href="${W(slug)}" target="_blank" rel="noopener">Ausführlich im Wissen →</a>` : ''}`;
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const on = box.hidden; box.hidden = !on; btn.setAttribute('aria-expanded', String(on)); });
    // Knopf direkt hinter den Beschriftungstext, Erklärung unter das Feld.
    const textNode = label ? [...label.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim()) || label.querySelector('span') : null;
    if (textNode && textNode.nodeType === 3) textNode.after(btn); else if (textNode) textNode.append(btn); else host.insertBefore(btn, el);
    el.after(box);
  }
}

export function watchHelp(root = document.body) {
  attachHelp(document);
  let t = null;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => attachHelp(document), 120); }).observe(root, { childList: true, subtree: true });
}
