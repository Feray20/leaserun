// Abwehr von Bots und Fake-Anfragen auf den öffentlichen Formularen (Lead, Kontakt, Kündigung).
// Grundsatz: hart gegen eindeutige Bot-/Fake-Signale, aber im Zweifel DURCHLASSEN – ein echter
// Interessent darf nie an einer unsicheren Prüfung (z. B. DNS kurz nicht erreichbar) scheitern.
// Reine Prüfungen (Syntax, Wegwerf-Domain, Honigtopf, Zeitfalle, Spam-Score) liegen in antispam-pure.ts.

import { reportBlock } from '@/lib/security/seclog';
import { checkEmailShape, honeypotTripped, spamScore, tooFast } from '@/lib/security/antispam-pure';

export * from '@/lib/security/antispam-pure';

// ---------------------------------------------------------------------------
// Netzprüfung: Kann die Domain überhaupt E-Mail empfangen? (DNS MX, sonst A/AAAA)
// Fail-open: jeder DNS-Fehler/Timeout → als „empfangsfähig“ behandeln.
// ---------------------------------------------------------------------------

const mxCache = new Map<string, { ok: boolean; at: number }>();
const MX_TTL = 60 * 60_000;

export async function domainCanReceiveMail(domain: string): Promise<boolean> {
  if (!domain) return false;
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_TTL) return cached.ok;
  let ok = true; // im Zweifel durchlassen
  try {
    const dns = await import('node:dns/promises');
    const withTimeout = <T>(p: Promise<T>) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))]);
    try {
      const mx = (await withTimeout(dns.resolveMx(domain))) as { exchange: string }[];
      ok = Array.isArray(mx) && mx.some((r) => r.exchange);
    } catch (e) {
      // Kein MX-Eintrag: manche Domains empfangen über den A-/AAAA-Record (RFC 5321 Fallback).
      const err = e as { code?: string };
      if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
        try {
          const a = await withTimeout(dns.resolve(domain)).then(() => true).catch(() => dns.resolve6(domain).then(() => true).catch(() => false));
          // ENOTFOUND beim MX heißt oft: Domain existiert nicht → nur dann blocken, wenn auch kein A-Record.
          ok = err.code === 'ENOTFOUND' ? (a as boolean) : true;
        } catch { ok = true; }
      } else {
        ok = true; // SERVFAIL/Timeout/sonstiges → durchlassen
      }
    }
  } catch { ok = true; }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

// ---------------------------------------------------------------------------
// Gesamtprüfung für einen Formular-Eingang.
// ---------------------------------------------------------------------------

export type GuardInput = { email?: string; name?: string; message?: string; website?: unknown; ts?: unknown; bucket: string };
export type GuardResult =
  | { action: 'allow'; flagged: boolean; score: number; emailDomain: string }
  | { action: 'drop' }                              // stillschweigend verwerfen (Bot) → 201/ok vortäuschen
  | { action: 'reject'; field: 'email'; error: string; suggestion?: string };

// Reihenfolge: zuerst stille Bot-Signale (Honeypot/Zeit), dann für Menschen sichtbare E-Mail-Prüfung.
export async function guardSubmission(inp: GuardInput): Promise<GuardResult> {
  if (honeypotTripped(inp.website)) { reportBlock('honeypot', inp.bucket); return { action: 'drop' }; }
  if (tooFast(inp.ts)) { reportBlock('too_fast', inp.bucket); return { action: 'drop' }; }

  const shape = checkEmailShape(String(inp.email || ''));
  if (!shape.ok) {
    if (shape.reason === 'wegwerf') { reportBlock('disposable_email', inp.bucket); return { action: 'reject', field: 'email', error: 'Bitte eine dauerhafte, persönliche E-Mail-Adresse angeben (keine Wegwerf-Adresse).' }; }
    if (shape.reason === 'tippfehler') return { action: 'reject', field: 'email', error: `Meinten Sie ${shape.suggestion}?`, suggestion: shape.suggestion };
    return { action: 'reject', field: 'email', error: 'Bitte eine gültige E-Mail-Adresse angeben.' };
  }

  if (!(await domainCanReceiveMail(shape.domain))) {
    reportBlock('email_no_mx', inp.bucket);
    return { action: 'reject', field: 'email', error: 'Diese E-Mail-Domain kann keine Nachrichten empfangen. Bitte die Adresse prüfen.' };
  }

  const score = spamScore(String(inp.message || ''), String(inp.name || ''));
  const flagged = score >= 4; // nur markieren, Anfrage kommt trotzdem an
  if (flagged) reportBlock('content_flagged', inp.bucket);
  return { action: 'allow', flagged, score, emailDomain: shape.domain };
}
