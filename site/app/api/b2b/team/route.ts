import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { TIER_LIMITS, effectiveTier, hashToken, membershipFor } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { createB2BLogin } from '@/lib/b2b/provision';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


async function emailOf(userId: string): Promise<string> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
  return data?.user?.email ?? '';
}

export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-team' });
  if (ctx instanceof Response) return ctx;
  const db = supabaseAdmin();
  const [{ data: mem }, { data: inv }] = await Promise.all([
    db.from('lr_b2b_members').select('user_id, role, created_at').eq('account_id', ctx.account.id).order('created_at'),
    db.from('lr_b2b_invites').select('id, email, expires_at, created_at').eq('account_id', ctx.account.id).is('accepted_at', null).gt('expires_at', new Date().toISOString()),
  ]);
  const members = await Promise.all((mem ?? []).map(async (m) => ({ ...m, email: await emailOf(m.user_id), self: m.user_id === ctx.user.id })));
  const tier = effectiveTier(ctx.account);
  return json({ members, invites: ctx.role === 'owner' ? inv ?? [] : [], seats: tier ? TIER_LIMITS[tier].seats : 1 });
}

const Invite = z.object({ email: z.string().trim().toLowerCase().email().max(200), send: z.boolean().optional().default(false) });

export async function POST(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-invite', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const p = Invite.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  const tier = effectiveTier(ctx.account);
  if (!tier) return json({ error: 'Weitere Berater-Zugänge gibt es ab einem gebuchten Tarif.' }, 402);
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const [{ count: m }, { count: i }] = await Promise.all([
    db.from('lr_b2b_members').select('user_id', { count: 'exact', head: true }).eq('account_id', ctx.account.id),
    db.from('lr_b2b_invites').select('id', { count: 'exact', head: true }).eq('account_id', ctx.account.id).is('accepted_at', null).gt('expires_at', now),
  ]);
  const seats = TIER_LIMITS[tier].seats;
  if ((m ?? 0) + (i ?? 0) >= seats) return json({ error: `Alle ${seats} Berater-Zugänge Ihres Tarifs sind vergeben.` }, 409);
  // Zugang direkt anlegen (keine Selbstregistrierung): Startpasswort einmalig anzeigen, Wechsel bei der ersten Anmeldung.
  const login = await createB2BLogin(p.data.email, '');
  if (!login.ok) return json({ error: login.error }, login.status);
  const mem = await db.from('lr_b2b_members').insert({ account_id: ctx.account.id, user_id: login.userId, role: 'advisor' });
  if (mem.error) { await db.auth.admin.deleteUser(login.userId).catch(() => null); return json({ error: 'Zugang konnte nicht angelegt werden.' }, 500); }
  let mailed = false;
  if (mailConfigured() && p.data.send) {
    mailed = await sendMail(p.data.email, `Ihr Zugang für ${ctx.account.company_name} auf LeaseRun`,
      `Guten Tag,\n\n${ctx.account.advisor_name} hat für Sie einen Berater-Zugang im LeaseRun-Unternehmensportal von ${ctx.account.company_name} eingerichtet.\n\nPortal: https://partner.leaserun.com\nBenutzername: ${p.data.email}\nStartpasswort: ${login.password}\n\nBei der ersten Anmeldung legen Sie ein eigenes Passwort fest.`,
      [], { area: 'b2b', title: 'Ihr Berater-Zugang', button: { label: 'Zum Unternehmensportal', url: 'https://partner.leaserun.com' }, note: 'Bitte das Startpasswort nicht weitergeben.' });
  }
  return json({ ok: true, email: p.data.email, password: login.password, mailed }, 201);
}

export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-invite', limit: 20 });
  if (ctx instanceof Response) return ctx;
  const u = new URL(req.url);
  const db = supabaseAdmin();
  const invite = u.searchParams.get('invite');
  const member = u.searchParams.get('member');
  if (invite && /^[0-9a-f-]{36}$/.test(invite)) {
    await db.from('lr_b2b_invites').delete().eq('id', invite).eq('account_id', ctx.account.id);
    return json({ ok: true });
  }
  if (member && /^[0-9a-f-]{36}$/.test(member)) {
    if (member === ctx.user.id) return json({ error: 'Der Kontoinhaber kann sich nicht selbst entfernen.' }, 400);
    await db.from('lr_b2b_members').delete().eq('account_id', ctx.account.id).eq('user_id', member).eq('role', 'advisor');
    return json({ ok: true });
  }
  return json({ error: 'Ungültige Anfrage.' }, 400);
}

// Einladung annehmen: angemeldeter Nutzer mit genau der eingeladenen E-Mail-Adresse.
export async function PUT(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Bitte zuerst mit der eingeladenen E-Mail-Adresse anmelden.' }, 401);
  if (!allowRequest(`b2b-accept:${user.id}`, 10, 60_000)) return json({ error: 'Zu viele Anfragen.' }, 429);
  const b = (await req.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof b?.token !== 'string' || b.token.length < 20 || b.token.length > 80) return json({ error: 'Ungültiger Einladungslink.' }, 400);
  const db = supabaseAdmin();
  const { data: inv } = await db.from('lr_b2b_invites').select('*').eq('token_hash', hashToken(b.token)).maybeSingle();
  if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) return json({ error: 'Die Einladung ist abgelaufen oder wurde schon genutzt.' }, 410);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) return json({ error: `Diese Einladung gilt für ${inv.email}. Bitte mit dieser Adresse anmelden.` }, 403);
  if (await membershipFor(user.id)) return json({ error: 'Ihr Konto gehört bereits zu einem Unternehmen.' }, 409);
  const ins = await db.from('lr_b2b_members').insert({ account_id: inv.account_id, user_id: user.id, role: 'advisor' });
  if (ins.error) return json({ error: 'Beitritt fehlgeschlagen.' }, 500);
  await db.from('lr_b2b_invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
  return json({ ok: true });
}
