import { NextResponse } from 'next/server';
import { healthCheck } from '@/lib/api/health';
import { API_VERSION } from '@/lib/api/config';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/v1/health – öffentlicher Status je Komponente, ohne interne Details (keine Fehlertexte, keine Konfiguration).
export async function GET(req: Request) {
  if (!allowRequest(`apihealth:${anonymizedIpHash(req) ?? 'x'}`, 30, 60_000)) return NextResponse.json({ status: 'unknown', code: 'RATE_LIMIT_EXCEEDED' }, { status: 429 });
  const h = await healthCheck();
  return NextResponse.json({
    status: h.status, version: API_VERSION, checked_at: h.checked_at,
    components: Object.fromEntries(h.components.map((c) => [c.name, c.status])),
  }, { status: h.status === 'unavailable' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
