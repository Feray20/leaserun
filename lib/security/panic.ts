import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Not-Aus: Solange aktiv, weisen alle angemeldeten Schnittstellen Nicht-Administratoren ab (Sitzungen wirken wie beendet),
// Partnerseiten, Widget und Anfragen sind abgeschaltet. Gespeichert in immo_settings, 15 s zwischengespeichert.
export type Panic = { active: boolean; since?: string; by?: string; reason?: string };

let cache: { v: Panic; until: number } | null = null;

export async function panicState(): Promise<Panic> {
  const now = Date.now();
  if (cache && cache.until > now) return cache.v;
  let v: Panic = { active: false };
  if (adminConfigured()) {
    const { data } = await supabaseAdmin().from('immo_settings').select('value').eq('key', 'panic').maybeSingle();
    if (data?.value && typeof data.value === 'object') v = data.value as Panic;
  }
  cache = { v, until: now + 15_000 };
  return v;
}

export async function setPanic(active: boolean, by: string, reason = ''): Promise<void> {
  const value: Panic = active ? { active: true, since: new Date().toISOString(), by, reason } : { active: false };
  await supabaseAdmin().from('immo_settings').upsert({ key: 'panic', value, updated_at: new Date().toISOString(), updated_by: by });
  cache = { v: value, until: Date.now() + 15_000 };
}

// IP-Freigabeliste für den Admin-Bereich: auf Wunsch des Betreibers abgeschaltet (Zugriff unterwegs per Handy
// mit wechselnder IP). Schutz bleibt: Anmeldung, Admin-Liste (ADMIN_EMAILS), Zwei-Faktor, Zeitlimit, Not-Aus.
// Eine gesetzte Variable ADMIN_IP_ALLOWLIST wird bewusst ignoriert.
export function ipAllowed(_req: Request): boolean {
  return true;
}
