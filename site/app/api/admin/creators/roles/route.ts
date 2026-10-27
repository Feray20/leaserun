import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminList } from '@/lib/security/admin';
import { effectiveRole, permissionsOf, ROLE_LABEL } from '@/lib/creator/roles';
import { RoleInput, firstIssue } from '@/lib/creator/schema';
import { audit, j, requireCreatorAdmin } from '@/lib/creator/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rollen im Creator-Bereich vergeben (nur Super Admin). Gilt nur für Adressen aus ADMIN_EMAILS –
// eine Rolle verschafft nie Zugang zum Web-Admin, sie schränkt ihn nur ein.
export async function GET(req: Request) {
  const a = await requireCreatorAdmin(req, 'roles.manage');
  if (!('role' in a)) return a;
  const { data } = await supabaseAdmin().from('lr_creator_admin_roles').select('email, role, updated_at');
  const stored = new Map(((data ?? []) as { email: string; role: string }[]).map((r) => [r.email, r]));
  return j({
    admins: adminList().map((email) => {
      const role = effectiveRole(stored.get(email)?.role ?? null);
      return { email, role, role_label: ROLE_LABEL[role], explicit: stored.has(email), permissions: permissionsOf(role), self: email === a.email };
    }),
  });
}

export async function POST(req: Request) {
  const a = await requireCreatorAdmin(req, 'roles.manage');
  if (!('role' in a)) return a;
  const p = RoleInput.safeParse(await req.json().catch(() => null));
  if (!p.success) return j(firstIssue(p.error), 400);
  const { email, role } = p.data;
  if (!adminList().includes(email)) return j({ error: 'Rollen gibt es nur für Administratoren aus ADMIN_EMAILS.' }, 400);
  if (email === a.email) return j({ error: 'Die eigene Rolle kann nicht geändert werden.' }, 409);
  const db = supabaseAdmin();
  const r = role === null
    ? await db.from('lr_creator_admin_roles').delete().eq('email', email)
    : await db.from('lr_creator_admin_roles').upsert({ email, role, granted_by: a.actor.ref });
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  const { pseudo } = await import('@/lib/security/pseudo');
  await audit('ADMIN_ROLE_CHANGED', null, a.actor, 'SUCCESS', { target: await pseudo(email).catch(() => 'ps:unbekannt'), role: role ?? 'DEFAULT_SUPER_ADMIN' });
  return j({ ok: true });
}
