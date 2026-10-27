// Content-Registry der Ratgeber-Engine. Einzige Quelle für Seiten, Sitemap-Einträge und Suche.
// Status je Thema: draft · review · published · noindex · deprecated. Nur „published“ + bestandenes Quality Gate wird indexiert.
import gehalt from './topics/gehalt.mjs';
import finanzierung from './topics/finanzierung.mjs';
import bank from './topics/bank.mjs';

export const GROUPS = ['Leistbarkeit & Gehalt', 'Eigenkapital & Finanzierungsstruktur', 'Prüfung durch die Bank', 'Besondere Lebenslagen'];
export const TOPICS = [...gehalt, ...finanzierung, ...bank];

// Themen der Content-Matrix, die dieselbe Suchintention wie eine bestehende starke Seite bedienen.
// Sie bekommen keine eigene Seite (keine Kannibalisierung, kein Thin Content); ein dauerhafter Redirect führt
// auf die inhaltliche Nachfolge-URL, falls die Adresse irgendwo verlinkt oder eingetippt wird.
export const CONSOLIDATED = [
  { slug: 'haushaltsrechnung-bank-pauschalen', into: '/guides/haushaltsrechnung-immobilienfinanzierung', reason: 'Pauschalen sind Abschnitt der Hauptseite zur Haushaltsrechnung (gleiche Suchintention).' },
  { slug: 'eigenkapital-anteil-kaufnebenkosten', into: '/guides/wie-viel-eigenkapital-fuer-immobilienkredit', reason: 'Eigenkapitalanteil und Kaufnebenkosten werden auf der Eigenkapital-Seite mit Länder-Tabelle behandelt.' },
  { slug: '100-prozent-finanzierung-immobilie', into: '/guides/immobilienkredit-ohne-eigenkapital', reason: '100- und 110-%-Finanzierung als Vergleich auf einer Seite.' },
  { slug: '110-prozent-finanzierung-immobilie', into: '/guides/immobilienkredit-ohne-eigenkapital', reason: '110-%-Finanzierung entspricht dem Kredit ohne Eigenkapital.' },
  { slug: 'kredit-mit-leasingrate', into: '/guides/kredit-mit-autokredit', reason: 'Leasing und Autokredit wirken identisch in der Haushaltsrechnung.' },
  { slug: 'restschuld-immobilienkredit-berechnen', into: '/calculators/amortization', reason: 'Bestehender Tilgungsplan-Rechner beantwortet die Suchintention vollständig.' },
  { slug: 'immobilienfinanzierung-unterlagen-bank', into: '/checklist', reason: 'Bestehende Unterlagen-Checkliste (21 Unterlagen, nach Erwerbsstatus filterbar).' },
  { slug: 'baufinanzierung-probezeit', into: '/learn/erwerbsstatus', reason: 'Bestehende Seite „Finanzierung nach Erwerbsstatus“ behandelt Probezeit.' },
  { slug: 'baufinanzierung-befristeter-arbeitsvertrag', into: '/learn/erwerbsstatus', reason: 'Bestehende Seite „Finanzierung nach Erwerbsstatus“ behandelt Befristung.' },
];
