import { createHash } from 'node:crypto';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Dauerhafte Begrenzung über die Datenbank (gilt über alle Server-Instanzen hinweg, anders als der Speicher-Zähler).
// Für alles, was E-Mails an frei eingegebene Adressen auslöst. Fällt die Datenbank aus, bleibt der Speicher-Zähler aktiv.
export async function durableAllow(bucket: string, windowSeconds: number, limit: number): Promise<boolean> {
  if (!adminConfigured()) return true;
  try {
    const { data, error } = await supabaseAdmin().rpc('api_rate_take', { p_bucket: `ia:${bucket}`.slice(0, 200), p_window_seconds: windowSeconds, p_limit: limit });
    if (error) return true;
    const used = Number((Array.isArray(data) ? data[0] : data)?.used || 0);
    return used <= limit;
  } catch { return true; }
}
// Empfänger nie im Klartext als Zählerschlüssel speichern.
export const keyOf = (s: string) => createHash('sha256').update(`rl:${s.trim().toLowerCase()}`).digest('hex').slice(0, 24);

// Schutz für Bestätigungs-Mails an frei eingegebene Adressen: je Empfänger 3 am Tag, insgesamt 150 pro Stunde.
export async function mailToAllowed(kind: string, email: string): Promise<boolean> {
  const [one, all] = await Promise.all([durableAllow(`${kind}:to:${keyOf(email)}`, 86400, 3), durableAllow(`${kind}:all`, 3600, 150)]);
  return one && all;
}
// Keine Links in Feldern, die in Mails an Dritte landen (Phishing-Schutz).
export const hasLink = (s: string) => /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|de|net|org|io|ru|cn|xyz|top|info|app|link|ly)\b)/i.test(s);
