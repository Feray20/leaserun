// SEO-Build für die statischen Seiten in public/:
// Titel, Beschreibung, Canonical, Robots, Open Graph, Twitter, JSON-LD (Organization, WebSite, WebApplication,
// FAQPage, HowTo, BreadcrumbList), Kaufnebenkosten-Seiten je Bundesland, sitemap.xml und robots.txt.
// Idempotent: ersetzt nur <title> und den Block zwischen <!--seo:start--> und <!--seo:end-->; vorgerenderter Inhalt bleibt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { GREST } from '../public/src/calc.mjs';

const ORIGIN = 'https://leaserun.com';
const pub = new URL('../public/', import.meta.url);
const read = (p) => readFileSync(new URL(p, pub), 'utf8');
const write = (p, s) => { const u = new URL(p, pub); mkdirSync(new URL('.', u), { recursive: true }); writeFileSync(u, s); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const today = new Date().toISOString().slice(0, 10);

const ORG = {
  '@type': 'Organization', '@id': `${ORIGIN}/#org`, name: 'LeaseRun', url: `${ORIGIN}/`,
  logo: { '@type': 'ImageObject', url: `${ORIGIN}/icon-512.png`, width: 512, height: 512 }, email: 'support@leaserun.com', sameAs: ['https://www.linkedin.com/company/leaserun/'],
  address: { '@type': 'PostalAddress', streetAddress: 'Georg-August-Zinn-Str. 25', postalCode: '64354', addressLocality: 'Reinheim', addressCountry: 'DE' },
};
const APP = {
  '@type': 'WebApplication', '@id': `${ORIGIN}/#app`, name: 'LeaseRun', url: `${ORIGIN}/`, applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web', inLanguage: 'de-DE', publisher: { '@id': `${ORIGIN}/#org` },
  description: 'Technisches Analysewerkzeug für Kapitalanleger: Cashflow, DSCR, Stresstest, Fristen und Kreditmappe. Keine Finanzierungs-, Rechts- oder Steuerberatung.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', description: 'Analyse kostenfrei' },
};

// Seitenliste: Pfad, Datei, Titel, Beschreibung, Brotkrumen, Indexierung (noindex, optional mit follow), Zusatz-JSON-LD.
const PAGES = [
  { path: '/', file: 'index.html', title: 'Immobilie prüfen & Kaufentscheidung vorbereiten | LeaseRun', desc: 'Prüfe Immobilien, Kaufnebenkosten, Finanzierung und wichtige Prüfpunkte mit LeaseRun – transparent und nachvollziehbar.', crumbs: [], extra: ['website', 'app', 'howto', 'homefaq'] },
  { path: '/learn', title: `Immobilien und Geld verständlich erklärt – ${((f) => (Array.isArray(f) ? f : f.entries).length)(JSON.parse(readFileSync(new URL('../public/data/faq.json', import.meta.url), 'utf8')))} Antworten | LeaseRun`, desc: 'Wissen in vier Phasen: Leistbarkeit, Objektprüfung, Steuern und Cashflow, Bankgespräch – verständlich erklärt, mit Formel und Rechtsgrundlage.', crumbs: ['Wissen'], extra: ['faq'] },
  { path: '/cockpit', file: null, skip: true, title: '', desc: '' },
  { path: '/search', file: 'search/index.html', template: 'learn/index.html', title: 'Suche | LeaseRun', noindex: true, desc: 'Rechner, Antworten und Fachbegriffe rund um Immobilienkauf und Finanzierung durchsuchen.', crumbs: ['Suche'] },
  { path: '/learn/erwerbsstatus', file: 'learn/erwerbsstatus/index.html', title: 'Finanzierung je Erwerbsstatus: Angestellt bis Selbstständig | LeaseRun', desc: 'Was Banken bei Angestellten, Befristeten, Beamten, Selbstständigen, Berufseinsteigern und Rentnern prüfen – mit typischen Unterlagen je Gruppe.', crumbs: ['Wissen', 'Erwerbsstatus'] },
  { path: '/learn/glossar', title: 'Glossar Immobilienfinanzierung: Begriffe von A bis Z | LeaseRun', desc: 'Annuität, Beleihungswert, Zinsbindung, Kappungsgrenze, Grundschuld und mehr: die wichtigsten Begriffe zu Kauf, Finanzierung, Miete und Steuer kurz erklärt.', crumbs: ['Wissen', 'Glossar'], extra: ['glossar'] },
  { path: '/start', title: 'Meine erste Immobilie durchrechnen – in drei Schritten | LeaseRun', desc: 'Kaufpreis, Miete, Eigenkapital: Rate, Tilgungshebel, Cashflow, Notgroschen und das Bild nach zehn Jahren – mit Erklärungen aller Fachbegriffe.', crumbs: ['Meine erste Immobilie'], extra: ['app'] },
  { path: '/calculators', title: 'Mietrecht- und Steuerrechner: Mietpreisbremse, AfA, Indexmiete | LeaseRun', desc: 'Mietpreisbremse, Kappungsgrenze, Index- und Staffelmiete, AfA linear und degressiv, Kaufpreisaufteilung und 15-%-Grenze – mit offengelegter Formel.', crumbs: ['Rechner'], extra: ['app'] },
  { path: '/deadlines', noindex: true, follow: true, title: 'Fristen nach dem Immobilienkauf berechnen | LeaseRun', desc: 'Spekulationsfrist (§ 23 EStG), 15-%-Grenze, Zinsbindung, Kündigungsrecht nach § 489 BGB und Mieterhöhung – als Liste und Kalenderdatei.', crumbs: ['Fristen'], extra: ['app'] },
  { path: '/scenarios', title: 'Anschlussfinanzierung und Verkauf durchrechnen | LeaseRun', desc: 'Restschuld, neue Rate und Kipp-Punkt nach der Zinsbindung; Verkaufsszenario mit Veräußerungsgewinn und Spekulationsfrist.', crumbs: ['Szenarien'], extra: ['app'] },
  { path: '/calculators/depreciation', file: 'calculators/depreciation/index.html', title: 'AfA-Rechner Immobilie: linear, degressiv und Sonder-AfA § 7b | LeaseRun', desc: 'Gebäude-AfA berechnen: 2 %, 2,5 % oder 3 % linear, 5 % degressiv (§ 7 Abs. 5a EStG) und Sonder-AfA nach § 7b – Jahr für Jahr mit Restwert.', crumbs: ['Rechner', 'AfA'] },
  { path: '/calculators/rent-increase', file: 'calculators/rent-increase/index.html', title: 'Mieterhöhung berechnen: Kappungsgrenze, Vergleichsmiete, Brief | LeaseRun', desc: 'Zulässige Mieterhöhung nach § 558 BGB: Kappungsgrenze 20 % oder 15 %, ortsübliche Vergleichsmiete, Wirksamkeit nach § 558b und ein Briefentwurf zum Anpassen.', crumbs: ['Rechner', 'Mieterhöhung'] },
  { path: '/calculators/cash-flow', file: 'calculators/cash-flow/index.html', title: 'Cashflow-Rechner Immobilie: vor und nach Steuern | LeaseRun', desc: 'Cashflow einer vermieteten Immobilie vor und nach Steuern: Miete, nicht umlagefähige Kosten, Zinsen, Tilgung, AfA, Steuersatz – mit 10-Jahres-Verlauf.', crumbs: ['Rechner', 'Cashflow'] },
  { path: '/calculators/loan-comparison', file: 'calculators/loan-comparison/index.html', title: 'Immobilienangebote vergleichen: Rendite, Faktor, Cashflow | LeaseRun', desc: 'Bis zu drei Wohnungen oder Häuser nebeneinander vergleichen: Kaufnebenkosten, Rate, Cashflow, Brutto- und Nettomietrendite, Kaufpreisfaktor und Preis pro m².', crumbs: ['Rechner', 'Angebotsvergleich'] },
  { path: '/calculators/rent-vs-buy', file: 'calculators/rent-vs-buy/index.html', title: 'Kaufen oder mieten? Vermögensvergleich über 25 Jahre | LeaseRun', desc: 'Eigentum mit Kredit gegen Miete plus angelegtes Eigenkapital: Vermögen nach 5, 10 und 25 Jahren mit eigenen Annahmen zu Miete, Wert und Rendite.', crumbs: ['Rechner', 'Kaufen oder mieten'] },
  { path: '/calculators/scorecard', file: 'calculators/scorecard/index.html', title: 'Deal-Scorecard: Haushalt, Eigenkapital und Objekt prüfen | LeaseRun', desc: 'Ampel für Ihr Immobilienvorhaben: Haushalt nach Rate, Eigenkapital inkl. Nebenkosten und Reserve, Rendite, Instandhaltung und Mietpreisbremse.', crumbs: ['Rechner', 'Deal-Scorecard'] },
  { path: '/calculators/budget', file: 'calculators/budget/index.html', title: 'Budget-Rechner: Wie viel Immobilie kann ich mir leisten? | LeaseRun', desc: 'Aus Einkommen, Ausgaben und Eigenkapital zur tragbaren Rate, zum Darlehen und zum Kaufpreis inkl. Nebenkosten je Bundesland – auch für Kapitalanleger.', crumbs: ['Rechner', 'Budget'] },
  { path: '/calculators/amortization', file: 'calculators/amortization/index.html', title: 'Tilgungsplan mit Sondertilgung berechnen | LeaseRun', desc: 'Tilgungsplan für Ihr Annuitätendarlehen: Zinsen, Tilgung und Restschuld je Jahr, Restschuld nach Zinsbindung, Sondertilgung und CSV-Export.', crumbs: ['Rechner', 'Tilgungsplan'] },
  { path: '/calculators/closing-costs', file: 'calculators/closing-costs/index.html', title: 'Kaufnebenkosten nach Bundesland 2026 | LeaseRun', desc: 'Grunderwerbsteuer von 3,5 % bis 6,5 %: alle 16 Bundesländer im Vergleich, mit Rechner für Notar, Grundbuch und Makler.', crumbs: ['Rechner', 'Kaufnebenkosten'], extra: ['pagefaq'] },
  { path: '/checklist', noindex: true, follow: true, title: 'Unterlagen-Checkliste für die Baufinanzierung | LeaseRun', desc: '21 Unterlagen, die Banken bei Kapitalanlegern typischerweise sehen wollen – gefiltert nach Erwerbsstatus und Objektart, druckbar.', crumbs: ['Checkliste'] },
  { path: '/sample-loan-package', title: 'Beispiele: Muster-Kreditmappe und Objekt-Analyse | LeaseRun', desc: 'Fiktive Beispiele als PDF: Kreditmappe mit Finanzierung, Haushaltsrechnung und Stresstest sowie Objekt-Analyse mit Rendite und Cashflow.', crumbs: ['Beispiele'] },
  { path: '/pro-guide', title: '12-Monats-Programm für Kapitalanleger | LeaseRun', desc: 'Vom Kassensturz bis zum verwalteten Bestand: ein Thema pro Monat mit Aufgaben, Werkzeug und Gesetzestext zum Nachlesen.', crumbs: ['Pro-Begleiter'] },
  { path: '/profiler', title: 'Investor-Profiler: Welche Strategie passt zu Ihnen? | LeaseRun', desc: 'Sechs Fragen zu Eigenkapital, Cashflow, Steuer und Horizont – mit den Kennzahlen, auf die Sie besonders achten sollten.', crumbs: ['Investor-Profiler'] },
  { path: '/pricing', title: 'Preise: Kreditmappe, Käufer-Pass & Investor Pro | LeaseRun', desc: 'Alle Rechner kostenlos. BankReady Kreditmappe 39 € einmalig, Käufer-Pass 49 € für 90 Tage (kein Abo), Investor Pro 29 €/Monat – Endpreise inkl. USt.', crumbs: ['Angebote'] },
  { path: '/about', title: 'Über uns: Wer hinter LeaseRun steht | LeaseRun', desc: 'Feray Korkmaz und LeaseRun: warum es LeaseRun gibt, wofür es steht und wie Sie uns direkt per E-Mail oder Telefon erreichen.', crumbs: ['Über uns'] },
  { path: '/request', noindex: true, title: 'Anfrage | LeaseRun', desc: 'Antwort auf eine E-Mail von LeaseRun: Unterlagen, Testzugang oder Termin anfordern.', crumbs: ['Anfrage'] },
  { path: '/book', noindex: true, title: 'Termin vereinbaren | LeaseRun', desc: 'Online-Termin mit LeaseRun buchen: freien Termin wählen, Anfrage senden und den Microsoft-Teams-Link per E-Mail erhalten.', crumbs: ['Termin'] },
  { path: '/contact', title: 'Kontakt | LeaseRun', desc: 'LeaseRun erreichen: Ansprechpartner mit Name, E-Mail, Telefon und Anschrift – für Privatkunden und Unternehmen.', crumbs: ['Kontakt'] },
  { path: '/learn/warum-investieren', file: 'learn/warum-investieren/index.html', title: 'Warum überhaupt investieren? Inflation und Krisen | LeaseRun', desc: 'Was Inflation mit Geld auf dem Konto macht, warum kein Investment krisenfest ist und wie man Krisen vor dem Immobilienkauf durchrechnet.', crumbs: ['Wissen', 'Warum investieren'] },
  { path: '/learn/vermietete-wohnung-rechnung', file: 'learn/vermietete-wohnung-rechnung/index.html', title: 'Was eine vermietete Wohnung rechnerisch leistet | LeaseRun', desc: 'Durchgerechnetes Beispiel: 300.000 € Wohnung, Vermögen nach 25 Jahren, wohin die Miete fließt und Kaufnebenkosten je Bundesland.', crumbs: ['Wissen', 'Rechenbeispiel vermietete Wohnung'] },
  { path: '/learning-path', noindex: true, follow: true, title: 'Dein Lernpfad: in vier Etappen zur Immobilie | LeaseRun', desc: 'Geld verstehen, investieren lernen, Objekte prüfen, finanzieren: der Lernpfad von LeaseRun in vier Etappen zum Immobilienkauf.', crumbs: ['Lernpfad'] },
  { path: '/security', title: 'Sicherheit und Datenschutz | LeaseRun', desc: 'Speicherung in Frankfurt, Prüfsummen, befristete Freigabelinks und Zugriffsprotokoll – und was noch geplant ist.', crumbs: ['Sicherheit'] },
  { path: '/legal-notice', title: 'Impressum | LeaseRun', desc: 'Impressum von LeaseRun: Anbieterkennzeichnung nach § 5 DDG, Kontakt, Verantwortliche nach § 18 MStV und Hinweise zur Streitbeilegung.', crumbs: ['Impressum'] },
  { path: '/privacy', title: 'Datenschutzerklärung | LeaseRun', desc: 'Welche Daten LeaseRun verarbeitet, wo sie gespeichert werden (Frankfurt), wie lange, an wen sie gehen und welche Rechte Sie nach der DSGVO haben.', crumbs: ['Datenschutz'] },
  { path: '/terms', title: 'Nutzungsbedingungen und Widerrufsbelehrung | LeaseRun', desc: 'Nutzungsbedingungen von LeaseRun: Leistungen, Preise, Laufzeit und Kündigung, Haftung sowie Widerrufsbelehrung und Muster-Widerrufsformular.', crumbs: ['Nutzungsbedingungen'] },
  { path: '/refund', title: 'Vertrag widerrufen | LeaseRun', desc: 'Kauf oder Abo bei LeaseRun online widerrufen – ohne Anmeldung, in zwei Schritten nach § 356a BGB, mit Eingangsbestätigung per E-Mail.', crumbs: ['Vertrag widerrufen'] },
  { path: '/cancel', title: 'Verträge hier kündigen | LeaseRun', desc: 'Abo (Investor Pro oder früherer Tarif) ohne Anmeldung kündigen – nach § 312k BGB, mit Eingangsbestätigung per E-Mail.', crumbs: ['Verträge kündigen'] },
  // Nicht indexieren: persönliche oder tokengebundene Seiten
  { path: '/data-room', title: 'Datenraum | LeaseRun', desc: 'Freigegebene Unterlagen.', noindex: true },
  { path: '/review', title: 'Kreditmappe prüfen | LeaseRun', desc: 'Echtheitsprüfung einer LeaseRun-Kreditmappe.', noindex: true },
  { path: '/business', title: 'Vollständige Finanzierungsfälle für Berater, Makler und Banken | LeaseRun', desc: 'Kunden-, Objekt- und Finanzierungsdaten strukturiert erfassen, fehlende Unterlagen früh erkennen, Kreditmappen vorbereiten. Demo ohne Anmeldung.', crumbs: ['Für Unternehmen'] },
  { path: '/checkout', title: 'Sichere Bezahlung | LeaseRun', desc: 'Sichere Bezahlung bei LeaseRun.', noindex: true },
  { path: '/partners', title: 'Partner | LeaseRun', desc: 'Partnerseite.', noindex: true },
  { path: '/app/dashboard', file: 'auth-login.html', title: 'Konto | LeaseRun', desc: 'Ihr LeaseRun-Konto.', noindex: true, noCanonical: true },
  { path: '/offline', file: 'offline.html', title: 'Offline | LeaseRun', desc: 'Keine Verbindung.', noindex: true, noCanonical: true },
];
for (const [slug, g] of Object.entries(GREST)) {
  PAGES.push({
    path: `/calculators/closing-costs/${slug}`, file: `calculators/closing-costs/${slug}/index.html`,
    title: (() => { const t = `Kaufnebenkosten ${g.name} 2026: Grunderwerbsteuer ${String(g.pct).replace('.', ',')} %`; return t.length > 62 ? `Kaufnebenkosten ${g.name} 2026: ${String(g.pct).replace('.', ',')} % GrESt` : `${t} | LeaseRun`; })(),
    desc: `Kaufnebenkosten in ${g.name} berechnen: Grunderwerbsteuer ${String(g.pct).replace('.', ',')} %, Notar, Grundbuch und Makler – mit eigenem Kaufpreis. Stand Oktober 2026.`,
    crumbs: ['Rechner', 'Kaufnebenkosten', g.name],
  });
}

// Ratgeber-Engine (scripts/build-ratgeber.mjs): Seiten aus der Content-Registry; Indexierung nur bei bestandenem Quality Gate.
{
  const RG = new URL('../content/ratgeber/pages.json', import.meta.url);
  if (existsSync(RG)) for (const r of JSON.parse(readFileSync(RG, 'utf8'))) {
    const title = r.title.endsWith('| LeaseRun') || `${r.title} | LeaseRun`.length > 62 ? r.title : `${r.title} | LeaseRun`;
    PAGES.push({ path: r.path, file: r.file, title, desc: r.desc, crumbs: r.crumbs, noindex: !r.indexable, rg: r });
  }
}


// Eine Seite je Wissensfrage (gleiche Slug-Regel wie SLUG in public/src/routes.js).
export const slugify = (q) => { let t = q.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (t.length > 80) { t = t.slice(0, 80); t = t.slice(0, t.lastIndexOf('-') > 30 ? t.lastIndexOf('-') : 80); } return t; };
{
  const faq = JSON.parse(read('data/faq.json'));
  for (const q of Array.isArray(faq) ? faq : faq.entries) {
    const slug = slugify(q.question);
    const desc = `${q.teaser || q.question} Die Antwort mit Rechenweg und Rechtsgrundlage gibt es im LeaseRun-Zugang.`.slice(0, 160);
    PAGES.push({ path: `/learn/${slug}`, file: `learn/${slug}/index.html`, template: 'learn/index.html', title: `${q.seoTitle || q.question} | LeaseRun`, desc, crumbs: ['Wissen', q.question], faqItem: q });
  }
}
const CRUMB_PATH = { Rechner: '/calculators', Kaufnebenkosten: '/calculators/closing-costs', Wissen: '/learn', Ratgeber: '/guides' };
function breadcrumb(p) {
  if (!p.crumbs?.length) return null;
  const items = [{ name: 'Start', item: `${ORIGIN}/` }];
  p.crumbs.forEach((c, i) => items.push({ name: c, item: i === p.crumbs.length - 1 ? `${ORIGIN}${p.path}` : `${ORIGIN}${CRUMB_PATH[c] || p.path}` }));
  return { '@type': 'BreadcrumbList', itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: x.item })) };
}
// Wissenszentrale: Übersicht als Liste der Fragen (jede mit eigener Seite). Kein FAQPage-Markup mit Teaser-Antworten –
// Google erwartet dort die vollständige Antwort; die gibt es bei LeaseRun erst mit Zugang (siehe gatedPage).
function faqLd() {
  const faq = JSON.parse(read('data/faq.json'));
  const list = Array.isArray(faq) ? faq : faq.entries;
  return { '@type': 'ItemList', '@id': `${ORIGIN}/wissen#liste`, name: 'Wissenszentrale: alle Fragen', numberOfItems: list.length, itemListElement: list.map((q, i) => ({ '@type': 'ListItem', position: i + 1, name: q.question, url: `${ORIGIN}/wissen/${slugify(q.question)}` })) };
}
// Bezahlinhalte (Paywall) korrekt auszeichnen: Die Seite ist eine Vorschau, der ausführliche Inhalt ist kostenpflichtig.
// Google wertet so ausgezeichnete Seiten als rechtmäßige Paywall-Inhalte und nicht als „dünn“ oder als Cloaking.
// Was ohne Zugang lesbar ist (Frage, Kurzfassung, Leseprobe), wird per CSS-Selektor als frei markiert.
function gatedPage(p, url, free, type = 'WebPage') {
  return { '@type': type, '@id': `${url}#page`, url, name: p.title.replace(/ \| LeaseRun$/, ''), description: p.desc, inLanguage: 'de-DE', isAccessibleForFree: false,
    hasPart: free.map((sel) => ({ '@type': 'WebPageElement', isAccessibleForFree: true, cssSelector: sel })),
    publisher: { '@id': `${ORIGIN}/#org` }, isPartOf: { '@id': `${ORIGIN}/#site` }, offers: { '@type': 'Offer', url: `${ORIGIN}/angebote`, priceCurrency: 'EUR', availability: 'https://schema.org/InStock' } };
}
function homeFaqLd(html) {
  const qs = [...html.matchAll(/<details[^>]*><summary>(.*?)<span>\+<\/span><\/summary><p>(.*?)<\/p><\/details>/g)];
  return { '@type': 'FAQPage', mainEntity: qs.map((m) => ({ '@type': 'Question', name: m[1].replace(/<[^>]+>/g, ''), acceptedAnswer: { '@type': 'Answer', text: m[2].replace(/<[^>]+>/g, '') } })) };
}
function glossarLd() {
  const src = read('src/routes.js');
  const m = src.match(/const GLOSSAR=(\{.*?\});/);
  const g = new Function(`return ${m[1]}`)();
  return { '@type': 'DefinedTermSet', '@id': `${ORIGIN}/wissen/glossar#set`, name: 'Glossar Immobilienfinanzierung', inLanguage: 'de-DE',
    hasDefinedTerm: Object.entries(g).map(([k, v]) => ({ '@type': 'DefinedTerm', name: k, description: v, inDefinedTermSet: `${ORIGIN}/wissen/glossar#set` })) };
}
const HOWTO = {
  '@type': 'HowTo', name: 'In drei Schritten zur Kreditmappe für das Bankgespräch',
  step: [
    { '@type': 'HowToStep', position: 1, name: 'Profil und Haushaltsrechnung', text: 'Einkommen, Ausgaben, Eigenkapital und Haushaltsgröße im Konto erfassen.' },
    { '@type': 'HowToStep', position: 2, name: 'Objekt und Wirtschaftlichkeit', text: 'Kaufpreis, Miete, Kosten und Finanzierung eintragen; Cashflow, DSCR und Stresstest prüfen.' },
    { '@type': 'HowToStep', position: 3, name: 'Unterlagen und Kreditmappe', text: 'Unterlagen hochladen, Kreditmappe als PDF erzeugen und per befristetem Link freigeben.' },
  ],
};

function headBlock(p, html) {
  const url = `${ORIGIN}${p.path === '/' ? '/' : p.path}`;
  const ogKey = p.path.replace(/^\//, '').replace(/\//g, '--');
  const ogImg = ogKey && existsSync(new URL(`og/${ogKey}.png`, pub)) ? `${ORIGIN}/og/${ogKey}.png` : `${ORIGIN}/og-image.png`;
  const lines = [
    `<meta name="description" content="${esc(p.desc)}">`,
    // Inhaberschafts-Nachweis für Google Search Console und Bing Webmaster Tools (Werte aus Vercel-Variablen, nur Startseite).
    ...(p.path === '/' ? [['google-site-verification', process.env.GOOGLE_SITE_VERIFICATION], ['msvalidate.01', process.env.BING_SITE_VERIFICATION]].filter(([, v]) => v && /^[A-Za-z0-9_\-]{10,120}$/.test(String(v).trim())).map(([n, v]) => `<meta name="${n}" content="${esc(String(v).trim())}">`) : []),
    // follow: dünne Hilfsseiten nicht als eigenes Suchergebnis führen, Links darauf aber weiter verfolgen lassen.
    `<meta name="robots" content="${p.noindex ? (p.follow ? 'noindex, follow' : 'noindex, nofollow') : 'index, follow, max-image-preview:large'}">`,
  ];
  if (!p.noCanonical) lines.push(`<link rel="canonical" href="${url}">`);
  if (!p.noindex) {
    lines.push(
      '<meta property="og:type" content="website">', '<meta property="og:site_name" content="LeaseRun">', '<meta property="og:locale" content="de_DE">',
      `<meta property="og:title" content="${esc(p.title)}">`, `<meta property="og:description" content="${esc(p.desc)}">`, `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${ogImg}">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${ogImg.includes('/og/') ? esc(p.title.replace(' | LeaseRun', '')) : 'LeaseRun – Immobilie als Kapitalanlage durchrechnen'}">`,
      '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:title" content="${esc(p.title)}">`,
      `<meta name="twitter:description" content="${esc(p.desc)}">`, `<meta name="twitter:image" content="${ogImg}">`,
    );
    const graph = [ORG];
    const ex = p.extra || [];
    if (ex.includes('website')) graph.push({ '@type': 'WebSite', '@id': `${ORIGIN}/#site`, url: `${ORIGIN}/`, name: 'LeaseRun', inLanguage: 'de-DE', publisher: { '@id': `${ORIGIN}/#org` }, potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${ORIGIN}/suche?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } });
    if (ex.includes('app')) graph.push(APP);
    if (ex.includes('tool')) graph.push({ '@type': 'WebApplication', '@id': `${url}#tool`, name: p.title.replace(/ \| LeaseRun$/, ''), url, description: p.desc, applicationCategory: 'FinanceApplication', operatingSystem: 'Web', inLanguage: 'de-DE', isAccessibleForFree: p.path === '/calculators/closing-costs', offers: p.path === '/calculators/closing-costs' ? { '@type': 'Offer', price: '0', priceCurrency: 'EUR' } : { '@type': 'Offer', url: `${ORIGIN}/angebote`, priceCurrency: 'EUR' }, publisher: { '@id': `${ORIGIN}/#org` } });
    if (ex.includes('tool') && p.path !== '/calculators/closing-costs') graph.push(gatedPage(p, url, ['.route-hero', '.lr-gate-box', '.calc-pages .formula', '.calc-pages .form-note']));
    if (ex.includes('howto')) graph.push(HOWTO);
    if (ex.includes('faq')) graph.push(faqLd());
    if (ex.includes('homefaq')) graph.push(homeFaqLd(html));
    if (ex.includes('pagefaq')) { const qs = [...html.matchAll(/<h3 class="faq-q">(.*?)<\/h3><p[^>]*>(.*?)<\/p>/g)]; const txt = (x) => x.replace(/<button[\s\S]*?<\/button>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); if (qs.length) graph.push({ '@type': 'FAQPage', mainEntity: qs.map((m) => ({ '@type': 'Question', name: txt(m[1]), acceptedAnswer: { '@type': 'Answer', text: txt(m[2]) } })) }); }
    if (ex.includes('glossar')) graph.push(glossarLd());
    if (p.rg?.article) graph.push({ '@type': 'Article', '@id': `${url}#article`, headline: p.rg.article.headline, description: p.desc, inLanguage: 'de-DE', datePublished: p.rg.article.datePublished, dateModified: p.rg.article.dateModified, author: { '@id': `${ORIGIN}/#org` }, publisher: { '@id': `${ORIGIN}/#org` }, mainEntityOfPage: url, image: ogImg });
    if (p.rg?.faqs?.length) graph.push({ '@type': 'FAQPage', mainEntity: p.rg.faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) });
    if (p.faqItem) graph.push({ ...gatedPage(p, url, ['.route-hero', '.lr-gate-box', '.wq-kurz', '.wq-teaser', '.wq-hook'], 'Article'), headline: p.faqItem.question, abstract: p.faqItem.teaser || p.desc, author: { '@id': `${ORIGIN}/#org` }, mainEntityOfPage: url, image: ogImg });
    if (p.path === '/learn') graph.push(gatedPage(p, url, ['.route-hero', '.lr-gate-box', '.wp-nav', '.route-q', '.wq-teaser', '.wq-hook'], 'CollectionPage'));
    if (p.path === '/sample-loan-package') graph.push(gatedPage(p, url, ['.route-hero', '.lr-gate-box', '.ex-grid', '.metrics-grid', '.report .route-accordion > article:first-child']));
    const bc = breadcrumb(p);
    if (bc) graph.push(bc);
    lines.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`);
  }
  return `<!--seo:start-->${lines.join('')}<!--seo:end-->`;
}

const template = read('calculators/index.html').replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '');
const results = [];
// Rechner-Unterseiten: eigenes WebApplication-Markup je Rechner.
for (const p of PAGES) if (p.path.startsWith('/calculators/')) p.extra = [...(p.extra || []), 'tool'];
// Suchmaschinen kürzen Titel ab ca. 60 Zeichen: lange Titel ohne Markenzusatz, Beschreibungen auf 160 Zeichen begrenzt.
for (const p of PAGES) {
  if (p.title.length > 62) p.title = p.title.replace(/ \| LeaseRun$/, '');
  if (p.desc.length > 160) throw new Error(`Beschreibung zu lang (${p.desc.length}): ${p.path}`);
}
const KURZ = new Map(JSON.parse(readFileSync(new URL('../lib/wissen/details.json', import.meta.url), 'utf8')).map((d) => [d.q, d]));
for (const p of PAGES) {
  if (p.skip) { results.push(p); continue; } // Next.js-Seite: Metadaten in app/layout.tsx
  const file = p.file || `${p.path.slice(1)}/index.html`;
  let html = existsSync(new URL(file, pub)) ? read(file) : p.template ? read(p.template).replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '').replace(/<!--pre:start-->[\s\S]*?<!--pre:end-->/, '') : template;
  html = html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`);
  if (!html.includes(`<title>${esc(p.title)}</title>`)) throw new Error(`Kein <title> in ${file}`);
  // vorhandene Einzelangaben ersetzen statt doppeln
  html = html.replace(/<meta name="description"[^>]*>/g, '');
  // Wissen: „Kurz gesagt“ (öffentliche Kurzantwort) steht fest im HTML – Google und Besucher ohne Zugang sehen sie sofort.
  // Rechenweg, Rechtsgrundlage und Bankpraxis bleiben im bezahlten Teil (.wq-detail). Idempotent: alte Fassung wird ersetzt.
  if (p.faqItem) {
    const d = KURZ.get(p.faqItem.question);
    html = html.replace(/<div class="callout wq-kurz"[\s\S]*?<!--\/kurz-->/, '');
    if (d && d.l1) html = html.replace('<div class="wq-detail"', `<div class="callout wq-kurz"><strong>Kurz gesagt</strong><p>${esc(d.l1)}</p>${d.next ? `<p class="wq-next"><strong>Nächster Schritt:</strong> ${esc(d.next)}</p>` : ''}</div><!--/kurz--><div class="wq-detail"`);
  }
  html = html.replace(`<title>${esc(p.title)}</title>`, `<title>${esc(p.title)}</title>${headBlock(p, html)}`);
  write(file, html);
  results.push(p);
}

// Sitemap und robots.txt (interne Bereiche bewusst nicht genannt – sie sind per X-Robots-Tag noindex, so verrät robots.txt keine Pfade)
const indexable = results.filter((p) => !p.noindex);
// Letzte inhaltliche Änderung je Seite. Verglichen wird ein Hash aus Titel, Beschreibung und Hauptinhalt (<main>),
// ohne ?v=-Marken, Kopf- und Fußzeile – so ändert ein Deploy oder eine neue Menüzeile nicht jedes Datum.
// Gespeichert in scripts/seo-lastmod.json (mit einchecken). Neue oder geänderte Seiten bekommen das heutige Datum.
const LM_FILE = new URL('./seo-lastmod.json', import.meta.url);
const lmStore = existsSync(LM_FILE) ? JSON.parse(readFileSync(LM_FILE, 'utf8')) : {};
const gitDate = (rel) => { try { const d = execSync(`git log -1 --format=%cs -- "${rel}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; } catch { return null; } };
const contentHash = (p) => {
  const h = createHash('sha256').update(`${p.title}\n${p.desc}\n`);
  if (p.skip) { // Next.js-Seite: Quelltext der Seite
    const src = new URL(`../app${p.path}/page.tsx`, import.meta.url);
    h.update(existsSync(src) ? readFileSync(src, 'utf8') : p.path);
  } else {
    const html = read(p.file || `${p.path.slice(1)}/index.html`).replace(/\?v=[a-z0-9]+/g, '');
    const m = /<main[\s>][\s\S]*<\/main>/.exec(html);
    h.update(m ? m[0] : html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, ''));
  }
  return h.digest('hex').slice(0, 16);
};
const lastmod = (p) => {
  const hash = contentHash(p), prev = lmStore[p.path];
  if (prev && prev.h === hash) return prev.d;
  // Erster Lauf ohne Eintrag: bisheriges Git-Datum übernehmen, sonst heute.
  const d = prev ? today : (gitDate(p.skip ? `app${p.path}/page.tsx` : `public/${p.file || (p.path === '/' ? 'index.html' : `${p.path.slice(1)}/index.html`)}`) || today);
  lmStore[p.path] = { h: hash, d };
  return d;
};
const prio = (p) => (p.path === '/' ? '1.0' : p.path.split('/').length > 3 ? '0.6' : ['/legal-notice', '/privacy', '/terms', '/cancel', '/refund'].includes(p.path) ? '0.3' : '0.8');
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${ORIGIN}${p.path === '/' ? '/' : p.path}</loc><lastmod>${lastmod(p)}</lastmod><priority>${prio(p)}</priority></url>`).join('\n')}\n</urlset>\n`);
writeFileSync(LM_FILE, JSON.stringify(Object.fromEntries(Object.entries(lmStore).filter(([k]) => indexable.some((p) => p.path === k)).sort()), null, 1) + '\n');
write('robots.txt',`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /auth/\nDisallow: /datenraum\nDisallow: /pruefen\nDisallow: /verify/\nDisallow: /p/\nDisallow: /partner\nDisallow: /b2b-portal\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
console.log(`SEO: ${results.length} Seiten, ${indexable.length} in der Sitemap`);
