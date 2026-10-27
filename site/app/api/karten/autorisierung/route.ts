import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { authorizeTransaction } from '@/lib/cards/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ cardId: z.string().uuid(), amountCents: z.number().int().positive().max(100_000_000), idempotencyKey: z.string().min(8).max(120), merchant: z.string().max(120).optional(), category: z.string().max(60).optional() });

// Echtzeit-Autorisierung durch den Kartenherausgeber (Server-zu-Server). Signatur: HMAC-SHA256 über den Rohtext
// mit CARD_PROVIDER_WEBHOOK_SECRET im Kopf „x-leaserun-signature“. Ohne Geheimnis: nicht eingerichtet.
export async function POST(req: Request) {
  const secret = process.env.CARD_PROVIDER_WEBHOOK_SECRET;
  if (!secret) return j({ status: 'NOT_CONFIGURED' }, 503);
  const raw = await req.text();
  const sig = Buffer.from(req.headers.get('x-leaserun-signature') || '', 'hex');
  const want = createHmac('sha256', secret).update(raw).digest();
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return j({ error: 'Ungültige Signatur.' }, 401);
  let body: unknown; try { body = JSON.parse(raw); } catch { return j({ error: 'Ungültig.' }, 400); }
  const p = Body.safeParse(body);
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const r = await authorizeTransaction(p.data);
  return r.ok ? j(r.data) : j({ error: r.error, code: r.code }, r.status);
}
