import test from 'node:test';
import assert from 'node:assert/strict';
import { remember, situation, trend, trendText, type Memory } from '../lib/admin/hq-intel.ts';

test('Gedächtnis: neu, seit Tagen offen, behoben, wieder aufgetreten, Hochstufung', () => {
  const mem: Memory = {};
  const d0 = new Date('2026-10-20T10:00:00Z'), d3 = new Date('2026-10-23T10:00:00Z'), d4 = new Date('2026-10-24T10:00:00Z'), d5 = new Date('2026-10-25T10:00:00Z');
  const a = { id: 'a', level: 'hoch' as const, title: 'A' }, b = { id: 'b', level: 'mittel' as const, title: 'B' };
  let r = remember(mem, 'x', [a, b], {}, d0);
  assert.deepEqual(r.neu.map((i) => i.id), ['a', 'b']);
  r = remember(mem, 'x', [a], {}, d3);
  assert.equal(r.alt[0].days, 3); assert.equal(r.escalate, true); assert.deepEqual(r.behoben, ['B']);
  r = remember(mem, 'x', [a, b], {}, d4);
  assert.deepEqual(r.wieder.map((i) => i.id), ['b']);
  r = remember(mem, 'x', [], {}, d5);
  assert.equal(r.behoben.length, 2);
});

test('Trend gegenüber der Vorwoche', () => {
  const mem: Memory = {};
  remember(mem, 'x', [], { k: 10 }, new Date('2026-10-18T10:00:00Z'));
  remember(mem, 'x', [], { k: 20 }, new Date('2026-10-25T10:00:00Z'));
  const t = trend(mem, 'x', 'k', +new Date('2026-10-25T10:00:00Z'), 7);
  assert.deepEqual(t, { before: 10, now: 20 });
  assert.equal(trendText(t, 'Fehler'), 'Fehler +100 % ggü. Vorwoche');
  assert.equal(trendText({ before: 10, now: 11 }, 'Fehler'), '');
});

test('Lagebild: Kundenprobleme zuerst, gemeinsame Ursache erkannt', () => {
  const s = situation([
    { id: 'technik', name: 'Olivia', status: 'todo', line: '', issues: [{ id: 'tech:stripe', level: 'hoch', title: 'Stripe: Schlüssel ungültig' }], days: {} },
    { id: 'support', name: 'Tyler', status: 'todo', line: '', issues: [{ id: 'k:1', level: 'hoch', title: 'Kunde konnte die Kasse nicht öffnen (Serverfehler)', customer: true }], days: {} },
    { id: 'finanzen', name: 'Ryan', status: 'todo', line: '', issues: [{ id: 'inv:1', level: 'mittel', title: 'Rechnung überfällig' }], days: {} },
  ]);
  assert.equal(s.top[0].agent, 'Tyler');
  assert.ok(s.causes.some((c) => /Stripe/.test(c)));
});

test('Diagnose: Kundenfehler mit Ursache und Lösung, Harmloses automatisch', async () => {
  const { diagnose } = await import('../lib/admin/kunden-diagnose.ts');
  assert.equal(diagnose({ message: 'API 500 · /api/billing/checkout', count: 1, area: 'website' }).kind, 'kasse');
  assert.equal(diagnose({ message: 'API 500 · /api/billing/checkout', count: 1, area: 'website' }).level, 'hoch');
  assert.match(diagnose({ message: 'Anmeldung 429 · /auth/signup', count: 1 }).fix, /SMTP/);
  assert.equal(diagnose({ message: '[selbst behoben] Failed to fetch dynamically imported module', count: 1 }).auto, true);
  assert.equal(diagnose({ message: 'Load failed', count: 1 }).auto, true);
  assert.equal(diagnose({ message: 'Load failed', count: 5 }).auto, undefined);
  const p = diagnose({ message: "Cannot read properties of null (reading 'value')", source: '/src/kasse.mjs:12:3', page: '/preise', count: 1, area: 'website' });
  assert.equal(p.level, 'hoch'); assert.match(p.fix, /kasse\.mjs:12:3/);
  assert.equal(diagnose({ message: 'x is not defined', count: 1, area: 'admin' }).customer, false);
  assert.equal(diagnose({ message: 'API 400 · /api/kontakt', count: 4, area: 'website' }).level, 'hoch');
});

test('Diagnose: Serverfehler der Kasse mit Stripe-Ursache, Ausweichlösung niedriger', async () => {
  const { diagnose } = await import('../lib/admin/kunden-diagnose.ts');
  const fb = diagnose({ message: 'Server · checkout_embed_fallback · /api/billing/checkout: You cannot set `logo` when `ui_mode` is `embedded_page`.', source: 'server:checkout_embed_fallback:ausweichen', area: 'app', count: 1 });
  assert.equal(fb.kind, 'kasse'); assert.equal(fb.level, 'niedrig'); assert.match(fb.cause, /Logo/); assert.match(fb.fix, /toEmbedded/);
  const hard = diagnose({ message: 'Server · checkout_error · /api/billing/checkout: No such price: price_123', source: 'server:checkout_error:fehler', area: 'app', count: 1 });
  assert.equal(hard.level, 'hoch'); assert.equal(hard.customer, true); assert.match(hard.cause, /Preis/);
  const other = diagnose({ message: 'Server · unbehandelt_app · /api/kontakt: relation "lr_x" does not exist', source: 'server:unbehandelt_app:fehler', area: 'website', count: 1 });
  assert.equal(other.kind, 'server'); assert.match(other.fix, /docs\/sql/);
});

test('Intelligence versteht Tippfehler und mehrteilige Fragen', async () => {
  const { fuzzyHas, lev } = await import('../lib/admin/hq-intel.ts');
  assert.equal(lev('umsaz', 'umsatz'), 1); assert.equal(lev('kunde', 'umsatz') > 1, true);
  assert.equal(fuzzyHas('wie war der umsaz heute', 'umsatz'), true);
  assert.equal(fuzzyHas('zeig mir die bescuher', 'besuch'), true);
  assert.equal(fuzzyHas('kauf', 'kaufe'), false);
  assert.equal(fuzzyHas('ternime diese woche', 'termin'), true);
  assert.equal(fuzzyHas('offene anfragen', 'umsatz', 'besuch'), false);
});

test('Kasse: derselbe Befund zählt einmal, nur Testverkehr wird nicht „hoch“', () => {
  const v = (id: string, name: string, iid: string, title: string) => ({ id, name, status: 'todo', line: '', days: {}, issues: [{ id: iid, level: 'hoch' as const, title, customer: true }] });
  const views = [v('support', 'Tyler', 'kasse:keinerueckkehr', '5 Personen starteten die Kasse'), v('neukunden', 'Hannah', 'neu:kasse-ohne-kauf', '12 Kassenstarts, kein Kauf'), v('marketing', 'Sophie', 'mkt:checkout-rate', 'Nur 0 % kaufen')];
  const echt = situation(views, { nurTest: false });
  assert.equal(echt.top.length, 1); assert.equal(echt.top[0].level, 'hoch');
  const test = situation(views, { nurTest: true });
  assert.equal(test.top.length, 1); assert.equal(test.top[0].level, 'niedrig');
  assert.ok(!test.causes.some((c) => /kaufen aber nicht/.test(c)));
});
