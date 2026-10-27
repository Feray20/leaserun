import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { codeToIdToken, PROVS, provReady, supabaseSession, unseal, type Flow, type Prov } from '@/lib/auth/sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rückkehr vom Anbieter (Google/Microsoft per GET, Apple per POST-Formular). Prüft Zustand und Alter des Vorgangs,
// tauscht den Code gegen das ID-Token, meldet bei Supabase an und gibt die Sitzung wie bisher an die Seite weiter
// (#access_token=… – genau das Format, das /auth/callback und /business-portal schon verarbeiten).
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
  if (!PROVS.includes(p) || !provReady(p)) return fail('Diese Anmeldung ist gerade nicht verfügbar.');
  if (params.get('error')) return fail(params.get('error') === 'user_cancelled_authorize' || params.get('error') === 'access_denied' ? 'Anmeldung abgebrochen.' : 'Die Anmeldung wurde vom Anbieter abgelehnt.');
  if (!flow || flow.p !== p || !params.get('state') || params.get('state') !== flow.st || Date.now() - flow.t > 10 * 60_000) return fail('Die Anmeldung ist abgelaufen. Bitte erneut versuchen.');
  const code = params.get('code');
  if (!code) return fail('Die Anmeldung konnte nicht abgeschlossen werden.');
  try {
    const idToken = await codeToIdToken(p, code, origin);
    const s = await supabaseSession(p, idToken, flow.n);
    return go(new URLSearchParams({ access_token: s.access_token, refresh_token: s.refresh_token, expires_in: String(s.expires_in), token_type: s.token_type }).toString());
  } catch (e) {
    console.warn('sso_callback', p, (e as Error).message);
    return fail('Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.');
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
