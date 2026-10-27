import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { AREA_ROLES, canAccess, isTeamRole, type AdminArea, type AdminRole } from '@/lib/security/roles';
import { NextResponse } from 'next/server';
import { userFromRequest, type AuthUser } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { ipAllowed } from '@/lib/security/panic';
import { logSecurity } from '@/lib/security/seclog';
import { after } from 'next/server';
import { hasOwnCookie, trustIp } from '@/lib/security/trusted';

// Administratoren: E-Mail in ADMIN_EMAILS und – solange ADMIN_MFA nicht "off" ist –
// eine Sitzung mit zweitem Faktor (Supabase MFA, TOTP-App; Token-Claim aal = aal2).

export const adminList = () => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const isAdminEmail = (email: string) => adminList().includes(email.toLowerCase());
// Rollen: Inhaber = ADMIN_EMAILS (unverändert). Teammitglieder stehen in lr_admin_roles (Support, Buchhaltung, Nur lesen).
// Fehlt die Tabelle oder ist die Datenbank nicht erreichbar, gelten nur die Inhaber (sicher geschlossen).
let roleCache: { at: number; map: Map<string, AdminRole> } | null = null;
async function teamRoles(): Promise<Map<string, AdminRole>> {
  const now = Date.now();
  if (roleCache && now - roleCache.at < 15_000) return roleCache.map;
  const map = new Map<string, AdminRole>();
  if (adminConfigured()) {
    const { data } = await supabaseAdmin().from('lr_admin_roles').select('email, role');
    for (const r of data ?? []) if (isTeamRole(r.role)) map.set(String(r.email).toLowerCase(), r.role);
  }
  roleCache = { at: now, map };
  return map;
}
export const resetRoleCache = () => { roleCache = null; };
export async function roleOf(email: string): Promise<AdminRole | null> {
  const e = email.toLowerCase();
  if (isAdminEmail(e)) return 'owner';
  return (await teamRoles().catch(() => new Map<string, AdminRole>())).get(e) ?? null;
}
// Empfänger für Mitteilungen: Inhaber plus Teammitglieder, die den Bereich sehen dürfen.
export async function adminEmailsFor(area: AdminArea | 'owner'): Promise<string[]> {
  const owners = adminList();
  if (area === 'owner') return owners;
  const team = await teamRoles().catch(() => new Map<string, AdminRole>());
  return [...new Set([...owners, ...[...team].filter(([, r]) => AREA_ROLES[area].includes(r)).map(([e]) => e)])];
}

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

// area angeben: dann dürfen auch Teammitglieder mit passender Rolle. Ohne area bleibt die Schnittstelle dem Inhaber vorbehalten.
export async function requireAdmin(req: Request, area?: AdminArea): Promise<{ user: AuthUser; role: AdminRole } | NextResponse> {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte anmelden.' }, { status: 401, headers: noStore });
  if (!allowRequest(`admin:${user.id}`, 120, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429, headers: noStore });
  const role = await roleOf(user.email);
  if (!role) { logSecurity('admin_denied', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: 'Web-Admin' }); return NextResponse.json({ error: 'Kein Zugriff.' }, { status: 403, headers: noStore }); }
  if (!canAccess(role, area)) { logSecurity('admin_denied', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: `Rolle ${role}: ${area ?? 'nur Inhaber'}` }); return NextResponse.json({ error: 'Keine Berechtigung für diesen Bereich.' }, { status: 403, headers: noStore }); }
  if (!ipAllowed(req)) { logSecurity('admin_ip_blocked', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: 'Web-Admin' }); return NextResponse.json({ error: 'Zugriff von dieser IP-Adresse nicht freigegeben (ADMIN_IP_ALLOWLIST).' }, { status: 403, headers: noStore }); }
  if (mfaRequired() && tokenAal(req) !== 'aal2') {
    if (!hasOwnCookie(req)) logSecurity('admin_mfa_missing', `admin:${user.id}`, { ipHash: anonymizedIpHash(req), detail: 'Web-Admin' });
    return NextResponse.json({ error: 'Bitte mit zweitem Faktor bestätigen.', mfa: 'required' }, { status: 403, headers: noStore });
  }
  // Vollständig angemeldet (Admin + zweiter Faktor): dieses Netz als eigenes merken.
  const ip = anonymizedIpHash(req);
  try { after(() => trustIp(ip).catch(() => null)); } catch { trustIp(ip).catch(() => null); }
  return { user, role };
}
