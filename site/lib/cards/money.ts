// Geld ausschließlich in ganzen Cent (keine Gleitkomma-Rechnung). Anzeige deutsch.
export type Cents = number;

export function toCents(input: string | number): Cents {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('invalid_amount');
    return Math.round(input * 100);
  }
  const s = input.trim().replace(/\s|€/g, '');
  if (!/^-?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^-?\d+(,\d{1,2})?$|^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error('invalid_amount');
  // „1.250,50“ (deutsch) oder „1250.50“
  const de = s.includes(',') || /^\-?\d{1,3}(\.\d{3})+$/.test(s);
  const norm = de ? s.replace(/\./g, '').replace(',', '.') : s;
  const [i, f = ''] = norm.replace('-', '').split('.');
  const v = Number(i) * 100 + Number((f + '00').slice(0, 2));
  return s.startsWith('-') ? -v : v;
}

export function formatEur(c: Cents | null | undefined): string {
  if (c == null) return 'Noch nicht festgelegt';
  const neg = c < 0, a = Math.abs(Math.trunc(c));
  const euro = Math.floor(a / 100).toLocaleString('de-DE'), cent = String(a % 100).padStart(2, '0');
  return `${neg ? '−' : ''}${euro},${cent} €`;
}
