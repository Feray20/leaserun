import type Stripe from 'stripe';
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin';
import { effectiveTier, type B2BAccount } from '@/lib/b2b/core';
import { accountBranches, getCatalog } from '@/lib/b2b/catalog';

// Abrechnungsstand je aktivem Abo und Unternehmenskonto (Finanz-Cockpit und HQ-Thema „abrechnung“ für Ryan).
// Zeigt, ob zu jedem laufenden Vertrag wirklich abgerechnet und bezahlt wurde – oder warum nicht (Testphase, 100-%-Rabatt,
// keine Rechnung). Quellen: Stripe (Abos mit letzter Rechnung und Rabatt) und das Rechnungsarchiv in Supabase (Zahlung auf Rechnung).
// Nur lesend: nichts wird angelegt, geändert oder gelöscht. Privatkunden erscheinen nur mit gekürzter E-Mail-Adresse.

export type AbrStatus = 'bezahlt' | 'offen' | 'überfällig' | 'Testphase' | '100-%-Rabatt' | 'ohne Rechnung';
export type AbrZeile = {
  quelle: 'stripe' | 'rechnung'; bereich: 'b2c' | 'b2b';
  kunde: string; tarif: string; intervall: string; preisBrutto: number;
  letzteZahlung: { datum: string; betrag: number } | null;
  naechsteAbrechnung: string | null;
  offen: number; aeltesteOffene: { nummer: string; faellig: string | null } | null;
  status: AbrStatus; hinweis: string;
};
export type Abrechnung = { stand: string; zeilen: AbrZeile[]; fehler: string[] };

const VAT = 0.19;
const DAY = 864e5;
const day = (s: number | string | null | undefined) => (s == null ? null : (typeof s === 'number' ? new Date(s * 1000) : new Date(s)).toISOString().slice(0, 10));
const INTERVALL: Record<string, string> = { day: 'täglich', week: 'wöchentlich', month: 'monatlich', year: 'jährlich' };
// Gekürzte Adresse: „ma***@gmx.de“ – reicht zum Wiederfinden in Stripe, ohne die volle Adresse weiterzugeben.
const kurzMail = (m: string) => { const [a, d] = m.split('@'); return d ? `${a.slice(0, 2)}***@${d}` : ''; };
// Nächster Abrechnungstag nach einem Rechnungsdatum (Monats- bzw. Jahresschritt).
const plus = (iso: string, interval: string) => { const d = new Date(`${iso}T12:00:00Z`); if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };

// „ohne Rechnung“: monatlich keine Rechnung in den letzten 35 Tagen, sonst keine Rechnung seit Vertragsbeginn.
const ohneRechnung = (interval: string, rechnungen: string[], beginn: string | null) => {
  if (interval === 'month') return !rechnungen.some((d) => Date.now() - Date.parse(`${d}T12:00:00Z`) <= 35 * DAY);
  return !rechnungen.some((d) => !beginn || d >= beginn);
};

// ---------- Stripe-Abos (active, trialing, past_due) ----------
async function stripeZeilen(fehler: string[]): Promise<{ zeilen: AbrZeile[]; konten: Set<string>; abos: Set<string> }> {
  const konten = new Set<string>(), abos = new Set<string>(), zeilen: AbrZeile[] = [];
  if (!process.env.STRIPE_SECRET_KEY) { fehler.push('Stripe ist nicht eingerichtet (STRIPE_SECRET_KEY) – Abos nicht lesbar.'); return { zeilen, konten, abos }; }
  const { stripe } = await import('@/lib/billing/stripe');
  const s = stripe();
  const subs: Stripe.Subscription[] = [];
  for (const status of ['active', 'trialing', 'past_due'] as const) {
    try {
      for await (const x of s.subscriptions.list({ status, limit: 100, expand: ['data.latest_invoice', 'data.customer', 'data.discounts'] })) { subs.push(x); if (subs.length >= 300) break; }
    } catch (e) { fehler.push(`Stripe-Abos (${status}) nicht lesbar: ${e instanceof Error ? e.message : 'Fehler'}`); }
  }
  const namen = new Map<string, string>();
  const ids = subs.map((x) => x.metadata?.b2b_account_id).filter(Boolean) as string[];
  if (ids.length && adminConfigured()) {
    const { data } = await supabaseAdmin().from('lr_b2b_accounts').select('id, company_name').in('id', ids);
    for (const a of data ?? []) namen.set(a.id as string, String(a.company_name || ''));
  }
  for (const sub of subs) {
    abos.add(sub.id);
    const konto = sub.metadata?.b2b_account_id || '';
    if (konto) konten.add(konto);
    const item = sub.items.data[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
    const interval = item?.price?.recurring?.interval || 'month';
    const preis = sub.items.data.reduce((a, it) => { const c = Number(it.price?.unit_amount || 0) * Number(it.quantity || 1); return a + (it.price?.tax_behavior === 'exclusive' ? Math.round(c * (1 + VAT)) : c); }, 0);
    const cust = typeof sub.customer === 'object' && sub.customer && !('deleted' in sub.customer && sub.customer.deleted) ? (sub.customer as Stripe.Customer) : null;
    const kunde = konto ? namen.get(konto) || `Unternehmenskonto ${konto.slice(0, 8)}` : kurzMail(String(cust?.email || '').toLowerCase()) || 'Privatkunde (ohne E-Mail)';
    // Rechnungen dieses Abos (neueste zuerst) – für letzte Zahlung, offene Beträge und „ohne Rechnung“.
    let inv: Stripe.Invoice[] = [];
    try { inv = (await s.invoices.list({ subscription: sub.id, limit: 24 })).data; } catch { fehler.push(`Rechnungen zu Abo ${sub.id} nicht lesbar.`); }
    const paid = inv.filter((x) => x.status === 'paid' && x.amount_paid > 0)
      .map((x) => ({ datum: day(x.status_transitions?.paid_at ?? x.created)!, betrag: x.amount_paid }))
      .sort((a, b) => (a.datum < b.datum ? 1 : -1))[0] ?? null;
    const open = inv.filter((x) => x.status === 'open').sort((a, b) => a.created - b.created);
    const offen = open.reduce((a, x) => a + Number(x.amount_remaining || 0), 0);
    const aelteste = open[0] ? { nummer: open[0].number || open[0].id || '', faellig: day(open[0].due_date ?? open[0].next_payment_attempt ?? null) } : null;
    // Rabatt: Gutschein je Abo nachladen, falls Stripe nur die Kennung liefert.
    let coupon: Stripe.Coupon | null = null;
    for (const d of sub.discounts || []) {
      const c = typeof d === 'object' ? d.source?.coupon : null;
      const full = c && typeof c === 'object' ? c : c ? await s.coupons.retrieve(c).catch(() => null) : null;
      if (full?.percent_off === 100) { coupon = full; break; }
    }
    const li = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
    const gratis = Boolean(coupon) || Boolean(li && li.subtotal > 0 && li.total === 0);
    const beginn = day(sub.start_date);
    const ueberfaellig = sub.status === 'past_due' || open.some((x) => x.due_date && x.due_date * 1000 < Date.now());
    const naechste = sub.status === 'trialing' && sub.trial_end ? day(sub.trial_end) : day(item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end ?? null);
    const status: AbrStatus = sub.status === 'trialing' ? 'Testphase' : gratis ? '100-%-Rabatt' : ueberfaellig ? 'überfällig' : offen > 0 ? 'offen'
      : ohneRechnung(interval, inv.filter((x) => x.status !== 'draft' && x.status !== 'void').map((x) => day(x.created)!), beginn) ? 'ohne Rechnung' : 'bezahlt';
    const hinweis = status === 'Testphase' ? `Testphase bis ${day(sub.trial_end) || '–'}`
      : status === '100-%-Rabatt' ? `Rabatt 100 %${coupon ? ` (${coupon.name || coupon.id})` : ''} – Rechnungen über 0 €`
      : status === 'ohne Rechnung' ? (interval === 'month' ? 'Keine Rechnung in den letzten 35 Tagen' : `Keine Rechnung seit Vertragsbeginn (${beginn || '–'})`)
      : sub.livemode ? '' : 'Stripe-Testmodus';
    zeilen.push({
      quelle: 'stripe', bereich: konto ? 'b2b' : 'b2c', kunde, tarif: String(sub.metadata?.tier || sub.metadata?.plan || item?.price?.nickname || item?.price?.lookup_key || 'Abo'),
      intervall: INTERVALL[interval] || interval, preisBrutto: preis, letzteZahlung: paid, naechsteAbrechnung: naechste,
      offen, aeltesteOffene: aelteste, status, hinweis,
    });
  }
  return { zeilen, konten, abos };
}

// ---------- Unternehmenskonten mit Zahlung auf Rechnung (Rechnungsarchiv) ----------
async function rechnungsZeilen(stripeKonten: Set<string>, stripeAbos: Set<string>): Promise<AbrZeile[]> {
  if (!adminConfigured()) return [];
  const db = supabaseAdmin();
  const { data: accs } = await db.from('lr_b2b_accounts').select('id, company_name, status, plan_tier, plan_until, plan_source, billing_interval, created_at, branche, extra_branches, institution_type, stripe_subscription_id').limit(5000);
  // Konten mit laufendem Stripe-Abo stehen schon oben; hier nur die übrigen aktiven Konten.
  const aktiv = (accs ?? []).filter((a) => effectiveTier(a as B2BAccount) && !stripeKonten.has(a.id as string) && !(a.stripe_subscription_id && stripeAbos.has(a.stripe_subscription_id as string)));
  if (!aktiv.length) return [];
  const [cat, { data: inv }] = await Promise.all([
    getCatalog(),
    db.from('lr_invoices').select('account_id, invoice_number, gross_cents, payment_status, issue_date, due_date, paid_at').eq('kind', 'invoice').in('account_id', aktiv.map((a) => a.id)).order('issue_date', { ascending: false }).limit(5000),
  ]);
  const heute = new Date().toISOString().slice(0, 10);
  return aktiv.map((a) => {
    const interval = a.billing_interval === 'year' ? 'year' : 'month';
    const br = accountBranches(a as { branche?: string; extra_branches?: string[]; institution_type?: string });
    const plan = cat.branchen[br[0]]?.plans.find((p) => p.tier === a.plan_tier);
    const netto = (plan ? (interval === 'year' ? plan.yearCents : plan.monthCents) : 0) + (br.length - 1) * (interval === 'year' ? cat.addon.yearCents : cat.addon.monthCents);
    const rows = (inv ?? []).filter((x) => x.account_id === a.id && String(x.payment_status).toUpperCase() !== 'CANCELLED');
    const paid = rows.filter((x) => String(x.payment_status).toUpperCase() === 'PAID')
      .map((x) => ({ datum: String(x.paid_at || x.issue_date).slice(0, 10), betrag: Number(x.gross_cents || 0) }))
      .sort((x, y) => (x.datum < y.datum ? 1 : -1))[0] ?? null;
    const open = rows.filter((x) => ['PENDING', 'OVERDUE'].includes(String(x.payment_status).toUpperCase())).sort((x, y) => String(x.due_date || x.issue_date).localeCompare(String(y.due_date || y.issue_date)));
    const offen = open.reduce((s, x) => s + Number(x.gross_cents || 0), 0);
    const beginn = a.created_at ? String(a.created_at).slice(0, 10) : null;
    const letzte = rows[0]?.issue_date ? String(rows[0].issue_date).slice(0, 10) : null;
    const ueberfaellig = open.some((x) => String(x.payment_status).toUpperCase() === 'OVERDUE' || (x.due_date && String(x.due_date) < heute));
    const status: AbrStatus = ueberfaellig ? 'überfällig' : offen > 0 ? 'offen' : ohneRechnung(interval, rows.map((x) => String(x.issue_date).slice(0, 10)), beginn) ? 'ohne Rechnung' : 'bezahlt';
    return {
      quelle: 'rechnung', bereich: 'b2b', kunde: String(a.company_name || `Unternehmenskonto ${String(a.id).slice(0, 8)}`), tarif: String(a.plan_tier || '–'),
      intervall: INTERVALL[interval], preisBrutto: Math.round(netto * (1 + VAT)), letzteZahlung: paid,
      naechsteAbrechnung: letzte ? plus(letzte, interval) : null, offen, aeltesteOffene: open[0] ? { nummer: String(open[0].invoice_number || ''), faellig: open[0].due_date ? String(open[0].due_date) : null } : null,
      status,
      hinweis: status === 'ohne Rechnung' ? (interval === 'month' ? 'Keine Rechnung in den letzten 35 Tagen' : `Keine Rechnung seit Vertragsbeginn (${beginn || '–'})`) : a.plan_source === 'manual' ? 'Tarif von Hand freigeschaltet' : '',
    } satisfies AbrZeile;
  });
}

// Gesamtstand; „bereich“ grenzt auf Privat- oder Unternehmenskunden ein (Finanz-Cockpit trennt die Bereiche strikt).
export async function abrechnungsstand(bereich?: 'b2c' | 'b2b'): Promise<Abrechnung> {
  const fehler: string[] = [];
  const st = await stripeZeilen(fehler);
  const re = bereich === 'b2c' ? [] : await rechnungsZeilen(st.konten, st.abos).catch((e) => { fehler.push(`Rechnungsarchiv nicht lesbar: ${e instanceof Error ? e.message : 'Fehler'}`); return [] as AbrZeile[]; });
  const order: Record<AbrStatus, number> = { 'überfällig': 0, 'ohne Rechnung': 1, offen: 2, '100-%-Rabatt': 3, Testphase: 4, bezahlt: 5 };
  const zeilen = [...st.zeilen, ...re].filter((z) => !bereich || z.bereich === bereich).sort((a, b) => order[a.status] - order[b.status]);
  return { stand: new Date().toISOString(), zeilen, fehler };
}
