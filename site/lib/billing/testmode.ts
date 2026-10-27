import type Stripe from 'stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminList } from '@/lib/security/admin';
import { testKeyMode, testStripe } from '@/lib/billing/stripe';

// Test purchase switch (Web-Admin → System): when on, purchases by administrators run in Stripe test mode –
// same checkout, but test card 4242 4242 4242 4242 (any future date, any CVC).
// Customers always buy for real. When off, Stripe checks everything as in live mode.
export const TESTKAUF_KEY = 'testkauf_mode';
export type TestkaufState = { on: boolean; by?: string; at?: string };

export async function testkaufState(): Promise<TestkaufState> {
  if (!adminConfigured()) return { on: false };
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', TESTKAUF_KEY).maybeSingle();
    return { on: Boolean((data?.value as TestkaufState | null)?.on), ...((data?.value as object) || {}) };
  } catch { return { on: false }; }
}

// Stripe client for this buyer: test mode only if the switch is on, a test key exists and an admin is buying.
export async function testStripeFor(email: string): Promise<Stripe | null> {
  if (!testKeyMode()) return null;
  if (!adminList().includes(String(email || '').toLowerCase())) return null;
  return (await testkaufState()).on ? testStripe() : null;
}

export async function testCustomer(s: Stripe, email: string): Promise<string> {
  const list = await s.customers.list({ email, limit: 10 });
  const hit = list.data.find((c) => c.metadata?.leaserun_test === '1');
  if (hit) return hit.id;
  return (await s.customers.create({ email, name: 'LeaseRun test purchase', preferred_locales: ['en-US'], metadata: { leaserun_test: '1' } })).id;
}
