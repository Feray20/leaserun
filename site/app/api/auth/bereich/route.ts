import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { adminConfigured } from '@/lib/supabase/admin';
import { isAdminEmail, roleOf } from '@/lib/security/admin';
import { membershipFor } from '@/lib/b2b/core';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Strikte Trennung der Anmeldungen: Zu welchem Bereich gehört dieses Konto?
//   admin – Web-Admin (Inhaber oder Teamrolle) · b2b – Mitglied eines Unternehmenskontos · b2c – sonst (Privatkunde)
// Die Anmeldemasken lassen nur Konten des eigenen Bereichs herein.
export async function GET(req: Request) {
  const user = await userFromRequest(req, { allowAal1: true });
  if (!user) return NextResponse.json({ error: 'Bitte anmelden.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  if (!allowRequest(`bereich:${user.id}`, 30, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  const admin = isAdminEmail(user.email) || Boolean(await roleOf(user.email).catch(() => null));
  const b2b = adminConfigured() ? Boolean(await membershipFor(user.id).catch(() => null)) : false;
  return NextResponse.json({ bereich: admin ? 'admin' : b2b ? 'b2b' : 'b2c', admin, b2b }, { headers: { 'Cache-Control': 'no-store' } });
}
