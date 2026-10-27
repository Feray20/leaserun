import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Express-Login: Nach Eingabe der E-Mail erkennt die Anmeldung, ob es schon ein Konto gibt (dann anmelden)
// oder nicht (dann registrieren) – und ob das Konto mit Google/Microsoft statt mit Passwort angelegt wurde.
// Gilt für Privatbereich und Unternehmensportal (gemeinsame Anmeldung). Streng gedrosselt gegen Massenabfragen.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

export async function POST(req: Request) {
  if (!adminConfigured()) return j({ known: false });
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`authstatus:${ip}`, 12, 10 * 60_000)) return j({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Bitte eine gültige E-Mail-Adresse angeben.' }, 400);
  const { data, error } = await supabaseAdmin().rpc('lr_email_status', { p_email: p.data.email });
  if (error || !data) return j({ known: false });
  const d = data as { exists: boolean; confirmed?: boolean; password?: boolean; providers?: string[] };
  const sso = (d.providers || []).filter((x) => x === 'google' || x === 'apple' || x === 'azure');
  return j({ known: true, exists: !!d.exists, confirmed: !!d.confirmed, password: !!d.password, sso });
}
