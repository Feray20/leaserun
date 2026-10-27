import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { entitlementsFor } from '@/lib/billing/stripe';
import { allowRequest } from '@/lib/security/rate-limit';
import { LEITFADEN, LEITFADEN_VERSION } from '@/lib/content/leitfaden';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

// Guide only for buyers of the add-on (order bump when buying a Lender Package or Buyer Pass).
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Please sign in.' }, 401);
  if (!allowRequest(`leitfaden:${user.id}`, 20, 60_000)) return j({ error: 'Too many requests.' }, 429);
  if (!process.env.STRIPE_SECRET_KEY) return j({ owned: false });
  const e = await entitlementsFor(user.id, user.email).catch(() => null);
  if (!e?.leitfaden) return j({ owned: false });
  return j({ owned: true, version: LEITFADEN_VERSION, ...LEITFADEN });
}
