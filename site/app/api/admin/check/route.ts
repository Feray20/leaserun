import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminList, mfaRequired, roleOf, tokenAal } from '@/lib/security/admin';
import { areasOf } from '@/lib/security/roles';
import { ipAllowed, panicState } from '@/lib/security/panic';
import { ownCookieHeader } from '@/lib/security/trusted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Interner Bereich: Freigabe nur für E-Mail-Adressen in ADMIN_EMAILS (kommagetrennt, in Vercel gesetzt).
// Zusätzlich verlangt der Bereich einen zweiten Faktor (TOTP), außer ADMIN_MFA=off.
export async function GET(req: Request) {
  const h = { 'Cache-Control': 'no-store' };
  const user = await userFromRequest(req, { allowAal1: true });
  if (!user) return NextResponse.json({ admin: false, reason: 'login' }, { status: 401, headers: h });
  if (!allowRequest(`admin-check:${user.id}`, 30, 60_000)) return NextResponse.json({ admin: false }, { status: 429, headers: h });
  const list = adminList();
  const role = await roleOf(user.email);
  const admin = role !== null;
  const aal = tokenAal(req);
  const ip = ipAllowed(req);
  const panic = admin ? await panicState().catch(() => ({ active: false })) : { active: false };
  const ok = admin && ip && (!mfaRequired() || aal === 'aal2');
  const res = NextResponse.json(
    { admin: admin && ip, role, areas: role ? (role === 'owner' ? ['all'] : areasOf(role)) : [], configured: list.length > 0, ipBlocked: admin && !ip, mfaRequired: mfaRequired(), aal, mfaOk: !mfaRequired() || aal === 'aal2', panic },
    { status: admin && ip ? 200 : 403, headers: h },
  );
  // Eigenes Gerät markieren (signiertes Cookie): Fehlversuche und Zugriffe von hier werden nie als Vorfall erfasst.
  if (ok) res.headers.append('Set-Cookie', ownCookieHeader());
  return res;
}
