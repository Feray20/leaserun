import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Freischaltungen des angemeldeten Nutzers. Wird auch direkt nach der Rückkehr aus dem Checkout aufgerufen.
export async function GET(req: Request) {
  const free = { enabled: false, pro: false, proSource: null, proUntil: null, starter: false, starterUntil: null, tier: 'free', creditMaps: 0, creditMapsUsed: 0, hasCustomer: false };
  if (!billingEnabled()) return NextResponse.json(free, { headers: { 'Cache-Control': 'no-store' } });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  try {
    const e = await entitlementsFor(user.id, user.email);
    let creditMapsUsed = 0;
    if (adminConfigured()) {
      const { count } = await supabaseAdmin().from('immo_kreditmappe_credits').select('object_ref', { count: 'exact', head: true }).eq('owner_id', user.id);
      creditMapsUsed = count ?? 0;
    }
    return NextResponse.json({ enabled: true, ...e, creditMapsUsed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('status_error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Status konnte nicht geladen werden.' }, { status: 502 });
  }
}
