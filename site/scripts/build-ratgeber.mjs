// Ratgeber-Engine: erzeugt aus der Content-Registry (content/ratgeber) statische, vollständig vorgerenderte Seiten
//   /guides                         Übersicht (Suche zuerst, wenige beliebte Themen, kompakte Gliederung)
//   /guides/{slug}                  ein Artikel je echter Suchintention, mit Bank-Chancen-Checker
//   /calculators/approval-odds     der Checker als eigenes Werkzeug
// Kopf- und Fußzeile, Schriften und Styles stammen aus einer bestehenden Rechner-Seite (gleiches Design wie überall).
// Jede Seite durchläuft das Quality Gate (scripts/ratgeber-gate.mjs); das Ergebnis steht in content/ratgeber/gate-report.json
// und steuert in build-seo.mjs Indexierung und Sitemap. Läuft vor bundle-css (prebuild), damit die Styles erfasst werden.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { TOPICS, CONSOLIDATED, GROUPS } from '../content/ratgeber/index.mjs';
import { ASSUMPTIONS, val } from '../public/src/finanz-config.mjs';
import { GREST, bankChance, nettoFuerDarlehen, monthlyRate, balanceAfterMonths, tilgungsplan, kaufnebenkosten, lebenshaltungModell } from '../public/src/calc.mjs';
import { renderForm, renderResult, euro } from '../public/src/bcc-view.mjs';
import { evaluate } from './ratgeber-gate.mjs';

const pub = new URL('../public/', import.meta.url);
const read = (p) => readFileSync(new URL(p, pub), 'utf8');
const write = (p, s) => { const u = new URL(p, pub); mkdirSync(new URL('.', u), { recursive: true }); writeFileSync(u, s); };
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pc = (n, d = 2) => `${(Math.round(n * 10 ** d) / 10 ** d).toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: d })}\u00a0%`;
const deDate = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
// Fester Rechentag für das Vorab-Ergebnis: das Prüfdatum der Inhalte (nicht künstlich „heute“); im Browser steht das echte Datum.
const BUILD_DATE = new Date('2026-10-26T12:00:00Z');

// ---------- Vorlage aus einer bestehenden Seite ----------
const tpl = read('calculators/budget/index.html');
const headAssets = (/<!--seo:end-->([\s\S]*?)<\/head>/.exec(tpl) || [])[1];
const header = (/<!--pre:start-->([\s\S]*?)<main/.exec(tpl) || [])[1];
const footer = (/<\/main>([\s\S]*?)<!--pre:end-->/.exec(tpl) || [])[1];
if (!headAssets || !header || !footer) throw new Error('Vorlage rechner/budget/index.html: Kopf/Fuß nicht gefunden');
const SCRIPTS = ['app.js', 'menu.js', 'klapp.js', 'hinweis.js'].map((s) => `<script src="/src/${s}" defer></script>`).join('') + '<script type="module" src="/src/ratgeber.mjs"></script>';

function page({ title, hero, kicker = 'Ratgeber', meta = '', body }) {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(title)}</title>${headAssets}</head><body>${header}<main id="inhalt" tabindex="-1"><section class="route-hero"><div class="container rg-wrap"><span class="kicker">${esc(kicker)}</span><h1>${esc(hero)}</h1>${meta ? `<p class="rg-meta">${meta}</p>` : ''}</div></section><section class="section"><div class="container rg-wrap calc-pages">${body}</div></section></main>${footer}${SCRIPTS}</body></html>\n`;
}
const crumbs = (items) => `<nav class="crumbs" aria-label="Brotkrumen"><a href="/">Start</a>${items.map(([t, u]) => ` › ${u ? `<a href="${u}">${esc(t)}</a>` : `<span>${esc(t)}</span>`}`).join('')}</nav>`;

// ---------- Platzhalter: Werte aus der zentralen Konfiguration, berechnete Tabellen ----------
const Z = val('zins_modell'), T = val('tilgung_modell'), OK = val('objektkosten_modell');
const zinsStufen = [Z - 1, Z, Z + 1].map((x) => Math.round(x * 100) / 100);
const HH = [['Single', 1, 0], ['Paar', 2, 0], ['Paar, 1 Kind', 2, 1], ['Paar, 2 Kinder', 2, 2]];
const table = (head, rows, caption) => `<div class="rg-scroll"><table class="rg-table">${caption ? `<caption class="rg-note" style="caption-side:bottom;text-align:left;padding-top:6px">${caption}</caption>` : ''}<thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>`;
const annahmen = (extra = '') => `Modellrechnung: ${pc(T)} anfängliche Tilgung, laufende Objektkosten ${euro(OK)} pro Monat, Lebenshaltung nach LeaseRun-Modell, keine weiteren Raten${extra}. Keine Bankvorgabe.`;

const TABLES = {
  // Benötigtes Haushaltsnetto je Haushaltstyp und Zinsstufe
  netto: (loan) => table(['Sollzins', 'Rate', ...HH.map((h) => h[0])],
    zinsStufen.map((z) => [pc(z), euro(monthlyRate(loan, z / 100, T / 100)), ...HH.map(([, a, k]) => euro(nettoFuerDarlehen({ loan, ratePct: z, repaymentPct: T, adults: a, children: k, propertyCosts: OK })))]),
    annahmen()),
  // Monatsrate je Zins und Tilgung, dazu Restschuld nach 10 Jahren und Laufzeit
  rate: (loan) => table(['Sollzins', 'Tilgung 1 %', 'Tilgung 2 %', 'Tilgung 3 %', 'Restschuld nach 10 J. (2 %)', 'Laufzeit (2 %)'],
    [Z - 1, Z - 0.5, Z, Z + 0.5, Z + 1].map((z) => { const p = tilgungsplan({ loan, ratePa: z / 100, repaymentPa: 0.02, fixedYears: 10 }); return [pc(z), ...[1, 2, 3].map((t) => euro(monthlyRate(loan, z / 100, t / 100))), euro(p.restAtFixed), p.months ? `${Math.ceil(p.months / 12)} Jahre` : '–']; }),
    'Annuitätendarlehen, gleichbleibender Zins über die gesamte Laufzeit angenommen (Modell).'),
  // Kaufnebenkosten je Bundesland für einen Kaufpreis
  laender: (price) => table(['Bundesland', 'Grunderwerbsteuer', 'Nebenkosten ohne Makler', `mit Makler (${pc(val('makler_pct'))})`],
    Object.keys(GREST).map((k) => { const a = kaufnebenkosten({ price, land: k }), b = kaufnebenkosten({ price, land: k, brokerPct: val('makler_pct') }); return [GREST[k].name, pc(GREST[k].pct, 1), euro(a.total), euro(b.total)]; }),
    `Kaufpreis ${euro(price)}; Notar ${pc(val('notar_pct'))} und Grundbuch ${pc(val('grundbuch_pct'))} als Richtwerte. Grunderwerbsteuer: Stand Oktober 2026.`),
  // Tilgungshöhe: Rate, Laufzeit, Zinskosten
  tilgung: (loan) => table(['Anfängliche Tilgung', 'Rate', 'Restschuld nach 10 J.', 'Laufzeit bis schuldenfrei', 'Zinsen gesamt'],
    [1, 1.5, 2, 3, 4].map((t) => { const p = tilgungsplan({ loan, ratePa: Z / 100, repaymentPa: t / 100, fixedYears: 10, maxYears: 80 }); return [pc(t, 1), euro(p.monthly), euro(p.restAtFixed), p.months ? `${Math.ceil(p.months / 12)} Jahre` : 'über 80 Jahre', euro(p.totalInterest)]; }),
    `Darlehen ${euro(loan)}, Sollzins ${pc(Z)} über die gesamte Laufzeit (Modell; nach der Zinsbindung gilt ein neuer Zins).`),
  // Beleihungsauslauf: Darlehen im Verhältnis zum Wert
  ltv: (value) => table(['Darlehen', 'Anteil am Beleihungswert', 'Eigenmittel-Einsatz', 'Rate (Modellzins)'],
    [0.6, 0.8, 0.9, 1.0, 1.1].map((q) => [euro(value * q), pc(q * 100, 0), euro(Math.max(0, value - value * q)), euro(monthlyRate(value * q, Z / 100, T / 100))]),
    `Beleihungswert hier vereinfacht ${euro(value)}. In der Praxis setzt die Bank den Beleihungswert meist unter dem Kaufpreis an.`),
  // Lebenshaltung im Modell und benötigtes Netto mit Kindern
  kinder: (loan) => table(['Haushalt', 'Lebenshaltung (Modell)', 'Benötigtes Netto', 'davon Kindergeld'],
    [['Paar', 2, 0], ['Paar, 1 Kind', 2, 1], ['Paar, 2 Kinder', 2, 2], ['Paar, 3 Kinder', 2, 3], ['Alleinerziehend, 1 Kind', 1, 1]].map(([n, a, k]) => [n, euro(lebenshaltungModell(a, k)), euro(nettoFuerDarlehen({ loan, ratePct: Z, repaymentPct: T, adults: a, children: k, propertyCosts: OK })), euro(k * val('kindergeld'))]),
    `Darlehen ${euro(loan)}. ${annahmen()} Kindergeld ${euro(val('kindergeld'))} je Kind (2026) zählt zum Haushaltsnetto.`),
  // Bestehende Raten senken das tragfähige Darlehen
  raten: (net) => table(['Bestehende Rate', 'Im Modell tragfähiges Darlehen', 'Weniger als ohne Rate'],
    [0, 150, 300, 450, 600].map((c) => { const m = bankChance({ netIncome: net, loan: 100000, adults: 2, children: 0, commitments: c, propertyCosts: OK }).maxLoan; const m0 = bankChance({ netIncome: net, loan: 100000, adults: 2, children: 0, propertyCosts: OK }).maxLoan; return [euro(c), euro(m), c ? `−${euro(m0 - m)}` : '–']; }),
    `Paar ohne Kinder, Haushaltsnetto ${euro(net)}, Sollzins ${pc(Z)}, Tilgung ${pc(T)}, Objektkosten ${euro(OK)} (Modell).`),
  // 90 / 100 / 110 % Finanzierung
  quote: (price) => { const nk = kaufnebenkosten({ price, land: 'hessen', brokerPct: val('makler_pct') }).total; return table(['Finanzierung', 'Darlehen', 'Eigenkapital nötig', 'Rate (Modellzins)', 'Restschuld nach 10 J.'],
    [['90 % des Kaufpreises', price * 0.9], ['100 % des Kaufpreises', price], ['110 % (inkl. Nebenkosten)', price + nk]].map(([n, l]) => [n, euro(l), euro(Math.max(0, price + nk - l)), euro(monthlyRate(l, Z / 100, T / 100)), euro(balanceAfterMonths(l, Z / 100, T / 100, 120))]),
    `Kaufpreis ${euro(price)} in Hessen, Nebenkosten inkl. Makler ${euro(nk)}; gleicher Modellzins ${pc(Z)} für alle Varianten – tatsächlich verlangen Banken bei höherem Darlehensanteil meist höhere Zinsen.`); },
};

function fill(html) {
  return html
    .replace(/\{\{wert:([a-z_]+)\}\}/g, (_, k) => { const a = ASSUMPTIONS[k]; if (!a) throw new Error(`Unbekannter Wert ${k}`); const v = Number(a.value).toLocaleString('de-DE'); return a.unit.startsWith('%') ? `${v}\u00a0%` : a.unit.startsWith('€') ? `${v}\u00a0€` : `${v}\u00a0${a.unit}`; })
    .replace(/\{\{euro:([a-z_]+)\}\}/g, (_, k) => euro(val(k)))
    .replace(/\{\{tabelle:([a-z]+)(?::(\d+))?\}\}/g, (_, t, n) => { if (!TABLES[t]) throw new Error(`Unbekannte Tabelle ${t}`); return TABLES[t](Number(n)); })
    .replace(/\{\{netto:(\d+):(\d):(\d)\}\}/g, (_, l, a, k) => euro(nettoFuerDarlehen({ loan: Number(l), ratePct: Z, repaymentPct: T, adults: Number(a), children: Number(k), propertyCosts: OK })))
    .replace(/\{\{rate:(\d+)(?::([\d.]+))?\}\}/g, (_, l, z) => euro(monthlyRate(Number(l), (z ? Number(z) : Z) / 100, T / 100)))
    .replace(/\{\{maxloan:(\d+):(\d):(\d)(?::(\d+))?\}\}/g, (_, net, a, k, c) => euro(bankChance({ netIncome: Number(net), loan: 1, adults: Number(a), children: Number(k), commitments: Number(c || 0), propertyCosts: OK }).maxLoan));
}

// ---------- Bausteine einer Artikelseite ----------
const bySlug = Object.fromEntries(TOPICS.map((t) => [t.slug, t]));
const LINKS = { // feste Ziele außerhalb des Ratgebers
  '/calculators/approval-odds': ['Bank-Chancen-Checker', 'Haushalt, Rate und Überschuss im Modell'],
  '/calculators/budget': ['Budget-Rechner', 'Vom Einkommen zum möglichen Kaufpreis'],
  '/calculators/amortization': ['Tilgungsplan', 'Restschuld Jahr für Jahr, mit Sondertilgung'],
  '/calculators/closing-costs': ['Kaufnebenkosten', 'Grunderwerbsteuer, Notar, Grundbuch je Bundesland'],
  '/checklist': ['Unterlagen-Checkliste', 'Was die Bank sehen will – nach Erwerbsstatus gefiltert'],
  '/learn/erwerbsstatus': ['Finanzierung nach Erwerbsstatus', 'Angestellt, befristet, Probezeit, selbstständig'],
  '/sample-loan-package': ['Muster-Kreditmappe', 'Beispiel einer bankfertigen Mappe als PDF'],
  '/auth/register?source=criteria_selbstauskunft': ['Haushaltsrechnung im Konto', 'Kostenlos: Finanzprofil und Selbstauskunft vorbereiten'],
};
const linkInfo = (u) => {
  if (u.startsWith('/guides/')) { const t = bySlug[u.slice(10)]; if (!t) throw new Error(`Verweis auf unbekannten Ratgeber ${u}`); return [t.short || t.h1, t.teaser]; }
  if (!LINKS[u]) throw new Error(`Unbekanntes Linkziel ${u}`); return LINKS[u];
};

function assumptionsBox(keys) {
  const TYPE = { modellannahme: 'Modellannahme', orientierungswert: 'Orientierungswert', veroeffentlichte_information: 'Veröffentlichte Information' };
  return `<article class="dash-card rg-body" id="annahmen"><h2>Annahmen und Datenstand</h2><dl class="rg-assume">${keys.map((k) => { const a = ASSUMPTIONS[k]; return `<dt>${esc(a.label)}: ${esc(Number(a.value).toLocaleString('de-DE'))} ${esc(a.unit)}</dt><dd>${TYPE[a.assumption_type]} · ${a.source_url ? `<a href="${esc(a.source_url)}" rel="noopener" target="_blank">${esc(a.source)}</a>` : esc(a.source)} · Stand ${deDate(a.verified_at)}</dd>`; }).join('')}</dl></article>`;
}

function article(t) {
  const sections = t.sections.map((s) => `<h2 id="${esc(s.id)}">${esc(s.h2)}</h2>${fill(s.html)}`).join('');
  const faqs = t.faqs.map((f) => `<h3>${esc(f.q)}</h3><p>${fill(f.a)}</p>`).join('');
  const checkerDefaults = { ...(t.checker || {}) };
  const ci = { ...checkerDefaults };
  const res = bankChance({ ...ci, propertyCosts: ci.propertyCosts ?? OK });
  const form = t.checker === false ? '' : renderForm(checkerDefaults, { id: 'a', slug: t.slug, heading: t.checkerHeading || 'Bank-Chancen-Checker: Ihre Zahlen im Modell', intro: t.checkerIntro || '' })
    .replace('{{result}}', renderResult(res, { ...ci, livingOverride: '' }, { slug: t.slug, date: BUILD_DATE }));
  const keys = [...new Set(['zins_modell', 'tilgung_modell', 'lebenshaltung_erste_person', 'lebenshaltung_weiterer_erwachsener', 'lebenshaltung_kind', 'objektkosten_modell', 'ueberschuss_gruen', ...(t.assumptions || [])])];
  const words = (t.lead + sections + faqs).replace(/<table[\s\S]*?<\/table>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  const body = `${crumbs([['Ratgeber', '/guides'], [t.short || t.h1]])}
<article class="dash-card rg-body"><div class="rg-answer">${fill(t.lead)}</div></article>
${form}
<article class="dash-card rg-body">${sections}</article>
<article class="dash-card rg-body" id="fragen"><h2>Häufige Fragen</h2>${faqs}</article>
${t.limitations ? `<article class="dash-card rg-body" id="grenzen"><h2>Grenzen dieser Rechnung</h2>${fill(t.limitations)}</article>` : ''}
${assumptionsBox(keys)}
<article class="dash-card rg-body" id="quellen"><h2>Quellen</h2><ul class="rg-sources">${t.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener" target="_blank">${esc(s.title)}</a></li>`).join('')}</ul></article>
<nav class="dash-card rg-body" aria-labelledby="weiter-${t.slug}"><h2 id="weiter-${t.slug}">Sinnvolle nächste Schritte</h2><ul class="rg-next">${t.related.map((u) => { const [a, b] = linkInfo(u); return `<li><a href="${esc(u)}">${esc(a)}<small>${esc(b)}</small></a></li>`; }).join('')}</ul></nav>`;
  const html = page({ title: t.title, hero: t.h1, meta: `Zuletzt fachlich geprüft am ${deDate(t.last_verified)} · Lesezeit etwa ${Math.max(2, Math.round(words / 200))} Minuten`, body });
  // Eigener Fließtext (für Gate/Duplikatprüfung): Einleitung, Abschnitte, FAQ – ohne Tabellen, Rechner und Standardbausteine.
  const prose = `${t.lead} ${sections} ${faqs} ${t.limitations || ''}`;
  return { html, prose, calcOk: t.checker === false || (res.status !== 'na' && Number.isFinite(res.rate) && Number.isFinite(res.surplus)), faqsRendered: (faqs.match(/<h3>/g) || []).length };
}

// ---------- Erzeugen, prüfen, schreiben ----------
const built = TOPICS.map((t) => ({ slug: t.slug, topic: t, title: t.title, desc: t.meta_description, h1: t.h1, ...article(t) }));
const report = evaluate(built);
for (const b of built) {
  const r = report[b.slug];
  r.status = b.topic.status;
  write(`guides/${b.slug}/index.html`, b.html);
}
// Verwaiste Seiten (Thema entfernt oder umbenannt) löschen – die Registry ist die einzige Quelle.
if (existsSync(new URL('guides/', pub))) for (const d of readdirSync(new URL('guides/', pub), { withFileTypes: true })) {
  if (d.isDirectory() && !bySlug[d.name]) rmSync(new URL(`guides/${d.name}/`, pub), { recursive: true });
}

// Übersicht: Suche zuerst, wenige beliebte Themen, darunter die kompakte Gliederung – nur indexierbare Seiten.
const live = TOPICS.filter((t) => report[t.slug].indexable);
const idx = live.map((t) => ({ u: `/guides/${t.slug}`, t: t.short || t.h1, c: t.group, k: (t.keywords || []).join(' '), p: Boolean(t.popular) }))
  .concat([{ u: '/calculators/approval-odds', t: 'Bank-Chancen-Checker', c: 'Rechner', k: 'haushaltsrechnung rate überschuss tragfähig', p: true }]);
const hub = page({
  title: 'Ratgeber Immobilienfinanzierung: Gehalt, Rate, Eigenkapital | LeaseRun',
  hero: 'Ratgeber Immobilienfinanzierung',
  meta: 'Antworten auf die Fragen vor dem Bankgespräch – jeweils mit Modellrechnung, Quellen und Datenstand.',
  body: `${crumbs([['Ratgeber']])}
<article class="dash-card rg-body"><div class="rg-search" data-rg-search role="search"><label for="rg-q" class="bcc-field">Wonach suchen Sie?</label><input id="rg-q" type="search" placeholder="z. B. Gehalt für 400.000 €, Eigenkapital, Kreditrate" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rg-list"><ul id="rg-list" role="listbox" class="rg-suggest" hidden></ul></div>
<ul class="rg-chips" aria-label="Häufig gesucht">${idx.filter((x) => x.p).slice(0, 5).map((x) => `<li><a href="${x.u}">${esc(x.t)}</a></li>`).join('')}</ul></article>
<div class="rg-groups">${GROUPS.map((g) => { const items = live.filter((t) => t.group === g); return items.length ? `<section class="dash-card rg-body"><h2>${esc(g)}</h2><ul class="plain-list">${items.map((t) => `<li><a class="ck-link" href="/guides/${t.slug}">${esc(t.short || t.h1)}</a></li>`).join('')}</ul></section>` : ''; }).join('')}</div>
<article class="dash-card rg-body"><h2>So rechnen die Ratgeber-Seiten</h2><p>Alle Zahlen stammen aus demselben Rechenkern wie die übrigen LeaseRun-Rechner und aus einer zentral gepflegten Liste von Annahmen. Modellwerte wie Sollzins oder Lebenshaltung sind als Annahme gekennzeichnet und in jedem Rechner änderbar – denn jede Bank rechnet mit eigenen Ansätzen. Gesetzliche Werte wie Grunderwerbsteuer oder Kindergeld sind mit Quelle und Stand angegeben.</p><p>Verwandte Themen: <a class="ck-link" href="/checklist">Unterlagen für die Bank</a> · <a class="ck-link" href="/calculators/amortization">Restschuld berechnen</a> · <a class="ck-link" href="/learn/erwerbsstatus">Probezeit, befristet, selbstständig</a></p></article>
<script type="application/json" id="rg-index">${JSON.stringify(idx).replace(/</g, '\\u003c')}</script>`,
});
write('guides/index.html', hub);
// llms.txt: Ratgeber-Abschnitt aus der Registry (nur indexierbare Seiten).
{
  const f = 'llms.txt', t = read(f);
  if (t.includes('<!--ratgeber:start-->')) write(f, t.replace(/<!--ratgeber:start-->[\s\S]*?<!--ratgeber:end-->/, `<!--ratgeber:start-->\n- [Übersicht](https://leaserun.com/guides)\n${live.map((x) => `- [${x.short || x.h1}](https://leaserun.com/guides/${x.slug}): ${x.teaser}`).join('\n')}\n<!--ratgeber:end-->`));
}
// Suchindex für /search (Volltextsuche der Website): nur indexierbare Ratgeber-Seiten.
write('src/ratgeber-index.js', `// Automatisch erzeugt (scripts/build-ratgeber.mjs) – nicht direkt bearbeiten.\nwindow.IA_RATGEBER=${JSON.stringify(live.map((t) => ({ u: `/guides/${t.slug}`, t: t.short || t.h1, d: t.teaser })))};\n`);

// Bank-Chancen-Checker als eigenes Werkzeug
{
  const d = { netIncome: 4500, adults: 2, children: 0, loan: 300000 };
  const res = bankChance({ ...d, propertyCosts: OK });
  const form = renderForm(d, { id: 'a', slug: 'checker', heading: 'Ihre Angaben' }).replace('{{result}}', renderResult(res, { ...d, livingOverride: '' }, { slug: 'checker', date: BUILD_DATE }));
  const keys = ['zins_modell', 'tilgung_modell', 'lebenshaltung_erste_person', 'lebenshaltung_weiterer_erwachsener', 'lebenshaltung_kind', 'objektkosten_modell', 'mietanrechnung', 'ueberschuss_gruen', 'rate_quote_hinweis', 'notar_pct', 'grundbuch_pct', 'makler_pct'];
  write('calculators/approval-odds/index.html', page({
    title: 'Bank-Chancen-Checker: Ist meine Finanzierung tragfähig? | LeaseRun', kicker: 'Rechner', hero: 'Bank-Chancen-Checker: Wie tragfähig ist meine Finanzierung?',
    meta: 'Haushaltsnetto, Darlehen und laufende Kosten eintragen – das Modell zeigt Rate, Überschuss und den Spielraum.',
    body: `${crumbs([['Rechner', '/calculators'], ['Bank-Chancen-Checker']])}
<article class="dash-card rg-body"><div class="rg-answer"><p>Banken prüfen vor einer Immobilienfinanzierung, ob nach Abzug aller Ausgaben und der neuen Rate genug vom Einkommen übrig bleibt. Der Checker bildet diese <strong>Haushaltsrechnung als Modell</strong> nach: Er zieht Lebenshaltung, bestehende Raten und laufende Objektkosten vom Haushaltsnetto ab und zeigt, wie viel nach der Rate bleibt – und bis zu welchem Darlehen das Ergebnis im Modell tragfähig wäre.</p></div></article>
${form}
<article class="dash-card rg-body"><h2>Was die Ampel bedeutet</h2><ul><li><strong>Grün – tragfähige Ausgangslage:</strong> Nach der Rate bleiben mindestens ${val('ueberschuss_gruen')} % des Haushaltsnettos übrig.</li><li><strong>Gelb – erhöhter Prüfbedarf:</strong> Die Rechnung geht auf, der Puffer ist aber kleiner als ${val('ueberschuss_gruen')} %.</li><li><strong>Rot – derzeit nicht tragfähig:</strong> Im Modell reicht das Einkommen nach allen Abzügen nicht für die Rate.</li></ul><p>Die Ampel ist keine Kreditentscheidung. Banken verwenden eigene Pauschalen, rechnen Mieten und Nebeneinkünfte unterschiedlich an und berücksichtigen Bonitätsauskünfte, Beleihungswert und Beschäftigung. Die Modellwerte sind deshalb änderbar; tragen Sie wo möglich Ihre tatsächlichen Ausgaben ein.</p><h2>Passende Ratgeber</h2><ul class="rg-next">${['/guides/haushaltsrechnung-immobilienfinanzierung', '/guides/wie-hoch-darf-kreditrate-sein', '/guides/wieviel-gehalt-fuer-400000-euro-kredit', '/guides/kredit-abgelehnt-gruende-loesung'].map((u) => { const [a, b] = linkInfo(u); return `<li><a href="${u}">${esc(a)}<small>${esc(b)}</small></a></li>`; }).join('')}</ul></article>
${assumptionsBox(keys)}`,
  }));
}

// Manifest für build-seo.mjs: Metadaten, sichtbare FAQ (Klartext, exakt wie auf der Seite) und Indexierbarkeit.
const plain = (h) => h.replace(/<[^>]+>/g, '').replace(/&nbsp;|\u00a0/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const manifest = [
  { path: '/guides', file: 'guides/index.html', title: 'Ratgeber Immobilienfinanzierung: Gehalt, Rate, Eigenkapital | LeaseRun', desc: 'Gehalt für 400.000 € Kredit, tragbare Rate, Eigenkapital, Haushaltsrechnung der Bank: Antworten mit Modellrechnung, Quellen und Datenstand.', crumbs: ['Ratgeber'], indexable: live.length > 0 },
  { path: '/calculators/approval-odds', file: 'calculators/approval-odds/index.html', title: 'Bank-Chancen-Checker: Ist meine Finanzierung tragfähig? | LeaseRun', desc: 'Haushaltsnetto, Darlehen und laufende Kosten eintragen: Rate, Überschuss und tragfähiges Darlehen im Modell – mit Ampel, Annahmen und Quellen.', crumbs: ['Rechner', 'Bank-Chancen-Checker'], indexable: true, tool: true },
  ...TOPICS.map((t) => ({ path: `/guides/${t.slug}`, file: `guides/${t.slug}/index.html`, title: t.title, desc: t.meta_description, crumbs: ['Ratgeber', t.short || t.h1], indexable: report[t.slug].indexable,
    article: { headline: t.h1, datePublished: t.created_at, dateModified: t.last_verified }, faqs: t.faqs.map((f) => ({ q: f.q, a: plain(fill(f.a)) })) })),
];
writeFileSync(new URL('../content/ratgeber/pages.json', import.meta.url), JSON.stringify(manifest, null, 1) + '\n');

// Bericht (eingecheckt): Gate-Ergebnis je Seite und zusammengelegte Themen mit Ziel-URL.
const out = { generated_for: BUILD_DATE.toISOString().slice(0, 10), thresholds: (await import('./ratgeber-gate.mjs')).THRESHOLDS, pages: report, consolidated: CONSOLIDATED };
writeFileSync(new URL('../content/ratgeber/gate-report.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
const fails = Object.entries(report).filter(([, r]) => !r.pass);
console.log(`Ratgeber: ${built.length} Seiten, ${built.length - fails.length} indexierbar${fails.length ? `; noindex: ${fails.map(([s, r]) => `${s} (${r.failures.join(', ')})`).join('; ')}` : ''}`);
