import { after, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { adminConfigured } from '@/lib/supabase/admin';
import { kickQueue, runQueue } from '@/lib/mail/send-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Interner Aufruf: nächstes Paket von „Alle senden“ abarbeiten. Nur mit CRON_SECRET (der Server ruft sich selbst auf).
// Antwortet sofort; gesendet wird danach im Hintergrund, und bei Rest stößt sich der Lauf erneut an.
const ok = (got: string, want: string) => { const a = Buffer.from(got), b = Buffer.from(want); return a.length === b.length && timingSafeEqual(a, b); };

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || !ok(got, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht konfiguriert.' }, { status: 503 });
  const origin = new URL(req.url).origin;
  after(async () => {
    const r = await runQueue(40_000).catch(() => ({ left: 0, locked: true }));
    if (r.left > 0 && !r.locked) await kickQueue(origin);
  });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
