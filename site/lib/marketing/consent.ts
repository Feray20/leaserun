import { createHmac } from 'node:crypto';
import { secretFor, verifySecrets } from '@/lib/security/secrets';
// Einwilligungstexte für werbliche E-Mails (Double-Opt-in). Werden mit jeder Anmeldung gespeichert.
export const CONSENT_B2B = 'Ich möchte Neuigkeiten zu LeaseRun für Unternehmen (neue Funktionen, Praxiswissen, Angebote) per E-Mail erhalten. Die Einwilligung kann ich jederzeit über den Abmeldelink in jeder E-Mail oder per Nachricht an support@leaserun.com widerrufen.';
export const CONSENT_B2C = 'Ich möchte Neuigkeiten zu LeaseRun (neue Funktionen, Wissen rund um Immobilien, Angebote) per E-Mail erhalten. Die Einwilligung kann ich jederzeit über den Abmeldelink in jeder E-Mail oder per Nachricht an support@leaserun.com widerrufen.';
// Anmeldebox „Kauf-Checkliste + Zins-Update“ (öffentliche Seiten): genau der Text am Kontrollkästchen, plus Zweck aus der Überschrift.
export const CONSENT_B2C_BOX = 'Ich möchte den LeaseRun-Newsletter erhalten. Abmeldung jederzeit über den Link in jeder E-Mail. (Anmeldebox: Kauf-Checkliste als PDF + monatliches Zins-Update)';

// Abmeldelink je Empfänger: Kennung plus Signatur (ohne gespeichertes Geheimnis je Empfänger).
const tok = (id: string, key: string) => `${id}.${createHmac('sha256', key).update('unsub:' + id).digest('base64url').slice(0, 22)}`;
export const unsubToken = (id: string) => tok(id, secretFor('newsletter'));
export function unsubId(t: string): string | null {
  const [id, sig] = String(t).split('.');
  if (!/^[0-9a-f-]{36}$/.test(id || '') || !sig) return null;
  return verifySecrets('newsletter').some((k) => tok(id, k) === t) ? id : null;
}
