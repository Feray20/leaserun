import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminScope, scopeError } from '@/lib/admin/scope';
import { anonymizedIpHash, adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { issueBusinessCardForMember, setBusinessLimit } from '@/lib/cards/service';
import { capabilities, programStatus } from '@/lib/cards/status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// Web-Admin (Bereich B2B): Firmenkarten (Stripe Issuing) je Unternehmenskonto ansehen, ausgeben und Limits setzen.
export async function GET(req: Request) {
  const auth = await requireAdmin(req); if (auth instanceof NextResponse) return auth;
  const sc = adminScope(req); if (sc !== 'b2b') return j(scopeError, 400);
  const base = { program: programStatus(), capabilities: capabilities(), provider: (process.env.CARD_PROVIDER || '').toLowerCase() || null };
  const id = new URL(req.url).searchParams.get('account');
  if (!id || !adminConfigured()) return j({ ...base, cards: [] });
  const db = supabaseAdmin();
  const { data, error } = await db.from('lr_cards').select('id, user_id, status, last4, design, created_at, lr_card_limits(monthly_limit_cents, settled_cents, reserved_cents, refunded_cents, reset_at)').eq('b2b_account_id', id).order('created_at');
  if (error) return j({ ...base, cards: [], tablesReady: false });
  return j({ ...base, cards: data ?? [], tablesReady: true });
}

const Issue = z.object({
  action: z.literal('issue'), account: z.string().uuid(), memberEmail: z.string().trim().toLowerCase().email(), holderName: z.string().trim().min(3).max(24),
  phone: z.string().trim().max(20).optional(), line1: z.string().trim().min(3).max(100), postalCode: z.string().regex(/^\d{5}$/), city: z.string().trim().min(2).max(60),
  limitCents: z.number().int().min(0).max(5_000_000), design: z.enum(['classic-black', 'platinum', 'minimal-white']).default('classic-black'),
  stripeAccount: z.string().regex(/^acct_[A-Za-z0-9]+$/).optional().or(z.literal('')),
});
const Limit = z.object({ action: z.literal('limit'), account: z.string().uuid(), cardId: z.string().uuid(), limitCents: z.number().int().min(0).max(5_000_000) });

export async function POST(req: Request) {
  const auth = await requireAdmin(req); if (auth instanceof NextResponse) return auth;
  const sc = adminScope(req); if (sc !== 'b2b') return j(scopeError, 400);
  const body = await req.json().catch(() => null);
  const ip = anonymizedIpHash(req);
  const iss = Issue.safeParse(body);
  if (iss.success) {
    const b = iss.data;
    const r = await issueBusinessCardForMember({ adminEmail: auth.user.email, b2bAccountId: b.account, memberEmail: b.memberEmail, holderName: b.holderName, phone: b.phone, address: { line1: b.line1, postalCode: b.postalCode, city: b.city }, monthlyLimitCents: b.limitCents, design: b.design, stripeAccount: b.stripeAccount || null, ipHash: ip });
    return r.ok ? j({ ok: true, ...(r.data as object) }) : j({ error: r.error, code: r.code }, r.status);
  }
  const lim = Limit.safeParse(body);
  if (lim.success) {
    const r = await setBusinessLimit(lim.data.cardId, lim.data.account, lim.data.limitCents, 'admin', ip);
    return r.ok ? j({ ok: true }) : j({ error: r.error, code: r.code }, r.status);
  }
  return j({ error: 'Bitte die Angaben prüfen.' }, 400);
}
