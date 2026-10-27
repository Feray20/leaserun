// Getrennte Konten je Portal: Der Creator-Bereich hat eigene Konten, unabhängig von Kundenbereich und Unternehmensportal.
// Supabase erlaubt jede E-Mail-Adresse nur einmal je Projekt. Deshalb bekommt jedes Creator-Konto intern eine eigene,
// aus der echten Adresse abgeleitete Kennung (c-<hash>@creator.leaserun.com). Die echte Adresse steht in user_metadata.contact_email
// und wird für Anmeldung, Anzeige und alle E-Mails verwendet. An die interne Kennung wird nie etwas gesendet.
import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const CREATOR_ID_DOMAIN = 'creator.leaserun.com';

export function creatorAuthEmail(real: string): string {
  const e = real.trim().toLowerCase();
  return `c-${createHash('sha256').update('leaserun-creator:' + e).digest('hex').slice(0, 32)}@${CREATOR_ID_DOMAIN}`;
}

export const isCreatorAuthEmail = (e?: string | null): boolean => Boolean(e && e.toLowerCase().endsWith('@' + CREATOR_ID_DOMAIN));

type UserLike = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null };
const cache = new Map<string, string>();

// Echte Kontaktadresse eines Kontos (bei Creator-Konten aus den Metadaten, sonst die Login-Adresse).
export async function contactEmail(u: UserLike | null | undefined): Promise<string> {
  if (!u) return '';
  const meta = u.user_metadata?.contact_email;
  if (typeof meta === 'string' && meta) return meta;
  if (!isCreatorAuthEmail(u.email)) return u.email || '';
  const hit = cache.get(u.id);
  if (hit) return hit;
  const { data } = await supabaseAdmin().auth.admin.getUserById(u.id);
  const real = (data?.user?.user_metadata?.contact_email as string | undefined) || '';
  if (real) cache.set(u.id, real);
  return real;
}

// Öffentliche Supabase-Auth-Schnittstelle (mit dem öffentlichen Schlüssel) – für Anmeldung und Einmal-Links.
export async function authApi(path: string, body: unknown, token?: string): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false, status: 503, data: {} };
  const r = await fetch(url + '/auth/v1' + path, {
    method: 'POST', cache: 'no-store',
    headers: { apikey: key, 'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!r) return { ok: false, status: 502, data: {} };
  return { ok: r.ok, status: r.status, data: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

// Sitzung für ein Creator-Konto ohne Passwort ausstellen (z. B. nach Google-Anmeldung): Einmal-Link erzeugen und sofort einlösen.
export async function sessionFor(authEmail: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin().auth.admin.generateLink({ type: 'magiclink', email: authEmail });
  const th = data?.properties?.hashed_token;
  if (error || !th) return null;
  const v = await authApi('/verify', { type: 'magiclink', token_hash: th });
  return v.ok && v.data.access_token ? v.data : null;
}
