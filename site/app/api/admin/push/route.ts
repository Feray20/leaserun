import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { DEFAULT_PUSH_PREFS, pushAdmins, pushToUser } from '@/lib/admin/push';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const TOKEN = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,100}\]$/);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('register'), token: TOKEN, platform: z.enum(['ios', 'android']) }),
  z.object({ action: z.literal('unregister'), token: TOKEN }),
  z.object({ action: z.literal('test') }),
  z.object({ action: z.literal('prefs'), prefs: z.object({ payment: z.boolean(), mail: z.boolean(), booking: z.boolean(), security: z.boolean().default(true), support: z.boolean().default(true) }) }),
]);

// Web-Admin / Admin-App: Geräte für Mitteilungen anmelden, abmelden, Auswahl speichern.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'stats');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const { data } = await supabaseAdmin().from('lr_admin_push_tokens').select('prefs').eq('user_id', auth.user.id).limit(1).maybeSingle();
  return j({ prefs: { ...DEFAULT_PUSH_PREFS, ...((data?.prefs as object | null) ?? {}) } });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req, 'stats');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Eingabe.' }, 400);
  const db = supabaseAdmin(), d = p.data, { id, email } = auth.user;
  if (d.action === 'register') {
    // prefs bleiben beim erneuten Anmelden erhalten (Spalte wird nicht überschrieben).
    const { data: known } = await db.from('lr_admin_push_tokens').select('token').eq('token', d.token).maybeSingle();
    const { error } = await db.from('lr_admin_push_tokens').upsert({ token: d.token, user_id: id, email, platform: d.platform, last_seen: new Date().toISOString() }, { onConflict: 'token' });
    if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    // Neues Gerät: die Inhaber erfahren es sofort (Warnsignal, falls ein fremdes Gerät angemeldet wird).
    if (!known) await pushAdmins('security', 'Neues Gerät', 'Auf einem neuen Gerät wurden Mitteilungen aktiviert.');
    return j({ ok: true });
  }
  if (d.action === 'test') {
    // Push-Test: nur an die eigenen Geräte, protokolliert.
    try {
      const n = await pushToUser(id, 'Push-Test', 'Mitteilungen von LeaseRun Admin kommen auf diesem Gerät an.');
      await adminAudit(email, 'push_test', null, { devices: n }).catch(() => null);
      return n ? j({ ok: true, devices: n }) : j({ error: 'Auf diesem Konto ist noch kein Gerät für Mitteilungen angemeldet.' }, 409);
    } catch { return j({ error: 'Der Mitteilungsdienst ist gerade nicht erreichbar.' }, 502); }
  }
  if (d.action === 'unregister') {
    await db.from('lr_admin_push_tokens').delete().eq('token', d.token).eq('user_id', id);
    return j({ ok: true });
  }
  const { error } = await db.from('lr_admin_push_tokens').update({ prefs: d.prefs }).eq('user_id', id);
  if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  return j({ ok: true });
}
