import { NextResponse } from 'next/server';
import { billingEnabled } from '@/lib/billing/stripe';

export const dynamic = 'force-dynamic';

// Whether purchases are possible. Stays off in production until live keys and delivery are ready.
export function GET() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return NextResponse.json(
    { enabled: billingEnabled(), testMode: key.startsWith('sk_test_') },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
