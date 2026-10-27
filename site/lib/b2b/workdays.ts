// Werktage für Fristen und automatischen Versand (ohne Abhängigkeiten, testbar).

// Deutsche Feiertage (bundeseinheitlich) für die Werktagsberechnung; Ostern nach Gauß.
function easter(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}
export function isHoliday(d: Date): boolean {
  const y = d.getUTCFullYear(), md = `${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  if (['1-1', '5-1', '10-3', '12-25', '12-26'].includes(md)) return true;
  const e = easter(y).getTime(), day = 864e5;
  return [-2, 1, 39, 50].some((o) => e + o * day === Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
}

// n-ter Werktag (Mo–Fr ohne bundeseinheitliche Feiertage) eines Monats als YYYY-MM-DD.
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
