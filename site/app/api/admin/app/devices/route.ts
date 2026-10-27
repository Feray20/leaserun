import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
// Gerätetokens verlassen den Server nie; die App sieht nur eine Kurzkennung.
const idOf = (token: string) => createHash('sha256').update(`leaserun-device:${token}`).digest('hex').slice(0, 16);
// Das eigene Gerät meldet sein Token im Header (nicht in der URL, damit es nicht in Zugriffsprotokollen landet).
const currentId = (req: Request) => { const t = req.headers.get('x-push-token'); return t ? idOf(t) : null; };
const bearer = (req: Request) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

// Admin-App: eigene Geräte (mit Mitteilungen angemeldet) anzeigen, einzelne Geräte abmelden, alle anderen Sitzungen beenden.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'stats');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Geräte gerade nicht verfügbar.' }, 503);
  const { data, error } = await supabaseAdmin().from('lr_admin_push_tokens').select('token, platform, created_at, last_seen').eq('user_id', auth.user.id).order('last_seen', { ascending: false }).limit(50);
  if (error) return j({ error: 'Geräte gerade nicht verfügbar.' }, 502);
  const cur = currentId(req);
  return j({
    devices: (data ?? []).map((d) => ({ id: idOf(String(d.token)), platform: d.platform, createdAt: d.created_at, lastSeen: d.last_seen, current: idOf(String(d.token)) === cur })),
  });
}

const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('remove'), id: z.string().regex(/^[0-9a-f]{16}$/) }),
  z.object({ action: z.literal('signout_others') }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'stats');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Gerade nicht verfügbar.' }, 503);
  const p = Act.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Eingabe.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_admin_push_tokens').select('token').eq('user_id', auth.user.id).limit(50);
  const mine = (data ?? []).map((r) => String(r.token));
  const cur = currentId(req);

  if (p.data.action === 'remove') {
    const id = p.data.id;
    const hit = mine.find((t) => idOf(t) === id);
    if (!hit) return j({ error: 'Gerät nicht gefunden.' }, 404);
    await db.from('lr_admin_push_tokens').delete().eq('token', hit).eq('user_id', auth.user.id);
    await adminAudit(auth.user.email, 'app_device_remove', id, { current: id === cur }).catch(() => null);
    return j({ ok: true });
  }

  // Alle anderen Sitzungen dieses Kontos beenden (Web-Admin, andere Geräte) und deren Mitteilungen abmelden.
  // Die aktuelle Sitzung bleibt bestehen.
  const { error } = await db.auth.admin.signOut(bearer(req), 'others');
  if (error) return j({ error: 'Andere Sitzungen konnten gerade nicht beendet werden.' }, 502);
  const others = mine.filter((t) => idOf(t) !== cur);
  if (others.length) await db.from('lr_admin_push_tokens').delete().in('token', others).eq('user_id', auth.user.id);
  await adminAudit(auth.user.email, 'app_signout_others', null, { devices: others.length }).catch(() => null);
  return j({ ok: true, devicesRemoved: others.length });
}
