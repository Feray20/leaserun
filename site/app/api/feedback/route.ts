import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { membershipFor } from '@/lib/b2b/core';
import { FeedbackIn } from '@/lib/feedback';
import { notifyAdmin } from '@/lib/feedback-notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Improvement suggestions from signed-in consumers and businesses (Business Portal).
// The area is checked server-side: "b2b" only with membership in a business account.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

async function ctx(req: Request) {
  if (!adminConfigured()) return { err: j({ error: 'Not configured.' }, 503) };
  const user = await userFromRequest(req);
  if (!user) return { err: j({ error: 'Please sign in first.' }, 401) };
  return { user };
}

// Own suggestions with status and answer (without the internal note and rating).
export async function GET(req: Request) {
  const c = await ctx(req);
  if (c.err) return c.err;
  const area = new URL(req.url).searchParams.get('area') === 'b2b' ? 'b2b' : 'b2c';
  const { data } = await supabaseAdmin().from('lr_feedback').select('id, created_at, topic, text, importance, status, answer').eq('user_id', c.user.id).eq('area', area).order('created_at', { ascending: false }).limit(50);
  return j({ items: data ?? [] });
}

export async function POST(req: Request) {
  const c = await ctx(req);
  if (c.err) return c.err;
  if (!allowRequest(`feedback:${c.user.id}`, 5, 10 * 60_000)) return j({ error: 'Thank you – please send more suggestions a little later.' }, 429);
  const p = FeedbackIn.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Invalid input.' }, 400);
  let accountId: string | null = null;
  if (p.data.area === 'b2b') {
    const m = await membershipFor(c.user.id);
    if (!m) return j({ error: 'No business account.' }, 403);
    accountId = m.account.id;
  }
  const { data, error } = await supabaseAdmin().from('lr_feedback').insert({
    area: p.data.area, user_id: c.user.id, account_id: accountId, topic: p.data.topic, text: p.data.text, importance: p.data.importance, page: p.data.page || null,
  }).select('id').single();
  if (error || !data) return j({ error: 'Could not be saved.' }, 500);
  notifyAdmin(p.data.area, p.data.topic, p.data.importance).catch(() => {});
  return j({ ok: true, id: data.id });
}
