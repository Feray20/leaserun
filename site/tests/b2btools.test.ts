import { test } from 'node:test';
import assert from 'node:assert/strict';

test('Haushaltsrechnung: Überschuss und maximales Darlehen', async () => {
  const { haushalt } = await import('../public/src/b2b-tools.mjs');
  const r = haushalt({ netto1: 3000, netto2: 0, kindergeld: 0, sonstEin: 0, mieteNeu: 0, mieteAnteil: 75, erwachsene: 1, kinder: 0, pausch1: 1000, pauschWeitere: 400, pauschKind: 300, warmmiete: 0, kredite: 0, versicherung: 0, kfz: 0, sonstAus: 0, bewirtschaftung: 0, darlehen: 300000, zins: 3.6, tilgung: 2, puffer: 0 });
  assert.equal(r.frei, 2000);
  assert.ok(Math.abs(r.rate - 1400) < 0.01);
  assert.ok(Math.abs(r.ueber - 600) < 0.01);
  assert.ok(Math.abs(r.maxDarlehen - 2000 * 12 / 0.056) < 1);
});

test('Provision: Halbteilung', async () => {
  const { provision } = await import('../public/src/b2b-tools.mjs');
  assert.ok(provision({ preis: 400000, gesamtPct: 7.14, kaeuferPct: 3.57, verbraucherWohnen: true }).ok);
  assert.ok(!provision({ preis: 400000, gesamtPct: 7.14, kaeuferPct: 5, verbraucherWohnen: true }).ok);
  assert.ok(provision({ preis: 400000, gesamtPct: 7.14, kaeuferPct: 7.14, verbraucherWohnen: false }).ok);
  assert.equal(Math.round(provision({ preis: 400000, gesamtPct: 7.14, kaeuferPct: 3.57, verbraucherWohnen: true }).kaeufer), 14280);
});

test('Ertragswert nach Barwertfaktor', async () => {
  const { ertragswert } = await import('../public/src/b2b-tools.mjs');
  const r = ertragswert({ jahresmiete: 100000, bwkPct: 20, bodenwert: 200000, lz: 4, rnd: 40, preis: 1500000 });
  // RE 80.000; Gebäude 72.000; V = 19,7928
  assert.ok(Math.abs(r.v - 19.7928) < 0.001);
  assert.ok(Math.abs(r.ew - (72000 * r.v + 200000)) < 1);
});

test('VFE: kein Schaden, wenn Wiederanlage über Vertragszins', async () => {
  const { vfe } = await import('../public/src/b2b-tools.mjs');
  assert.equal(vfe({ rest: 200000, zins: 2, tilgung: 2, restMonate: 36, wiederanlage: 3 }).vfe, 0);
  const v = vfe({ rest: 200000, zins: 1.5, tilgung: 2, restMonate: 48, wiederanlage: 0.5 });
  assert.ok(v.vfe > 5000 && v.vfe < 9000, String(v.vfe));
});

test('GEG-Pflichtangaben und Unterlagenliste', async () => {
  const { gegText, unterlagenListe } = await import('../public/src/b2b-tools.mjs');
  assert.deepEqual(gegText({ art: 'bedarf', kennwert: 80, traeger: 'Erdgas', baujahr: 2001, wohn: true, klasse: 'C' }).fehlt, []);
  assert.ok(gegText({ art: 'bedarf', kennwert: 0, traeger: '', baujahr: 0, wohn: true, klasse: '' }).fehlt.length === 4);
  const l = unterlagenListe({ status: 'selbst', objekt: 'etw', vermietet: true });
  assert.ok(l.includes('Teilungserklärung mit Aufteilungsplan') && l.some((x) => x.startsWith('Bilanzen')) && l.includes('Mietvertrag bzw. Mieterliste'));
});

test('Plausibilität: Warnungen bei untypischen Eingaben', async () => {
  const { plausi } = await import('../public/src/b2b-tools.mjs');
  assert.ok(plausi('haushalt', { zins: 3.6, tilgung: 2, pausch1: 500, mieteAnteil: 100, puffer: 0 }).length === 3);
  assert.equal(plausi('provision', { gesamtPct: 7.14 }).length, 0);
  assert.ok(plausi('angebote', { o: [{ bank: 'X', rate: 3.5, eff: 3.4 }] })[0].includes('Effektivzins'));
});
