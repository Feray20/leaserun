import { NextResponse } from 'next/server';
import { addressError, confirmedFlag } from '@/lib/address';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, findCustomer, stripe } from '@/lib/billing/stripe';
import { allowRequest } from '@/lib/security/rate-limit';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Konto → Persönliche Daten: Name und Rechnungsanschrift.
// Gespeichert im Nutzerkonto (user_metadata.personal). Besteht bereits ein Stripe-Kunde, werden Name und Anschrift dort
// ebenfalls aktualisiert – Stripe verwendet sie ab der nächsten Rechnung. Bereits ausgestellte Rechnungen bleiben unverändert
// (Rechnungen dürfen nachträglich nicht geändert werden).
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const t = (max: number) => z.string().trim().max(max).optional().default('');
const Body = z.object({
  salutation: z.enum(['', 'Frau', 'Herr', 'Divers']).optional().default(''),
  firstName: z.string().trim().min(1, 'Bitte Vornamen angeben.').max(80),
  lastName: z.string().trim().min(1, 'Bitte Nachnamen angeben.').max(80),
  company: t(120),
  street: z.string().trim().min(3, 'Bitte Straße und Hausnummer angeben.').max(120),
  addressExtra: t(120),
  postalCode: z.string().trim().regex(/^[0-9A-Za-z -]{3,10}$/, 'Bitte eine gültige Postleitzahl angeben.'),
  city: z.string().trim().min(2, 'Bitte Ort angeben.').max(80),
  country: z.string().trim().regex(/^[A-Z]{2}$/).optional().default('DE'),
  phone: z.string().trim().regex(/^[+0-9 ()/-]{0,30}$/, 'Telefonnummer prüfen.').optional().default(''),
  addressConfirmed: z.unknown().optional(),
});
export type Personal = z.infer<typeof Body> & { updatedAt?: string };

export async function GET(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`me-personal:${user.id}`, 30, 60_000)) return j({ error: 'Zu viele Anfragen.' }, 429);
  const { data, error } = await supabaseAdmin().auth.admin.getUserById(user.id);
  if (error || !data.user) return j({ error: 'Konto nicht gefunden.' }, 404);
  return j({ personal: (data.user.user_metadata?.personal as Personal) || null, email: user.email });
}

export async function PUT(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte zuerst anmelden.' }, 401);
  if (!allowRequest(`me-personal-put:${user.id}`, 10, 60_000)) return j({ error: 'Zu viele Änderungen – bitte kurz warten.' }, 429);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Angaben prüfen.' }, 400);
  // Adressprüfung (Deutschland): PLZ, Ort, Straße und Hausnummer müssen zusammenpassen.
  if (p.data.country === 'DE') {
    const err = await addressError({ postalCode: p.data.postalCode, city: p.data.city, street: p.data.street }, confirmedFlag(p.data.addressConfirmed));
    if (err) return j({ error: err }, 400);
  }
  const { addressConfirmed: _ac, ...clean } = p.data; void _ac;
  const personal: Personal = { ...clean, updatedAt: new Date().toISOString() };
  const admin = supabaseAdmin();
  const { data: cur, error: e1 } = await admin.auth.admin.getUserById(user.id);
  if (e1 || !cur.user) return j({ error: 'Konto nicht gefunden.' }, 404);
  const { error: e2 } = await admin.auth.admin.updateUserById(user.id, { user_metadata: { ...(cur.user.user_metadata || {}), personal } });
  if (e2) return j({ error: 'Speichern fehlgeschlagen.' }, 500);

  // Stripe-Kunde (falls vorhanden) für künftige Rechnungen aktualisieren.
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
          address: { line1: p.data.street, line2: p.data.addressExtra || undefined, postal_code: p.data.postalCode, city: p.data.city, country: p.data.country },
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
