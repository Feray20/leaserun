import type Stripe from 'stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminList } from '@/lib/security/admin';
import { testKeyMode, testStripe } from '@/lib/billing/stripe';

// Testkauf-Schalter (Web-Admin → System): Ist er an, laufen Käufe von Administratoren über den Stripe-Testmodus –
// dieselbe Bezahlseite, aber Testkarte 4242 4242 4242 4242 (beliebiges Datum in der Zukunft, beliebige Prüfziffer).
// Kunden kaufen immer echt. Ist der Schalter aus, prüft Stripe alle Angaben wie im Live-Betrieb.
export const TESTKAUF_KEY = 'testkauf_mode';
export type TestkaufState = { on: boolean; by?: string; at?: string };

export async function testkaufState(): Promise<TestkaufState> {
  if (!adminConfigured()) return { on: false };
  try {
    const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', TESTKAUF_KEY).maybeSingle();
    return { on: Boolean((data?.value as TestkaufState | null)?.on), ...((data?.value as object) || {}) };
  } catch { return { on: false }; }
}

// Stripe-Client für diesen Käufer: Testmodus nur, wenn der Schalter an ist, ein Testschlüssel existiert und ein Admin kauft.
export async function testStripeFor(email: string): Promise<Stripe | null> {
  if (!testKeyMode()) return null;
  if (!adminList().includes(String(email || '').toLowerCase())) return null;
  return (await testkaufState()).on ? testStripe() : null;
}

export async function testCustomer(s: Stripe, email: string): Promise<string> {
  const list = await s.customers.list({ email, limit: 10 });
  const hit = list.data.find((c) => c.metadata?.leaserun_test === '1');
  if (hit) return hit.id;
  return (await s.customers.create({ email, name: 'LeaseRun Testkauf', preferred_locales: ['de'], metadata: { leaserun_test: '1' } })).id;
}
