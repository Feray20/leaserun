// LeaseRun – zentrale Finanz-Konfiguration.
// Jede Zahl, die in Rechnern, Ratgeber-Seiten oder Modellrechnungen verwendet wird, steht genau einmal hier –
// mit Einheit, Herkunft, Datenstand und Art der Annahme. Änderungen wirken überall (Rechenkern, Ratgeber, Checker).
//
// assumption_type:
//   modellannahme            – von LeaseRun gesetzter Rechenwert, keine Bankvorgabe
//   orientierungswert        – verbreiteter Richtwert, im Einzelfall abweichend
//   veroeffentlichte_information – aus Gesetz oder amtlicher/öffentlicher Quelle
// review_status: geprueft (intern geprüft) · offen (fachlich noch zu prüfen) · blockiert (nicht verwenden)
//
// Wichtig: Es gibt keine für alle Banken identische Lebenshaltungspauschale und keinen garantierten Marktzins.
// Die Modellwerte sind deshalb als Annahme gekennzeichnet und in jedem Rechner änderbar.

export const ASSUMPTIONS = {
  zins_modell: {
    value: 4.2, unit: '% p. a.', assumption_type: 'modellannahme',
    label: 'Sollzins für Modellrechnungen',
    source: 'Orientierung: durchschnittlicher Bauzins bei 10 Jahren Zinsbindung im September 2026 rund 4,2 % (Baufi24, Zinskommentar Oktober 2026). Kein Live-Zins, kein Angebot.',
    source_url: 'https://www.baufi24.de/presse/pressemitteilungen/zinskommentar-102026/',
    verified_at: '2026-10-26', effective_from: '2026-10-01', effective_until: null, review_status: 'geprueft',
  },
  tilgung_modell: {
    value: 2, unit: '% p. a.', assumption_type: 'modellannahme',
    label: 'Anfängliche Tilgung für Modellrechnungen',
    source: 'LeaseRun-Modellwert. Die Mindesttilgung legt jedes Institut selbst fest.',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  lebenshaltung_erste_person: {
    value: 1000, unit: '€ / Monat', assumption_type: 'modellannahme',
    label: 'Lebenshaltung erste erwachsene Person',
    source: 'LeaseRun-Haushaltsmodell (identisch mit der Deal-Scorecard). Banken verwenden eigene, voneinander abweichende Ansätze.',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  lebenshaltung_weiterer_erwachsener: {
    value: 350, unit: '€ / Monat', assumption_type: 'modellannahme',
    label: 'Lebenshaltung je weiterer erwachsener Person',
    source: 'LeaseRun-Haushaltsmodell (identisch mit der Deal-Scorecard).',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  lebenshaltung_kind: {
    value: 350, unit: '€ / Monat', assumption_type: 'modellannahme',
    label: 'Lebenshaltung je Kind',
    source: 'LeaseRun-Haushaltsmodell (identisch mit der Deal-Scorecard, dort je weiterer Person).',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  mietanrechnung: {
    value: 75, unit: '% der Kaltmiete', assumption_type: 'modellannahme',
    label: 'Angerechneter Anteil von Mieteinnahmen',
    source: 'LeaseRun-Modellwert. Banken rechnen Mieten nur teilweise an; der Anteil ist institutsspezifisch.',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  ueberschuss_gruen: {
    value: 10, unit: '% des Haushaltsnettos', assumption_type: 'modellannahme',
    label: 'Mindest-Überschuss nach Rate für „tragfähig“',
    source: 'LeaseRun-Modellwert (identisch mit der Deal-Scorecard).',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  objektkosten_modell: {
    value: 250, unit: '€ / Monat', assumption_type: 'modellannahme',
    label: 'Laufende Objektkosten (Hausgeld/Nebenkosten, Rücklage) für Modelltabellen',
    source: 'LeaseRun-Modellwert für Beispieltabellen; tatsächliche Kosten hängen vom Objekt ab und sind im Rechner änderbar.',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  rate_quote_hinweis: {
    value: 40, unit: '% des Haushaltsnettos', assumption_type: 'orientierungswert',
    label: 'Rate im Verhältnis zum Nettoeinkommen (Prüfhinweis)',
    source: 'Verbreitete Faustregel (Rate höchstens etwa ein Drittel bis 40 % des Nettoeinkommens); keine Bankvorgabe.',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  reserve_monate: {
    value: 3, unit: 'Monatsausgaben', assumption_type: 'modellannahme',
    label: 'Finanzielle Reserve nach dem Kauf',
    source: 'LeaseRun-Modellwert (identisch mit der Deal-Scorecard).',
    source_url: null, verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  notar_pct: {
    value: 1.5, unit: '% des Kaufpreises', assumption_type: 'orientierungswert',
    label: 'Notar (Richtwert)',
    source: 'Gebühren nach dem Gerichts- und Notarkostengesetz (GNotKG); der Prozentwert ist ein Richtwert.',
    source_url: 'https://www.gesetze-im-internet.de/gnotkg/', verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  grundbuch_pct: {
    value: 0.5, unit: '% des Kaufpreises', assumption_type: 'orientierungswert',
    label: 'Grundbuchamt (Richtwert)',
    source: 'Gebühren nach dem GNotKG; der Prozentwert ist ein Richtwert.',
    source_url: 'https://www.gesetze-im-internet.de/gnotkg/', verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  makler_pct: {
    value: 3.57, unit: '% des Kaufpreises', assumption_type: 'orientierungswert',
    label: 'Makler, Käuferanteil (Richtwert)',
    source: 'Bei Wohnung oder Einfamilienhaus zahlt ein privater Käufer höchstens die Hälfte der Provision (§ 656c BGB); die Höhe ist frei verhandelbar.',
    source_url: 'https://www.gesetze-im-internet.de/bgb/__656c.html', verified_at: '2026-10-26', effective_from: '2020-12-23', effective_until: null, review_status: 'geprueft',
  },
  kindergeld: {
    value: 259, unit: '€ je Kind / Monat', assumption_type: 'veroeffentlichte_information',
    label: 'Kindergeld 2026',
    source: 'Kindergeld 2026: 259 € je Kind und Monat (§ 66 EStG; Deutscher Bundestag, Wissenschaftliche Dienste).',
    source_url: 'https://www.bundestag.de/resource/blob/1181986/305_kindergeld.pdf', verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  elterngeld_max: {
    value: 1800, unit: '€ / Monat', assumption_type: 'veroeffentlichte_information',
    label: 'Basiselterngeld Höchstbetrag',
    source: 'Bundeselterngeld- und Elternzeitgesetz (BEEG), § 2: Basiselterngeld 300 € bis 1.800 € im Monat.',
    source_url: 'https://www.gesetze-im-internet.de/beeg/__2.html', verified_at: '2026-10-26', effective_from: '2026-01-01', effective_until: null, review_status: 'geprueft',
  },
  pfandbrief_grenze: {
    value: 60, unit: '% des Beleihungswerts', assumption_type: 'veroeffentlichte_information',
    label: 'Beleihungsgrenze für die Pfandbrief-Deckung',
    source: 'Pfandbriefgesetz § 14: Hypotheken dürfen zur Deckung nur bis zu 60 % des Beleihungswerts verwendet werden.',
    source_url: 'https://www.gesetze-im-internet.de/pfandbg/__14.html', verified_at: '2026-10-26', effective_from: '2005-07-19', effective_until: null, review_status: 'geprueft',
  },
};

export const val = (key) => {
  const a = ASSUMPTIONS[key];
  if (!a) throw new Error(`Unbekannte Annahme: ${key}`);
  if (a.review_status === 'blockiert') throw new Error(`Annahme gesperrt: ${key}`);
  return a.value;
};

// Kurzform „4,2 % p. a.“ für Texte.
export const fmtAssumption = (key) => {
  const a = ASSUMPTIONS[key];
  return `${String(a.value).replace('.', ',')} ${a.unit}`;
};
