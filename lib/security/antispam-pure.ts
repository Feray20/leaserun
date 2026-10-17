// Reine, netz- und abhängigkeitsfreie Prüfungen für die Formular-Abwehr. In Unit-Tests direkt nutzbar.
// Bekannte Wegwerf-/Einmal-Mail-Domains. Seriöse Interessenten nutzen diese praktisch nie.
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'grr.la', 'sharklasers.com', 'guerrillamailblock.com',
  '10minutemail.com', '10minutemail.net', '20minutemail.com', 'tempmail.com', 'temp-mail.org', 'tempmail.net',
  'temp-mail.io', 'tempmailo.com', 'tmail.tm', 'tmpmail.org', 'tmpmail.net', 'throwawaymail.com', 'getnada.com',
  'trashmail.com', 'trashmail.de', 'trash-mail.com', 'wegwerfmail.de', 'wegwerfmail.net', 'wegwerfmail.org',
  'einrot.com', 'fakeinbox.com', 'dispostable.com', 'yopmail.com', 'yopmail.fr', 'yopmail.net', 'cool.fr.nf',
  'jetable.org', 'nospam.ze.tc', 'mytrashmail.com', 'mailnesia.com', 'maildrop.cc', 'mailcatch.com', 'inboxalias.com',
  'spamgourmet.com', 'spam4.me', 'mohmal.com', 'emailondeck.com', 'mailexpire.com', 'moakt.com', 'luxusmail.org',
  'burnermail.io', 'anonbox.net', 'discard.email', 'discardmail.com', 'discardmail.de', 'spambog.com', 'spambog.de',
  'mailsac.com', 'harakirimail.com', 'mail-temporaire.fr', 'tempinbox.com', 'emailtemporanea.net', 'fakemail.net',
  'mailforspam.com', 'mail7.io', 'inboxkitten.com', 'tempail.com', '1secmail.com', '1secmail.org', '1secmail.net',
  'byom.de', 'byespm.com', 'muellmail.com', 'minutemail.com', 'getairmail.com', 'mailtemp.net', 'rmqkr.net',
  'deadaddress.com', 'fakemailgenerator.com', 'tempmailaddress.com', 'tempemail.co', 'emlhub.com', 'gixenmail.com',
  'edu.pl.ua', 'cuvox.de', 'dayrep.com', 'fleckens.hu', 'gustr.com', 'jourrapide.com', 'rhyta.com', 'superrito.com',
  'teleworm.us', 'armyspy.com',
]);

// Häufige Tippfehler bei großen Anbietern → Hinweis an den Nutzer (nicht blocken).
const TYPO_FIX: Record<string, string> = {
  'gmail.de': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gmail.comm': 'gmail.com',
  'googlemail.de': 'googlemail.com', 'hotmail.con': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com',
  'web.d': 'web.de', 'webde.de': 'web.de', 'gmx.ne': 'gmx.net', 'gmx.de.com': 'gmx.de', 'outlook.con': 'outlook.com',
  'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 't-onine.de': 't-online.de', 'tonline.de': 't-online.de',
};

export type EmailShape = { ok: boolean; domain: string; reason?: string; suggestion?: string };

// Syntax, Wegwerf-Domain und offensichtliche Tippfehler. Kein Netzzugriff.
export function checkEmailShape(raw: string): EmailShape {
  const email = String(raw || '').trim().toLowerCase();
  // Bewusst strenger als die bloße Zod-Prüfung: genau ein @, Punkt in der Domain, keine Leerzeichen.
  const m = email.match(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/);
  if (!m) return { ok: false, domain: '', reason: 'ungueltig' };
  const domain = m[1];
  if (domain.includes('..') || domain.length > 253) return { ok: false, domain, reason: 'ungueltig' };
  if (DISPOSABLE_DOMAINS.has(domain)) return { ok: false, domain, reason: 'wegwerf' };
  if (TYPO_FIX[domain]) return { ok: false, domain, reason: 'tippfehler', suggestion: email.replace(/@.+$/, '@' + TYPO_FIX[domain]) };
  return { ok: true, domain };
}

// Honigtopf: unsichtbares Feld, das nur Bots ausfüllen.
export const honeypotTripped = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

// Zeitfalle: Formular, das in Sekundenbruchteilen (Bot) oder mit absurd altem Token kommt.
// ts = Zeitstempel (ms) beim Laden des Formulars, vom Client mitgeschickt.
export function tooFast(ts: unknown, minMs = 1500, maxMs = 6 * 3600_000): boolean {
  const n = typeof ts === 'number' ? ts : Number(ts);
  if (!Number.isFinite(n) || n <= 0) return false; // kein/kaputter Zeitstempel → nicht blocken
  const age = Date.now() - n;
  return age < minMs || age > maxMs;
}

// Inhaltliche Spam-Bewertung einer Nachricht. Höher = verdächtiger. Nur zum Markieren/Schwelle,
// damit echte (auch knappe) Anfragen durchkommen. Reiner String-Check.
export function spamScore(text: string, name = ''): number {
  const t = String(text || '');
  let s = 0;
  const links = (t.match(/https?:\/\//gi) || []).length + (t.match(/\[url=|\[link=/gi) || []).length;
  if (links >= 1) s += 2;
  if (links >= 3) s += 3;
  if (/\b(viagra|cialis|casino|porn|sex[\s-]?cam|crypto|bitcoin|forex|loan offer|seo service|backlink|betting|escort)\b/i.test(t)) s += 4;
  if (/[А-Яа-яЁё]{4,}/.test(t)) s += 2;          // kyrillisch in einer deutschen Anfrage
  if (/[一-鿿]{3,}/.test(t)) s += 2;      // CJK
  if (/(.)\1{9,}/.test(t)) s += 2;                 // dieselbe Zeichenfolge sehr oft
  const upper = t.replace(/[^A-Za-zÄÖÜäöü]/g, '');
  if (upper.length > 40 && upper === upper.toUpperCase()) s += 2;
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\b.*\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\b/i.test(t)) s += 1; // mehrere Mailadressen im Text
  if (/^[a-z]{8,}\d{2,}$/i.test(String(name).trim().replace(/\s/g, ''))) s += 1; // „asdfghjk12“-Namen
  return s;
}

