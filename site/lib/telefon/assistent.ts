// Telefon-Assistent (Retell AI + nationale 032-Nummer): Gesprächsskript, Auswertung eines Anrufs und Kostenzähler.
// Der Assistent führt das Gespräch selbst; nach jedem Anruf kommt nur eine Zusammenfassung ins Postfach support@leaserun.com.
// Datensparsam: kein Mitschnitt, kein Wortprotokoll in der E-Mail – nur Anliegen, Rückrufwunsch und Zusammenfassung.
import { createHmac, timingSafeEqual } from 'node:crypto';
import PRICES from '@/public/data/preise.json';

// Budget: ca. 20 $ im Monat (Retell rechnet in US-Dollar ab). Richtwert pro Minute bei Standard-Stimme + günstigem Modell.
export const BUDGET_USD = 20;
export const USD_PER_MIN = 0.1;
export const NUMBER_USD = 2; // nationale Rufnummer (Telnyx) pro Monat, gerundet
export const USAGE_KEY = 'telefon_usage';

const eur = (c: number) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })} €`;

type Plan = { id: string; name: string; cents?: number; netto_cents?: number; intervall: string; features: string[]; fuer?: string };
function preisliste(): string {
  const p = (PRICES as unknown as { privat: { plans: Plan[]; addons?: { name: string; cents: number }[] }; b2b: { plans: Plan[] }; kostenlos: { features: string[] } });
  const priv = p.privat.plans.map((x) => `- ${x.name}: ${eur(x.cents || 0)} ${x.intervall} (inkl. MwSt.). ${x.fuer || ''} Enthalten: ${x.features.join('; ')}.`).join('\n');
  const add = (p.privat.addons || []).map((x) => `- Zusatz: ${x.name} für ${eur(x.cents)}.`).join('\n');
  const b2b = p.b2b.plans.map((x) => `- ${x.name}: ${eur(x.netto_cents || 0)} netto ${x.intervall}. ${x.features.slice(0, 4).join('; ')}.`).join('\n');
  return `Kostenlos: ${p.kostenlos.features.join('; ')}.\n\nPrivatkunden (Endpreise):\n${priv}${add ? `\n${add}` : ''}\n\nUnternehmen (nur Gewerbe, netto zzgl. 19 % USt, Monatsabos monatlich kündbar):\n${b2b}`;
}

// Systemprompt für den Retell-Agenten (Feld „Prompt“ / „Global Prompt“). Preise kommen immer aus preise.json.
export function gespraechsskript(): string {
  return `# Rolle
Du bist Lena vom Kundenservice von LeaseRun (leaserun.com). Du sprichst natürliches, freundliches Hochdeutsch wie eine erfahrene Mitarbeiterin am Telefon: kurze Sätze, ganz normale Umgangssprache, „Sie“ als Anrede. Du führst das Gespräch vollständig selbst.

# Begrüßung (immer genau so beginnen)
„Guten Tag, hier ist LeaseRun, Sie sprechen mit Lena, der digitalen Assistentin. Wie kann ich Ihnen helfen?“
Der Hinweis „digitale Assistentin“ ist gesetzlich vorgeschrieben und wird nie weggelassen. Fragt jemand, ob du ein Mensch bist, sagst du ehrlich, dass du eine KI-Assistentin bist.

# Was LeaseRun ist
LeaseRun ist eine Online-Software rund um Immobilienkauf und Finanzierung: Rechner, eine Wissenszentrale, Exposé-Analyse und die bankfertige Kreditmappe als PDF. Für Makler, Finanzierungsberater und Kanzleien gibt es ein eigenes Unternehmensportal.
LeaseRun ist ein technisches Analyse- und Vorbereitungswerkzeug. LeaseRun vermittelt keine Kredite und gibt keine Anlage-, Steuer- oder Rechtsberatung. Bei solchen Fragen sagst du freundlich, dass du dazu keine Beratung geben darfst, und empfiehlst Bank, Steuerberater oder Anwalt.

# Preise und Leistungen (nur diese Angaben verwenden, nichts erfinden)
${preisliste()}

# Häufige Fragen
- Kündigung: Investor Pro und Unternehmens-Monatsabos sind monatlich kündbar, im Kundenkonto unter „Konto“ oder über leaserun.com/kuendigung. Kreditmappe und Käufer-Pass sind Einmalkäufe ohne Abo.
- Bezahlung: online an der Kasse auf leaserun.com, z. B. mit Karte, PayPal oder Lastschrift. Unternehmen können auch per Rechnung zahlen.
- Registrierung und Testen: kostenlos auf leaserun.com, ohne Zahlungsdaten.
- Unternehmenskonto: Anfrage unter leaserun.com/b2b, nach Prüfung des Gewerbenachweises wird freigeschaltet.
- Termin oder Beratung zur Software: Buchung über leaserun.com/termin.
- E-Mail: support@leaserun.com.

# Gesprächsregeln
1. Erst zuhören, dann kurz und konkret antworten. Höchstens zwei, drei Sätze am Stück, dann nachfragen.
2. Zahlen nur aus der Preisliste oben. Was du nicht sicher weißt, versprichst du nicht.
3. Weißt du etwas nicht oder braucht es eine persönliche Klärung (Kooperation, Presse, Rechnung, Problem mit dem Konto), nimmst du ein Anliegen auf: Name, Rückrufnummer (Nummer einmal zur Bestätigung wiederholen) und worum es geht. Sag dann: „Ich gebe das weiter, Sie bekommen in der Regel innerhalb eines Werktags eine Rückmeldung.“
4. Frag nie nach Passwörtern, Kontonummern, Kartendaten, Ausweisdaten oder Gesundheitsdaten. Will jemand solche Daten nennen, bittest du ihn, das nicht am Telefon zu tun.
5. Nenne nie Namen, Adressen oder private Telefonnummern von Mitarbeitern. Verweise auf support@leaserun.com und leaserun.com/impressum.
6. Bleib höflich, auch bei Ärger. Bei Beleidigungen oder Werbeanrufen beendest du das Gespräch freundlich.
7. Halte das Gespräch kurz: Nach spätestens vier Minuten fasst du zusammen und verabschiedest dich.
8. Verabschiedung: „Vielen Dank für Ihren Anruf bei LeaseRun. Einen schönen Tag noch!“ – dann das Gespräch beenden.`;
}

// Felder für Retell → „Post-Call Analysis“ (Name · Typ · Beschreibung). Die Zusammenfassungs-E-Mail liest genau diese Felder.
export const AUSWERTUNG: { name: string; typ: string; text: string }[] = [
  { name: 'name', typ: 'Text', text: 'Name des Anrufers, falls genannt, sonst leer.' },
  { name: 'anliegen', typ: 'Text', text: 'Worum ging es, in einem Satz auf Deutsch.' },
  { name: 'kategorie', typ: 'Auswahl', text: 'Eine von: Frage zu Preisen, Frage zur Software, Unternehmen/B2B, Kooperation, Problem mit Konto oder Zahlung, Kündigung, Sonstiges, Werbung/Spam.' },
  { name: 'rueckruf', typ: 'Ja/Nein', text: 'Wünscht der Anrufer einen Rückruf oder eine Rückmeldung?' },
  { name: 'rueckrufnummer', typ: 'Text', text: 'Bestätigte Rückrufnummer, falls genannt.' },
  { name: 'dringend', typ: 'Ja/Nein', text: 'Ist das Anliegen dringend (z. B. Zahlung fehlgeschlagen, Zugang gesperrt)?' },
];
export function auswertungText(): string {
  return AUSWERTUNG.map((f) => `${f.name} (${f.typ}): ${f.text}`).join('\n');
}

// ---------- Webhook-Prüfung ----------
// Retell signiert jeden Webhook mit dem API-Schlüssel (HMAC-SHA256). Zusätzlich oder alternativ: geheimer Token in der URL.
export function verifyRetell(raw: string, header: string | null, apiKey: string | undefined): boolean {
  if (!header || !apiKey) return false;
  const m = /^v=(\d+),d=([0-9a-f]+)$/i.exec(header.trim());
  if (!m) return false;
  const [, ts, digest] = m;
  if (Math.abs(Date.now() - Number(ts)) > 5 * 60 * 1000) return false;
  const want = createHmac('sha256', apiKey).update(raw + ts).digest('hex');
  return safeEq(want, digest.toLowerCase());
}
export function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- Anruf auswerten ----------
export type RetellCall = {
  call_id?: string; from_number?: string; to_number?: string; direction?: string;
  start_timestamp?: number; end_timestamp?: number; duration_ms?: number; disconnection_reason?: string;
  call_analysis?: { call_summary?: string; user_sentiment?: string; call_successful?: boolean; custom_analysis_data?: Record<string, unknown> };
};
const s = (v: unknown, n = 300) => (v === null || v === undefined ? '' : String(v)).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
const yes = (v: unknown) => v === true || /^(ja|yes|true)$/i.test(String(v ?? ''));

export function minuten(c: RetellCall): number {
  const ms = c.duration_ms ?? (c.end_timestamp && c.start_timestamp ? c.end_timestamp - c.start_timestamp : 0);
  return Math.max(0, Math.ceil(ms / 60000));
}

export function zusammenfassung(c: RetellCall): { subject: string; text: string; spam: boolean; dringend: boolean } {
  const d = c.call_analysis?.custom_analysis_data || {};
  const kat = s(d.kategorie, 60);
  const spam = /werbung|spam/i.test(kat);
  const dringend = yes(d.dringend);
  const name = s(d.name, 80);
  const anliegen = s(d.anliegen, 200) || 'ohne Angabe';
  const wann = c.start_timestamp ? new Date(c.start_timestamp).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }) : '';
  const min = minuten(c);
  const lines = [
    `Anruf${wann ? ` am ${wann} Uhr` : ''} · Dauer ca. ${min} Min.`,
    '',
    `Anrufer: ${name || 'Name nicht genannt'} · Nummer: ${s(c.from_number, 40) || 'unterdrückt'}`,
    `Kategorie: ${kat || 'Sonstiges'}`,
    `Anliegen: ${anliegen}`,
    `Rückruf gewünscht: ${yes(d.rueckruf) ? `Ja${s(d.rueckrufnummer, 40) ? ` – ${s(d.rueckrufnummer, 40)}` : ''}` : 'Nein'}`,
    dringend ? 'Dringend: Ja' : '',
    '',
    'Zusammenfassung:',
    s(c.call_analysis?.call_summary, 1500) || 'Keine Zusammenfassung verfügbar.',
  ].filter((l, i, a) => l !== '' || (a[i - 1] !== '' && i > 0));
  const subject = `${dringend ? 'Dringend · ' : ''}Telefon: ${name || s(c.from_number, 30) || 'Anruf'} – ${anliegen.slice(0, 70)}`;
  return { subject, text: lines.join('\n'), spam, dringend };
}

// ---------- Kostenzähler (nur Minuten und Anzahl, keine Inhalte) ----------
export type Usage = { monat: string; minuten: number; anrufe: number; gewarnt?: number };
export const monatJetzt = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
export function kostenUsd(u: Pick<Usage, 'minuten'>): number {
  return Math.round((u.minuten * USD_PER_MIN + NUMBER_USD) * 100) / 100;
}
// Warnschwelle: 80 % und 100 % des Budgets – je Monat höchstens einmal pro Stufe.
export function warnStufe(u: Usage): 0 | 80 | 100 {
  const k = kostenUsd(u);
  if (k >= BUDGET_USD && (u.gewarnt || 0) < 100) return 100;
  if (k >= BUDGET_USD * 0.8 && (u.gewarnt || 0) < 80) return 80;
  return 0;
}
