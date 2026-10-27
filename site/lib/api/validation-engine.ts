// Vorprüfung eines Finanzierungsfalls (rein rechnerisch, ohne Datenbank – testbar).
// Ergebnis: maschinenlesbare Prüfpunkte, Vollständigkeit und Bank-Readiness. Keine Kreditentscheidung:
// Schwellenwerte sind LeaseRun-Orientierungswerte; die Entscheidung trifft allein das finanzierende Institut.
import { kaufnebenkosten, monthlyRate } from '@/public/src/calc.mjs';
import type { CaseData, DocumentType } from '@/lib/api/schemas';

export type Severity = 'info' | 'warning' | 'error';
export type Check = {
  code: string; category: string; severity: Severity; passed: boolean; message: string;
  field: string | null; requires_action: boolean; value: number | string | null; threshold: number | string | null;
};
export type DocInfo = { id: string; type: DocumentType | string; sha256: string; status: string; verification_status: string; malware_scan: string };

export const ASSUMPTIONS = {
  living_first_adult: 1000, living_per_adult: 350, living_per_child: 300, rent_recognition_pct: 75,
  default_interest_pct: 3.8, default_repayment_pct: 2, fallback_ancillary_pct: 9.0, notary_pct: 1.5, land_registry_pct: 0.5,
  min_equity_pct: 10, affordability_ok_pct: 35, affordability_max_pct: 45, reserve_months: 3, surplus_min_pct: 10,
};

export const DISCLAIMER = 'Vorprüfung und Plausibilitätsprüfung auf Basis der übermittelten Angaben. Keine Kreditzusage, keine Bonitätsentscheidung und keine Finanzierungsgarantie – die Kreditentscheidung trifft allein das finanzierende Institut.';

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function requiredDocuments(d: CaseData): DocumentType[] {
  const emp = new Set((d.applicants ?? []).map((a) => a.employment_type).filter(Boolean));
  const out: DocumentType[] = ['identity', 'self_disclosure', 'equity_proof', 'expose', 'land_register', 'floor_plan', 'living_area_calculation', 'energy_certificate', 'purchase_contract_draft'];
  if (emp.size === 0 || emp.has('employed') || emp.has('civil_servant') || emp.has('retired') || emp.has('other')) out.push('income_proof');
  if (emp.has('employed')) out.push('employment_contract');
  if (emp.has('self_employed')) out.push('tax_assessment', 'annual_financials', 'bwa');
  if (d.property?.property_type === 'apartment') out.push('declaration_of_division', 'owners_meeting_minutes', 'service_charge_statement');
  if (d.property?.usage === 'rented' || d.property?.usage === 'mixed') out.push('rental_agreement');
  if (d.property?.property_type && d.property.property_type !== 'apartment') out.push('cadastral_map');
  return [...new Set(out)];
}

const REQUIRED_FIELDS: [string, (d: CaseData) => unknown][] = [
  ['property.purchase_price', (d) => d.property?.purchase_price],
  ['property.property_type', (d) => d.property?.property_type],
  ['property.address.state', (d) => d.property?.address?.state],
  ['property.address.postal_code', (d) => d.property?.address?.postal_code],
  ['household.monthly_net_income', (d) => d.household?.monthly_net_income ?? ((d.applicants ?? []).some((a) => a.monthly_net_income != null) ? 1 : undefined)],
  ['household.monthly_expenses', (d) => d.household?.monthly_expenses],
  ['equity.amount', (d) => d.equity?.amount],
  ['equity.available_amount', (d) => d.equity?.available_amount],
  ['loan.requested_amount', (d) => d.loan?.requested_amount],
  ['loan.repayment_rate', (d) => d.loan?.repayment_rate],
  ['applicants[].employment_type', (d) => (d.applicants ?? []).find((a) => a.employment_type)?.employment_type],
];

export type ValidationOutcome = {
  completeness_score: number;
  missing_fields: string[];
  missing_documents: DocumentType[];
  checks: Check[];
  warnings: Check[];
  errors: Check[];
  bank_readiness: 'ready' | 'needs_attention' | 'not_ready';
  figures: Record<string, number | null>;
  assumptions: typeof ASSUMPTIONS & { interest_assumed: boolean; repayment_assumed: boolean; ancillary_estimated: boolean };
  disclaimer: string;
};

export function evaluateCase(d: CaseData, docs: DocInfo[]): ValidationOutcome {
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'passed' | 'requires_action'> & { passed?: boolean; requires_action?: boolean }) =>
    checks.push({ ...c, passed: c.passed ?? c.severity === 'info', requires_action: c.requires_action ?? c.severity !== 'info' });

  const price = num(d.property?.purchase_price) ?? 0;
  const renovation = num(d.property?.renovation_cost) ?? 0;
  const state = d.property?.address?.state;
  const nkCalc = state && price > 0 ? kaufnebenkosten({ price, land: state, notaryPct: ASSUMPTIONS.notary_pct, landRegistryPct: ASSUMPTIONS.land_registry_pct }) : null;
  const ancillary = nkCalc ? nkCalc.total : price > 0 ? r2((price * ASSUMPTIONS.fallback_ancillary_pct) / 100) : 0;
  const totalCost = r2(price + ancillary + renovation);
  const equity = num(d.equity?.amount) ?? 0;
  const available = num(d.equity?.available_amount);
  const loan = num(d.loan?.requested_amount) ?? 0;
  const interestAssumed = d.loan?.interest_rate == null;
  const repaymentAssumed = d.loan?.repayment_rate == null;
  const interest = (d.loan?.interest_rate ?? ASSUMPTIONS.default_interest_pct) / 100;
  const repayment = (d.loan?.repayment_rate ?? ASSUMPTIONS.default_repayment_pct) / 100;
  const rate = loan > 0 ? r2(monthlyRate(loan, interest, repayment)) : 0;
  const applicantIncome = (d.applicants ?? []).reduce((s, a) => s + (num(a.monthly_net_income) ?? 0), 0);
  const income = num(d.household?.monthly_net_income) ?? (applicantIncome > 0 ? applicantIncome : null);
  const expenses = num(d.household?.monthly_expenses);
  const adults = d.household?.adults ?? Math.max(1, (d.applicants ?? []).length || 1);
  const children = d.household?.dependants ?? 0;
  const rent = d.property?.usage === 'rented' || d.property?.usage === 'mixed' ? num(d.property?.monthly_cold_rent) ?? 0 : 0;
  const living = ASSUMPTIONS.living_first_adult + ASSUMPTIONS.living_per_adult * Math.max(0, adults - 1) + ASSUMPTIONS.living_per_child * children;

  // Vollständigkeit: Pflichtangaben und Pflichtunterlagen je zur Hälfte.
  const missingFields = REQUIRED_FIELDS.filter(([, get]) => get(d) == null || get(d) === '').map(([f]) => f);
  const required = requiredDocuments(d);
  const present = new Set(docs.filter((x) => x.status !== 'rejected' && x.verification_status !== 'rejected' && x.malware_scan !== 'infected').map((x) => x.type));
  const missingDocs = required.filter((t) => !present.has(t));
  const fieldScore = (REQUIRED_FIELDS.length - missingFields.length) / REQUIRED_FIELDS.length;
  const docScore = required.length ? (required.length - missingDocs.length) / required.length : 1;
  const completeness = Math.round((fieldScore * 0.5 + docScore * 0.5) * 100);

  // 1) Unterlagen vollständig
  add({ code: missingDocs.length ? 'DOCUMENTS_MISSING' : 'DOCUMENTS_COMPLETE', category: 'documents', severity: missingDocs.length ? 'warning' : 'info',
    message: missingDocs.length ? `${missingDocs.length} von ${required.length} erforderlichen Unterlagen fehlen.` : 'Alle erforderlichen Unterlagen liegen vor (formal geprüft).',
    field: 'documents', value: required.length - missingDocs.length, threshold: required.length });
  for (const f of missingFields) add({ code: 'FIELD_MISSING', category: 'completeness', severity: 'warning', message: `Angabe fehlt: ${f}`, field: f, value: null, threshold: null });

  // 2) Einkommen plausibel
  if (income == null || income <= 0) add({ code: 'INCOME_MISSING', category: 'income', severity: 'error', message: 'Kein monatliches Nettoeinkommen angegeben.', field: 'household.monthly_net_income', value: null, threshold: null });
  else if (income > 50_000) add({ code: 'INCOME_UNUSUALLY_HIGH', category: 'income', severity: 'warning', message: 'Sehr hohes Monatsnettoeinkommen – bitte Eingabe (Monat statt Jahr?) prüfen.', field: 'household.monthly_net_income', value: income, threshold: 50_000 });
  else add({ code: 'INCOME_PLAUSIBLE', category: 'income', severity: 'info', message: 'Nettoeinkommen im plausiblen Bereich.', field: 'household.monthly_net_income', value: income, threshold: null });

  // 3) Haushaltsrechnung
  if (income != null && income > 0) {
    const surplus = r2(income + (rent * ASSUMPTIONS.rent_recognition_pct) / 100 - (expenses ?? 0) - living - rate);
    const minSurplus = r2((income * ASSUMPTIONS.surplus_min_pct) / 100);
    if (surplus < 0) add({ code: 'HOUSEHOLD_DEFICIT', category: 'household', severity: 'error', message: 'Nach Lebenshaltungspauschale, Ausgaben und Rate bleibt kein Überschuss.', field: 'household.monthly_expenses', value: surplus, threshold: 0 });
    else if (surplus < minSurplus) add({ code: 'HOUSEHOLD_SURPLUS_LOW', category: 'household', severity: 'warning', message: 'Geringer monatlicher Überschuss – wenig Puffer für Zinsänderungen.', field: 'household.monthly_expenses', value: surplus, threshold: minSurplus });
    else add({ code: 'HOUSEHOLD_SURPLUS_OK', category: 'household', severity: 'info', message: 'Haushaltsrechnung mit ausreichendem Überschuss.', field: 'household.monthly_expenses', value: surplus, threshold: minSurplus });
    if (expenses == null) add({ code: 'EXPENSES_ASSUMED_ZERO', category: 'household', severity: 'warning', message: 'Keine Haushaltsausgaben angegeben; mit 0 € gerechnet (nur Lebenshaltungspauschale).', field: 'household.monthly_expenses', value: null, threshold: null });
  }

  // 4) Kaufnebenkosten
  add({ code: nkCalc ? 'ANCILLARY_COSTS_CALCULATED' : 'ANCILLARY_COSTS_ESTIMATED', category: 'costs', severity: nkCalc ? 'info' : 'warning',
    message: nkCalc ? `Kaufnebenkosten ${nkCalc.land}: ${nkCalc.totalPct.toLocaleString('de-DE')} % des Kaufpreises (ohne Makler).` : `Bundesland fehlt: Kaufnebenkosten pauschal mit ${ASSUMPTIONS.fallback_ancillary_pct.toLocaleString('de-DE')} % geschätzt.`,
    field: 'property.address.state', value: ancillary, threshold: null });

  // 5) Eigenkapital
  if (price > 0) {
    const pct = r2((equity / price) * 100);
    if (equity <= 0) add({ code: 'NO_EQUITY', category: 'equity', severity: 'warning', message: 'Kein Eigenkapital angegeben (Vollfinanzierung).', field: 'equity.amount', value: 0, threshold: ASSUMPTIONS.min_equity_pct });
    else if (pct < ASSUMPTIONS.min_equity_pct) add({ code: 'EQUITY_LOW', category: 'equity', severity: 'warning', message: `Eigenkapital unter ${ASSUMPTIONS.min_equity_pct} % des Kaufpreises.`, field: 'equity.amount', value: pct, threshold: ASSUMPTIONS.min_equity_pct });
    else add({ code: 'EQUITY_OK', category: 'equity', severity: 'info', message: 'Eigenkapitalquote im üblichen Rahmen.', field: 'equity.amount', value: pct, threshold: ASSUMPTIONS.min_equity_pct });
    // 6) Nebenkostendeckung
    add(equity >= ancillary
      ? { code: 'ANCILLARY_COSTS_COVERED', category: 'equity', severity: 'info', message: 'Eigenkapital deckt die Kaufnebenkosten.', field: 'equity.amount', value: equity, threshold: ancillary }
      : { code: 'ANCILLARY_COSTS_NOT_COVERED', category: 'equity', severity: 'warning', message: 'Eigenkapital deckt die Kaufnebenkosten nicht; Banken finanzieren Nebenkosten selten mit.', field: 'equity.amount', value: equity, threshold: ancillary });
  }

  // 7) Darlehenshöhe
  if (price > 0) {
    const need = r2(Math.max(0, totalCost - equity));
    if (loan <= 0) add({ code: 'LOAN_MISSING', category: 'loan', severity: 'error', message: 'Kein Darlehensbetrag angegeben.', field: 'loan.requested_amount', value: null, threshold: need });
    else if (loan + 500 < need) add({ code: 'FINANCING_GAP', category: 'loan', severity: 'error', message: 'Darlehen und Eigenkapital decken die Gesamtkosten nicht.', field: 'loan.requested_amount', value: loan, threshold: need });
    else if (loan > need * 1.05 + 500) add({ code: 'LOAN_EXCEEDS_NEED', category: 'loan', severity: 'warning', message: 'Darlehen höher als der rechnerische Bedarf.', field: 'loan.requested_amount', value: loan, threshold: need });
    else add({ code: 'LOAN_MATCHES_NEED', category: 'loan', severity: 'info', message: 'Darlehensbetrag passt zum rechnerischen Bedarf.', field: 'loan.requested_amount', value: loan, threshold: need });
  }

  // 8) Beleihung (Darlehen zu Kaufpreis)
  if (price > 0 && loan > 0) {
    const ltv = r2((loan / price) * 100);
    add(ltv > 100
      ? { code: 'LTV_HIGH', category: 'ltv', severity: 'warning', message: 'Darlehen über 100 % des Kaufpreises (Nebenkosten mitfinanziert).', field: 'loan.requested_amount', value: ltv, threshold: 100 }
      : ltv > 80
        ? { code: 'LTV_ELEVATED', category: 'ltv', severity: 'info', passed: true, message: 'Darlehen zwischen 80 und 100 % des Kaufpreises – höhere Zinsstufe wahrscheinlich.', field: 'loan.requested_amount', value: ltv, threshold: 80 }
        : { code: 'LTV_OK', category: 'ltv', severity: 'info', message: 'Darlehen bis 80 % des Kaufpreises.', field: 'loan.requested_amount', value: ltv, threshold: 80 });
  }

  // 9) Tragfähigkeit (Rate zu Nettoeinkommen)
  if (income != null && income > 0 && rate > 0) {
    const q = r2((rate / income) * 100);
    add(q > ASSUMPTIONS.affordability_max_pct
      ? { code: 'AFFORDABILITY_LOW', category: 'affordability', severity: 'error', message: `Rate über ${ASSUMPTIONS.affordability_max_pct} % des Nettoeinkommens.`, field: 'loan.requested_amount', value: q, threshold: ASSUMPTIONS.affordability_max_pct }
      : q > ASSUMPTIONS.affordability_ok_pct
        ? { code: 'AFFORDABILITY_TIGHT', category: 'affordability', severity: 'warning', message: `Rate über ${ASSUMPTIONS.affordability_ok_pct} % des Nettoeinkommens.`, field: 'loan.requested_amount', value: q, threshold: ASSUMPTIONS.affordability_ok_pct }
        : { code: 'AFFORDABILITY_OK', category: 'affordability', severity: 'info', message: 'Rate im tragfähigen Verhältnis zum Einkommen.', field: 'loan.requested_amount', value: q, threshold: ASSUMPTIONS.affordability_ok_pct });
  }

  // 10) Liquidität und Liquiditätslücke
  if (price > 0) {
    const ownContribution = r2(Math.max(0, totalCost - loan));
    if (available == null) add({ code: 'LIQUIDITY_UNKNOWN', category: 'liquidity', severity: 'warning', message: 'Verfügbares Eigenkapital nicht angegeben.', field: 'equity.available_amount', value: null, threshold: ownContribution });
    else if (available < ownContribution) add({ code: 'LIQUIDITY_GAP', category: 'liquidity', severity: 'warning', message: 'Verfügbares Eigenkapital reicht für den Eigenanteil nicht aus.', field: 'equity.available_amount', value: available, threshold: ownContribution });
    else {
      const reserve = r2(available - ownContribution), needReserve = r2(Math.max(rate, 1) * ASSUMPTIONS.reserve_months);
      add(reserve < needReserve
        ? { code: 'LIQUIDITY_RESERVE_LOW', category: 'liquidity', severity: 'warning', message: `Nach Eigenanteil bleibt weniger als ${ASSUMPTIONS.reserve_months} Monatsraten Reserve.`, field: 'equity.available_amount', value: reserve, threshold: needReserve }
        : { code: 'LIQUIDITY_OK', category: 'liquidity', severity: 'info', message: 'Liquidität deckt Eigenanteil und Reserve.', field: 'equity.available_amount', value: reserve, threshold: needReserve });
    }
  }

  // 11) Widersprüche
  const contra: [string, string, number | null, number | null][] = [];
  if (available != null && d.equity?.amount != null && available > d.equity.amount + 0.5) contra.push(['equity.available_amount', 'Verfügbares Eigenkapital ist höher als das angegebene Gesamteigenkapital.', available, d.equity.amount]);
  if (d.property?.land_value != null && price > 0 && d.property.land_value > price) contra.push(['property.land_value', 'Bodenwert höher als der Kaufpreis.', d.property.land_value, price]);
  if (d.household?.monthly_net_income != null && applicantIncome > 0 && Math.abs(applicantIncome - d.household.monthly_net_income) > Math.max(100, d.household.monthly_net_income * 0.1))
    contra.push(['household.monthly_net_income', 'Summe der Antragsteller-Einkommen weicht vom Haushaltseinkommen ab.', applicantIncome, d.household.monthly_net_income]);
  if (price > 0 && equity + loan > totalCost * 1.2 + 1000) contra.push(['loan.requested_amount', 'Eigenkapital und Darlehen übersteigen die Gesamtkosten deutlich.', r2(equity + loan), totalCost]);
  if (d.property?.usage === 'rented' && !(num(d.property?.monthly_cold_rent) ?? 0)) contra.push(['property.monthly_cold_rent', 'Objekt als vermietet angegeben, aber ohne Kaltmiete.', null, null]);
  if (contra.length) for (const [field, message, value, threshold] of contra) add({ code: 'CONTRADICTORY_INFORMATION', category: 'consistency', severity: 'warning', message, field, value, threshold });
  else add({ code: 'NO_CONTRADICTIONS', category: 'consistency', severity: 'info', message: 'Keine widersprüchlichen Angaben erkannt.', field: null, value: null, threshold: null });

  // 12) Unterlagen-Konsistenz
  const dup = docs.length - new Set(docs.map((x) => x.sha256)).size;
  const rejected = docs.filter((x) => x.status === 'rejected' || x.verification_status === 'rejected').length;
  const infected = docs.filter((x) => x.malware_scan === 'infected').length;
  if (infected) add({ code: 'DOCUMENT_MALWARE', category: 'documents', severity: 'error', message: 'Mindestens eine Datei wurde vom Virenscanner beanstandet.', field: 'documents', value: infected, threshold: 0 });
  if (rejected) add({ code: 'DOCUMENT_REJECTED', category: 'documents', severity: 'warning', message: 'Mindestens eine Unterlage wurde abgelehnt und muss ersetzt werden.', field: 'documents', value: rejected, threshold: 0 });
  if (dup) add({ code: 'DOCUMENT_DUPLICATE', category: 'documents', severity: 'warning', message: 'Identische Datei mehrfach hochgeladen.', field: 'documents', value: dup, threshold: 0 });
  if (!dup && !rejected && !infected) add({ code: 'DOCUMENTS_CONSISTENT', category: 'documents', severity: 'info', message: docs.length ? 'Unterlagen formal konsistent (Typ, Prüfsumme, Dateisignatur).' : 'Noch keine Unterlagen hochgeladen.', field: 'documents', value: docs.length, threshold: null });

  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const bank_readiness = errors.length ? 'not_ready' : warnings.length || completeness < 100 ? 'needs_attention' : 'ready';
  return {
    completeness_score: completeness, missing_fields: missingFields, missing_documents: missingDocs, checks, warnings, errors, bank_readiness,
    figures: { purchase_price: price || null, ancillary_costs: ancillary || null, renovation_cost: renovation || null, total_cost: totalCost || null, equity: equity || null,
      available_equity: available, loan: loan || null, monthly_rate: rate || null, monthly_net_income: income, living_allowance: living },
    assumptions: { ...ASSUMPTIONS, interest_assumed: interestAssumed, repayment_assumed: repaymentAssumed, ancillary_estimated: !nkCalc },
    disclaimer: DISCLAIMER,
  };
}
