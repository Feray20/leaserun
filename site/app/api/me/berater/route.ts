import { NextResponse } from 'next/server';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { hashToken } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Customer (website account): view an advisor's invitation, consent, list connections and disconnect.
// Status values ('eingeladen', 'verbunden', 'getrennt') are stored DB values and stay unchanged.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const CONSENT = 'I agree that the company named above may see my progress in LeaseRun: my stage, lender readiness in percent, the number of my properties and documents, which types of documents are still missing (e.g. "Title & county records") and when I was last active. Documents and their contents are not shared. The company may remind me by email about missing documents. I can withdraw this consent at any time in my account.';
const RADAR = 'I agree that the company named above may also see the month and year when the fixed-rate period of my properties\' loans ends (no amounts, lenders or documents), so it can contact me in time about refinancing. I can withdraw this consent at any time in my account.';
const Tok = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

async function ctx(req: Request) {
  if (!adminConfigured()) return { err: j({ error: 'Not configured.' }, 503) };
  const user = await userFromRequest(req);
  if (!user) return { err: j({ error: 'Please sign in first.' }, 401) };
  if (!allowRequest(`me-berater:${user.id}`, 30, 60_000)) return { err: j({ error: 'Too many requests.' }, 429) };
  return { user };
}

async function inviteByToken(token: string) {
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_clients').select('id, account_id, status, expires_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (!data || data.status !== 'eingeladen' || !data.expires_at || new Date(data.expires_at).getTime() < Date.now()) return null;
  const { data: acc } = await db.from('lr_b2b_accounts').select('company_name, city, institution_type, verified_at').eq('id', data.account_id).maybeSingle();
  return acc ? { ...data, company: acc } : null;
}

export async function GET(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const token = new URL(req.url).searchParams.get('token');
  if (token) {
    if (!Tok.safeParse(token).success) return j({ error: 'Invalid link.' }, 400);
    const inv = await inviteByToken(token);
    if (!inv) return j({ error: 'This invitation has expired or was already used.' }, 404);
    return j({ invite: { company: inv.company.company_name, city: inv.company.city, verified: Boolean(inv.company.verified_at) }, consent: CONSENT });
  }
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_clients').select('id, account_id, consent_at, last_request_at, request_note, request_seen_at, radar_consent_at').eq('client_user_id', c.user!.id).eq('status', 'verbunden');
  const accIds = [...new Set((data ?? []).map((x) => x.account_id))];
  const { data: accs } = accIds.length ? await db.from('lr_b2b_accounts').select('id, company_name, city').in('id', accIds) : { data: [] };
  const byId = new Map((accs ?? []).map((a) => [a.id, a]));
  return j({ connections: (data ?? []).map((x) => ({
    id: x.id, company: byId.get(x.account_id)?.company_name || 'Company', city: byId.get(x.account_id)?.city || null, since: x.consent_at, radar: Boolean(x.radar_consent_at),
    // Open request from the advisor for missing documents (until the customer has seen it).
    request: x.last_request_at && (!x.request_seen_at || new Date(x.request_seen_at) < new Date(x.last_request_at)) ? { at: x.last_request_at, note: x.request_note || null } : null,
  })), radarText: RADAR });
}

export async function POST(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const body = await req.json().catch(() => null);
  const seen = z.object({ seen: z.string().uuid() }).safeParse(body);
  if (seen.success) {
    await supabaseAdmin().from('lr_b2b_clients').update({ request_seen_at: new Date().toISOString() }).eq('id', seen.data.seen).eq('client_user_id', c.user!.id);
    return j({ ok: true });
  }
  // Turn the rate-reset radar on or off per connection (separate consent).
  const rad = z.object({ radar: z.boolean(), id: z.string().uuid() }).safeParse(body);
  if (rad.success) {
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin().from('lr_b2b_clients').update(rad.data.radar ? { radar_consent_at: now, radar_consent_text: RADAR } : { radar_consent_at: null }).eq('id', rad.data.id).eq('client_user_id', c.user!.id).eq('status', 'verbunden');
    return error ? j({ error: 'Could not save.' }, 500) : j({ ok: true });
  }
  const p = z.object({ token: Tok, consent: z.literal(true) }).safeParse(body);
  if (!p.success) return j({ error: 'Please explicitly agree to sharing.' }, 400);
  const inv = await inviteByToken(p.data.token);
  if (!inv) return j({ error: 'This invitation has expired or was already used.' }, 404);
  const db = supabaseAdmin();
  // Already connected? Then just close the invitation.
  const { data: dup } = await db.from('lr_b2b_clients').select('id').eq('account_id', inv.account_id).eq('client_user_id', c.user!.id).eq('status', 'verbunden').maybeSingle();
  if (dup) { await db.from('lr_b2b_clients').update({ status: 'getrennt', ended_at: new Date().toISOString(), ended_by: 'doppelt', token_hash: null }).eq('id', inv.id); return j({ ok: true, company: inv.company.company_name }); }
  const { error } = await db.from('lr_b2b_clients').update({ status: 'verbunden', client_user_id: c.user!.id, consent_at: new Date().toISOString(), consent_text: CONSENT, token_hash: null }).eq('id', inv.id).eq('status', 'eingeladen');
  return error ? j({ error: 'Could not connect.' }, 500) : j({ ok: true, company: inv.company.company_name });
}

export async function DELETE(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const p = z.object({ id: z.string().uuid() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Invalid.' }, 400);
  const { error } = await supabaseAdmin().from('lr_b2b_clients').update({ status: 'getrennt', ended_at: new Date().toISOString(), ended_by: 'kunde' }).eq('id', p.data.id).eq('client_user_id', c.user!.id);
  return error ? j({ error: 'Could not disconnect.' }, 500) : j({ ok: true });
}
