import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlinesFor, dueThreshold } from '../lib/reminders/deadlines';
import { fristen } from '../public/src/calc.mjs';

test('Erinnerungsfristen stimmen mit dem Rechenkern überein', () => {
  const o = { id: 'obj1', purchaseDate: '2024-01-31', payoutDate: '2024-03-15', fixedYears: 15 };
  const d = Object.fromEntries(deadlinesFor(o).map((x) => [x.kind, x.due]));
  const f = fristen({ purchaseDate: o.purchaseDate, payoutDate: o.payoutDate, fixedYears: o.fixedYears }) as { date: string; title: string }[];
  const by = (t: string) => f.find((x) => x.title.startsWith(t))!.date;
  assert.equal(d.frist15, by('Ende der 15-%-Frist'));
  assert.equal(d.spekulation, by('Verkauf ohne Spekulationssteuer'));
  assert.equal(d.zinsbindung, by('Ende der Zinsbindung'));
  assert.equal(d.kuendigung489, by('Kündigungsrecht nach zehn Jahren'));
});

test('Schwellen: kleinste erreichte Schwelle, nichts nach Ablauf', () => {
  const dl = { kind: 'zinsbindung', title: '', due: '2027-01-31', thresholds: [365, 180, 90, 30], detail: '', source: '' };
  assert.deepEqual(dueThreshold(dl, new Date('2026-10-15T08:00:00Z')), { threshold: 180, daysLeft: 108 });
  assert.deepEqual(dueThreshold(dl, new Date('2027-01-10T08:00:00Z')), { threshold: 30, daysLeft: 21 });
  assert.equal(dueThreshold(dl, new Date('2025-01-01T08:00:00Z')), null);
  assert.equal(dueThreshold(dl, new Date('2027-02-01T08:00:00Z')), null);
  assert.equal(deadlinesFor({ purchaseDate: 'kaputt' }).length, 0);
});
