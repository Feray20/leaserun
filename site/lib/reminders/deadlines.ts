// Deadlines for email reminders (same date logic as public/src/calc.mjs → fristen(), US version).
const DAY = 86_400_000;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(d: Date, n: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d.getUTCDate(), last));
  return x;
}
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown) => (typeof v === 'string' && DATE_RE.test(v) ? parse(v) : null);

// exchangeSaleDate (optional): closing date of a relinquished property sold in a 1031 exchange.
export type ReminderObject = { id?: unknown; name?: unknown; purchaseDate?: unknown; payoutDate?: unknown; fixedYears?: unknown; exchangeSaleDate?: unknown };
export type Deadline = { kind: string; title: string; due: string; thresholds: number[]; detail: string; source: string };

export function deadlinesFor(o: ReminderObject): Deadline[] {
  const out: Deadline[] = [];
  const purchase = date(o.purchaseDate);
  const payout = date(o.payoutDate) || purchase;
  const fixed = Number(o.fixedYears) || 0;
  if (purchase) {
    out.push({ kind: 'ltcg', title: 'Long-term capital gains holding period reached', due: iso(addDays(addMonths(purchase, 12), 1)), thresholds: [30],
      detail: 'A sale after this date is taxed at long-term capital gains rates (held more than one year). Depreciation recapture still applies to rentals.', source: 'IRC § 1222' });
    out.push({ kind: 'sec121', title: 'Home-sale exclusion: 2-year ownership test met (Section 121)', due: iso(addMonths(purchase, 24)), thresholds: [60, 14],
      detail: 'If you also lived in the home as your main residence for 2 of the last 5 years, up to $250,000 of gain ($500,000 married filing jointly) may be excluded.', source: 'IRC § 121' });
  }
  // fixedYears = fixed period of an ARM (e.g. 5, 7, 10). 0 or 30+ means a fully fixed-rate loan: no reset.
  if (payout && fixed > 0 && fixed < 30) {
    out.push({ kind: 'zinsbindung', title: 'End of fixed-rate period (ARM reset)', due: iso(addMonths(payout, Math.round(fixed * 12))), thresholds: [365, 180, 90, 30],
      detail: 'From this date your rate adjusts to the index plus margin, within the caps in your note. Compare refinance quotes early and check your loan balance.', source: 'Your promissory note (ARM disclosure)' });
  }
  const sold = date(o.exchangeSaleDate);
  if (sold) {
    out.push({ kind: 'x1031id', title: '1031 exchange: identify replacement property (45 days)', due: iso(addDays(sold, 45)), thresholds: [21, 7, 2],
      detail: 'Written, signed identification must reach your qualified intermediary by midnight. Weekends and holidays count.', source: 'IRC § 1031(a)(3)' });
    out.push({ kind: 'x1031close', title: '1031 exchange: close on replacement property (180 days)', due: iso(addDays(sold, 180)), thresholds: [60, 30, 7],
      detail: 'The 180 days end earlier on your tax return due date unless you file an extension.', source: 'IRC § 1031(a)(3)' });
  }
  return out;
}

// Reminder due: smallest threshold reached (deadline not yet passed).
export function dueThreshold(d: Deadline, today: Date): { threshold: number; daysLeft: number } | null {
  const daysLeft = Math.round((parse(d.due).getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY);
  if (daysLeft < 0) return null;
  const hit = [...d.thresholds].sort((a, b) => a - b).find((t) => daysLeft <= t);
  return hit === undefined ? null : { threshold: hit, daysLeft };
}
