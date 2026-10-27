import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { authorizeUrl, BACKS, directProviders, newFlow, seal, type Prov } from '@/lib/auth/sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Start der Express-Anmeldung über die eigene Adresse. Der Anmeldevorgang (Zustand + Nonce) liegt signiert in einem
// kurzlebigen, nur für den Server lesbaren Cookie; der Browser wird zum Anbieter geschickt.
export async function GET(req: Request) {
  const u = new URL(req.url), origin = u.origin;
  const p = u.searchParams.get('provider') as Prov | null;
  const back = (BACKS as readonly string[]).includes(u.searchParams.get('back') || '') ? (u.searchParams.get('back') as string) : '/auth/callback';
  const fail = (m: string) => NextResponse.redirect(`${origin}${back}#error_description=${encodeURIComponent(m)}`, 302);
  if (!p || !directProviders().includes(p)) return fail('Diese Anmeldung ist gerade nicht verfügbar.');
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  if (!allowRequest(`sso:${ip}`, 20, 10 * 60_000)) return fail('Zu viele Versuche – bitte kurz warten.');
  const flow = newFlow(p, back);
  const res = NextResponse.redirect(authorizeUrl(flow, origin), 302);
  // SameSite=None: Apple schickt die Rückkehr als Formular (POST) von appleid.apple.com – sonst käme das Cookie nicht mit.
  res.cookies.set('lr_sso', seal(flow), { httpOnly: true, secure: true, sameSite: 'none', path: '/api/auth/sso', maxAge: 600 });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
