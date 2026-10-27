import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { accessGrant, billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Freischaltungen des angemeldeten Nutzers. Wird auch direkt nach der Rückkehr aus dem Checkout aufgerufen.
export async function GET(req: Request) {
  const free = { enabled: false, pro: false, proSource: null, proUntil: null, starter: false, starterUntil: null, tier: 'free', creditMaps: 0, creditMapsUsed: 0, hasCustomer: false };
  const user = await userFromRequest(req);
  if (!billingEnabled()) {
    // Ohne Abrechnung zählt nur die manuelle Freischaltung aus dem Web-Admin.
    const g = user ? await accessGrant(user.id) : null;
    const out = g ? { ...free, tier: g.tier, pro: g.tier === 'pro', starter: g.tier === 'starter', proSource: g.tier === 'pro' ? 'pass' : null, proUntil: g.tier === 'pro' ? g.valid_until : null, starterUntil: g.tier === 'starter' ? g.valid_until : null, creditMaps: g.credit_maps || 0, leitfaden: g.leitfaden, grant: g, features: g.features || {} } : free;
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  try {
    const e = await entitlementsFor(user.id, user.email, new URL(req.url).searchParams.has('fresh'));
    let creditMapsUsed = 0;
    if (adminConfigured()) {
      const { count } = await supabaseAdmin().from('lr_kreditmappe_credits').select('object_ref', { count: 'exact', head: true }).eq('owner_id', user.id);
      creditMapsUsed = count ?? 0;
    }
    return NextResponse.json({ enabled: true, ...e, features: e.grant?.features || {}, creditMapsUsed }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('status_error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Status konnte nicht geladen werden.' }, { status: 502 });
  }
}
