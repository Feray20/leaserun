import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { authorizeUrl, BACKS, directProviders, newFlow, seal, type Prov } from '@/lib/auth/sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Start of express sign-in through our own domain. The flow (state + nonce) is stored signed in a short-lived,
// server-only cookie; the browser is sent to the provider.
export async function GET(req: Request) {
  const u = new URL(req.url), origin = u.origin;
  const p = u.searchParams.get('provider') as Prov | null;
  const back = (BACKS as readonly string[]).includes(u.searchParams.get('back') || '') ? (u.searchParams.get('back') as string) : '/auth/callback';
  const fail = (m: string) => NextResponse.redirect(`${origin}${back}#error_description=${encodeURIComponent(m)}`, 302);
  if (!p || !directProviders().includes(p)) return fail('This sign-in option is not available right now.');
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  if (!allowRequest(`sso:${ip}`, 20, 10 * 60_000)) return fail('Too many attempts. Please wait a moment.');
  const flow = newFlow(p, back);
  const res = NextResponse.redirect(authorizeUrl(flow, origin), 302);
  // SameSite=None: Apple returns via a form POST from appleid.apple.com – otherwise the cookie would not be sent.
  res.cookies.set('lr_sso', seal(flow), { httpOnly: true, secure: true, sameSite: 'none', path: '/api/auth/sso', maxAge: 600 });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
