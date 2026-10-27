import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Not-Aus in zwei Stufen. Gespeichert in lr_settings, 15 s zwischengespeichert.
// Stufe 1 (Soft Lock): Neuanmeldungen, Käufe, Anfragen, Partnerseiten, Widget und B2B-Schnittstellen aus;
//   angemeldete Nutzer können nur noch lesen (keine Änderungen), Administratoren arbeiten normal.
// Stufe 2 (Hard Lock): zusätzlich weisen alle Schnittstellen Nicht-Administratoren ab, ihre Sitzungen werden beendet
//   (Datenbankfunktion lr_revoke_sessions, siehe docs/sql) und der tägliche Lauf pausiert.
// Ältere Einträge ohne Stufe gelten als Stufe 2 (bisheriges Verhalten).
export type PanicLevel = 0 | 1 | 2;
export type Panic = { active: boolean; level?: 1 | 2; since?: string; by?: string; reason?: string; revoked?: number | null };
export const panicLevel = (p: Panic | null | undefined): PanicLevel => (p?.active ? (p.level === 1 ? 1 : 2) : 0);

let cache: { v: Panic; until: number } | null = null;

export async function panicState(): Promise<Panic> {
  const now = Date.now();
  if (cache && cache.until > now) return cache.v;
  let v: Panic = { active: false };
  if (adminConfigured()) {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'panic').maybeSingle();
    if (data?.value && typeof data.value === 'object') v = data.value as Panic;
  }
  cache = { v, until: now + 15_000 };
  return v;
}

export async function setPanic(active: boolean, by: string, reason = '', level: 1 | 2 = 2, keepEmails: string[] = []): Promise<Panic> {
  let revoked: number | null = null;
  // Stufe 2: alle Sitzungen außer denen der Administratoren beenden (falls die Datenbankfunktion eingerichtet ist).
  if (active && level === 2) {
    const r = await supabaseAdmin().rpc('lr_revoke_sessions', { keep_emails: keepEmails }).then((x) => x, () => null);
    revoked = r && !r.error && typeof r.data === 'number' ? r.data : null;
  }
  const value: Panic = active ? { active: true, level, since: new Date().toISOString(), by, reason, revoked } : { active: false };
  await supabaseAdmin().from('lr_settings').upsert({ key: 'panic', value, updated_at: new Date().toISOString(), updated_by: by });
  cache = { v: value, until: Date.now() + 15_000 };
  return value;
}

// IP-Freigabeliste für den Admin-Bereich: auf Wunsch des Betreibers abgeschaltet (Zugriff unterwegs per Handy
// mit wechselnder IP). Schutz bleibt: Anmeldung, Admin-Liste (ADMIN_EMAILS), Zwei-Faktor, Zeitlimit, Not-Aus.
// Eine gesetzte Variable ADMIN_IP_ALLOWLIST wird bewusst ignoriert.
export function ipAllowed(_req: Request): boolean {
  return true;
}

// Not-Aus (jede Stufe): keine Neuanmeldungen, Käufe und Anfragen. Antwort für die betroffenen Schnittstellen.
export async function intakeClosed(): Promise<boolean> {
  return panicLevel(await panicState().catch(() => ({ active: false }))) > 0;
}
