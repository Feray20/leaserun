import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminList, requireAdmin, resetRoleCache } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { pushAdmins } from '@/lib/admin/push';
import { TEAM_ROLES } from '@/lib/security/roles';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const MAX_TEAM = 20;
const Email = z.string().trim().toLowerCase().email().max(200);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), email: Email, role: z.enum(TEAM_ROLES) }),
  z.object({ action: z.literal('remove'), email: Email }),
]);

// Team verwalten – ausschließlich Inhaber (ohne Bereichsangabe lässt requireAdmin nur Inhaber durch).
// Jede Änderung wird protokolliert und löst eine Sicherheits-Mitteilung an die Inhaber aus.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const { data, error } = await supabaseAdmin().from('lr_admin_roles').select('email, role, created_by, created_at').order('created_at', { ascending: true }).limit(100);
  if (error) return j({ error: 'Team nicht verfügbar. Ist die Tabelle lr_admin_roles angelegt?' }, 502);
  return j({ owners: adminList(), members: data ?? [], roles: TEAM_ROLES });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte gültige E-Mail-Adresse und Rolle angeben.' }, 400);
  const db = supabaseAdmin(), d = p.data, actor = auth.user.email;

  if (d.action === 'add') {
    if (adminList().includes(d.email)) return j({ error: 'Diese Adresse ist bereits Inhaber.' }, 409);
    const { count } = await db.from('lr_admin_roles').select('email', { count: 'exact', head: true });
    const { data: have } = await db.from('lr_admin_roles').select('email').eq('email', d.email).maybeSingle();
    if (!have && (count ?? 0) >= MAX_TEAM) return j({ error: `Höchstens ${MAX_TEAM} Teammitglieder.` }, 409);
    const { error } = await db.from('lr_admin_roles').upsert({ email: d.email, role: d.role, created_by: actor });
    if (error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    resetRoleCache();
    await adminAudit(actor, 'team_add', d.email, { role: d.role }).catch(() => null);
    await pushAdmins('security', 'Team geändert', 'Ein Teammitglied wurde hinzugefügt oder geändert.');
    return j({ ok: true });
  }

  // Zugang entziehen: Rolle löschen (wirkt innerhalb von 15 Sekunden auf allen Instanzen) und Geräte für Mitteilungen abmelden.
  const { error } = await db.from('lr_admin_roles').delete().eq('email', d.email);
  if (error) return j({ error: 'Entfernen fehlgeschlagen.' }, 500);
  await db.from('lr_admin_push_tokens').delete().eq('email', d.email);
  resetRoleCache();
  await adminAudit(actor, 'team_remove', d.email, {}).catch(() => null);
  await pushAdmins('security', 'Team geändert', 'Einem Teammitglied wurde der Zugang entzogen.');
  return j({ ok: true });
}
