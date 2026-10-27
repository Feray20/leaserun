import { NextResponse } from 'next/server';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { setFrozen } from '@/lib/cards/service';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ cardId: z.string().uuid(), on: z.boolean() });

// Karte vorübergehend sperren bzw. entsperren (nur eigene Karte, nur bei angeschlossenem Kartenherausgeber).
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte melden Sie sich an.' }, 401);
  if (!allowRequest(`karten-sperre:${user.id}`, 20, 10 * 60_000)) return j({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Anfrage.' }, 400);
  const r = await setFrozen(user.id, p.data.cardId, p.data.on, anonymizedIpHash(req));
  return r.ok ? j({ ok: true, ...(r.data as object || {}) }) : j({ error: r.error, code: r.code }, r.status);
}
