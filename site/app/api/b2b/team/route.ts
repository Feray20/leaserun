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
  if (!p.success) return json({ error: 'Please enter a valid email address.' }, 400);
  const tier = effectiveTier(ctx.account);
  if (!tier) return json({ error: 'Additional seats are available with a paid plan.' }, 402);
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const [{ count: m }, { count: i }] = await Promise.all([
    db.from('lr_b2b_members').select('user_id', { count: 'exact', head: true }).eq('account_id', ctx.account.id),
    db.from('lr_b2b_invites').select('id', { count: 'exact', head: true }).eq('account_id', ctx.account.id).is('accepted_at', null).gt('expires_at', now),
  ]);
  const seats = TIER_LIMITS[tier].seats;
  if ((m ?? 0) + (i ?? 0) >= seats) return json({ error: `All ${seats} seats of your plan are in use.` }, 409);
  // Create the login directly (no self-registration): show the initial password once, change at first sign-in.
  const login = await createB2BLogin(p.data.email, '');
  if (!login.ok) return json({ error: login.error }, login.status);
  const mem = await db.from('lr_b2b_members').insert({ account_id: ctx.account.id, user_id: login.userId, role: 'advisor' });
  if (mem.error) { await db.auth.admin.deleteUser(login.userId).catch(() => null); return json({ error: 'The login could not be created.' }, 500); }
  let mailed = false;
  if (mailConfigured() && p.data.send) {
    mailed = await sendMail(p.data.email, `Your ${ctx.account.company_name} login on LeaseRun`,
      `Hello,\n\n${ctx.account.advisor_name} has set up a team login for you in the LeaseRun business portal of ${ctx.account.company_name}.\n\nPortal: https://partner.leaserun.com\nUsername: ${p.data.email}\nInitial password: ${login.password}\n\nYou will choose your own password at your first sign-in.`,
      [], { area: 'b2b', title: 'Your team login', button: { label: 'Go to the business portal', url: 'https://partner.leaserun.com' }, note: 'Please do not share the initial password.' });
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
    if (member === ctx.user.id) return json({ error: 'The account owner cannot remove themselves.' }, 400);
    await db.from('lr_b2b_members').delete().eq('account_id', ctx.account.id).eq('user_id', member).eq('role', 'advisor');
    return json({ ok: true });
  }
  return json({ error: 'Invalid request.' }, 400);
}

// Accept an invitation: signed-in user with exactly the invited email address.
export async function PUT(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in with the invited email address first.' }, 401);
  if (!allowRequest(`b2b-accept:${user.id}`, 10, 60_000)) return json({ error: 'Zu viele Anfragen.' }, 429);
  const b = (await req.json().catch(() => null)) as { token?: unknown } | null;
  if (typeof b?.token !== 'string' || b.token.length < 20 || b.token.length > 80) return json({ error: 'Invalid invitation link.' }, 400);
  const db = supabaseAdmin();
  const { data: inv } = await db.from('lr_b2b_invites').select('*').eq('token_hash', hashToken(b.token)).maybeSingle();
  if (!inv || inv.accepted_at || new Date(inv.expires_at).getTime() < Date.now()) return json({ error: 'This invitation has expired or was already used.' }, 410);
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) return json({ error: `This invitation is for ${inv.email}. Please sign in with that address.` }, 403);
  if (await membershipFor(user.id)) return json({ error: 'Your login already belongs to a business account.' }, 409);
  const ins = await db.from('lr_b2b_members').insert({ account_id: inv.account_id, user_id: user.id, role: 'advisor' });
  if (ins.error) return json({ error: 'Beitritt fehlgeschlagen.' }, 500);
  await db.from('lr_b2b_invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
  return json({ ok: true });
}
