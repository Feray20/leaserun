import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { paidAccess } from '@/lib/billing/paid';
import { allowRequest } from '@/lib/security/rate-limit';
import { DETAILS } from '@/lib/wissen/preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' } });

// Ausführliche Antworten der Wissenszentrale (Rechenweg, Rechtsgrundlage, Bankpraxis): nur für zahlende Kunden.
// Öffentlich stehen auf der Website nur Frage, Kernaussage und nächster Schritt.
export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte anmelden.' }, 401);
  if (!allowRequest(`wissen-details:${user.id}`, 20, 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const acc = await paidAccess(user);
  if (!acc.areas.wissen) return j({ error: 'Die ausführlichen Antworten sind im LeaseRun-Zugang enthalten.' }, 402);
  return j({ entries: DETAILS.map(({ q, l1, next, l2 }) => ({ q, l1, next, l2 })) });
}
