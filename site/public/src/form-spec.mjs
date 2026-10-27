// Ausfüllbare PDF-Formulare (BankReady-Kreditmappe und RenditeRadar-Analyse).
// Gemeinsame Beschreibung für den Server (Erzeugen mit pdf-lib) und den Browser (Wiedereinlesen mit pdf.js).
// Feldnamen bleiben stabil – sie sind die Schnittstelle zwischen heruntergeladenem und hochgeladenem PDF.

export const LAENDER = [
  ['baden-wuerttemberg', 'Baden-Württemberg'], ['bayern', 'Bayern'], ['berlin', 'Berlin'], ['brandenburg', 'Brandenburg'], ['bremen', 'Bremen'],
  ['hamburg', 'Hamburg'], ['hessen', 'Hessen'], ['mecklenburg-vorpommern', 'Mecklenburg-Vorpommern'], ['niedersachsen', 'Niedersachsen'],
  ['nordrhein-westfalen', 'Nordrhein-Westfalen'], ['rheinland-pfalz', 'Rheinland-Pfalz'], ['saarland', 'Saarland'], ['sachsen', 'Sachsen'],
  ['sachsen-anhalt', 'Sachsen-Anhalt'], ['schleswig-holstein', 'Schleswig-Holstein'], ['thueringen', 'Thüringen'],
];

// Feld: [name, Beschriftung, Typ ('n' Zahl, 't' Text, 'c' Ankreuzfeld, 'l' Bundesland, 's:<Optionen|…>' Auswahl), Breite (1 = halbe, 2 = ganze Zeile)]
export const FORMS = {
  analyse: {
    id: 'leaserun-form:analyse-v1',
    product: 'RenditeRadar',
    title: 'RenditeRadar – Objekt-Analyse zum Ausfüllen',
    intro: 'Tragen Sie die Werte direkt im PDF ein (z. B. mit Adobe Acrobat Reader, Vorschau am Mac oder der Dateien-App auf dem iPhone), speichern Sie und laden Sie die Datei bei LeaseRun unter „RenditeRadar › Manuell › PDF hochladen“ wieder hoch. Alle Kennzahlen werden dann automatisch berechnet.',
    sections: [
      ['Objekt', [['a_addr', 'Bezeichnung / Adresse', 't', 2], ['a_land', 'Bundesland', 'l', 1], ['a_art', 'Objektart', 's:ETW|EFH|MFH', 1], ['a_url', 'Link zum Inserat (optional)', 't', 2]]],
      ['Kernfakten', [['a_price', 'Kaufpreis (€)', 'n', 1], ['a_area', 'Wohnfläche (m²)', 'n', 1], ['a_rooms', 'Zimmer', 'n', 1], ['a_year', 'Baujahr', 'n', 1], ['a_ec', 'Effizienzklasse (A+ bis H)', 't', 1], ['a_broker', 'Makler, Käuferanteil (%)', 'n', 1]]],
      ['Miete und Kosten', [['a_rent', 'Ist-Nettokaltmiete (€/Monat)', 'n', 1], ['a_vq', 'Vergleichsmiete Mietspiegel (€/m²)', 'n', 1], ['a_vac', 'Mietausfall (%)', 'n', 1], ['a_nonrec', 'Nicht umlagefähige Kosten (€/Monat)', 'n', 1], ['a_mqm', 'Instandhaltung (€/m² und Monat)', 'n', 1], ['a_mpb', 'Gebiet mit Mietpreisbremse', 'c', 1]]],
      ['Finanzierung', [['a_eq', 'Eigenkapital (€)', 'n', 1], ['a_z', 'Sollzins p. a. (%)', 'n', 1], ['a_t', 'Anfängliche Tilgung p. a. (%)', 'n', 1], ['a_fix', 'Zinsbindung (Jahre)', 'n', 1]]],
      ['Steuer (optional)', [['a_bs', 'Gebäudeanteil (%)', 'n', 1], ['a_afa', 'AfA-Satz (%)', 's:2|2.5|3', 1], ['a_tax', 'Grenzsteuersatz (%)', 'n', 1]]],
    ],
  },
  kreditmappe: {
    id: 'leaserun-form:kreditmappe-v1',
    product: 'BankReady',
    title: 'BankReady – Kreditmappe zum Ausfüllen',
    intro: 'Tragen Sie Ihre Angaben direkt im PDF ein, speichern Sie und laden Sie die Datei bei LeaseRun unter „BankReady › Manuell › PDF hochladen“ wieder hoch. LeaseRun legt daraus das Objekt an, übernimmt Ihr Finanzprofil und erstellt die Kreditmappe automatisch.',
    sections: [
      ['Persönliche Angaben', [['p_employment', 'Erwerbsstatus', 's:Angestellt|Beamter|Selbstständig/Freiberufler', 1], ['p_netIncome', 'Nettoeinkommen Haushalt (€/Monat)', 'n', 1], ['p_householdSize', 'Personen im Haushalt', 'n', 1], ['p_equity', 'Eigenkapital gesamt (€)', 'n', 1]]],
      ['Objekt', [['o_name', 'Bezeichnung / Adresse', 't', 2], ['o_land', 'Bundesland', 'l', 1], ['o_price', 'Kaufpreis (€)', 'n', 1], ['o_rent', 'Nettokaltmiete (€/Monat)', 'n', 1], ['o_area', 'Wohnfläche (m²)', 'n', 1], ['o_yearBuilt', 'Baujahr', 'n', 1], ['o_efficiencyClass', 'Effizienzklasse', 't', 1], ['o_heatingType', 'Heizungsart', 't', 1], ['o_heatingYear', 'Baujahr Wärmeerzeuger', 'n', 1]]],
      ['Kosten und Finanzierung', [['o_brokerPct', 'Makler (%)', 'n', 1], ['o_notaryPct', 'Notar und Grundbuch (%)', 'n', 1], ['o_equity', 'Eigenkapital für dieses Objekt (€)', 'n', 1], ['o_loan', 'Darlehen (€, leer = automatisch)', 'n', 1], ['o_interestPct', 'Sollzins (%)', 'n', 1], ['o_repaymentPct', 'Anfängliche Tilgung (%)', 'n', 1], ['o_fixedYears', 'Zinsbindung (Jahre)', 'n', 1], ['o_lendingValue', 'Beleihungswert (€, falls bekannt)', 'n', 1]]],
      ['Bewirtschaftung', [['o_nonRecoverable', 'Nicht umlagefähige Kosten (€/Monat)', 'n', 1], ['o_maintenance', 'Instandhaltung (€/Monat)', 'n', 1], ['o_vacancyPct', 'Leerstand / Mietausfall (%)', 'n', 1], ['o_vergleichsmieteQm', 'Vergleichsmiete (€/m²)', 'n', 1], ['o_mietpreisbremse', 'Gebiet mit Mietpreisbremse', 'c', 1]]],
      ['Grundbuch und WEG (falls vorhanden)', [['o_grundbuchAmt', 'Grundbuch: Amtsgericht', 't', 1], ['o_grundbuchBlatt', 'Grundbuch: Blatt', 't', 1], ['o_flur', 'Flur', 't', 1], ['o_flurstueck', 'Flurstück', 't', 1], ['o_ownership', 'Eigentumsstruktur', 't', 1], ['o_landArea', 'Grundstücksfläche (m²)', 'n', 1], ['o_meaShare', 'Miteigentumsanteil Zähler', 'n', 1], ['o_meaTotal', 'Miteigentumsanteil Nenner', 'n', 1], ['o_wegReserveTotal', 'Erhaltungsrücklage gesamt (€)', 'n', 1], ['o_abt2Open', 'Ungeklärte Lasten in Abt. II', 'c', 1]]],
      ['Steuer (optional)', [['o_buildingSharePct', 'Gebäudeanteil (%)', 'n', 1], ['o_marginalTaxPct', 'Grenzsteuersatz (%)', 'n', 1]]],
    ],
  },
};

export const fieldsOf = (kind) => FORMS[kind].sections.flatMap(([, f]) => f);

// Deutsche Zahleneingaben robust lesen: „300.000“, „300 000 €“, „3,5“, „1.234,56“.
export function parseNum(v) {
  let s = String(v ?? '').replace(/[€%\s]|m²|EUR/gi, '').trim();
  if (!s) return null;
  if (/,\d{1,2}$/.test(s) || (s.includes(',') && !s.includes('.'))) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Gelesene Formularwerte (Name → Wert) in saubere Daten umwandeln. Liefert { values, filled, unknown }.
export function readForm(kind, raw) {
  const out = {}; let filled = 0;
  for (const [name, , type] of fieldsOf(kind)) {
    const v = raw[name];
    if (v === undefined || v === null || v === '' || v === 'Off') continue;
    if (type === 'n') { const n = parseNum(v); if (n !== null) { out[name] = n; filled++; } }
    else if (type === 'c') { out[name] = v === true || /^(on|yes|ja|true|1)$/i.test(String(v)); if (out[name]) filled++; }
    else if (type === 'l') { const t = String(v).trim().toLowerCase(); const hit = LAENDER.find(([k, n]) => k === t || n.toLowerCase() === t); if (hit) { out[name] = hit[0]; filled++; } }
    else { const t = String(v).trim().slice(0, 160); if (t) { out[name] = t; filled++; } }
  }
  return { values: out, filled };
}
