import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminList, mfaRequired, tokenAal } from '@/lib/security/admin';
import { ipAllowed, panicState } from '@/lib/security/panic';

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
  const admin = list.length > 0 && list.includes(user.email.toLowerCase());
  const aal = tokenAal(req);
  const ip = ipAllowed(req);
  const panic = admin ? await panicState().catch(() => ({ active: false })) : { active: false };
  return NextResponse.json(
    { admin: admin && ip, configured: list.length > 0, ipBlocked: admin && !ip, mfaRequired: mfaRequired(), aal, mfaOk: !mfaRequired() || aal === 'aal2', panic },
    { status: admin && ip ? 200 : 403, headers: h },
  );
}
