// PDF-Standardschriften (Helvetica, Courier) kennen nur den WinAnsi-Zeichensatz. Zeichen außerhalb davon
// verschwinden in @react-pdf stillschweigend (z. B. „− 1.000 €“ wird zu „1.000 €“) oder bringen pdf-lib zum Absturz.
// Deshalb werden alle Texte vor der Ausgabe auf darstellbare Zeichen abgebildet.

const MAP: Record<string, string> = {
  '−': '–', // Minuszeichen → Halbgeviertstrich (typografisches Minus)
  '‐': '-', '‑': '-', '‒': '–', '―': '—',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': 'ca.', '≃': 'ca.',
  '→': '->', '←': '<-', '⇒': '=>', '➔': '->', '➜': '->',
  '✓': 'ja', '✔': 'ja', '✕': 'x', '✗': 'nein', '✘': 'nein',
  '•': '•', '●': '•', '▪': '•', '‣': '•',
  ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ', '⁠': '',
  '​': '', '‌': '', '‍': '', '﻿': '', '­': '',
  '′': "'", '″': '"', '⁄': '/', '∕': '/', '∙': '·', '⋅': '·',
  '⅓': '1/3', '⅔': '2/3', '⅛': '1/8',
  'ı': 'i', 'İ': 'I', 'Ł': 'L', 'ł': 'l', 'Đ': 'D', 'đ': 'd', 'ħ': 'h',
  '№': 'Nr.', '™': '™', ' ': ' ',
};

// WinAnsi (CP1252): ASCII, Latin-1 ab 0xA0 und die 27 Sonderzeichen in 0x80–0x9F.
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const isWinAnsi = (ch: string) => {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || c === 0x0a || c === 0x09 || WINANSI_EXTRA.includes(ch);
};

export function pdfText(input: unknown): string {
  const s = String(input ?? '');
  let out = '';
  for (const ch of s) {
    if (isWinAnsi(ch)) { out += ch; continue; }
    if (ch in MAP) { out += MAP[ch]; continue; }
    // Buchstaben mit diakritischen Zeichen (ş, ć, ő …) auf den Grundbuchstaben zurückführen.
    const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    out += base && [...base].every(isWinAnsi) ? base : ch === '\r' ? '' : '?';
  }
  return out;
}

// Alle Zeichenketten eines Datenobjekts (verschachtelt) bereinigen; Zahlen, Wahrheitswerte und Data-URLs bleiben unverändert.
export function pdfSafeDeep<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('data:') ? value : pdfText(value)) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => pdfSafeDeep(v)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) o[k] = pdfSafeDeep(v);
    return o as T;
  }
  return value;
}
