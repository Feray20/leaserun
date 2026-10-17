import { NextResponse } from 'next/server';
import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { checkLeadToken } from '@/lib/b2b/leadtoken';
import { partnerBrandFor } from '@/lib/b2b/brand';
import { effectiveTier, type B2BAccount } from '@/lib/b2b/core';
import { ReportDocument, type ReportInput } from '@/lib/pdf/report';
import { analyse, kaufnebenkosten } from '@/public/src/calc.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const eur = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' €' : '–');
const pct = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' %' : '–');

// Finanzierungsübersicht als PDF für den Interessenten nach seiner Anfrage (Schlüssel aus der Anfrage, 2 Stunden gültig).
export async function GET(req: Request) {
  if (!adminConfigured()) return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 503 });
  if (!allowRequest(`leadpdf:${anonymizedIpHash(req) ?? 'x'}`, 10, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  const u = new URL(req.url);
  const id = u.searchParams.get('id') ?? '';
  const t = u.searchParams.get('t') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(id) || !checkLeadToken(id, t)) return NextResponse.json({ error: 'Link abgelaufen. Bitte die Berechnung erneut durchführen.' }, { status: 403 });
  const db = supabaseAdmin();
  const { data: lead } = await db.from('immo_b2b_leads').select('id, account_id, client_name, property_data, created_at').eq('id', id).maybeSingle();
  if (!lead) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 });
  const { data: acc } = await db.from('immo_b2b_accounts').select('*').eq('id', lead.account_id).maybeSingle();
  const a = acc as B2BAccount | null;
  if (!a || a.status !== 'active') return NextResponse.json({ error: 'Nicht verfügbar.' }, { status: 404 });

  const p = (lead.property_data ?? {}) as Record<string, number | string | undefined>;
  const num = (k: string, d = 0) => (typeof p[k] === 'number' ? (p[k] as number) : d);
  const price = num('price'), land = typeof p.land === 'string' ? p.land : 'hessen';
  if (!(price > 0)) return NextResponse.json({ error: 'Ohne Kaufpreis gibt es keine Übersicht.' }, { status: 400 });
  const input = { price, rent: num('rent'), area: num('area'), land, equity: num('equity'), ratePct: num('ratePct', 3.8), repaymentPct: num('repaymentPct', 2), brokerPct: num('brokerPct'), maintenanceQm: 1, vacancyPct: 2 };
  const r = analyse(input);
  const nk = kaufnebenkosten({ price, land, brokerPct: input.brokerPct });
  if (!r || !nk) return NextResponse.json({ error: 'Berechnung nicht möglich.' }, { status: 400 });

  const rep: ReportInput = {
    title: `Finanzierungsübersicht${p.address ? ` – ${String(p.address).slice(0, 80)}` : p.ref ? ` – ${String(p.ref).slice(0, 80)}` : ''}`,
    subtitle: `Für ${lead.client_name} · erstellt über die Seite von ${a.company_name}`,
    chips: [['Gesamtkosten', eur(r.allIn)], ['Darlehen', eur(r.loan)], ['Monatsrate', eur(r.rate)], ['Eigenkapital', eur(input.equity)]],
    sections: [
      { title: 'Kaufnebenkosten', rows: [...nk.parts.map((x: { label: string; pct: number; amount: number }) => [`${x.label} (${pct(x.pct)})`, eur(x.amount)] as [string, string]), ['Summe Nebenkosten', eur(nk.total)]] },
      { title: 'Finanzierung', rows: [['Kaufpreis', eur(price)], ['Eigenkapital', eur(input.equity)], ['Darlehen', eur(r.loan)], ['Beleihungsauslauf (Darlehen/Kaufpreis)', pct(r.ltv)], ['Sollzins / Tilgung p. a.', `${pct(input.ratePct)} / ${pct(input.repaymentPct)}`], ['Monatsrate', eur(r.rate)], ['Restschuld nach 10 Jahren', eur(r.restAfterFixed)], ['Rate bei +2 Prozentpunkten Zins', eur(r.rateStress)]] },
      ...(input.rent > 0 ? [{ title: 'Vermietung (rechnerisch)', rows: [['Kaltmiete / Monat', eur(input.rent)], ['Bruttomietrendite', pct(r.grossYield)], ['Nettomietrendite', pct(r.netYield)], ['Cashflow vor Steuern / Monat', eur(r.cashflow)], ['Kapitaldienstdeckung (DSCR)', r.dscr == null ? '–' : String(r.dscr).replace('.', ',')], ['Miete für DSCR 1,2', eur(r.rentDscr12)]] as [string, string][] }] : []),
    ],
    hints: [
      ...(input.equity < nk.total ? ['Das Eigenkapital deckt die Kaufnebenkosten nicht. Banken finanzieren Nebenkosten nur selten mit.'] : []),
      'Annahmen: Notar 1,5 %, Grundbuch 0,5 %, Instandhaltung 1 €/m² im Monat, Mietausfall 2 %.',
      `Ihr Ansprechpartner: ${a.company_name}${a.phone ? `, Tel. ${a.phone}` : ''}, ${a.email}.`,
    ],
    note: `${(a.has_whitelabel || effectiveTier(a) === 'ENTERPRISE') && a.custom_disclaimer ? a.custom_disclaimer + ' ' : ''}Rechnerische Orientierung auf Basis Ihrer Eingaben. Keine Kreditzusage, keine Konditionszusicherung und keine Bonitätsentscheidung. Ersetzt keine Steuer- oder Rechtsberatung.`,
  };
  const partner = await partnerBrandFor(a);
  const el = createElement(ReportDocument, { r: rep, reportId: id.slice(0, 8), createdAt: new Date().toISOString(), partner, reportType: 'Finanzierungsübersicht' }) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(el);
  return new NextResponse(new Uint8Array(pdf), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Finanzierungsuebersicht.pdf"', 'Cache-Control': 'no-store' },
  });
}
