// Business days for deadlines and scheduled sending (no dependencies, testable).

// US federal holidays (5 U.S.C. 6103) incl. observed dates: a holiday on Saturday is observed on Friday,
// a holiday on Sunday on Monday.
const nthWeekday = (y: number, m0: number, wd: number, n: number) => {
  const first = new Date(Date.UTC(y, m0, 1)).getUTCDay();
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
};
const lastWeekday = (y: number, m0: number, wd: number) => {
  const last = new Date(Date.UTC(y, m0 + 1, 0));
  return last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7);
};
const observed = (d: Date): number => {
  const wd = d.getUTCDay();
  return d.getTime() + (wd === 6 ? -864e5 : wd === 0 ? 864e5 : 0);
};

export function federalHolidays(y: number): number[] {
  const D = (m0: number, day: number) => new Date(Date.UTC(y, m0, day));
  const fixed = [D(0, 1), D(5, 19), D(6, 4), D(10, 11), D(11, 25)].map(observed); // New Year, Juneteenth, Independence Day, Veterans Day, Christmas
  const floating = [
    D(0, nthWeekday(y, 0, 1, 3)), // Martin Luther King Jr. Day – 3rd Monday of January
    D(1, nthWeekday(y, 1, 1, 3)), // Washington's Birthday – 3rd Monday of February
    D(4, lastWeekday(y, 4, 1)), // Memorial Day – last Monday of May
    D(8, nthWeekday(y, 8, 1, 1)), // Labor Day – 1st Monday of September
    D(9, nthWeekday(y, 9, 1, 2)), // Columbus Day – 2nd Monday of October
    D(10, nthWeekday(y, 10, 4, 4)), // Thanksgiving – 4th Thursday of November
  ].map((d) => d.getTime());
  // New Year's Day of the following year observed on Dec 31 when Jan 1 falls on a Saturday.
  const nextNy = observed(new Date(Date.UTC(y + 1, 0, 1)));
  return [...fixed, ...floating, ...(new Date(nextNy).getUTCFullYear() === y ? [nextNy] : [])];
}

export function isHoliday(d: Date): boolean {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return federalHolidays(d.getUTCFullYear()).includes(t);
}

// n-th business day (Mon–Fri excluding US federal holidays) of a month as YYYY-MM-DD.
export function nthWorkday(year: number, month1: number, n: number): string {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month1 - 1, day));
    if (d.getUTCMonth() !== month1 - 1) break;
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || isHoliday(d)) continue;
    if (++count === n) return d.toISOString().slice(0, 10);
  }
  return '';
}
