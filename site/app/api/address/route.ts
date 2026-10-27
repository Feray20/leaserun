import { NextResponse } from 'next/server';
import { allowRequest } from '@/lib/security/rate-limit';
import { checkAddress } from '@/lib/address';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Adressprüfung für Formulare (Rechnungsanschrift, Unternehmensdaten). Keine Speicherung.
export async function GET(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'x';
  if (!allowRequest(`addr:${ip}`, 40, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  const q = new URL(req.url).searchParams;
  const r = await checkAddress({ postalCode: (q.get('plz') || '').slice(0, 10), city: (q.get('ort') || '').slice(0, 80), street: (q.get('street') || '').slice(0, 160) });
  return NextResponse.json(r, { headers: { 'Cache-Control': 'private, max-age=300' } });
}
