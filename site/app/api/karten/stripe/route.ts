import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { issuingClient } from '@/lib/cards/stripe-issuing';
import { applyStripeIssuingEvent, decideStripeAuthorization } from '@/lib/cards/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'fra1';

// Stripe Issuing: Echtzeit-Freigabe (issuing_authorization.request) und Folgeereignisse für die LeaseRun Card.
// Im Stripe-Dashboard unter Issuing → Echtzeit-Autorisierung bzw. Webhooks diese Adresse eintragen:
// https://leaserun.com/api/karten/stripe – Signaturgeheimnis in STRIPE_ISSUING_WEBHOOK_SECRET.
// Grundsatz: Im Zweifel ablehnen. Die Freigabe prüft das harte Limit atomar in der Datenbank.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_ISSUING_WEBHOOK_SECRET;
  const s = issuingClient();
  const sig = req.headers.get('stripe-signature');
  if (!secret || !s) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!sig) return NextResponse.json({ error: 'missing signature' }, { status: 400 });
  const payload = await req.text();
  let event: Stripe.Event;
  try { event = s.webhooks.constructEvent(payload, sig, secret); } catch { return NextResponse.json({ error: 'invalid signature' }, { status: 400 }); }

  if (event.type === 'issuing_authorization.request') {
    let approved = false;
    try {
      const d = await Promise.race([
        decideStripeAuthorization(event.data.object as unknown as Parameters<typeof decideStripeAuthorization>[0]),
        new Promise<{ approved: boolean; reason: string }>((r) => setTimeout(() => r({ approved: false, reason: 'timeout' }), 1500)),
      ]);
      approved = d.approved;
      if (!approved) console.info('[karten] abgelehnt', d.reason);
    } catch (e) { console.warn('[karten] freigabe fehler', e instanceof Error ? e.message : e); approved = false; }
    return new NextResponse(JSON.stringify({ approved }), { status: 200, headers: { 'Content-Type': 'application/json', 'Stripe-Version': event.api_version || '2025-03-31.basil' } });
  }

  try { await applyStripeIssuingEvent(event.type, event.data.object as unknown as Record<string, unknown>); }
  catch (e) { console.error('[karten] stripe ereignis', event.type, e instanceof Error ? e.message : e); return NextResponse.json({ error: 'retry' }, { status: 500 }); }
  return NextResponse.json({ received: true });
}
