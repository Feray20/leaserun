import { adminEmailsFor } from '@/lib/security/admin';
import type { AdminArea } from '@/lib/security/roles';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Mitteilungen an die Admin-App (Expo Push). Auf dem Sperrbildschirm erscheint nur der Anlass –
// bewusst keine Namen, Adressen oder Beträge. Fehler werden protokolliert und nie weitergegeben,
// damit ein Push-Problem Zahlung, Postfach oder Terminbuchung nicht stört.
export type PushKind = 'payment' | 'mail' | 'booking' | 'security' | 'support';
export type PushPrefs = Record<PushKind, boolean>;
export const DEFAULT_PUSH_PREFS: PushPrefs = { payment: true, mail: true, booking: true, security: true, support: true };
// Wer welche Mitteilung bekommt: Teammitglieder nur für Bereiche ihrer Rolle, Sicherheit nur die Inhaber.
const KIND_AREA: Record<PushKind, AdminArea | 'owner'> = { payment: 'finance', mail: 'mail', booking: 'termine', security: 'owner', support: 'support' };

// event: genauer Anlass (z. B. payment_failed) – die App öffnet damit direkt den passenden Bereich.
// Datenschutz: Push-Inhalte laufen über den Expo-Push-Dienst (USA). Deshalb nie personenbezogene Daten senden –
// E-Mail-Adressen werden zusätzlich zentral entfernt, falls ein Aufrufer sie doch übergibt.
const scrub = (t: string) => String(t || '').replace(/[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}/gi, '[E-Mail]').slice(0, 160);
export async function pushAdmins(kind: PushKind, title: string, body: string, event?: string): Promise<void> {
  title = scrub(title); body = scrub(body);
  try {
    if (!adminConfigured()) return;
    const admins = await adminEmailsFor(KIND_AREA[kind]);
    if (!admins.length) return;
    const db = supabaseAdmin();
    const { data } = await db.from('lr_admin_push_tokens').select('token, prefs').in('email', admins);
    const tokens = (data ?? []).filter((r) => (r.prefs as Partial<PushPrefs> | null)?.[kind] !== false).map((r) => String(r.token));
    if (!tokens.length) return;
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default', data: { kind, event: event ?? kind }, ...(kind === 'security' || kind === 'support' || event === 'payment_failed' ? { priority: 'high', interruptionLevel: 'time-sensitive' } : {}) }))),
      signal: AbortSignal.timeout(5000),
    });
    const j = (await res.json().catch(() => null)) as { data?: { details?: { error?: string } }[] } | null;
    // Abgemeldete Geräte aufräumen.
    const dead = tokens.filter((_, i) => j?.data?.[i]?.details?.error === 'DeviceNotRegistered');
    if (dead.length) await db.from('lr_admin_push_tokens').delete().in('token', dead);
  } catch (e) {
    console.warn('admin_push', e instanceof Error ? e.message : e);
  }
}

// Mitteilung nur an die Geräte eines einzelnen Admins (z. B. Push-Test aus der App). Liefert die Anzahl der Geräte.
export async function pushToUser(userId: string, title: string, body: string, event = 'test'): Promise<number> {
  if (!adminConfigured()) return 0;
  const db = supabaseAdmin();
  const { data } = await db.from('lr_admin_push_tokens').select('token').eq('user_id', userId);
  const tokens = (data ?? []).map((r) => String(r.token));
  if (!tokens.length) return 0;
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default', data: { kind: 'security', event } }))),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error('push_service');
  return tokens.length;
}

