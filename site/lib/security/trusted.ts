import { createHmac, timingSafeEqual } from 'node:crypto';
import { secretFor, verifySecrets } from '@/lib/security/secrets';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';

// Eigene Geräte der Betreiberin: werden nie als Vorfall erfasst, nie automatisch gesperrt.
// Zwei Merkmale: (1) Geräte-Cookie „lr_own“ (signiert, 1 Jahr) – gilt in jedem Netz;
// (2) anonymisierte Netzkennung (IP-Hash), automatisch gelernt bei jeder erfolgreichen Admin-Anmeldung (30 Tage gültig ab letzter Nutzung).
export const OWN_COOKIE = 'lr_own';
const TTL = 30 * 864e5;
type Entry = { ip: string; label: string; at: string; seen: string };
let cache: { at: number; list: Entry[] } = { at: 0, list: [] };

const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APP_SECRET || '';
const sigWith = (exp: string, k: string) => createHmac('sha256', k).update(exp).digest('base64url').slice(0, 43);
const sig = (exp: string) => sigWith(exp, secretFor('own-device'));
export function ownCookieValue(): string { const exp = String(Date.now() + 365 * 864e5); return `${exp}.${sig(exp)}`; }
export function ownCookieHeader(): string { return `${OWN_COOKIE}=${ownCookieValue()}; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`; }
export function hasOwnCookie(req: Request): boolean {
  const m = /(?:^|;\s*)lr_own=([0-9]{10,16})\.([A-Za-z0-9_-]{43})/.exec(req.headers.get('cookie') || '');
  if (!m || Number(m[1]) < Date.now() || !key()) return false;
  const a = Buffer.from(m[2]);
  return verifySecrets('own-device').some((k) => { const b = Buffer.from(sigWith(m[1], k)); return a.length === b.length && timingSafeEqual(a, b); });
}

export async function trustedList(fresh = false): Promise<Entry[]> {
  if (!adminConfigured()) return [];
  if (!fresh && Date.now() - cache.at < 60_000) return cache.list;
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', 'sec_trusted').maybeSingle();
    const list = (Array.isArray(data?.value) ? (data!.value as Entry[]) : []).filter((e) => e && /^[0-9a-f]{32}$/.test(e.ip) && Date.parse(e.seen) > Date.now() - TTL);
    cache = { at: Date.now(), list };
  } catch { cache.at = Date.now(); }
  return cache.list;
}
export async function isTrustedIp(ip: string | null | undefined): Promise<boolean> {
  if (!ip) return false;
  return (await trustedList()).some((e) => e.ip === ip);
}
export async function isOwnRequest(req: Request): Promise<boolean> {
  return hasOwnCookie(req) || isTrustedIp(anonymizedIpHash(req));
}

// Netz als eigenes merken (oder „zuletzt gesehen“ auffrischen) und vorhandene Einträge/Sperren dieses Netzes entfernen.
export async function trustIp(ip: string | null, label = 'Eigenes Gerät'): Promise<void> {
  if (!ip || !/^[0-9a-f]{32}$/.test(ip) || !adminConfigured()) return;
  const now = new Date().toISOString();
  const list = await trustedList(true);
  const hit = list.find((e) => e.ip === ip);
  if (hit && Date.parse(hit.seen) > Date.now() - 6 * 3600_000) return; // höchstens alle 6 Std. schreiben
  const next = hit ? list.map((e) => (e.ip === ip ? { ...e, seen: now } : e)) : [...list, { ip, label: label.slice(0, 60), at: now, seen: now }].slice(-30);
  const db = supabaseAdmin();
  await db.from('lr_settings').upsert({ key: 'sec_trusted', value: next, updated_at: now, updated_by: 'system' });
  cache = { at: Date.now(), list: next };
  if (!hit) {
    await db.from('lr_security_log').delete().eq('ip_hash', ip);
    await db.from('lr_security_blocks').delete().eq('ip_hash', ip);
  }
}
export async function untrustIp(ip: string): Promise<void> {
  const list = (await trustedList(true)).filter((e) => e.ip !== ip);
  await supabaseAdmin().from('lr_settings').upsert({ key: 'sec_trusted', value: list, updated_at: new Date().toISOString(), updated_by: 'admin' });
  cache = { at: Date.now(), list };
}
