import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bankChance, nettoFuerDarlehen, lebenshaltungModell, monthlyRate, SCORE_ASSUMPTIONS } from '../public/src/calc.mjs';
import { ASSUMPTIONS, val } from '../public/src/finanz-config.mjs';
import { renderResult, STATUS, DISCLAIMER } from '../public/src/bcc-view.mjs';
import { evaluate, PROHIBITED } from '../scripts/ratgeber-gate.mjs';
import { TOPICS, CONSOLIDATED } from '../content/ratgeber/index.mjs';

test('Finanz-Konfiguration: jede Annahme vollständig dokumentiert', () => {
  for (const [k, a] of Object.entries(ASSUMPTIONS)) {
    for (const f of ['value', 'unit', 'source', 'verified_at', 'effective_from', 'assumption_type', 'review_status']) assert.ok(a[f] !== undefined && a[f] !== '', `${k}.${f}`);
    assert.match(a.verified_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['modellannahme', 'orientierungswert', 'veroeffentlichte_information'].includes(a.assumption_type), k);
  }
  assert.throws(() => val('gibt_es_nicht'));
});

test('Scorecard und Checker nutzen dasselbe Haushaltsmodell', () => {
  assert.equal(SCORE_ASSUMPTIONS.livingBase, val('lebenshaltung_erste_person'));
  assert.equal(SCORE_ASSUMPTIONS.livingPerPerson, val('lebenshaltung_weiterer_erwachsener'));
  assert.equal(lebenshaltungModell(2, 0), 1350); // wie bisher in der Deal-Scorecard (2 Personen)
  assert.equal(lebenshaltungModell(2, 1), 1700);
});

test('bankChance: Rate, Überschuss und Ampel', () => {
  const r = bankChance({ netIncome: 5000, loan: 400000, adults: 2, children: 1, propertyCosts: 250, ratePct: 4.2, repaymentPct: 2 });
  assert.equal(r.rate, Math.round(monthlyRate(400000, 0.042, 0.02) * 100) / 100);
  assert.equal(r.surplus, Math.round((5000 - 1700 - 250 - r.rate) * 100) / 100);
  assert.equal(r.status, 'green');
  assert.equal(bankChance({ netIncome: 3000, loan: 400000, adults: 2, children: 1, propertyCosts: 250 }).status, 'red');
  assert.equal(bankChance({ netIncome: 4400, loan: 400000, adults: 2, children: 1, propertyCosts: 250, ratePct: 4.2, repaymentPct: 2 }).status, 'yellow');
  assert.equal(bankChance({}).status, 'na');
});

test('bankChance: Umkehrrechnungen sind konsistent', () => {
  const need = nettoFuerDarlehen({ loan: 300000, ratePct: 4.2, repaymentPct: 2, adults: 2, children: 0, propertyCosts: 250 });
  assert.equal(bankChance({ netIncome: need, loan: 300000, adults: 2, propertyCosts: 250, ratePct: 4.2, repaymentPct: 2 }).status, 'green');
  assert.notEqual(bankChance({ netIncome: need - 60, loan: 300000, adults: 2, propertyCosts: 250, ratePct: 4.2, repaymentPct: 2 }).status, 'green');
  const r = bankChance({ netIncome: 4500, loan: 1, adults: 2, propertyCosts: 250 });
  assert.equal(bankChance({ netIncome: 4500, loan: r.maxLoan - 1000, adults: 2, propertyCosts: 250 }).status, 'green');
});

test('bankChance: Hinweise statt Entscheidung', () => {
  const r = bankChance({ netIncome: 4000, loan: 380000, adults: 1, employment: 'probezeit', price: 350000, equity: 0, land: 'hessen', propertyCosts: 0 });
  const keys = r.flags.map((f) => f.key);
  for (const k of ['probezeit', 'objektkosten', 'ek', 'ltv']) assert.ok(keys.includes(k), k);
  const html = renderResult(r, {}, { slug: 'test' });
  assert.ok(html.includes(DISCLAIMER));
  assert.ok(html.includes(STATUS[r.status]));
  for (const re of PROHIBITED) assert.doesNotMatch(html, re);
  assert.match(html, /\/auth\/register\?source=criteria_test"/);
});

test('Registry: eindeutige Slugs, keine Kollision mit zusammengelegten Themen, gültige Daten', () => {
  const slugs = TOPICS.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const c of CONSOLIDATED) { assert.ok(!slugs.includes(c.slug), c.slug); assert.match(c.into, /^\/[a-z0-9/-]+$/); }
  for (const t of TOPICS) {
    assert.ok(t.sources.every((s) => /^https:\/\//.test(s.url)), t.slug);
    assert.ok(t.related.length >= 3 && t.related.length <= 4, t.slug);
    assert.ok(t.faqs.length >= 3, t.slug);
  }
  assert.equal(slugs.length + CONSOLIDATED.length, 27); // vollständige Content-Matrix abgedeckt
});

test('Quality Gate: Duplikate und Thin Content werden erkannt', () => {
  const t = TOPICS[0];
  const long = Array.from({ length: 500 }, (_, i) => `wort${i}`).join(' ');
  const page = (slug: string, prose: string) => ({ slug, topic: { ...t, slug }, prose, title: t.title, desc: t.meta_description, h1: t.h1, calcOk: true, faqsRendered: t.faqs.length });
  const r = evaluate([page('a-seite', long), page('b-seite', long), page('c-seite', 'zu kurz')]);
  assert.equal(r['a-seite'].indexable, false);
  assert.ok(r['a-seite'].failures.includes('no_duplicate_content'));
  assert.ok(r['c-seite'].failures.includes('no_thin_content'));
});

test('Gate-Bericht und Sitemap: nur bestandene Seiten indexiert', () => {
  const rep = JSON.parse(readFileSync(new URL('../content/ratgeber/gate-report.json', import.meta.url), 'utf8'));
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  for (const [slug, r] of Object.entries(rep.pages) as [string, { indexable: boolean }][]) {
    assert.equal(sitemap.includes(`<loc>https://leaserun.com/guides/${slug}</loc>`), r.indexable, slug);
    const html = readFileSync(new URL(`../public/ratgeber/${slug}/index.html`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<link rel="canonical" href="https://leaserun.com/guides/${slug}">`));
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
    // Keine personenbezogenen Finanzdaten in URLs oder strukturierten Daten: nur Modellwerte aus dem Build.
    for (const m of html.matchAll(/source=([^"&]+)/g)) assert.equal(m[1], `criteria_${slug}`);
  }
});
