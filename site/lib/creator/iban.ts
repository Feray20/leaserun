// IBAN prüfen, normalisieren und maskiert darstellen (ISO 13616, Prüfziffer nach ISO 7064 MOD 97-10).
// Reine Funktionen ohne Netz- oder Datenbankzugriff – im Browser (creator.mjs) gleich nachgebaut.
// Fehlermeldungen enthalten nie die eingegebene IBAN.

// Länge je Land laut SWIFT-IBAN-Register.
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BI: 27, BR: 29, BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24,
  DE: 22, DJ: 27, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FK: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27,
  GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20,
  LV: 21, LY: 25, MC: 27, MD: 24, ME: 22, MK: 19, MN: 20, MR: 27, MT: 31, MU: 30, NI: 28, NL: 18, NO: 15, OM: 23, PK: 24, PL: 28,
  PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, RU: 33, SA: 24, SC: 31, SD: 18, SE: 24, SI: 19, SK: 24, SM: 27, SO: 23, ST: 25, SV: 28, TL: 23,
  TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20, YE: 30,
};

// SEPA-Länder, in denen eine BIC für Inlands- und SEPA-Überweisungen nicht erforderlich ist (IBAN-only).
const SEPA = new Set(['AD', 'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MC', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'SM', 'VA']);
export type IbanCheck =
  | { ok: true; iban: string; country: string; last4: string; sepa: boolean }
  | { ok: false; reason: 'format' | 'country' | 'length' | 'checksum' };

export const IBAN_ERROR = 'Bitte überprüfe deine IBAN.';

export function normalizeIban(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[\s\-.]/g, '');
}

// MOD 97-10 in Abschnitten berechnen (kein BigInt nötig, läuft auch in älteren Browsern).
export function mod97(iban: string): number {
  const re = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of re) {
    const v = ch >= 'A' && ch <= 'Z' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) rest = (rest * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return rest;
}

export function checkIban(input: string): IbanCheck {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$/.test(iban)) return { ok: false, reason: 'format' };
  const country = iban.slice(0, 2);
  const len = IBAN_LENGTHS[country];
  if (!len) return { ok: false, reason: 'country' };
  if (iban.length !== len) return { ok: false, reason: 'length' };
  if (mod97(iban) !== 1) return { ok: false, reason: 'checksum' };
  return { ok: true, iban, country, last4: iban.slice(-4), sepa: SEPA.has(country) };
}

// Einheitliche Maske, unabhängig von der Länge (verrät nicht, wie lang die IBAN ist): DE••••••••••4821
export function maskIban(country: string, last4: string): string {
  return `${country}${'•'.repeat(10)}${last4}`;
}

// Lesbare Gruppierung in Viererblöcken (nur für die freigegebene Vollansicht).
export function groupIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

export function bicRequired(country: string): boolean {
  return !SEPA.has(country);
}

export function normalizeBic(input: string | null | undefined): string | null {
  const b = String(input ?? '').toUpperCase().replace(/\s/g, '');
  return b ? b : null;
}

export function validBic(bic: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic);
}
