import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canCobrand, effectiveTier, hashToken, moduleState, newToken, TIER_LIMITS, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Business portal → Clients: invite clients and – after the client's explicit consent – see their progress.
// Only numbers are visible (stage, lender readiness, number of properties and documents) and the types of missing documents – never documents or content.
// Active clients = connected clients plus open (not expired) invitations; Business Basic allows up to 25 (TIER_LIMITS.clients).
const INVITE_DAYS = 14;

type Summary = { stage?: number; level?: number; best?: number; objects?: number; docs?: number; profile?: boolean; missing?: string[]; fixEnds?: string[]; at?: string };

export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-clients' });
  if (ctx instanceof Response) return ctx;
  if (moduleState(ctx.account, 'crm') === 'off') return json({ error: 'Client management is not enabled for your business account. Please contact support@leaserun.com.' }, 403);
  const db = supabaseAdmin();
  const { data: rows } = await db.from('lr_b2b_clients').select('id, client_name, client_email, status, client_user_id, consent_at, expires_at, created_at, ended_at, last_request_at, radar_consent_at')
    .eq('account_id', ctx.account.id).neq('status', 'getrennt').order('created_at', { ascending: false }).limit(500);
  const now = Date.now();
  const list = (rows ?? []).filter((r) => r.status === 'verbunden' || (r.expires_at && new Date(r.expires_at).getTime() > now));
  const ids = list.filter((r) => r.status === 'verbunden' && r.client_user_id).map((r) => r.client_user_id as string);
  const { data: ud } = ids.length ? await db.from('lr_user_data').select('user_id, progress, updated_at').in('user_id', ids) : { data: [] };
  const byUser = new Map((ud ?? []).map((u) => [u.user_id, u]));
  const t = effectiveTier(ctx.account), radarOn = Boolean(t && TIER_LIMITS[t].radar);
  const clients = list.map((r) => {
    const u = r.client_user_id ? byUser.get(r.client_user_id) : null;
    const s = ((u?.progress as { summary?: Summary } | null)?.summary) || {};
    return {
      id: r.id, name: r.client_name, email: r.client_email, status: r.status, since: r.consent_at, invitedAt: r.created_at, expiresAt: r.expires_at,
      progress: r.status === 'verbunden' ? { stage: s.stage ?? null, level: s.level ?? null, best: s.best ?? null, objects: s.objects ?? null, docs: s.docs ?? null, profile: s.profile ?? null, missing: Array.isArray(s.missing) ? s.missing.slice(0, 8).map(String) : null, lastActive: u?.updated_at ?? null } : null,
      lastRequestAt: r.last_request_at,
      radar: r.radar_consent_at ? (radarOn ? (Array.isArray(s.fixEnds) ? s.fixEnds.filter((x) => /^\d{4}-\d{2}$/.test(String(x))).slice(0, 10) : []) : 'tarif') : null,
    };
  });
  return json({ clients, radarOn });
}

const Invite = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().max(120).optional(), consent: z.literal(true) });

export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-client-invite', limit: 20 });
  if (ctx instanceof Response) return ctx;
  if (moduleState(ctx.account, 'crm') === 'off') return json({ error: 'Client management is not enabled for your business account. Please contact support@leaserun.com.' }, 403);
  if (!ctx.account.verified_at) return json({ error: 'You can invite clients once your business account is verified.' }, 403);
  {
    const t = effectiveTier(ctx.account);
    const max = t ? TIER_LIMITS[t].clients : TIER_LIMITS.BASIC.clients;
    if (max != null) {
      const db0 = supabaseAdmin();
      const nowIso = new Date().toISOString();
      const [{ count: conn }, { count: open }] = await Promise.all([
        db0.from('lr_b2b_clients').select('id', { count: 'exact', head: true }).eq('account_id', ctx.account.id).eq('status', 'verbunden'),
        db0.from('lr_b2b_clients').select('id', { count: 'exact', head: true }).eq('account_id', ctx.account.id).neq('status', 'verbunden').neq('status', 'getrennt').gt('expires_at', nowIso),
      ]);
      if ((conn ?? 0) + (open ?? 0) >= max) return json({ error: `Your plan includes up to ${max} active clients. Disconnect a client you no longer work with or upgrade to Pro for unlimited clients.`, code: 'client_limit' }, 402);
    }
  }
  const p = Invite.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues.some((i) => i.path[0] === 'consent') ? 'Please confirm that the client has agreed to receive this invitation.' : 'Please enter a valid email address.' }, 400);
  const db = supabaseAdmin();
  const token = newToken();
  const ins = await db.from('lr_b2b_clients').insert({
    account_id: ctx.account.id, invited_by: ctx.user.id, client_email: p.data.email, client_name: p.data.name || null, inviter_consent_at: new Date().toISOString(),
    token_hash: hashToken(token), expires_at: new Date(Date.now() + INVITE_DAYS * 864e5).toISOString(),
  });
  if (ins.error) return json({ error: 'The invitation failed.' }, 500);
  const link = `${new URL(req.url).origin}/app/dashboard#berater=${token}`;
  let mailed = false;
  if (mailConfigured()) {
    mailed = await sendMail(p.data.email, `${ctx.account.company_name} invited you to LeaseRun`,
      `Hi${p.data.name ? ' ' + p.data.name : ''},\n\n${ctx.account.company_name} is helping you with your real estate financing and has invited you to LeaseRun. There you prepare your financial profile, property and documents – step by step to a lender-ready package.\n\nIf you agree, your advisor sees only your progress (stage, lender readiness in percent, number of documents) – no documents and no content. You can disconnect at any time.\n\nThe link is valid for ${INVITE_DAYS} days.`,
      [], { title: `Invitation from ${ctx.account.company_name}`, button: { label: 'View invitation', url: link }, note: 'Free for you. Nothing is shared without your consent.',
        // Business as sender name and reply-to; brand color from the co-branding plan.
        sender: ctx.account.company_name, replyTo: ctx.account.email, accent: canCobrand(ctx.account as B2BAccount) ? ctx.account.brand_color || undefined : undefined });
  }
  return json({ ok: true, link, mailed }, 201);
}

const End = z.object({ id: z.string().uuid() });

export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-clients' });
  if (ctx instanceof Response) return ctx;
  if (moduleState(ctx.account, 'crm') === 'off') return json({ error: 'Client management is not enabled for your business account. Please contact support@leaserun.com.' }, 403);
  const p = End.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Invalid request.' }, 400);
  const { error } = await supabaseAdmin().from('lr_b2b_clients').update({ status: 'getrennt', ended_at: new Date().toISOString(), ended_by: 'berater', token_hash: null })
    .eq('id', p.data.id).eq('account_id', ctx.account.id);
  return error ? json({ error: 'Disconnecting failed.' }, 500) : json({ ok: true });
}
