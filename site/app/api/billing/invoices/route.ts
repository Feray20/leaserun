import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { billingEnabled, findCustomer, stripe } from '@/lib/billing/stripe';
import { allowRequest } from '@/lib/security/rate-limit';

export const dynamic = 'force-dynamic';

// Rechnungen des angemeldeten Nutzers (von Stripe ausgestellt). Die PDF-Links werden bei jedem Aufruf frisch
// abgefragt und sind damit beliebig oft abrufbar. Logo und Farben setzt Stripe aus den Branding-Einstellungen.
export async function GET(req: Request) {
  const noStore = { 'Cache-Control': 'no-store' };
  if (!billingEnabled()) return NextResponse.json({ enabled: false, invoices: [] }, { headers: noStore });
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  if (!allowRequest(`invoices:${user.id}`, 30, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  try {
    const customer = await findCustomer(user.id, user.email);
    if (!customer) return NextResponse.json({ enabled: true, invoices: [] }, { headers: noStore });
    const list = await stripe().invoices.list({ customer: customer.id, limit: 100 });
    const invoices = list.data
      .filter((i) => i.status === 'paid' || i.status === 'open')
      .map((i) => ({
        id: i.id, number: i.number, date: new Date((i.status_transitions?.finalized_at || i.created) * 1000).toISOString(),
        total: i.total, currency: i.currency, status: i.status, description: i.lines?.data?.[0]?.description || i.description || '',
        pdf: i.invoice_pdf || null, hosted: i.hosted_invoice_url || null,
      }));
    return NextResponse.json({ enabled: true, invoices }, { headers: noStore });
  } catch (e) {
    console.error('invoices_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Rechnungen konnten nicht geladen werden.' }, { status: 502 });
  }
}
