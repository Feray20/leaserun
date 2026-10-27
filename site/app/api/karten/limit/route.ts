import { NextResponse } from 'next/server';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { updateLimit } from '@/lib/cards/service';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ cardId: z.string().uuid(), limitCents: z.number().int().min(0).max(5_000_000) });

// Monatslimit ändern: Prüfung erneut auf dem Server (Eigentum, Status, Kaution). Dem Browser wird nie vertraut.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte melden Sie sich an.' }, 401);
  const ip = anonymizedIpHash(req);
  if (!allowRequest(`karten-limit:${user.id}`, 10, 10 * 60_000)) return j({ error: 'Zu viele Änderungen. Bitte später erneut versuchen.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte einen gültigen Betrag angeben.' }, 400);
  const r = await updateLimit(user.id, p.data.cardId, p.data.limitCents, ip);
  return r.ok ? j({ ok: true }) : j({ error: r.error, code: r.code }, r.status);
}
