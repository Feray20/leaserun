import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { effectiveTier, type B2BAccount } from '@/lib/b2b/core';
import { accountBranches, getCatalog } from '@/lib/b2b/catalog';
import { customerScope, scopeError } from '@/lib/admin/scope';
import { b2cFinance } from '@/lib/admin/b2c-finance';
import { abrechnungsstand, type Abrechnung } from '@/lib/admin/abrechnung';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Berlin-Kalendertag als YYYY-MM-DD.
const berlinDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function range(preset: string, from?: string | null, to?: string | null): { from: string; to: string; label: string } {
  const today = berlinDay(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  switch (preset) {
    case 'heute': return { from: today, to: today, label: 'Heute' };
    case 'woche': {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const dow = (dt.getUTCDay() + 6) % 7; // Montag = 0
      return { from: iso(new Date(Date.UTC(y, m - 1, d - dow))), to: today, label: 'Diese Woche' };
    }
    case 'jahr': return { from: `${y}-01-01`, to: today, label: 'Dieses Jahr' };
    case 'gesamt': return { from: '2000-01-01', to: today, label: 'Gesamt' };
    case 'frei':
      if (from && to && DAY.test(from) && DAY.test(to) && from <= to) return { from, to, label: `${from} bis ${to}` };
      return { from: today, to: today, label: 'Heute' };
    default: return { from: `${today.slice(0, 7)}-01`, to: today, label: 'Dieser Monat' };
  }
}

// Finanz-Cockpit: Umsätze aus dem Rechnungsarchiv (netto, USt, brutto), wiederkehrender Umsatz aus aktiven Tarifen,
// offene Posten mit Fälligkeit, Viral-Kennzahlen der Prüfseite. Alle Werte aus eigenen Daten, nichts geschätzt.
export async function GET(req: Request) {
  const auth = await requireAdmin(req, 'finance');
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const u = new URL(req.url);
  const r = range(u.searchParams.get('zeitraum') || 'monat', u.searchParams.get('von'), u.searchParams.get('bis'));
  // Strikte Bereichstrennung: B2C rechnet ausschließlich aus Stripe-Käufen der Privattarife, B2B ausschließlich aus Unternehmensrechnungen.
  const scope = customerScope(req);
  if (!scope) return j(scopeError, 400);
  // Abrechnungsstand je aktivem Abo/Unternehmenskonto (unabhängig vom Zeitraum, nur lesend); Fehler blockieren das Cockpit nicht.
  const billing: Promise<Abrechnung> = abrechnungsstand(scope).catch((e) => ({ stand: new Date().toISOString(), zeilen: [], fehler: [e instanceof Error ? e.message : 'Abrechnungsstand nicht verfügbar.'] }));
  if (scope === 'b2c') {
    try { return j({ scope, range: r, ...(await b2cFinance(r.from, r.to, berlinDay(new Date()))), billing: await billing }); }
    catch (e) { return j({ error: e instanceof Error ? e.message : 'Stripe nicht erreichbar.' }, 502); }
  }
  const db = supabaseAdmin();

  const { data: inv } = await db
    .from('lr_invoices')
    .select('id, invoice_number, kind, net_cents, vat_cents, gross_cents, payment_status, issue_date, due_date, paid_at, buyer, account_id, source')
    .not('account_id', 'is', null)
    .gte('issue_date', r.from).lte('issue_date', r.to)
    .order('issue_date', { ascending: false })
    .limit(5000);
  const rows = inv ?? [];
  const sum = (k: 'net_cents' | 'vat_cents' | 'gross_cents') => rows.reduce((s, x) => s + Number(x[k] || 0), 0);
  const revenue = { net: sum('net_cents'), vat: sum('vat_cents'), gross: sum('gross_cents'), count: rows.filter((x) => x.kind === 'invoice').length, stornos: rows.filter((x) => x.kind !== 'invoice').length };

  // Offene Posten (unabhängig vom Zeitraum) mit Mahn-Ampel.
  const today = berlinDay(new Date());
  const { data: open } = await db
    .from('lr_invoices')
    .select('id, invoice_number, gross_cents, due_date, issue_date, buyer, payment_status')
    .in('payment_status', ['PENDING', 'OVERDUE'])
    .eq('kind', 'invoice')
    .not('account_id', 'is', null)
    .order('due_date', { ascending: true })
    .limit(500);
  const openItems = (open ?? []).map((x) => {
    const days = x.due_date ? Math.round((Date.parse(today) - Date.parse(x.due_date)) / 864e5) : 0;
    return { ...x, daysOverdue: days, ampel: days > 14 ? 'rot' : days > 0 ? 'gelb' : 'gruen' };
  });

  // Wiederkehrender Umsatz aus aktiven Tarifen (Netto-Listenpreise; manuelle Tarife ohne Preis ausgewiesen).
  const { data: accs } = await db.from('lr_b2b_accounts').select('status, plan_tier, plan_until, plan_source, billing_interval, created_at, branche, extra_branches, institution_type').limit(5000);
  const active = (accs ?? []).filter((a) => effectiveTier(a as B2BAccount));
  const cat = await getCatalog();
  const priceOf = (a: Record<string, unknown>) => {
    const br = accountBranches(a as { branche?: string; extra_branches?: string[]; institution_type?: string });
    const plan = cat.branchen[br[0]].plans.find((p) => p.tier === a.plan_tier);
    const yr = a.billing_interval === 'year';
    return (plan ? (yr ? plan.yearCents : plan.monthCents) : 0) + (br.length - 1) * (yr ? cat.addon.yearCents : cat.addon.monthCents);
  };
  let mrr = 0;
  const byTier: Record<string, number> = { BASIC: 0, PRO: 0, ENTERPRISE: 0 };
  let manual = 0;
  for (const a of active) {
    byTier[a.plan_tier as string] = (byTier[a.plan_tier as string] ?? 0) + 1;
    if (a.plan_source !== 'stripe') { manual++; continue; }
    const c = priceOf(a as Record<string, unknown>);
    mrr += a.billing_interval === 'year' ? Math.round(c / 12) : c;
  }
  // Abwanderung im Zeitraum: Admin-Protokoll und Stripe-Kündigungen sind nicht vollständig erfasst; hier nur Konten mit abgelaufenem Tarif.
  const expired = (accs ?? []).filter((a) => a.plan_until && a.plan_until.slice(0, 10) >= r.from && a.plan_until.slice(0, 10) <= r.to && a.plan_until < new Date().toISOString()).length;

  // Tagesgrenzen in deutscher Zeit (MEZ/MESZ) korrekt in UTC umrechnen.
  const berlinOffset = (day: string) => {
    const d = new Date(`${day}T12:00:00Z`);
    const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(d));
    return `+0${h - 12}:00`;
  };
  const fromTs = `${r.from}T00:00:00${berlinOffset(r.from)}`, toTs = `${r.to}T23:59:59.999${berlinOffset(r.to)}`;
  const cnt = async (t: string, f: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const { count } = await f(db.from(t).select('*', { count: 'exact', head: true }));
    return count ?? 0;
  };
  const [verifyViews, partnerDossiers, newAccounts, viaVerify, leads] = await Promise.all([
    cnt('lr_verify_views', (q) => q.gte('created_at', fromTs).lte('created_at', toTs)),
    cnt('lr_kreditmappe_versions', (q) => q.not('b2b_account_id', 'is', null).gte('created_at', fromTs).lte('created_at', toTs)),
    cnt('lr_b2b_accounts', (q) => q.gte('created_at', fromTs).lte('created_at', toTs)),
    cnt('lr_b2b_accounts', (q) => q.eq('referral', 'verify').gte('created_at', fromTs).lte('created_at', toTs)),
    cnt('lr_b2b_leads', (q) => q.gte('created_at', fromTs).lte('created_at', toTs)),
  ]);

  // Netto-Umsatz der letzten 12 Kalendermonate (unabhängig vom gewählten Zeitraum).
  const m0 = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 12, 1)).toISOString().slice(0, 10);
  const { data: last12 } = await db.from('lr_invoices').select('issue_date, net_cents').not('account_id', 'is', null).gte('issue_date', m0).limit(20000);
  const months: { m: string; net: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    months.push({ m: key, net: (last12 ?? []).filter((x) => String(x.issue_date).startsWith(key)).reduce((a, x) => a + Number(x.net_cents || 0), 0) });
  }

  return j({
    scope,
    months,
    range: r, revenue, invoices: rows.slice(0, 200), openItems,
    recurring: { mrrNet: mrr, arrNet: mrr * 12, activeAccounts: active.length, byTier, manualWithoutPrice: manual, expiredInRange: expired },
    viral: { verifyViews, partnerDossiers, newAccounts, viaVerify, leads },
    billing: await billing,
  });
}
