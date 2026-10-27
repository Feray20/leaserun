import { NextResponse } from 'next/server';
import { userFromRequest, type AuthUser } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured } from '@/lib/supabase/admin';
import { membershipFor, type B2BAccount } from '@/lib/b2b/core';

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export type MemberCtx = { user: AuthUser; account: B2BAccount; role: 'owner' | 'advisor' };

// Signed-in member of a business account; locked accounts are rejected.
export async function requireMember(req: Request, opts: { owner?: boolean; allowLocked?: boolean; bucket?: string; limit?: number; onboarding?: boolean } = {}): Promise<MemberCtx | NextResponse> {
  if (!adminConfigured()) return json({ error: 'Not configured.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return json({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`${opts.bucket ?? 'b2b'}:${user.id}`, opts.limit ?? 60, 60_000)) return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  const m = await membershipFor(user.id);
  if (!m) return json({ error: 'No business account.' }, 404);
  if (m.account.status === 'locked' && !opts.allowLocked) return json({ error: 'This business account is locked. Please contact support@leaserun.com.' }, 423);
  if (opts.owner && m.role !== 'owner') return json({ error: 'Only the account owner can change this.' }, 403);
  // Accounts created by an admin: usable only after initial setup (business-use confirmation, DPA).
  if (!opts.onboarding && (!m.account.unternehmer_confirmed_at || !m.account.avv_accepted_at)) return json({ error: 'Please complete the initial setup first.', code: 'onboarding' }, 428);
  return { user, ...m };
}
