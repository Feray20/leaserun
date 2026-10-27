// Creator-Abrechnung (reine Funktionen): Provisionsregeln, Provision je Conversion, Steuerbehandlung,
// Abrechnungssummen, Sperrgründe, Abrechnungszeitraum (Europe/Berlin), Rechnungsnummern.
// Alle Beträge in Cent (ganze Zahlen). Die Berechnung läuft ausschließlich auf dem Server.

// ---------------- Zeitraum ----------------
export const PERIOD_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])$/;

// Versatz von Europe/Berlin zu UTC (Minuten) für einen Zeitpunkt.
export function berlinOffsetMinutes(at: Date): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Berlin', timeZoneName: 'shortOffset' }).formatToParts(at);
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(p.find((x) => x.type === 'timeZoneName')?.value || '');
  if (!m) return 60;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0));
}

// Monatsbeginn 00:00 Uhr Berliner Zeit als UTC-Zeitpunkt.
function berlinMidnight(y: number, m0: number): Date {
  const guess = new Date(Date.UTC(y, m0, 1, 0, 0, 0));
  const off = berlinOffsetMinutes(new Date(guess.getTime() - 3 * 3600_000));
  return new Date(guess.getTime() - off * 60_000);
}

export function periodBounds(period: string): { from: Date; to: Date } {
  if (!PERIOD_RE.test(period)) throw new Error('period_invalid');
  const [y, m] = period.split('-').map(Number);
  return { from: berlinMidnight(y, m - 1), to: berlinMidnight(m === 12 ? y + 1 : y, m === 12 ? 0 : m) };
}

export function periodOf(at: Date): string {
  const local = new Date(at.getTime() + berlinOffsetMinutes(at) * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// Ein Monat darf erst abgeschlossen werden, wenn die Widerrufsfrist (14 Tage) aller Käufe des Monats abgelaufen ist.
export function closeAllowedAt(period: string, delayDays = 15): Date {
  return new Date(periodBounds(period).to.getTime() + delayDays * 86_400_000);
}

export const periodLabel = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
};

// ---------------- Provisionsregeln ----------------
export type RuleKind = 'PERCENT' | 'FIXED' | 'HYBRID' | 'TIERED';
export type Tier = { min_conversions: number; percent_bps: number };
export type Rule = {
  id: string; version: number; creator_id: string | null; campaign_slug: string | null; kind: RuleKind;
  percent_bps: number; fixed_cents: number; tiers: Tier[]; valid_from: string; valid_to: string | null;
};
export type ConversionIn = { id: string; creator_id: string; campaign_slug: string | null; amount_net_cents: number; occurred_at: string };

function ruleValidAt(r: Rule, at: Date): boolean {
  return new Date(r.valid_from).getTime() <= at.getTime() && (!r.valid_to || new Date(r.valid_to).getTime() > at.getTime());
}

// Spezifischste gültige Regel: Creator + Kampagne > Creator > Kampagne > Standard; bei Gleichstand die jüngste.
export function pickRule(rules: Rule[], c: ConversionIn): Rule | null {
  const at = new Date(c.occurred_at);
  let best: { r: Rule; score: number } | null = null;
  for (const r of rules) {
    if (!ruleValidAt(r, at)) continue;
    if (r.creator_id && r.creator_id !== c.creator_id) continue;
    if (r.campaign_slug && r.campaign_slug !== c.campaign_slug) continue;
    const score = (r.creator_id ? 2 : 0) + (r.campaign_slug ? 1 : 0);
    if (!best || score > best.score || (score === best.score && r.valid_from > best.r.valid_from)) best = { r, score };
  }
  return best?.r ?? null;
}

const pct = (base: number, bps: number) => Math.round((Math.max(0, base) * Math.max(0, bps)) / 10_000);

// Provision einer Conversion. position = laufende Nummer der Conversion des Creators im Monat (1, 2, 3 …) für Staffeln.
export function commissionFor(rule: Rule, c: ConversionIn, position: number): number {
  switch (rule.kind) {
    case 'PERCENT': return pct(c.amount_net_cents, rule.percent_bps);
    case 'FIXED': return Math.max(0, rule.fixed_cents);
    case 'HYBRID': return pct(c.amount_net_cents, rule.percent_bps) + Math.max(0, rule.fixed_cents);
    case 'TIERED': {
      const tier = [...rule.tiers].sort((a, b) => a.min_conversions - b.min_conversions).filter((t) => position >= t.min_conversions).pop();
      return pct(c.amount_net_cents, tier ? tier.percent_bps : rule.percent_bps) + Math.max(0, rule.fixed_cents);
    }
    default: return 0;
  }
}

export type CommissionLine = { conversion_id: string; creator_id: string; rule_id: string | null; rule_version: number | null; base_cents: number; commission_cents: number };

// Provisionen eines Monats: Reihenfolge nach Zeitpunkt (für Staffeln), ohne Regel → 0 € (sichtbar, damit es auffällt).
export function commissionLines(rules: Rule[], conversions: ConversionIn[]): CommissionLine[] {
  const pos = new Map<string, number>();
  return [...conversions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).map((c) => {
    const n = (pos.get(c.creator_id) ?? 0) + 1;
    pos.set(c.creator_id, n);
    const r = pickRule(rules, c);
    return { conversion_id: c.id, creator_id: c.creator_id, rule_id: r?.id ?? null, rule_version: r?.version ?? null, base_cents: c.amount_net_cents, commission_cents: r ? commissionFor(r, c, n) : 0 };
  });
}

// ---------------- Steuer ----------------
export const EU = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK']);
export type TaxMode = 'SMALL_BUSINESS' | 'VAT_19' | 'REVERSE_CHARGE' | 'NOT_TAXABLE_DE' | 'REVIEW_REQUIRED';
export type TaxTreatment = { mode: TaxMode; rate_bps: number; note: string };
export type BusinessIn = { country: string; vat_status: 'small_business' | 'vat_registered' | 'not_applicable'; vat_id: string | null; tax_number: string | null };

// Steuerbehandlung nach den hinterlegten Angaben des Creators (Leistungsempfänger ist LeaseRun, Deutschland).
// Hinweis: Orientierung, keine Steuerberatung – Fälle, die nicht eindeutig sind, werden zur Prüfung gesperrt.
export function taxTreatment(b: BusinessIn): TaxTreatment {
  if (b.country === 'DE') {
    if (b.vat_status === 'small_business') return { mode: 'SMALL_BUSINESS', rate_bps: 0, note: 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.' };
    if (b.vat_status === 'vat_registered' && (b.vat_id || b.tax_number)) return { mode: 'VAT_19', rate_bps: 1900, note: 'Umsatzsteuer 19 %.' };
    return { mode: 'REVIEW_REQUIRED', rate_bps: 0, note: 'Steuerliche Angaben unvollständig – bitte prüfen.' };
  }
  if (EU.has(b.country)) {
    if (b.vat_id && b.vat_id.startsWith(b.country === 'GR' ? 'EL' : b.country)) return { mode: 'REVERSE_CHARGE', rate_bps: 0, note: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge, § 13b UStG / Art. 196 MwStSystRL).' };
    return { mode: 'REVIEW_REQUIRED', rate_bps: 0, note: 'EU-Ausland ohne passende USt-IdNr. – bitte prüfen.' };
  }
  return { mode: 'NOT_TAXABLE_DE', rate_bps: 0, note: 'Leistung im Inland nicht steuerbar (Leistungsort beim Empfänger).' };
}

// ---------------- Abrechnung ----------------
export type AdjustmentIn = { amount_cents: number; kind: 'BONUS' | 'CORRECTION' | 'CLAWBACK' | 'CARRY_OVER'; reason: string };
export type Totals = { commission_cents: number; adjustments_cents: number; net_cents: number; vat_cents: number; gross_cents: number; payout_cents: number };

export function statementTotals(commissions: number[], adjustments: AdjustmentIn[], tax: TaxTreatment): Totals {
  const commission = commissions.reduce((a, b) => a + b, 0);
  const adj = adjustments.reduce((a, b) => a + b.amount_cents, 0);
  const net = commission + adj;
  const vat = net > 0 ? Math.round((net * tax.rate_bps) / 10_000) : 0;
  const gross = net + vat;
  return { commission_cents: commission, adjustments_cents: adj, net_cents: net, vat_cents: vat, gross_cents: gross, payout_cents: Math.max(0, gross) };
}

export type BillingMode = 'INVOICE' | 'CREDIT_NOTE';
export type Blocker = 'payout_missing' | 'payout_review' | 'agreement_missing' | 'creator_inactive' | 'tax_review' | 'invoice_missing' | 'nothing_to_pay';

export const BLOCKER_TEXT: Record<Blocker, string> = {
  payout_missing: 'Zahlungsdaten fehlen',
  payout_review: 'Geänderte Zahlungsdaten noch nicht geprüft',
  agreement_missing: 'Aktuelle Vereinbarung nicht bestätigt',
  creator_inactive: 'Creator nicht aktiv',
  tax_review: 'Steuerliche Angaben prüfen',
  invoice_missing: 'Rechnung des Creators fehlt',
  nothing_to_pay: 'Kein auszuzahlender Betrag',
};

export function blockers(s: { creatorActive: boolean; payoutStatus: string | null; agreementAccepted: boolean; tax: TaxTreatment; mode: BillingMode; hasInvoice: boolean; payoutCents: number }): Blocker[] {
  const out: Blocker[] = [];
  if (!s.creatorActive) out.push('creator_inactive');
  if (!s.payoutStatus) out.push('payout_missing');
  else if (s.payoutStatus === 'VERIFICATION_REQUIRED') out.push('payout_review');
  if (!s.agreementAccepted) out.push('agreement_missing');
  if (s.tax.mode === 'REVIEW_REQUIRED') out.push('tax_review');
  if (s.payoutCents <= 0) out.push('nothing_to_pay');
  else if (s.mode === 'INVOICE' && !s.hasInvoice) out.push('invoice_missing');
  return out;
}

// Status, der dem Creator angezeigt wird.
export type StatementStatus = 'READY' | 'INVOICED' | 'APPROVED' | 'PAID' | 'BLOCKED' | 'ZERO';
export function statementStatusAfterClose(mode: BillingMode, payoutCents: number): StatementStatus {
  void mode; // beide Verfahren starten als READY: Rechnung (Creator) bzw. Gutschrift (bei Freigabe)
  return payoutCents <= 0 ? 'ZERO' : 'READY';
}

// ---------------- Nummern ----------------
// Rechnungsnummer des Creators (seine eigene, fortlaufende Reihe): Vorschlag CR-JJJJ-NNN, frei änderbar.
export const INVOICE_NO_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,39}$/;
export function suggestInvoiceNumber(year: number, existing: string[]): string {
  const re = new RegExp(`^CR-${year}-(\\d{3,})$`);
  const max = existing.reduce((m, n) => { const x = re.exec(n); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `CR-${year}-${String(max + 1).padStart(3, '0')}`;
}
export const creditNoteNumber = (year: number, n: number) => `GS-${year}-${String(n).padStart(5, '0')}`;

export const eurText = (c: number) => (c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// ---------------- Erstattungen (Phase 4) ----------------
// Netto-Anteil einer (Teil-)Erstattung: Stripe meldet brutto (amount, amount_refunded); verrechnet wird anteilig netto.
export function refundedNetTotal(amountNetCents: number, chargeAmount: number, refundedAmount: number): number {
  if (chargeAmount <= 0 || refundedAmount <= 0) return 0;
  if (refundedAmount >= chargeAmount) return amountNetCents;
  return Math.round((amountNetCents * refundedAmount) / chargeAmount);
}

// Grundlage einer noch nicht abgerechneten Conversion nach Teilerstattungen.
export const reducedBase = (amountNetCents: number, refundedNetCents: number) => Math.max(0, amountNetCents - Math.max(0, refundedNetCents));

// Anteilige Rückforderung nach dem Abschluss: Anteil der Erstattung an der abgerechneten Grundlage,
// höchstens die noch nicht zurückgeforderte Provision.
export function partialClawback(commissionCents: number, baseCents: number, refundNetCents: number, alreadyClawedCents: number): number {
  if (commissionCents <= 0 || baseCents <= 0 || refundNetCents <= 0) return 0;
  const share = Math.round((commissionCents * Math.min(refundNetCents, baseCents)) / baseCents);
  return Math.max(0, Math.min(share, commissionCents - Math.max(0, alreadyClawedCents)));
}

// Regel als verständlicher Satz für das Creator-Portal (z. B. „20 % vom Netto-Umsatz je Kauf“).
export function describeRule(r: Pick<Rule, 'kind' | 'percent_bps' | 'fixed_cents' | 'tiers'>): string {
  const pct = (bps: number) => `${(bps / 100).toLocaleString('de-DE', { maximumFractionDigits: 2 })} %`;
  const eur = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  if (r.kind === 'PERCENT') return `${pct(r.percent_bps)} vom Netto-Umsatz je Kauf`;
  if (r.kind === 'FIXED') return `${eur(r.fixed_cents)} je Kauf`;
  if (r.kind === 'HYBRID') return `${eur(r.fixed_cents)} plus ${pct(r.percent_bps)} vom Netto-Umsatz je Kauf`;
  const tiers = [...(r.tiers || [])].sort((a, b) => a.min_conversions - b.min_conversions);
  return `${pct(r.percent_bps)} vom Netto-Umsatz je Kauf${tiers.map((t) => `, ab ${t.min_conversions} Käufen im Monat ${pct(t.percent_bps)}`).join('')}`;
}
