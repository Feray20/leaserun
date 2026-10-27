import { supabaseAdmin } from '@/lib/supabase/admin';
import { pseudoWith } from '@/lib/security/pseudo';

// Globale Werbe-Sperrliste (§ 7 UWG, Art. 21 Abs. 3 DSGVO): Nach einem Werbewiderspruch wird der Kontakt hier dauerhaft
// gesperrt – nur als Hash von E-Mail bzw. Firma+PLZ, ohne Klartext. Neu erfasste oder importierte Kontakte, Serienbriefe
// und Kampagnen prüfen gegen diese Liste. Löschen eines CRM-Kontakts hebt die Sperre nicht auf.
type C = { email?: string | null; company?: string | null; postal_code?: string | null; postalCode?: string | null };
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\b(gmbh|ug|ag|kg|ohg|e\.?\s?k\.?|mbh|co)\b/g, '').replace(/[^a-z0-9]/g, '');
let saltCache: string | null = null;
async function salt(): Promise<string> {
  if (saltCache) return saltCache;
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'log_salt').maybeSingle();
  saltCache = typeof data?.value === 'string' ? data.value : '';
  if (!saltCache) throw new Error('log_salt fehlt');
  return saltCache;
}
export async function suppressionKeys(c: C): Promise<{ key: string; kind: 'email' | 'firma' }[]> {
  const s = await salt();
  const out: { key: string; kind: 'email' | 'firma' }[] = [];
  if (c.email && c.email.includes('@')) out.push({ key: pseudoWith(s, 'supp-mail:' + c.email.trim().toLowerCase()), kind: 'email' });
  const plz = c.postal_code ?? c.postalCode;
  if (c.company && plz) out.push({ key: pseudoWith(s, 'supp-firma:' + norm(c.company) + ':' + plz), kind: 'firma' });
  return out;
}
export async function suppress(c: C, reason = 'werbewiderspruch'): Promise<void> {
  const keys = await suppressionKeys(c);
  if (keys.length) await supabaseAdmin().from('lr_suppression').upsert(keys.map((k) => ({ key_hash: k.key, kind: k.kind, reason })), { onConflict: 'key_hash', ignoreDuplicates: true });
}
// Liefert für jede Eingabe true, wenn sie gesperrt ist.
export async function isSuppressed(list: C[]): Promise<boolean[]> {
  const keys = await Promise.all(list.map(suppressionKeys));
  const all = [...new Set(keys.flat().map((k) => k.key))];
  if (!all.length) return list.map(() => false);
  const hit = new Set<string>();
  for (let i = 0; i < all.length; i += 500) {
    const { data } = await supabaseAdmin().from('lr_suppression').select('key_hash').in('key_hash', all.slice(i, i + 500));
    (data ?? []).forEach((r) => hit.add(r.key_hash));
  }
  return keys.map((ks) => ks.some((k) => hit.has(k.key)));
}
