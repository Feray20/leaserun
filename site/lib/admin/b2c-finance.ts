import type Stripe from 'stripe';
import { billingEnabled, stripe } from '@/lib/billing/stripe';
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin';
import PRICES from '@/public/data/preise.json';

// Finanz-Cockpit Bereich B2C: ausschließlich Privattarife (Kreditmappe 39 €, Käufer-Pass 49 €, Investor Pro 29 €/Monat).
// Stripe ist die einzige Quelle für Privatkäufe (keine eigene Zahlungstabelle). Unternehmenszahlungen
// (metadata.b2b_account_id) und Testkäufe (metadata.leaserun_test) werden ausgeschlossen.
const B2C_PLANS = new Set<string>(PRICES.privat.plans.map((p) => p.id));
const NAME: Record<string, string> = Object.fromEntries(PRICES.privat.plans.map((p) => [p.id, p.name]));
const VAT = 0.19;
const net = (gross: number) => Math.round(gross / (1 + VAT));
const MAX = 3000; // Sicherheitsgrenze je Abfrage

type Meta = Record<string, string> | null | undefined;
const isB2C = (m: Meta) => Boolean(m && !m.b2b_account_id && m.leaserun_test !== '1' && B2C_PLANS.has(String(m.plan || '')));

// Zeitraum (Berliner Kalendertage) als Unix-Sekunden.
// Berliner Versatz (MEZ +01:00 / MESZ +02:00) für den jeweiligen Tag.
const off = (day: string) => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(new Date(`${day}T12:00:00Z`)));
  return `+0${h - 12}:00`;
};
const ts = (day: string, end = false) => Math.floor(Date.parse(`${day}T${end ? '23:59:59' : '00:00:00'}${off(day)}`) / 1000);

async function collect<T>(list: Stripe.ApiListPromise<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of list) { out.push(x); if (out.length >= MAX) break; }
  return out;
}

// Metadaten der Rechnung eines Abos (ältere und neuere Stripe-API-Formen).
function invoiceMeta(inv: Stripe.Invoice): Meta {
  const anyInv = inv as unknown as { subscription_details?: { metadata?: Meta }; parent?: { subscription_details?: { metadata?: Meta } } };
  return anyInv.parent?.subscription_details?.metadata ?? anyInv.subscription_details?.metadata ?? null;
}

export type B2CPayment = { id: string; date: string; plan: string; planName: string; gross: number; net: number; kind: 'kauf' | 'abo-verlaengerung'; refunded: boolean };

async function payments(from: string, to: string): Promise<B2CPayment[]> {
  const s = stripe();
  const created = { gte: ts(from), lte: ts(to, true) };
  const [sessions, invoices] = await Promise.all([
    collect(s.checkout.sessions.list({ created, status: 'complete', limit: 100, expand: ['data.payment_intent'] })),
    collect(s.invoices.list({ created, status: 'paid', limit: 100 })),
  ]);
  const out: B2CPayment[] = [];
  for (const x of sessions) {
    if (x.payment_status !== 'paid' || !isB2C(x.metadata)) continue;
    const pi = x.payment_intent && typeof x.payment_intent === 'object' ? (x.payment_intent as Stripe.PaymentIntent) : null;
    const plan = String(x.metadata?.plan);
    const gross = Number(x.amount_total || 0);
    const refunded = Boolean(pi && (pi as unknown as { latest_charge?: { refunded?: boolean } }).latest_charge?.refunded);
    out.push({ id: x.id, date: new Date(x.created * 1000).toISOString().slice(0, 10), plan, planName: NAME[plan] || plan, gross, net: net(gross), kind: 'kauf', refunded });
  }
  // Abo-Verlängerungen (Investor Pro): nur Folgerechnungen; die Erstzahlung steckt bereits in der Checkout-Sitzung.
  for (const inv of invoices) {
    if (inv.billing_reason !== 'subscription_cycle' || !isB2C(invoiceMeta(inv))) continue;
    const plan = String(invoiceMeta(inv)?.plan);
    const gross = Number(inv.amount_paid || 0);
    out.push({ id: inv.id || '', date: new Date(inv.created * 1000).toISOString().slice(0, 10), plan, planName: NAME[plan] || plan, gross, net: net(gross), kind: 'abo-verlaengerung', refunded: false });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function b2cFinance(from: string, to: string, today: string) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe ist nicht eingerichtet (STRIPE_SECRET_KEY).');
  const rows = await payments(from, to);
  const valid = rows.filter((x) => !x.refunded);
  const gross = valid.reduce((a, x) => a + x.gross, 0);
  const revenue = { gross, net: valid.reduce((a, x) => a + x.net, 0), vat: gross - valid.reduce((a, x) => a + x.net, 0), count: valid.length, refunds: rows.length - valid.length };
  const byPlan = Object.fromEntries([...B2C_PLANS].map((p) => [p, { name: NAME[p], count: valid.filter((x) => x.plan === p).length, gross: valid.filter((x) => x.plan === p).reduce((a, x) => a + x.gross, 0) }]));

  // Laufende Abos (Investor Pro) für den wiederkehrenden Umsatz.
  let activeSubs = 0, mrrGross = 0;
  try {
    const subs = await collect(stripe().subscriptions.list({ status: 'active', limit: 100 }));
    for (const sub of subs) {
      if (!isB2C(sub.metadata)) continue;
      activeSubs++;
      for (const it of sub.items.data) {
        const p = it.price; const c = Number(p.unit_amount || 0) * Number(it.quantity || 1);
        mrrGross += p.recurring?.interval === 'year' ? Math.round(c / 12) : c;
      }
    }
  } catch { /* eingeschränkter Schlüssel – Abos nicht lesbar */ }

  // Netto-Umsatz der letzten 12 Monate (nur Privattarife).
  const m0 = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10);
  const year = from <= m0 ? rows : await payments(m0, today);
  const months: { m: string; net: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const key = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1)).toISOString().slice(0, 7);
    months.push({ m: key, net: year.filter((x) => !x.refunded && x.date.startsWith(key)).reduce((a, x) => a + x.net, 0) });
  }

  // Vergebene Kreditmappen (Privatkunden, ohne Unternehmen) und zahlende Konten.
  let kreditmappen = 0;
  if (adminConfigured()) {
    const { count } = await supabaseAdmin().from('lr_kreditmappe_versions').select('id', { count: 'exact', head: true })
      .is('b2b_account_id', null).gte('created_at', `${from}T00:00:00${off(from)}`).lte('created_at', `${to}T23:59:59${off(to)}`);
    kreditmappen = count ?? 0;
  }

  return {
    revenue, byPlan, payments: rows.slice(0, 200), months,
    recurring: { mrrGross, mrrNet: net(mrrGross), arrNet: net(mrrGross) * 12, activeSubs },
    downloads: { kreditmappen },
    billingLive: billingEnabled(),
  };
}
