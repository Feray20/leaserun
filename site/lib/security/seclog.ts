import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Sicherheitsprotokoll: gedrosselte Zugriffe und abgewiesene Admin-Zugriffe. Gespeichert wird nur der Bereich
// und ein gekürzter Hash des Schlüssels (keine IP-Adresse, keine Nutzer-ID im Klartext); Löschung nach 30 Tagen.
export type SecKind =
  | 'rate_limit' | 'admin_denied' | 'admin_ip_blocked' | 'admin_mfa_missing' | 'panic'
  // Formular-Abwehr (Bots/Fakes):
  | 'honeypot' | 'too_fast' | 'disposable_email' | 'email_no_mx' | 'content_flagged'
  // Angriffe:
  | 'probe' | 'blocked' | 'login_flood' | 'upload_rejected' | 'creator_oauth_reject' | 'mail_abuse'
  // Buchhaltung (GoBD):
  | 'invoice_tampered';

export function logSecurity(kind: SecKind, key: string, extra: { ipHash?: string | null; detail?: string | null } = {}): void {
  if (!adminConfigured()) return;
  const [bucket] = key.split(':');
  const subject = createHash('sha256').update(`seclog:${key}`).digest('hex').slice(0, 12);
  const ip = extra.ipHash && /^[0-9a-f]{32}$/.test(extra.ipHash) ? extra.ipHash : (/(?:^|:)([0-9a-f]{32})(?:$|:)/.exec(key)?.[1] ?? null);
  const work = async () => {
    // Eigene Geräte/Netze der Betreiberin nie als Vorfall erfassen.
    if (ip && await (await import('@/lib/security/trusted')).isTrustedIp(ip)) return;
    await supabaseAdmin().from('lr_security_log').insert({ kind, bucket: bucket.slice(0, 40), subject, ip_hash: ip, detail: extra.detail ? extra.detail.slice(0, 160) : null });
    await (await import('@/lib/security/alert')).maybeAlert(kind, bucket);
    await (await import('@/lib/security/autoblock')).maybeAutoBlock(kind, ip);
  };
  // Nach der Antwort weiterarbeiten (Serverless), außerhalb einer Anfrage direkt.
  try { after(() => work().catch(() => null)); } catch { work().catch(() => null); }
}

// Kurzform für die Formular-Abwehr: Art des Blocks plus Bereich (ohne personenbezogene Daten).
export function reportBlock(kind: SecKind, bucket: string): void {
  logSecurity(kind, `${bucket}:form`);
}
