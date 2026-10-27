import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { checkLeadToken } from '@/lib/b2b/leadtoken';
import { partnerBrandFor } from '@/lib/b2b/brand';
import { effectiveTier, type B2BAccount } from '@/lib/b2b/core';
import { ReportDocument, type ReportInput } from '@/lib/pdf/report';
import { analyse, kaufnebenkosten, GREST } from '@/public/src/calc.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eur = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%' : '–');

// Financing overview as PDF for the prospect after their inquiry (token from the inquiry, valid for 2 hours).
export async function GET(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Not available.' }, { status: 503 });
  if (!allowRequest(`leadpdf:${anonymizedIpHash(req) ?? 'x'}`, 10, 60_000)) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 });
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';
  const t = u.searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id) || !checkLeadToken(id, t)) return NextResponse.json({ error: 'This link has expired. Please run the calculation again.' }, { status: 403 });
  const db = supabaseAdmin();
  const { data: lead } = await db.from('lr_b2b_leads').select('id, account_id, client_name, property_data, created_at').eq('id', id).maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const { data: acc } = await db.from('lr_b2b_accounts').select('*').eq('id', lead.account_id).maybeSingle();
  const a = acc as B2BAccount | null;
  if (!a || a.status !== 'active') return NextResponse.json({ error: 'Not available.' }, { status: 404 });

  const p = (lead.property_data ?? {}) as Record<string, number | string | undefined>;
  const num = (k: string, d = 0) => (typeof p[k] === 'number' ? (p[k] as number) : d);
  const states = Object.keys(GREST as Record<string, unknown>);
  const price = num('price'), land = typeof p.land === 'string' && states.includes(p.land) ? p.land : states[0];
  if (!(price > 0)) return NextResponse.json({ error: 'An overview needs a purchase price.' }, { status: 400 });
  const input = { price, rent: num('rent'), area: num('area'), land, equity: num('equity'), ratePct: num('ratePct', 6.5), repaymentPct: num('repaymentPct', 2), brokerPct: num('brokerPct'), maintenanceQm: 1, vacancyPct: 2 };
  const r = analyse(input);
  const nk = kaufnebenkosten({ price, land, brokerPct: input.brokerPct });
  if (!r || !nk) return NextResponse.json({ error: 'The calculation is not possible.' }, { status: 400 });

  const rep: ReportInput = {
    title: `Financing Overview${p.address ? ` – ${String(p.address).slice(0, 80)}` : p.ref ? ` – ${String(p.ref).slice(0, 80)}` : ''}`,
    subtitle: `For ${lead.client_name} · created on the page of ${a.company_name}`,
    chips: [['Total cost', eur(r.allIn)], ['Loan amount', eur(r.loan)], ['Monthly payment (P&I)', eur(r.rate)], ['Down payment', eur(input.equity)]],
    sections: [
      { title: 'Closing costs', rows: [...nk.parts.map((x: { label: string; pct: number; amount: number }) => [x.label.endsWith(')') ? `${x.label.slice(0, -1)}, ${pct(x.pct)})` : `${x.label} (${pct(x.pct)})`, eur(x.amount)] as [string, string]), ['Total closing costs', eur(nk.total)]] },
      { title: 'Financing', rows: [['Purchase price', eur(price)], ['Down payment', eur(input.equity)], ['Loan amount', eur(r.loan)], ['Loan-to-value (LTV)', pct(r.ltv)], ['Interest rate / principal paydown p.a.', `${pct(input.ratePct)} / ${pct(input.repaymentPct)}`], ['Monthly payment (P&I)', eur(r.rate)], ['Balance after 10 years', eur(r.restAfterFixed)], ['Payment at +2 percentage points', eur(r.rateStress)]] },
      ...(input.rent > 0 ? [{ title: 'Rental (calculated)', rows: [['Rent / month', eur(input.rent)], ['Gross yield', pct(r.grossYield)], ['Cap rate', pct(r.netYield)], ['Cash flow before tax / month', eur(r.cashflow)], ['Debt service coverage (DSCR)', r.dscr == null ? '–' : r.dscr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })], ['Rent needed for DSCR 1.2', eur(r.rentDscr12)]] as [string, string][] }] : []),
    ],
    hints: [
      ...(input.equity < nk.total ? ['Your cash does not cover the closing costs. Lenders rarely finance closing costs; ask about seller credits or lender credits.'] : []),
      'Assumptions: typical closing costs for the selected state (estimates), repairs reserve and 2% vacancy allowance.',
      `Your contact: ${a.company_name}${a.phone ? `, phone ${a.phone}` : ''}, ${a.email}.`,
    ],
    note: `${(a.has_whitelabel || effectiveTier(a) === 'ENTERPRISE') && a.custom_disclaimer ? a.custom_disclaimer + ' ' : ''}Estimates based on your inputs for planning only. Not a loan offer, rate quote, commitment to lend or credit decision. Not tax or legal advice.`,
  };
  const partner = await partnerBrandFor(a);
  const el = createElement(ReportDocument, { r: rep, reportId: id.slice(0, 8), createdAt: new Date().toISOString(), partner, reportType: 'Financing Overview' }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(el);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Financing_Overview.pdf"', 'Cache-Control': 'no-store' },
  });
}
