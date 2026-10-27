import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { paidAccess } from '@/lib/billing/paid';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

// Zugang für die Navigation: „Zur Anwendung" und App-Leiste nur für zahlende Kunden
// (gebuchter Tarif, aktives Unternehmenskonto). Liefert nur Ja/Nein-Werte.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ loggedIn: false, paid: false }, 401);
  if (!allowRequest(`me-access:${user.id}`, 30, 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const acc = await paidAccess(user);
  return j({ loggedIn: true, ...acc });
}
