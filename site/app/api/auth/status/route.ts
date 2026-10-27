import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { allowRequest } from '@/lib/security/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Express sign-in: after the email is entered, detect whether an account exists (sign in) or not (sign up) –
// and whether it was created with Google/Microsoft instead of a password.
// Used by the consumer app and the business portal. Strictly rate-limited against bulk lookups.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const Body = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

export async function POST(req: Request) {
  if (!adminConfigured()) return j({ known: false });
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`authstatus:${ip}`, 12, 10 * 60_000)) return j({ error: 'Too many requests. Please wait a moment.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Please enter a valid email address.' }, 400);
  const { data, error } = await supabaseAdmin().rpc('lr_email_status', { p_email: p.data.email });
  if (error || !data) return j({ known: false });
  const d = data as { exists: boolean; confirmed?: boolean; password?: boolean; providers?: string[] };
  const sso = (d.providers || []).filter((x) => x === 'google' || x === 'apple' || x === 'azure');
  return j({ known: true, exists: !!d.exists, confirmed: !!d.confirmed, password: !!d.password, sso });
}
