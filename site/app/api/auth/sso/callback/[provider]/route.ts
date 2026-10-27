import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { codeToIdToken, PROVS, provReady, supabaseSession, unseal, type Flow, type Prov } from '@/lib/auth/sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Return from the provider (Google/Microsoft via GET, Apple via form POST). Checks state and age of the flow,
// exchanges the code for the ID token, signs in with Supabase and hands the session to the page
// (#access_token=… – the format /auth/callback and /business-portal already handle).
async function handle(req: Request, provider: string, params: URLSearchParams) {
  const origin = new URL(req.url).origin;
  const jar = await cookies();
  const flow = unseal<Flow>(jar.get('lr_sso')?.value);
  const back = flow?.back || '/auth/callback';
  const go = (hash: string) => {
    const res = NextResponse.redirect(`${origin}${back}#${hash}`, 303);
    res.cookies.set('lr_sso', '', { httpOnly: true, secure: true, sameSite: 'none', path: '/api/auth/sso', maxAge: 0 });
    res.headers.set('Cache-Control', 'no-store');
    return res;
  };
  const fail = (m: string) => go(`error_description=${encodeURIComponent(m)}`);
  const p = provider as Prov;
  if (!PROVS.includes(p) || !provReady(p)) return fail('This sign-in option is not available right now.');
  if (params.get('error')) return fail(params.get('error') === 'user_cancelled_authorize' || params.get('error') === 'access_denied' ? 'Sign-in canceled.' : 'The provider declined the sign-in.');
  if (!flow || flow.p !== p || !params.get('state') || params.get('state') !== flow.st || Date.now() - flow.t > 10 * 60_000) return fail('The sign-in expired. Please try again.');
  const code = params.get('code');
  if (!code) return fail('The sign-in could not be completed.');
  try {
    const idToken = await codeToIdToken(p, code, origin);
    const s = await supabaseSession(p, idToken, flow.n);
    return go(new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: String(s.expires_in), token_type: s.token_type }).toString());
  } catch (e) {
    console.warn('sso_callback', p, (e as Error).message);
    return fail('The sign-in could not be completed. Please try again.');
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  return handle(req, (await ctx.params).provider, new URL(req.url).searchParams);
}
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const f = await req.formData().catch(() => null);
  const q = new URLSearchParams();
  for (const k of ['code', 'state', 'error']) { const v = f?.get(k); if (typeof v === 'string') q.set(k, v); }
  return handle(req, (await ctx.params).provider, q);
}
