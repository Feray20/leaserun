import { NextResponse } from 'next/server';
import { logSecurity } from '@/lib/security/seclog';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';
import { hasOwnCookie } from '@/lib/security/trusted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Fehlgeschlagene Anmeldung melden (vom Anmeldeformular). Zählt je anonymisierter IP; ab 10 Fehlversuchen
// in 15 Minuten wird die Quelle automatisch für 24 Stunden gesperrt (lib/security/autoblock.ts).
// Es wird nur der IP-Hash gespeichert – keine E-Mail-Adresse, kein Passwort.
export async function POST(req: Request) {
  const ip = anonymizedIpHash(req);
  if (hasOwnCookie(req)) return new NextResponse(null, { status: 204 }); // eigenes Gerät: kein Vorfall
  if (!ip || !allowRequest(`loginfail:${ip}`, 30, 60_000)) return new NextResponse(null, { status: 204 });
  const area = new URL(req.url).searchParams.get('area');
  logSecurity('login_flood', `login:${ip}`, { ipHash: ip, detail: area === 'admin' ? 'Anmeldung Web-Admin' : area === 'b2b' ? 'Anmeldung Unternehmensportal' : area === 'creator' ? 'Anmeldung Creator-Bereich' : 'Anmeldung' });
  return new NextResponse(null, { status: 204 });
}
