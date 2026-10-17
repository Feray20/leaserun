import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Pseudonymisierung von Kennungen in Protokollen (Art. 5 Abs. 1 lit. c, Art. 32 DSGVO): SHA-256 mit geheimem Salz
// (immo_settings.log_salt, nur serverseitig). Klartext wird nur im Web-Admin (Anmeldung mit zweitem Faktor) auf
// ausdrücklichen Klick wieder zugeordnet – und dieser Vorgang selbst wird protokolliert.
let salt: { v: string; until: number } | null = null;
async function getSalt(): Promise<string> {
  if (salt && salt.until > Date.now()) return salt.v;
  const { data } = await supabaseAdmin().from('immo_settings').select('value').eq('key', 'log_salt').maybeSingle();
  const v = typeof data?.value === 'string' ? data.value : '';
  if (!v) throw new Error('log_salt fehlt');
  salt = { v, until: Date.now() + 10 * 60_000 };
  return v;
}
export const pseudoWith = (s: string, id: string) => 'ps:' + createHash('sha256').update(s + id.trim().toLowerCase()).digest('hex').slice(0, 16);
export async function pseudo(id: string): Promise<string> {
  if (!id || !id.includes('@')) return id;
  return pseudoWith(await getSalt(), id);
}
// Zuordnung Pseudonym → E-Mail für eine Liste bekannter Adressen.
export async function revealMap(emails: string[]): Promise<Map<string, string>> {
  const s = await getSalt();
  return new Map(emails.filter(Boolean).map((e) => [pseudoWith(s, e), e.toLowerCase()]));
}
export async function scrubMeta(meta: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta || {})) out[k] = typeof v === 'string' && v.includes('@') ? await pseudo(v) : v;
  return out;
}
