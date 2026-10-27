import { NextResponse } from 'next/server';
import { addressError, confirmedFlag } from '@/lib/address';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, findCustomer, stripe } from '@/lib/billing/stripe';
import { allowRequest } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Account → Personal details: name and billing address.
// Stored on the user account (user_metadata.personal). If a Stripe customer already exists, name and address are updated
// there too – Stripe uses them from the next invoice/receipt on. Invoices already issued stay unchanged.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const t = (max: number) => z.string().trim().max(max).optional().default('');
const Body = z.object({
  salutation: z.enum(['', 'Ms.', 'Mr.', 'Mx.', 'Dr.']).optional().default(''),
  firstName: z.string().trim().min(1, 'Please enter your first name.').max(80),
  lastName: z.string().trim().min(1, 'Please enter your last name.').max(80),
  company: t(120),
  street: z.string().trim().min(3, 'Please enter your street address.').max(120),
  addressExtra: t(120),
  postalCode: z.string().trim().regex(/^[0-9A-Za-z -]{3,10}$/, 'Please enter a valid ZIP code.'),
  city: z.string().trim().min(2, 'Please enter your city.').max(80),
  state: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/, 'Please choose a state.').optional().default(''),
  country: z.string().trim().regex(/^[A-Z]{2}$/).optional().default('US'),
  phone: z.string().trim().regex(/^[+0-9 ()/-]{0,30}$/, 'Please check the phone number.').optional().default(''),
  addressConfirmed: z.unknown().optional(),
});
export type Personal = z.infer<typeof Body> & { updatedAt?: string };

export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`me-personal:${user.id}`, 30, 60_000)) return j({ error: 'Too many requests.' }, 429);
  const { data, error } = await supabaseAdmin().auth.admin.getUserById(user.id);
  if (error || !data.user) return j({ error: 'Account not found.' }, 404);
  return j({ personal: (data.user.user_metadata?.personal as Personal) || null, email: user.email });
}

export async function PUT(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Please sign in first.' }, 401);
  if (!allowRequest(`me-personal-put:${user.id}`, 10, 60_000)) return j({ error: 'Too many changes. Please wait a moment.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Please check your entries.' }, 400);
  // US address check: ZIP, state, city and house number must match.
  if (p.data.country === 'US') {
    if (!p.data.state) return j({ error: 'Please choose a state.' }, 400);
    const err = await addressError({ postalCode: p.data.postalCode, city: p.data.city, street: p.data.street, state: p.data.state }, confirmedFlag(p.data.addressConfirmed));
    if (err) return j({ error: err }, 400);
  }
  const { addressConfirmed: _ac, ...clean } = p.data; void _ac;
  const personal: Personal = { ...clean, updatedAt: new Date().toISOString() };
  const admin = supabaseAdmin();
  const { data: cur, error: e1 } = await admin.auth.admin.getUserById(user.id);
  if (e1 || !cur.user) return j({ error: 'Account not found.' }, 404);
  const { error: e2 } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(cur.user.user_metadata || {}), personal } });
  if (e2) return j({ error: 'Could not save. Please try again.' }, 500);

  // Update the Stripe customer (if any) for future invoices.
  let invoice: 'updated' | 'no-customer' | 'off' | 'failed' = 'off';
  if (billingEnabled()) {
    try {
      const c = await findCustomer(user.id, user.email);
      if (!c) invoice = 'no-customer';
      else {
        const name = [p.data.firstName, p.data.lastName].join(' ');
        await stripe().customers.update(c.id, {
          name: p.data.company ? `${p.data.company} – ${name}` : name,
          phone: p.data.phone || undefined,
          address: { line1: p.data.street, line2: p.data.addressExtra || undefined, postal_code: p.data.postalCode, city: p.data.city, state: p.data.state || undefined, country: p.data.country },
          metadata: { personal_updated_at: personal.updatedAt || '' },
        });
        invoice = 'updated';
      }
    } catch (e) {
      console.error('personal_stripe', e instanceof Error ? e.message : e);
      invoice = 'failed';
    }
  }
  return j({ ok: true, personal, invoice });
}
