// SEO-Build für die statischen Seiten in public/:
// Titel, Beschreibung, Canonical, Robots, Open Graph, Twitter, JSON-LD (Organization, WebSite, WebApplication,
// FAQPage, HowTo, BreadcrumbList), Kaufnebenkosten-Seiten je Bundesland, sitemap.xml und robots.txt.
// Idempotent: ersetzt nur <title> und den Block zwischen <!--seo:start--> und <!--seo:end-->; vorgerenderter Inhalt bleibt.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { GREST } from '../public/src/calc.mjs';

const ORIGIN = 'https://immoadv.de';
const pub = new URL('../public/', import.meta.url);
const read = (p) => readFileSync(new URL(p, pub), 'utf8');
const write = (p, s) => { const u = new URL(p, pub); mkdirSync(new URL('.', u), { recursive: true }); writeFileSync(u, s); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const today = new Date().toISOString().slice(0, 10);

const ORG = {
  '@type': 'Organization', '@id': `${ORIGIN}/#org`, name: 'ImmoAdv', url: `${ORIGIN}/`,
  logo: `${ORIGIN}/brand/immoadv-icon.svg`, email: 'support@immoadv.de',
  address: { '@type': 'PostalAddress', streetAddress: 'Georg-August-Zinn-Str. 25', postalCode: '64354', addressLocality: 'Reinheim', addressCountry: 'DE' },
};
const APP = {
  '@type': 'WebApplication', '@id': `${ORIGIN}/#app`, name: 'ImmoAdv', url: `${ORIGIN}/`, applicationCategory: 'FinanceApplication',
  operatingSystem: 'Web', inLanguage: 'de-DE', publisher: { '@id': `${ORIGIN}/#org` },
  description: 'Technisches Analysewerkzeug für Kapitalanleger: Cashflow, DSCR, Stresstest, Fristen und Kreditmappe. Keine Finanzierungs-, Rechts- oder Steuerberatung.',
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR', description: 'Analyse kostenfrei' },
};

// Seitenliste: Pfad, Datei, Titel, Beschreibung, Brotkrumen, Indexierung, Zusatz-JSON-LD.
const PAGES = [
  { path: '/', file: 'index.html', title: 'In 5 Minuten wissen, ob sich Ihre Immobilie rechnet | ImmoAdv', desc: 'Kostenloser Schnellrechner für Kapitalanlage und Eigenheim: Rendite, Cashflow, Rate, Stresstest – plus bankfertige Kreditmappe. Unabhängig, ohne Provision.', crumbs: [], extra: ['website', 'app', 'howto'] },
  { path: '/wissen', title: `Immobilien und Geld verständlich erklärt – ${((f) => (Array.isArray(f) ? f : f.entries).length)(JSON.parse(readFileSync(new URL('../public/data/faq.json', import.meta.url), 'utf8')))} Antworten | ImmoAdv`, desc: 'Wissen in vier Phasen: Leistbarkeit, Objektprüfung, Steuern und Cashflow, Bankgespräch – verständlich erklärt, mit Formel und Rechtsgrundlage.', crumbs: ['Wissen'], extra: ['faq'] },
  { path: '/cockpit', file: null, skip: true, title: '', desc: '' },
  { path: '/suche', file: 'suche/index.html', template: 'wissen/index.html', title: 'Suche | ImmoAdv', noindex: true, desc: 'Rechner, Antworten und Fachbegriffe rund um Immobilienkauf und Finanzierung durchsuchen.', crumbs: ['Suche'] },
  { path: '/wissen/erwerbsstatus', file: 'wissen/erwerbsstatus/index.html', title: 'Immobilienfinanzierung nach Erwerbsstatus: Angestellt, Beamter, Selbstständig | ImmoAdv', desc: 'Was Banken bei Angestellten, Befristeten, Beamten, Selbstständigen, Berufseinsteigern und Rentnern prüfen – mit typischen Unterlagen je Gruppe.', crumbs: ['Wissen', 'Erwerbsstatus'] },
  { path: '/wissen/glossar', title: 'Glossar Immobilienfinanzierung: Begriffe von A bis Z | ImmoAdv', desc: 'Annuität, Beleihungswert, Zinsbindung, Kappungsgrenze, Grundschuld und mehr: die wichtigsten Begriffe zu Kauf, Finanzierung, Miete und Steuer kurz erklärt.', crumbs: ['Wissen', 'Glossar'], extra: ['glossar'] },
  { path: '/start', title: 'Meine erste Immobilie durchrechnen – in drei Schritten | ImmoAdv', desc: 'Kaufpreis, Miete, Eigenkapital: Rate, Tilgungshebel, Cashflow, Notgroschen und das Bild nach zehn Jahren – mit Erklärungen aller Fachbegriffe.', crumbs: ['Meine erste Immobilie'], extra: ['app'] },
  { path: '/rechner', title: 'Mietrecht- und Steuerrechner: Mietpreisbremse, AfA, Indexmiete | ImmoAdv', desc: 'Mietpreisbremse, Kappungsgrenze, Index- und Staffelmiete, AfA linear und degressiv, Kaufpreisaufteilung und 15-%-Grenze – mit offengelegter Formel.', crumbs: ['Rechner'], extra: ['app'] },
  { path: '/fristen', title: 'Fristen nach dem Immobilienkauf berechnen | ImmoAdv', desc: 'Spekulationsfrist (§ 23 EStG), 15-%-Grenze, Zinsbindung, Kündigungsrecht nach § 489 BGB und Mieterhöhung – als Liste und Kalenderdatei.', crumbs: ['Fristen'], extra: ['app'] },
  { path: '/szenarien', title: 'Anschlussfinanzierung und Verkauf durchrechnen | ImmoAdv', desc: 'Restschuld, neue Rate und Kipp-Punkt nach der Zinsbindung; Verkaufsszenario mit Veräußerungsgewinn und Spekulationsfrist.', crumbs: ['Szenarien'], extra: ['app'] },
  { path: '/rechner/afa', file: 'rechner/afa/index.html', title: 'AfA-Rechner Immobilie: linear, degressiv und Sonder-AfA § 7b | ImmoAdv', desc: 'Gebäude-AfA berechnen: 2 %, 2,5 % oder 3 % linear, 5 % degressiv (§ 7 Abs. 5a EStG) und Sonder-AfA nach § 7b – Jahr für Jahr mit Restwert.', crumbs: ['Rechner', 'AfA'] },
  { path: '/rechner/mieterhoehung', file: 'rechner/mieterhoehung/index.html', title: 'Mieterhöhung berechnen: Kappungsgrenze, Vergleichsmiete, Brief | ImmoAdv', desc: 'Zulässige Mieterhöhung nach § 558 BGB: Kappungsgrenze 20 % oder 15 %, ortsübliche Vergleichsmiete, Wirksamkeit nach § 558b und ein Briefentwurf zum Anpassen.', crumbs: ['Rechner', 'Mieterhöhung'] },
  { path: '/rechner/cashflow', file: 'rechner/cashflow/index.html', title: 'Cashflow-Rechner Immobilie: vor und nach Steuern | ImmoAdv', desc: 'Cashflow einer vermieteten Immobilie vor und nach Steuern: Miete, nicht umlagefähige Kosten, Zinsen, Tilgung, AfA, Steuersatz – mit 10-Jahres-Verlauf.', crumbs: ['Rechner', 'Cashflow'] },
  { path: '/rechner/vergleich', file: 'rechner/vergleich/index.html', title: 'Immobilienangebote vergleichen: Rendite, Faktor, Cashflow | ImmoAdv', desc: 'Bis zu drei Wohnungen oder Häuser nebeneinander vergleichen: Kaufnebenkosten, Rate, Cashflow, Brutto- und Nettomietrendite, Kaufpreisfaktor und Preis pro m².', crumbs: ['Rechner', 'Angebotsvergleich'] },
  { path: '/rechner/kaufen-mieten', file: 'rechner/kaufen-mieten/index.html', title: 'Kaufen oder mieten? Vermögensvergleich über 25 Jahre | ImmoAdv', desc: 'Eigentum mit Kredit gegen Miete plus angelegtes Eigenkapital: Vermögen nach 5, 10 und 25 Jahren mit eigenen Annahmen zu Miete, Wert und Rendite.', crumbs: ['Rechner', 'Kaufen oder mieten'] },
  { path: '/rechner/scorecard', file: 'rechner/scorecard/index.html', title: 'Deal-Scorecard: Haushalt, Eigenkapital und Objekt prüfen | ImmoAdv', desc: 'Ampel für Ihr Immobilienvorhaben: Haushalt nach Rate, Eigenkapital inkl. Nebenkosten und Reserve, Rendite, Instandhaltung und Mietpreisbremse.', crumbs: ['Rechner', 'Deal-Scorecard'] },
  { path: '/rechner/budget', file: 'rechner/budget/index.html', title: 'Budget-Rechner: Wie viel Immobilie kann ich mir leisten? | ImmoAdv', desc: 'Aus Einkommen, Ausgaben und Eigenkapital zur tragbaren Rate, zum Darlehen und zum Kaufpreis inkl. Nebenkosten je Bundesland – auch für Kapitalanleger.', crumbs: ['Rechner', 'Budget'] },
  { path: '/rechner/tilgungsplan', file: 'rechner/tilgungsplan/index.html', title: 'Tilgungsplan mit Sondertilgung berechnen | ImmoAdv', desc: 'Tilgungsplan für Ihr Annuitätendarlehen: Zinsen, Tilgung und Restschuld je Jahr, Restschuld nach Zinsbindung, Sondertilgung und CSV-Export.', crumbs: ['Rechner', 'Tilgungsplan'] },
  { path: '/rechner/kaufnebenkosten', file: 'rechner/kaufnebenkosten/index.html', title: 'Kaufnebenkosten nach Bundesland 2026 | ImmoAdv', desc: 'Grunderwerbsteuer von 3,5 % bis 6,5 %: alle 16 Bundesländer im Vergleich, mit Rechner für Notar, Grundbuch und Makler.', crumbs: ['Rechner', 'Kaufnebenkosten'] },
  { path: '/checkliste', title: 'Unterlagen-Checkliste für die Baufinanzierung | ImmoAdv', desc: '21 Unterlagen, die Banken bei Kapitalanlegern typischerweise sehen wollen – gefiltert nach Erwerbsstatus und Objektart, druckbar.', crumbs: ['Checkliste'] },
  { path: '/mustermappe', title: 'Beispiele: Muster-Kreditmappe und Objekt-Analyse | ImmoAdv', desc: 'Fiktive Beispiele als PDF: Kreditmappe mit Finanzierung, Haushaltsrechnung und Stresstest sowie Objekt-Analyse mit Rendite und Cashflow.', crumbs: ['Beispiele'] },
  { path: '/pro-begleiter', title: '12-Monats-Programm für Kapitalanleger | ImmoAdv', desc: 'Vom Kassensturz bis zum verwalteten Bestand: ein Thema pro Monat mit Aufgaben, Werkzeug und Gesetzestext zum Nachlesen.', crumbs: ['Pro-Begleiter'] },
  { path: '/profiler', title: 'Investor-Profiler: Welche Strategie passt zu Ihnen? | ImmoAdv', desc: 'Sechs Fragen zu Eigenkapital, Cashflow, Steuer und Horizont – mit den Kennzahlen, auf die Sie besonders achten sollten.', crumbs: ['Investor-Profiler'] },
  { path: '/angebote', title: 'Preise und Angebote | ImmoAdv', desc: 'Alle Rechner kostenlos. BankReady Kreditmappe 39 € einmalig, Käufer-Pass 49 € für 90 Tage (kein Abo), Investor Pro 29 €/Monat – Endpreise inkl. USt.', crumbs: ['Angebote'] },
  { path: '/sicherheit', title: 'Sicherheit und Datenschutz | ImmoAdv', desc: 'Speicherung in Frankfurt, Prüfsummen, befristete Freigabelinks und Zugriffsprotokoll – und was noch geplant ist.', crumbs: ['Sicherheit'] },
  { path: '/impressum', title: 'Impressum | ImmoAdv', desc: 'Anbieterkennzeichnung nach § 5 DDG.', crumbs: ['Impressum'] },
  { path: '/datenschutz', title: 'Datenschutzerklärung | ImmoAdv', desc: 'Welche Daten ImmoAdv verarbeitet, wo sie gespeichert werden und welche Rechte Sie haben.', crumbs: ['Datenschutz'] },
  { path: '/nutzungsbedingungen', title: 'Nutzungsbedingungen und Widerrufsbelehrung | ImmoAdv', desc: 'Nutzungsbedingungen, Preise, Laufzeit, Kündigung und Widerrufsbelehrung von ImmoAdv.', crumbs: ['Nutzungsbedingungen'] },
  { path: '/kuendigen', title: 'Verträge hier kündigen | ImmoAdv', desc: 'Abo (Einsteiger oder Profi) ohne Anmeldung kündigen – nach § 312k BGB, mit Eingangsbestätigung per E-Mail.', crumbs: ['Verträge kündigen'] },
  // Nicht indexieren: persönliche oder tokengebundene Seiten
  { path: '/datenraum', title: 'Datenraum | ImmoAdv', desc: 'Freigegebene Unterlagen.', noindex: true },
  { path: '/pruefen', title: 'Kreditmappe prüfen | ImmoAdv', desc: 'Echtheitsprüfung einer ImmoAdv-Kreditmappe.', noindex: true },
  { path: '/b2b', title: 'Für Makler, Vermittler und Banken: Tarife | ImmoAdv', desc: 'Kreditmappen nach banküblichen Prüfkriterien, Website-Widget, Exposé-QR und Anfragen-Pipeline für Makler, Vermittler und Banken. Ab 59 € netto im Monat.', crumbs: ['Für Unternehmen'] },
  { path: '/partner', title: 'Partner | ImmoAdv', desc: 'Partnerseite.', noindex: true },
  { path: '/app/dashboard', file: 'auth-login.html', title: 'Konto | ImmoAdv', desc: 'Ihr ImmoAdv-Konto.', noindex: true, noCanonical: true },
  { path: '/offline', file: 'offline.html', title: 'Offline | ImmoAdv', desc: 'Keine Verbindung.', noindex: true, noCanonical: true },
];
for (const [slug, g] of Object.entries(GREST)) {
  PAGES.push({
    path: `/rechner/kaufnebenkosten/${slug}`, file: `rechner/kaufnebenkosten/${slug}/index.html`,
    title: `Kaufnebenkosten ${g.name} 2026: Grunderwerbsteuer ${String(g.pct).replace('.', ',')} % | ImmoAdv`,
    desc: `Kaufnebenkosten in ${g.name} berechnen: Grunderwerbsteuer ${String(g.pct).replace('.', ',')} %, Notar, Grundbuch und Makler – mit eigenem Kaufpreis. Stand Oktober 2026.`,
    crumbs: ['Rechner', 'Kaufnebenkosten', g.name],
  });
}


// Eine Seite je Wissensfrage (gleiche Slug-Regel wie SLUG in public/src/routes.js).
export const slugify = (q) => { let t = q.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); if (t.length > 70) { t = t.slice(0, 70); t = t.slice(0, t.lastIndexOf('-') > 30 ? t.lastIndexOf('-') : 70); } return t; };
{
  const faq = JSON.parse(read('data/faq.json'));
  for (const q of Array.isArray(faq) ? faq : faq.entries) {
    const slug = slugify(q.question);
    const desc = q.level1.length > 155 ? q.level1.slice(0, q.level1.lastIndexOf(' ', 152)) + ' …' : q.level1;
    PAGES.push({ path: `/wissen/${slug}`, file: `wissen/${slug}/index.html`, template: 'wissen/index.html', title: `${q.question} | ImmoAdv`, desc, crumbs: ['Wissen', q.question], faqItem: q });
  }
}
const CRUMB_PATH = { Rechner: '/rechner', Kaufnebenkosten: '/rechner/kaufnebenkosten', Wissen: '/wissen' };
function breadcrumb(p) {
  if (!p.crumbs?.length) return null;
  const items = [{ name: 'Start', item: `${ORIGIN}/` }];
  p.crumbs.forEach((c, i) => items.push({ name: c, item: i === p.crumbs.length - 1 ? `${ORIGIN}${p.path}` : `${ORIGIN}${CRUMB_PATH[c] || p.path}` }));
  return { '@type': 'BreadcrumbList', itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: x.item })) };
}
function faqLd() {
  const faq = JSON.parse(read('data/faq.json'));
  const list = Array.isArray(faq) ? faq : faq.entries;
  return { '@type': 'FAQPage', mainEntity: list.map((q) => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: `${q.level1} ${q.level2}`.trim() } })) };
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
    `<meta name="robots" content="${p.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}">`,
  ];
  if (!p.noCanonical) lines.push(`<link rel="canonical" href="${url}">`);
  if (!p.noindex) {
    lines.push(
      '<meta property="og:type" content="website">', '<meta property="og:site_name" content="ImmoAdv">', '<meta property="og:locale" content="de_DE">',
      `<meta property="og:title" content="${esc(p.title)}">`, `<meta property="og:description" content="${esc(p.desc)}">`, `<meta property="og:url" content="${url}">`,
      `<meta property="og:image" content="${ogImg}">`, '<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">',
      `<meta property="og:image:alt" content="${ogImg.includes('/og/') ? esc(p.title.replace(' | ImmoAdv', '')) : 'ImmoAdv – Immobilie als Kapitalanlage durchrechnen'}">`,
      '<meta name="twitter:card" content="summary_large_image">', `<meta name="twitter:title" content="${esc(p.title)}">`,
      `<meta name="twitter:description" content="${esc(p.desc)}">`, `<meta name="twitter:image" content="${ogImg}">`,
    );
    const graph = [ORG];
    const ex = p.extra || [];
    if (ex.includes('website')) graph.push({ '@type': 'WebSite', '@id': `${ORIGIN}/#site`, url: `${ORIGIN}/`, name: 'ImmoAdv', inLanguage: 'de-DE', publisher: { '@id': `${ORIGIN}/#org` }, potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${ORIGIN}/suche?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } });
    if (ex.includes('app')) graph.push(APP);
    if (ex.includes('howto')) graph.push(HOWTO);
    if (ex.includes('faq')) graph.push(faqLd());
    if (ex.includes('homefaq')) graph.push(homeFaqLd(html));
    if (ex.includes('glossar')) graph.push(glossarLd());
    if (p.faqItem) graph.push({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: p.faqItem.question, acceptedAnswer: { '@type': 'Answer', text: `${p.faqItem.level1} ${p.faqItem.level2}`.trim() } }] });
    const bc = breadcrumb(p);
    if (bc) graph.push(bc);
    lines.push(`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`);
  }
  return `<!--seo:start-->${lines.join('')}<!--seo:end-->`;
}

const template = read('rechner/index.html').replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '');
const results = [];
// Suchmaschinen kürzen Titel ab ca. 60 Zeichen: lange Titel ohne Markenzusatz, Beschreibungen auf 160 Zeichen begrenzt.
for (const p of PAGES) {
  if (p.title.length > 62) p.title = p.title.replace(/ \| ImmoAdv$/, '');
  if (p.desc.length > 160) throw new Error(`Beschreibung zu lang (${p.desc.length}): ${p.path}`);
}
for (const p of PAGES) {
  if (p.skip) { results.push(p); continue; } // Next.js-Seite: Metadaten in app/layout.tsx
  const file = p.file || `${p.path.slice(1)}/index.html`;
  let html = existsSync(new URL(file, pub)) ? read(file) : p.template ? read(p.template).replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '').replace(/<!--pre:start-->[\s\S]*?<!--pre:end-->/, '') : template;
  html = html.replace(/<!--seo:start-->[\s\S]*?<!--seo:end-->/, '');
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`);
  if (!html.includes(`<title>${esc(p.title)}</title>`)) throw new Error(`Kein <title> in ${file}`);
  // vorhandene Einzelangaben ersetzen statt doppeln
  html = html.replace(/<meta name="description"[^>]*>/g, '');
  html = html.replace(`<title>${esc(p.title)}</title>`, `<title>${esc(p.title)}</title>${headBlock(p, html)}`);
  write(file, html);
  results.push(p);
}

// Sitemap und robots.txt
const indexable = results.filter((p) => !p.noindex);
// Letzte inhaltliche Änderung je Seite aus der Git-Historie (Fallback: heute).
const lastmod = (p) => {
  const file = p.file || (p.path === '/' ? 'index.html' : `${p.path.slice(1)}/index.html`);
  try { const d = execSync(`git log -1 --format=%cs -- "public/${file}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today; } catch { return today; }
};
const prio = (p) => (p.path === '/' ? '1.0' : p.path.split('/').length > 3 ? '0.6' : ['/impressum', '/datenschutz', '/nutzungsbedingungen', '/kuendigen'].includes(p.path) ? '0.3' : '0.8');
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((p) => `  <url><loc>${ORIGIN}${p.path === '/' ? '/' : p.path}</loc><lastmod>${lastmod(p)}</lastmod><priority>${prio(p)}</priority></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /auth/\nDisallow: /datenraum\nDisallow: /pruefen\nDisallow: /verify/\nDisallow: /p/\nDisallow: /partner\nDisallow: /intern\nDisallow: /b2b-portal\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
console.log(`SEO: ${results.length} Seiten, ${indexable.length} in der Sitemap`);
