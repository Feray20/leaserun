import { createHmac } from 'node:crypto';
// Einwilligungstexte für werbliche E-Mails (Double-Opt-in). Werden mit jeder Anmeldung gespeichert.
export const CONSENT_B2B = 'Ich möchte Neuigkeiten zu ImmoAdv für Unternehmen (neue Funktionen, Praxiswissen, Angebote) per E-Mail erhalten. Die Einwilligung kann ich jederzeit über den Abmeldelink in jeder E-Mail oder per Nachricht an support@immoadv.de widerrufen.';
export const CONSENT_B2C = 'Ich möchte Neuigkeiten zu ImmoAdv (neue Funktionen, Wissen rund um Immobilien, Angebote) per E-Mail erhalten. Die Einwilligung kann ich jederzeit über den Abmeldelink in jeder E-Mail oder per Nachricht an support@immoadv.de widerrufen.';

// Abmeldelink je Empfänger: Kennung plus Signatur (ohne gespeichertes Geheimnis je Empfänger).
const secret = () => process.env.NEWSLETTER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'immoadv-newsletter';
export const unsubToken = (id: string) => `${id}.${createHmac('sha256', secret()).update('unsub:' + id).digest('base64url').slice(0, 22)}`;
export function unsubId(t: string): string | null {
  const [id, sig] = String(t).split('.');
  if (!/^[0-9a-f-]{36}$/.test(id || '') || !sig) return null;
  return unsubToken(id) === t ? id : null;
}
