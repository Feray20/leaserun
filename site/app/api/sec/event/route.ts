import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { logSecurity } from '@/lib/security/seclog';
import { internalToken } from '@/lib/security/internal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Interne Meldung aus der Middleware (Scanner-Zugriffe, gesperrte Quellen). Nur mit internem Schlüssel.

export async function POST(req: Request) {
  const got = Buffer.from(req.headers.get('x-ia-sec') || ''), want = Buffer.from(internalToken());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new NextResponse(null, { status: 404 });
  const b = (await req.json().catch(() => null)) as { kind?: string; ip?: string; detail?: string } | null;
  if (!b || !['probe', 'blocked'].includes(String(b.kind))) return new NextResponse(null, { status: 400 });
  logSecurity(b.kind as 'probe' | 'blocked', `edge:${b.ip || 'x'}`, { ipHash: b.ip || null, detail: String(b.detail || '').slice(0, 160) });
  return new NextResponse(null, { status: 204 });
}
