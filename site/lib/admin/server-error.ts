import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Serverfehler für die HQ-Mitarbeiter sichtbar machen. Bisher sah Tyler nur, was im Browser des Kunden schiefging;
// Fehler in den Schnittstellen (z. B. Stripe lehnt die Kasse ab) standen nur in den Vercel-Logs. Jetzt landen sie
// in derselben Fehlerliste wie Browserfehler (Quelle „server“), Tyler bestimmt sofort Ursache und Lösung und meldet
// echte Kundenfehler aufs Gerät – ohne externe Dienste, ohne Kosten. Keine personenbezogenen Daten: E-Mail-Adressen,
// lange Zahlen und Schlüssel werden vor dem Speichern entfernt.
export type ServerErrorLevel = 'fehler' | 'ausweichen';
// Kurzer, stabiler Fingerabdruck ohne node:crypto (die Datei wird auch für den Edge-Bereich gebündelt).
function fingerprint(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = Math.imul(h2 ^ c, 0x9e3779b1); }
  return `s${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}
const clean = (t: string) => String(t || '')
  .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[E-Mail]')
  .replace(/\b(sk|pk|rk|whsec|re)_(live|test)_[A-Za-z0-9]+/g, '[Schlüssel]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [Token]')
  .replace(/\d{6,}/g, '[Zahl]')
  .replace(/\s+/g, ' ').trim();
const areaOf = (path: string) => (/^\/api\/admin|^\/intern/.test(path) ? 'admin' : /^\/api\/b2b|^\/b2b-portal|^\/partner/.test(path) ? 'portal' : /^\/api\/(billing|account|me|auth|kreditmappe|unterlagen|documents)|^\/app/.test(path) ? 'app' : 'website');

// tag: kurzer Name der Stelle (z. B. checkout_error), path: Pfad der Schnittstelle, level „ausweichen“ = Kunde kam noch
// ans Ziel (z. B. Stripe-Bezahlseite statt eingebetteter Kasse), „fehler“ = Kunde hat eine Fehlermeldung gesehen.
export async function reportServerError(tag: string, e: unknown, path: string, level: ServerErrorLevel = 'fehler'): Promise<void> {
  try {
    if (!adminConfigured()) return;
    const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e ?? '').slice(0, 200);
    const msg = `Server · ${tag} · ${path.replace(/[?#].*$/, '')}: ${clean(raw)}`.slice(0, 300);
    const fp = fingerprint(`${tag}|${path}|${clean(raw).slice(0, 80)}`);
    const db = supabaseAdmin();
    await db.rpc('lr_log_client_error', { fp, msg, src: `server:${tag}:${level}`, pg: path.replace(/[?#].*$/, ''), ar: areaOf(path), br: 'server' });
    await import('@/lib/admin/kundenreise').then((k) => k.reactNow(fp)).catch((x) => console.warn('kundenreise', (x as Error).message));
  } catch (x) {
    console.warn('server_error_report', x instanceof Error ? x.message : x);
  }
}
