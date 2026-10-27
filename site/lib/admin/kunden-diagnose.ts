// Regeln: Fehlermeldung eines Kunden → Ursache und Lösung (rein, ohne Datenbank; getestet in tests/hq-intel.test.ts).

export type Level = 'hoch' | 'mittel' | 'niedrig';
export type Diag = { kind: 'programm' | 'kasse' | 'anmeldung' | 'formular' | 'server' | 'netz' | 'cache' | 'browser' | 'sonstig'; level: Level; customer: boolean; title: string; cause: string; fix: string; auto?: boolean };
export type ErrRow = { id?: string; fingerprint?: string; message: string; source?: string | null; page?: string | null; area?: string | null; browser?: string | null; count: number; first_seen?: string; last_seen?: string };

const FORM_PATHS = /\/api\/(billing|kontakt|formular|termin|kuendigung|widerruf|newsletter|feedback|support|unterlagen|kreditmappe|b2b\/contact|auth)/;
const where = (p?: string | null) => (p && p !== '/' ? p : 'der Startseite');
const file = (s?: string | null) => (s || '').replace(/:0:0$/, '') || 'unbekannter Datei';

// Ursache und Lösung aus der Fehlermeldung ableiten (feste Regeln, keine KI-Kosten).
export function diagnose(e: ErrRow): Diag {
  const m = e.message || '', customer = (e.area || 'website') !== 'admin', many = e.count >= 3;
  let x: RegExpExecArray | null;
  if ((x = /^Server · ([\w-]+) · (\S+): ([\s\S]*)$/.exec(m))) return serverDiag(x[1], x[2], x[3], e);
  if (/^\[selbst behoben\]/.test(m)) return { kind: 'cache', level: 'niedrig', customer, auto: true, title: `Veraltete Programmteile auf ${where(e.page)}`, cause: 'Der Browser hatte nach einem Update noch alte Dateien.', fix: 'Die Seite hat sich beim Kunden automatisch neu geladen – nichts zu tun.' };
  if (/QuotaExceeded|localStorage|sessionStorage|The operation is insecure|SecurityError/i.test(m)) return { kind: 'browser', level: 'niedrig', customer, auto: true, title: 'Privates Browserfenster', cause: 'Im privaten Modus ist der Gerätespeicher gesperrt.', fix: 'Kein Fehler der Website – automatisch abgehakt.' };
  if (/chrome-extension|moz-extension|safari-extension|webkit-masked-url|__gCrWeb|instantSearchSDKJSBridge/i.test(`${m} ${e.source}`)) return { kind: 'browser', level: 'niedrig', customer, auto: true, title: 'Browser-Erweiterung des Kunden', cause: 'Eine Erweiterung im Browser des Kunden hat den Fehler ausgelöst.', fix: 'Kein Fehler der Website – automatisch abgehakt.' };
  if ((x = /^Anmeldung (\d{3}) · (\S+)/.exec(m))) {
    if (x[1] === '429') return { kind: 'anmeldung', level: 'hoch', customer: true, title: 'Kunden können sich gerade nicht registrieren oder anmelden', cause: 'Das E-Mail-Limit des Anmeldedienstes ist erreicht (ohne eigenen Mailversand nur wenige Mails pro Stunde).', fix: 'Supabase → Authentication → SMTP Settings: eigenen Versand über Resend eintragen (smtp.resend.com, Absender noreply@leaserun.com). Danach gilt das Limit nicht mehr.' };
    return { kind: 'anmeldung', level: 'hoch', customer: true, title: `Anmeldedienst gestört (Status ${x[1]})`, cause: 'Der Anmeldedienst (Supabase Auth) hat mit einem Serverfehler geantwortet.', fix: 'status.supabase.com prüfen. Hält es an: Supabase → Logs → Auth ansehen.' };
  }
  if ((x = /^API offline · (\S+)/.exec(m))) return many ? { kind: 'netz', level: 'mittel', customer, title: `Verbindung zu ${x[1]} bricht ab (${e.count}×)`, cause: 'Die Schnittstelle antwortet zu langsam oder gar nicht – oder Kunden sind mobil ohne Netz.', fix: `Vercel → Logs → ${x[1]} auf Zeitüberschreitungen prüfen; in Noahs Bericht steht die Antwortzeit.` } : { kind: 'netz', level: 'niedrig', customer, auto: true, title: `Einzelner Verbindungsabbruch zu ${x[1]}`, cause: 'Meist ein Funkloch beim Kunden.', fix: 'Einzelfall – automatisch abgehakt. Häuft es sich, meldet Tyler es.' };
  if ((x = /^API (\d{3}) · (\S+)/.exec(m))) {
    const st = Number(x[1]), p = x[2], kasse = /\/api\/billing/.test(p);
    if (st >= 500) return { kind: kasse ? 'kasse' : 'server', level: 'hoch', customer, title: kasse ? 'Kunde konnte die Kasse nicht öffnen (Serverfehler)' : `Serverfehler bei ${p}`, cause: `Die Schnittstelle ${p} ist mit Status ${st} abgestürzt – der Kunde hat eine Fehlermeldung gesehen.`, fix: kasse ? 'Olivia prüft Stripe live (Technik). Häufigste Ursache: Preis-ID oder Stripe-Schlüssel ungültig. Vercel → Logs → /api/billing/checkout zeigt die genaue Meldung; an Claude melden.' : `Vercel → Logs → ${p} öffnen und die Meldung im Chat mit Claude melden – wird dann behoben.` };
    if (st === 429) return { kind: 'formular', level: many ? 'hoch' : 'mittel', customer, title: `Kunde wurde vom Missbrauchsschutz gebremst (${p})`, cause: 'Zu viele Versuche in kurzer Zeit – bei echten Kunden ist die Grenze zu streng.', fix: `Grenze für ${p} in lib/security/rate-limit.ts lockern (an Claude melden), wenn das kein Angriff war (Jake prüft Angriffe).` };
    if (kasse) return { kind: 'kasse', level: 'hoch', customer, title: `Kasse hat den Kunden abgewiesen (Status ${st})`, cause: st === 401 || st === 403 ? 'Der Kunde war nicht (mehr) angemeldet, als er bezahlen wollte.' : 'Die Kasse hat die Bestellung abgelehnt (z. B. fehlende Zustimmung, unbekanntes Paket).', fix: 'Kaufweg einmal selbst durchklicken (Preise → Paket wählen → Kasse). Bleibt es, Status und Seite an Claude melden.' };
    if (FORM_PATHS.test(p)) return { kind: 'formular', level: many ? 'hoch' : 'mittel', customer, title: `Kunde scheiterte am Formular ${p} (Status ${st}${many ? `, ${e.count}×` : ''})`, cause: st === 400 || st === 422 ? 'Die Eingabe wurde abgelehnt – entweder ein Tippfehler des Kunden oder eine zu strenge Prüfung.' : `Die Schnittstelle hat mit ${st} geantwortet.`, fix: many ? `Mehrere Kunden betroffen – Prüfregeln von ${p} an Claude melden.` : 'Einzelfall, meist eine falsche Eingabe. Tyler beobachtet, ob es sich wiederholt.' };
    return { kind: 'server', level: 'niedrig', customer, title: `${p} antwortet mit ${st}`, cause: 'Anfrage abgelehnt.', fix: 'Beobachten.' };
  }
  if (/^(Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|The network connection was lost\.?)$/i.test(m)) return many ? { kind: 'netz', level: 'mittel', customer, title: `Verbindungsabbrüche auf ${where(e.page)} (${e.count}×)`, cause: 'Anfragen der Seite kommen nicht an – Funkloch oder eine Schnittstelle ist zu langsam.', fix: 'In Noahs Bericht die Antwortzeiten ansehen; bleibt es, an Claude melden.' } : { kind: 'netz', level: 'niedrig', customer, auto: true, title: 'Einzelner Verbindungsabbruch', cause: 'Meist ein Funkloch beim Kunden.', fix: 'Automatisch abgehakt.' };
  if (/is not a valid selector/i.test(m)) return { kind: 'programm', level: 'mittel', customer, title: `Älterer Browser kann ${file(e.source)} nicht ausführen`, cause: `Der Browser (${e.browser || 'unbekannt'}) kennt eine neuere CSS-Abfrage nicht.`, fix: `An Claude melden: „Selektor in ${file(e.source)} für ältere Browser absichern“.` };
  if (/Cannot (read|set) propert|null is not an object|undefined is not (an object|a function)|is not a function|is not defined|SyntaxError|TypeError|ReferenceError/i.test(m)) return { kind: 'programm', level: customer ? 'hoch' : 'niedrig', customer, title: `Programmfehler auf ${where(e.page)}${customer ? ' – Kunde betroffen' : ''}`, cause: `In ${file(e.source)} bricht ein Programmschritt ab (${e.browser || 'Browser unbekannt'}). Der Kunde kann an dieser Stelle nicht weiter.`, fix: `Im Chat mit Claude melden: „Fehler in ${file(e.source)} auf ${e.page || '/'}: ${m.slice(0, 90)}“ – wird dann behoben.` };
  return { kind: 'sonstig', level: many ? 'mittel' : 'niedrig', customer, title: `Fehler auf ${where(e.page)}`, cause: m.slice(0, 140), fix: 'Beobachten; bei Häufung an Claude melden.' };
}


// ---------- Serverfehler (aus lib/admin/server-error.ts): Stripe, Datenbank, Schnittstellen ----------
// Tyler kennt die typischen Ablehnungsgründe von Stripe und sagt genau, welche Einstellung schuld ist.
const STRIPE_HINTS: [RegExp, string, string][] = [
  [/no longer supported|ui_mode value/i, 'Stripe hat den Modus der eingebetteten Kasse umbenannt (embedded → embedded_page).', 'In lib/billing/checkout-params.ts EMBED_MODE auf „embedded_page“ setzen (an Claude melden). Kunden wurden auf die Stripe-Bezahlseite umgeleitet.'],
  [/cannot set `?logo`?|branding_settings|branding/i, 'Stripe erlaubt bei der eingebetteten Kasse kein eigenes Logo/Branding.', 'Logo und Branding nur bei der Weiterleitung mitgeben, bei der eingebetteten Kasse entfernen (lib/billing/checkout-params.ts → toEmbedded).'],
  [/submit_type/i, 'Stripe akzeptiert den Bestellknopf-Text (submit_type) bei diesem Vertragsmodus nicht.', 'Ohne submit_type erneut anlegen – das macht die Kasse automatisch (createCheckoutSession).'],
  [/managed_payments|custom_text/i, 'Stripe lehnt eine Einstellung der Bezahlseite ab (Managed Payments oder Hinweistext).', 'Stripe → Einstellungen → Managed Payments prüfen; im Code NO_MANAGED_PAYMENTS/custom_text an Claude melden.'],
  [/No such (price|product|customer|tax_rate)/i, 'Stripe kennt die hinterlegte Preis-, Produkt-, Kunden- oder Steuersatz-ID nicht (gelöscht oder aus dem anderen Modus Test/Live).', 'In Stripe prüfen, ob Preise/Steuersatz im richtigen Modus existieren; Olivia (Technik) zeigt den Stripe-Status. Danach „Alles live prüfen“.'],
  [/api key|api_key|authentication|invalid.*key/i, 'Der Stripe-Schlüssel ist ungültig oder passt nicht zum Modus.', 'Vercel → Environment Variables → STRIPE_SECRET_KEY und STRIPE_PUBLISHABLE_KEY prüfen (beide live oder beide test).'],
  [/rate limit|too many requests/i, 'Stripe bremst wegen zu vieler Anfragen.', 'Kurz warten; häuft es sich, Anfragen an Stripe im Code bündeln (an Claude melden).'],
  [/timeout|ETIMEDOUT|ECONNRESET|fetch failed|socket hang up|network/i, 'Verbindung zu einem Dienst (Stripe, Datenbank) ist abgebrochen.', 'status.stripe.com und status.supabase.com prüfen. Einmalig: beobachten. Wiederholt: an Claude melden.'],
  [/JWT|permission denied|row-level security|relation .* does not exist|column .* does not exist/i, 'Die Datenbank hat die Anfrage abgelehnt (Rechte oder fehlende Tabelle/Spalte).', 'Supabase → SQL-Editor: fehlende Migration aus docs/sql ausführen bzw. Rechte prüfen (an Claude melden).'],
];
function serverDiag(tag: string, path: string, msg: string, e: ErrRow): Diag {
  const kasse = /checkout|billing|b2b\/checkout|kasse|pm_|price/i.test(`${tag} ${path}`), ausweichen = /fallback|ausweichen/i.test(`${tag} ${e.source || ''}`);
  const customer = (e.area || 'website') !== 'admin';
  const hint = STRIPE_HINTS.find(([re]) => re.test(msg));
  const cause = hint ? hint[1] : `Die Schnittstelle ${path} ist abgestürzt: „${msg.slice(0, 120)}“.`;
  const fix = hint ? hint[2] : `Vercel → Logs → ${path} öffnen und die Meldung im Chat mit Claude melden – wird dann behoben.`;
  if (kasse && ausweichen) return { kind: 'kasse', level: e.count >= 3 ? 'mittel' : 'niedrig', customer, title: `Eingebettete Kasse ausgefallen – ${e.count === 1 ? 'Kunde wurde' : `${e.count}× wurden Kunden`} zur Stripe-Bezahlseite umgeleitet`, cause: `${cause} Der Kauf war weiter möglich (Weiterleitung zu Stripe).`, fix };
  if (kasse) return { kind: 'kasse', level: 'hoch', customer, title: `Kasse abgestürzt – Kunde konnte nicht bezahlen (${path})`, cause, fix };
  if (ausweichen) return { kind: 'server', level: 'niedrig', customer, title: `${path}: Ausweichlösung aktiv`, cause, fix };
  return { kind: 'server', level: customer ? 'hoch' : 'mittel', customer, title: `Serverfehler bei ${path}${customer ? ' – Kunde betroffen' : ''}`, cause, fix };
}
