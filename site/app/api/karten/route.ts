import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { capabilities, programStatus } from '@/lib/cards/status';
import { overview } from '@/lib/cards/service';
import { currentPricing, pricingHash } from '@/lib/cards/pricing';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

// Status der LeaseRun Card und – mit Anmeldung – die eigenen Karten. Ohne Anbieter: leere Liste, Status „In Vorbereitung“.
export async function GET(req: Request) {
  if (!allowRequest(`karten:${anonymizedIpHash(req) ?? 'x'}`, 60, 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const v = currentPricing();
  const base = { program: programStatus(), capabilities: capabilities(), pricing: { documentId: v.documentId, version: v.version, status: v.status, effectiveFrom: v.effectiveFrom, hash: pricingHash(v).slice(0, 16) } };
  const user = req.headers.get('authorization') ? await userFromRequest(req) : null;
  if (!user) return j({ ...base, signedIn: false });
  return j({ ...base, signedIn: true, ...(await overview(user.id)) });
}
