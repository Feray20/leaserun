import { NextResponse } from 'next/server';
import { billingEnabled } from '@/lib/billing/stripe';

export const dynamic = 'force-dynamic';

// Ob Käufe möglich sind. In Produktion bleibt das aus, bis Live-Schlüssel und Lieferung bereitstehen.
export function GET() {
  const key = process.env.STRIPE_SECRET_KEY || '';
  return NextResponse.json(
    { enabled: billingEnabled(), testMode: key.startsWith('sk_test_') },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
