import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlinesFor, dueThreshold } from '../lib/reminders/deadlines';
import { fristen } from '../public/src/calc.mjs';

test('Reminder deadlines match the calculation core', () => {
  const o = { id: 'obj1', purchaseDate: '2024-01-31', payoutDate: '2024-03-15', fixedYears: 7 };
  const d = Object.fromEntries(deadlinesFor(o).map((x) => [x.kind, x.due]));
  const f = fristen({ purchaseDate: o.purchaseDate, payoutDate: o.payoutDate, fixedYears: o.fixedYears }) as { date: string; title: string }[];
  const by = (t: string) => f.find((x) => x.title.startsWith(t))!.date;
  assert.equal(d.ltcg, by('Long-term capital gains holding period'));
  assert.equal(d.sec121, by('Home-sale exclusion'));
  assert.equal(d.zinsbindung, by('End of fixed-rate period'));
  assert.equal(d.ltcg, '2025-02-01');
  assert.equal(d.zinsbindung, '2031-03-15');
});

test('1031 exchange: 45 and 180 calendar days; fixed-rate 30-year loan has no reset', () => {
  const d = Object.fromEntries(deadlinesFor({ exchangeSaleDate: '2026-01-10', payoutDate: '2026-01-10', fixedYears: 30 }).map((x) => [x.kind, x.due]));
  assert.equal(d.x1031id, '2026-02-24');
  assert.equal(d.x1031close, '2026-07-09');
  assert.equal(d.zinsbindung, undefined);
});

test('Thresholds: smallest reached threshold, nothing after the due date', () => {
  const dl = { kind: 'zinsbindung', title: '', due: '2027-01-31', thresholds: [365, 180, 90, 30], detail: '', source: '' };
  assert.deepEqual(dueThreshold(dl, new Date('2026-10-15T08:00:00Z')), { threshold: 180, daysLeft: 108 });
  assert.deepEqual(dueThreshold(dl, new Date('2027-01-10T08:00:00Z')), { threshold: 30, daysLeft: 21 });
  assert.equal(dueThreshold(dl, new Date('2025-01-01T08:00:00Z')), null);
  assert.equal(dueThreshold(dl, new Date('2027-02-01T08:00:00Z')), null);
  assert.equal(deadlinesFor({ purchaseDate: 'broken' }).length, 0);
});
