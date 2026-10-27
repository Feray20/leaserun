import { NextResponse } from 'next/server';
import { programStatus } from '@/lib/cards/status';
import { NOT_ACTIVE_MSG } from '@/lib/cards/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Kartenantrag: Solange kein zugelassener Partner (Kartenherausgeber, Identifizierung) angeschlossen ist,
// werden keine Antragsdaten angenommen oder gespeichert.
export async function POST() {
  if (!['LIVE', 'SANDBOX'].includes(programStatus())) return NextResponse.json({ error: NOT_ACTIVE_MSG, code: 'NOT_CONFIGURED' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ error: 'Der Antrag wird über den angeschlossenen Partner gestellt.', code: 'PROVIDER_PENDING' }, { status: 501 });
}
