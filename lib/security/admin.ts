import { anonymizedIpHash } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { userFromRequest, type AuthUser } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { ipAllowed } from '@/lib/security/panic';
import { logSecurity } from '@/lib/security/seclog';

// Administratoren: E-Mail in ADMIN_EMAILS und – solange ADMIN_MFA nicht "off" ist –
// eine Sitzung mit zweitem Faktor (Supabase MFA, TOTP-App; Token-Claim aal = aal2).

export const adminList = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (email: string) => adminList().includes(email.toLowerCase());
export const mfaRequired = () => process.env.ADMIN_MFA !== 'off';

// Der Token wurde in userFromRequest serverseitig bei Supabase geprüft; hier wird nur der Claim gelesen.
export function tokenAal(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const part = h.replace(/^Bearer\s+/, '').split('.')[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { aal?: string };
    return typeof payload.aal === 'string' ? payload.aal : null;
  } catch {
    return null;
  }
}

const noStore = { 'Cache-Control': 'no-store' };

export async function requireAdmin(req: Request): Promise<{ user: AuthUser } | NextResponse> {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte anmelden.' }, { status: 401, headers: noStore });
  if (!allowRequest(`admin:${user.id}`, 120, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429, headers: noStore });
  if (!isAdminEmail(user.email)) { logSecurity('admin_denied', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: 'Web-Admin' }); return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403, headers: noStore }); }
  if (!ipAllowed(req)) { logSecurity('admin_ip_blocked', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: 'Web-Admin' }); return NextResponse.json({ error: 'Zugriff von dieser IP-Adresse nicht freigegeben (ADMIN_IP_ALLOWLIST).' }, { status: 403, headers: noStore }); }
  if (mfaRequired() && tokenAal(req) !== 'aal2') {
    logSecurity('admin_mfa_missing', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: 'Web-Admin' });
    return NextResponse.json({ error: 'Bitte mit zweitem Faktor bestätigen.', mfa: 'required' }, { status: 403, headers: noStore });
  }
  return { user };
}
