// Pre-check of a financing case (pure calculation, no database – testable).
// Result: machine-readable checks, completeness and lender readiness. Not a credit decision: thresholds are
// LeaseRun reference values based on common US underwriting guidelines; the decision is made solely by the lender.
// US model: fully amortizing fixed-rate loan (default 30 years), PITIA (principal, interest, property tax, homeowners
// insurance, HOA dues), front-end and back-end DTI on gross income, LTV with PMI note, cash to close, reserves in
// months of PITIA and DSCR for rental properties.
import type { CaseData, DocumentType } from '@/lib/api/schemas';

export type Severity = 'info' | 'warning' | 'error';
export type Check = {
  code: string; category: string; severity: Severity; passed: boolean; message: string;
  field: string | null; requires_action: boolean; value: number | string | null; threshold: number | string | null;
};
export type DocInfo = { id: string; type: DocumentType | string; sha256: string; status: string; verification_status: string; malware_scan: string };

export const ASSUMPTIONS = {
  default_interest_pct: 6.5, default_term_years: 30,
  closing_cost_pct: 3.0, // estimated buyer closing costs (lender fees, title, escrow, recording, prepaids) – varies by state
  property_tax_pct: 1.1, insurance_pct: 0.35, // annual, % of purchase price, used only when not provided
  rent_recognition_pct: 75, // share of gross rent counted as income (common 75% vacancy/expense factor)
  min_down_payment_pct: 3, pmi_ltv_pct: 80, max_ltv_pct: 97,
  front_dti_ok_pct: 28, back_dti_ok_pct: 36, back_dti_qm_pct: 43, back_dti_max_pct: 50,
  reserve_months: 2, reserve_months_investment: 6, dscr_ok: 1.2, dscr_min: 1.0, surplus_min_pct: 10,
};

export const DISCLAIMER = 'Pre-check and plausibility review based on the data submitted. Not a loan approval, pre-approval, rate quote or credit decision and no guarantee of financing – the credit decision is made solely by the lender.';

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Monthly principal and interest of a fully amortizing loan.
export function amortizingPayment(loan: number, ratePct: number, years: number): number {
  if (!(loan > 0) || !(years > 0)) return 0;
  const n = Math.round(years * 12), i = ratePct / 100 / 12;
  return i === 0 ? loan / n : (loan * i) / (1 - Math.pow(1 + i, -n));
}

export function requiredDocuments(d: CaseData): DocumentType[] {
  const emp = new Set((d.applicants ?? []).map((a) => a.employment_type).filter(Boolean));
  // Photo ID, loan application / financial profile, bank statements, asset statements, listing, purchase agreement,
  // preliminary title report and homeowners insurance quote.
  const out: DocumentType[] = ['identity', 'self_disclosure', 'bank_statement', 'equity_proof', 'expose', 'purchase_contract_draft', 'land_register', 'building_insurance'];
  if (emp.size === 0 || emp.has('employed') || emp.has('civil_servant') || emp.has('retired') || emp.has('other')) out.push('income_proof');
  if (emp.size === 0 || emp.has('employed') || emp.has('civil_servant')) out.push('tax_assessment'); // W-2s / tax returns, 2 years
  if (emp.has('self_employed')) out.push('tax_assessment', 'annual_financials', 'bwa'); // personal + business returns, YTD P&L
  if (d.property?.property_type === 'apartment' || d.property?.property_type === 'townhouse') out.push('declaration_of_division', 'service_charge_statement'); // HOA documents and dues
  if (d.property?.usage === 'rented' || d.property?.usage === 'mixed') out.push('rental_agreement');
  return [...new Set(out)];
}

const REQUIRED_FIELDS: [string, (d: CaseData) => unknown][] = [
  ['property.purchase_price', (d) => d.property?.purchase_price],
  ['property.property_type', (d) => d.property?.property_type],
  ['property.address.state', (d) => d.property?.address?.state],
  ['property.address.postal_code', (d) => d.property?.address?.postal_code],
  ['household.monthly_gross_income', (d) => d.household?.monthly_gross_income ?? d.household?.monthly_net_income ?? ((d.applicants ?? []).some((a) => a.monthly_gross_income != null || a.monthly_net_income != null) ? 1 : undefined)],
  ['household.monthly_debt_payments', (d) => d.household?.monthly_debt_payments ?? d.household?.monthly_expenses],
  ['equity.amount', (d) => d.equity?.amount],
  ['equity.available_amount', (d) => d.equity?.available_amount],
  ['loan.requested_amount', (d) => d.loan?.requested_amount],
  ['loan.term_years', (d) => d.loan?.term_years],
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
  assumptions: typeof ASSUMPTIONS & { interest_assumed: boolean; term_assumed: boolean; repayment_assumed: boolean; ancillary_estimated: boolean; taxes_assumed: boolean; insurance_assumed: boolean; income_basis: 'gross' | 'net' | 'none' };
  disclaimer: string;
};

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function evaluateCase(d: CaseData, docs: DocInfo[]): ValidationOutcome {
  const checks: Check[] = [];
  const add = (c: Omit<Check, 'passed' | 'requires_action'> & { passed?: boolean; requires_action?: boolean }) =>
    checks.push({ ...c, passed: c.passed ?? c.severity === 'info', requires_action: c.requires_action ?? c.severity !== 'info' });

  const price = num(d.property?.purchase_price) ?? 0;
  const renovation = num(d.property?.renovation_cost) ?? 0;
  const state = d.property?.address?.state;
  const investment = d.property?.usage === 'rented' || d.property?.usage === 'mixed';
  const closingGiven = num(d.property?.closing_costs);
  const ancillary = closingGiven ?? (price > 0 ? r2((price * ASSUMPTIONS.closing_cost_pct) / 100) : 0);
  const totalCost = r2(price + ancillary + renovation);
  const equity = num(d.equity?.amount) ?? 0;
  const available = num(d.equity?.available_amount);
  const loan = num(d.loan?.requested_amount) ?? 0;
  const interestAssumed = d.loan?.interest_rate == null;
  const termAssumed = d.loan?.term_years == null;
  const ratePct = d.loan?.interest_rate ?? ASSUMPTIONS.default_interest_pct;
  const term = d.loan?.term_years ?? ASSUMPTIONS.default_term_years;
  const pi = loan > 0 ? r2(amortizingPayment(loan, ratePct, term)) : 0;
  const taxesAssumed = d.property?.annual_property_tax == null, insAssumed = d.property?.annual_insurance == null;
  const tax = num(d.property?.annual_property_tax) ?? (price * ASSUMPTIONS.property_tax_pct) / 100;
  const ins = num(d.property?.annual_insurance) ?? (price * ASSUMPTIONS.insurance_pct) / 100;
  const hoa = num(d.property?.monthly_hoa) ?? 0;
  const pitia = loan > 0 || price > 0 ? r2(pi + tax / 12 + ins / 12 + hoa) : 0;
  const sumApp = (k: 'monthly_gross_income' | 'monthly_net_income') => (d.applicants ?? []).reduce((s, a) => s + (num(a[k]) ?? 0), 0);
  const appGross = sumApp('monthly_gross_income'), appNet = sumApp('monthly_net_income');
  const gross = num(d.household?.monthly_gross_income) ?? (appGross > 0 ? appGross : null);
  const net = num(d.household?.monthly_net_income) ?? (appNet > 0 ? appNet : null);
  const income = gross ?? net;
  const incomeBasis: 'gross' | 'net' | 'none' = gross != null ? 'gross' : net != null ? 'net' : 'none';
  const debts = num(d.household?.monthly_debt_payments) ?? num(d.household?.monthly_expenses);
  const expenses = num(d.household?.monthly_expenses);
  const rent = investment ? num(d.property?.monthly_cold_rent) ?? 0 : 0;
  const rentIncome = r2((rent * ASSUMPTIONS.rent_recognition_pct) / 100);

  // Completeness: required fields and required documents, half each.
  const missingFields = REQUIRED_FIELDS.filter(([, get]) => get(d) == null || get(d) === '').map(([f]) => f);
  const required = requiredDocuments(d);
  const present = new Set(docs.filter((x) => x.status !== 'rejected' && x.verification_status !== 'rejected' && x.malware_scan !== 'infected').map((x) => x.type));
  const missingDocs = required.filter((t) => !present.has(t));
  const fieldScore = (REQUIRED_FIELDS.length - missingFields.length) / REQUIRED_FIELDS.length;
  const docScore = required.length ? (required.length - missingDocs.length) / required.length : 1;
  const completeness = Math.round((fieldScore * 0.5 + docScore * 0.5) * 100);

  // 1) Documents complete
  add({ code: missingDocs.length ? 'DOCUMENTS_MISSING' : 'DOCUMENTS_COMPLETE', category: 'documents', severity: missingDocs.length ? 'warning' : 'info',
    message: missingDocs.length ? `${missingDocs.length} of ${required.length} required documents are missing.` : 'All required documents are present (format checked).',
    field: 'documents', value: required.length - missingDocs.length, threshold: required.length });
  for (const f of missingFields) add({ code: 'FIELD_MISSING', category: 'completeness', severity: 'warning', message: `Missing field: ${f}`, field: f, value: null, threshold: null });

  // 2) Income plausible
  if (income == null || income <= 0) add({ code: 'INCOME_MISSING', category: 'income', severity: 'error', message: 'No monthly income provided.', field: 'household.monthly_gross_income', value: null, threshold: null });
  else if (income > 100_000) add({ code: 'INCOME_UNUSUALLY_HIGH', category: 'income', severity: 'warning', message: 'Very high monthly income – please check the entry (monthly, not annual?).', field: incomeBasis === 'gross' ? 'household.monthly_gross_income' : 'household.monthly_net_income', value: income, threshold: 100_000 });
  else add({ code: 'INCOME_PLAUSIBLE', category: 'income', severity: 'info', message: 'Income is in a plausible range.', field: incomeBasis === 'gross' ? 'household.monthly_gross_income' : 'household.monthly_net_income', value: income, threshold: null });
  if (incomeBasis === 'net') add({ code: 'INCOME_NET_ONLY', category: 'income', severity: 'warning', message: 'Only take-home (net) income provided; lenders calculate DTI on gross income. DTI shown is conservative.', field: 'household.monthly_gross_income', value: net, threshold: null });

  // 3) DTI (front-end housing ratio and back-end ratio incl. monthly debts)
  if (income != null && income > 0 && pitia > 0) {
    const inc = income + rentIncome;
    const front = r2((pitia / inc) * 100);
    const back = r2(((pitia + (debts ?? 0)) / inc) * 100);
    add(front > ASSUMPTIONS.front_dti_ok_pct
      ? { code: 'FRONT_END_DTI_HIGH', category: 'household', severity: 'info', passed: true, requires_action: false, message: `Housing payment (PITIA) is above ${ASSUMPTIONS.front_dti_ok_pct}% of income – many programs still allow this if the back-end DTI fits.`, field: 'household.monthly_gross_income', value: front, threshold: ASSUMPTIONS.front_dti_ok_pct }
      : { code: 'FRONT_END_DTI_OK', category: 'household', severity: 'info', message: 'Housing payment (PITIA) within the common front-end ratio.', field: 'household.monthly_gross_income', value: front, threshold: ASSUMPTIONS.front_dti_ok_pct });
    add(back > ASSUMPTIONS.back_dti_max_pct
      ? { code: 'AFFORDABILITY_LOW', category: 'affordability', severity: 'error', message: `Back-end DTI above ${ASSUMPTIONS.back_dti_max_pct}% – above the limit of most loan programs.`, field: 'loan.requested_amount', value: back, threshold: ASSUMPTIONS.back_dti_max_pct }
      : back > ASSUMPTIONS.back_dti_qm_pct
        ? { code: 'AFFORDABILITY_TIGHT', category: 'affordability', severity: 'warning', message: `Back-end DTI above ${ASSUMPTIONS.back_dti_qm_pct}% – usually needs compensating factors (reserves, credit score) or an automated underwriting approval.`, field: 'loan.requested_amount', value: back, threshold: ASSUMPTIONS.back_dti_qm_pct }
        : back > ASSUMPTIONS.back_dti_ok_pct
          ? { code: 'AFFORDABILITY_ACCEPTABLE', category: 'affordability', severity: 'info', passed: true, requires_action: false, message: `Back-end DTI between ${ASSUMPTIONS.back_dti_ok_pct}% and ${ASSUMPTIONS.back_dti_qm_pct}% – within common limits.`, field: 'loan.requested_amount', value: back, threshold: ASSUMPTIONS.back_dti_qm_pct }
          : { code: 'AFFORDABILITY_OK', category: 'affordability', severity: 'info', message: `Back-end DTI at or below ${ASSUMPTIONS.back_dti_ok_pct}%.`, field: 'loan.requested_amount', value: back, threshold: ASSUMPTIONS.back_dti_ok_pct });
    if (debts == null) add({ code: 'EXPENSES_ASSUMED_ZERO', category: 'household', severity: 'warning', message: 'No monthly debt payments provided; calculated with $0 (credit cards, auto and student loans count toward DTI).', field: 'household.monthly_debt_payments', value: null, threshold: null });
  }

  // 4) Monthly budget after all costs (only with take-home income and living expenses)
  if (net != null && net > 0 && expenses != null && pitia > 0) {
    const surplus = r2(net + rentIncome - expenses - (num(d.household?.monthly_debt_payments) ?? 0) - pitia);
    const minSurplus = r2((net * ASSUMPTIONS.surplus_min_pct) / 100);
    if (surplus < 0) add({ code: 'HOUSEHOLD_DEFICIT', category: 'household', severity: 'error', message: 'After living expenses, debts and the new payment nothing is left each month.', field: 'household.monthly_expenses', value: surplus, threshold: 0 });
    else if (surplus < minSurplus) add({ code: 'HOUSEHOLD_SURPLUS_LOW', category: 'household', severity: 'warning', message: 'Small monthly cushion – little room for rate, tax or insurance increases.', field: 'household.monthly_expenses', value: surplus, threshold: minSurplus });
    else add({ code: 'HOUSEHOLD_SURPLUS_OK', category: 'household', severity: 'info', message: 'Monthly budget leaves a sufficient cushion.', field: 'household.monthly_expenses', value: surplus, threshold: minSurplus });
  }

  // 5) Closing costs
  add({ code: closingGiven != null ? 'ANCILLARY_COSTS_CALCULATED' : 'ANCILLARY_COSTS_ESTIMATED', category: 'costs', severity: closingGiven != null ? 'info' : 'warning',
    message: closingGiven != null ? `Closing costs as provided: ${usd(ancillary)}.` : `Closing costs estimated at ${ASSUMPTIONS.closing_cost_pct}% of the purchase price${state ? ` (${state})` : ''}; transfer taxes, title and escrow fees vary by state and county – use the Loan Estimate figures.`,
    field: 'property.closing_costs', value: ancillary, threshold: null });

  // 6) Down payment
  if (price > 0) {
    const pct = r2((equity / price) * 100);
    if (equity <= 0) add({ code: 'NO_EQUITY', category: 'equity', severity: 'warning', message: 'No down payment provided (100% financing is only available through VA or USDA programs).', field: 'equity.amount', value: 0, threshold: ASSUMPTIONS.min_down_payment_pct });
    else if (pct < ASSUMPTIONS.min_down_payment_pct) add({ code: 'EQUITY_LOW', category: 'equity', severity: 'warning', message: `Down payment below ${ASSUMPTIONS.min_down_payment_pct}% of the purchase price.`, field: 'equity.amount', value: pct, threshold: ASSUMPTIONS.min_down_payment_pct });
    else if (investment && pct < 15) add({ code: 'EQUITY_LOW', category: 'equity', severity: 'warning', message: 'Investment properties usually need 15–25% down.', field: 'equity.amount', value: pct, threshold: 15 });
    else add({ code: 'EQUITY_OK', category: 'equity', severity: 'info', message: 'Down payment within the usual range.', field: 'equity.amount', value: pct, threshold: ASSUMPTIONS.min_down_payment_pct });
    // 7) Cash to close covers closing costs
    add(equity >= ancillary
      ? { code: 'ANCILLARY_COSTS_COVERED', category: 'equity', severity: 'info', message: 'Funds cover the closing costs.', field: 'equity.amount', value: equity, threshold: ancillary }
      : { code: 'ANCILLARY_COSTS_NOT_COVERED', category: 'equity', severity: 'warning', message: 'Funds do not cover the closing costs; consider seller concessions or lender credits.', field: 'equity.amount', value: equity, threshold: ancillary });
  }

  // 8) Loan amount
  if (price > 0) {
    const need = r2(Math.max(0, totalCost - equity));
    if (loan <= 0) add({ code: 'LOAN_MISSING', category: 'loan', severity: 'error', message: 'No loan amount provided.', field: 'loan.requested_amount', value: null, threshold: need });
    else if (loan + 500 < need) add({ code: 'FINANCING_GAP', category: 'loan', severity: 'error', message: 'Loan and funds do not cover the total cost (purchase price, closing costs, renovation).', field: 'loan.requested_amount', value: loan, threshold: need });
    else if (loan > need * 1.05 + 500) add({ code: 'LOAN_EXCEEDS_NEED', category: 'loan', severity: 'warning', message: 'Loan amount is higher than the calculated need.', field: 'loan.requested_amount', value: loan, threshold: need });
    else add({ code: 'LOAN_MATCHES_NEED', category: 'loan', severity: 'info', message: 'Loan amount matches the calculated need.', field: 'loan.requested_amount', value: loan, threshold: need });
  }

  // 9) LTV
  if (price > 0 && loan > 0) {
    const ltv = r2((loan / price) * 100);
    add(ltv > ASSUMPTIONS.max_ltv_pct
      ? { code: 'LTV_HIGH', category: 'ltv', severity: 'warning', message: `LTV above ${ASSUMPTIONS.max_ltv_pct}% – above conventional limits (FHA up to 96.5%, VA/USDA up to 100%).`, field: 'loan.requested_amount', value: ltv, threshold: ASSUMPTIONS.max_ltv_pct }
      : ltv > ASSUMPTIONS.pmi_ltv_pct
        ? { code: 'LTV_ELEVATED', category: 'ltv', severity: 'info', passed: true, message: `LTV above ${ASSUMPTIONS.pmi_ltv_pct}% – private mortgage insurance (PMI) is likely on a conventional loan.`, field: 'loan.requested_amount', value: ltv, threshold: ASSUMPTIONS.pmi_ltv_pct }
        : { code: 'LTV_OK', category: 'ltv', severity: 'info', message: `LTV at or below ${ASSUMPTIONS.pmi_ltv_pct}% – no PMI needed on a conventional loan.`, field: 'loan.requested_amount', value: ltv, threshold: ASSUMPTIONS.pmi_ltv_pct });
  }

  // 10) DSCR for rental properties
  if (investment && pitia > 0) {
    if (!(rent > 0)) add({ code: 'DSCR_UNKNOWN', category: 'dscr', severity: 'warning', message: 'Rental property without rent – DSCR cannot be calculated.', field: 'property.monthly_cold_rent', value: null, threshold: ASSUMPTIONS.dscr_ok });
    else {
      const dscr = r2(rent / pitia);
      add(dscr < ASSUMPTIONS.dscr_min
        ? { code: 'DSCR_LOW', category: 'dscr', severity: 'warning', message: `DSCR below ${ASSUMPTIONS.dscr_min.toFixed(2)} – rent does not cover PITIA.`, field: 'property.monthly_cold_rent', value: dscr, threshold: ASSUMPTIONS.dscr_min }
        : dscr < ASSUMPTIONS.dscr_ok
          ? { code: 'DSCR_TIGHT', category: 'dscr', severity: 'info', passed: true, message: `DSCR between ${ASSUMPTIONS.dscr_min.toFixed(2)} and ${ASSUMPTIONS.dscr_ok.toFixed(2)} – many DSCR lenders want ${ASSUMPTIONS.dscr_ok.toFixed(2)} or more.`, field: 'property.monthly_cold_rent', value: dscr, threshold: ASSUMPTIONS.dscr_ok }
          : { code: 'DSCR_OK', category: 'dscr', severity: 'info', message: `DSCR of ${ASSUMPTIONS.dscr_ok.toFixed(2)} or more.`, field: 'property.monthly_cold_rent', value: dscr, threshold: ASSUMPTIONS.dscr_ok });
    }
  }

  // 11) Cash to close and reserves
  if (price > 0) {
    const ownContribution = r2(Math.max(0, totalCost - loan));
    const months = investment ? ASSUMPTIONS.reserve_months_investment : ASSUMPTIONS.reserve_months;
    if (available == null) add({ code: 'LIQUIDITY_UNKNOWN', category: 'liquidity', severity: 'warning', message: 'Available assets not provided.', field: 'equity.available_amount', value: null, threshold: ownContribution });
    else if (available < ownContribution) add({ code: 'LIQUIDITY_GAP', category: 'liquidity', severity: 'warning', message: 'Available assets do not cover the cash to close.', field: 'equity.available_amount', value: available, threshold: ownContribution });
    else {
      const reserve = r2(available - ownContribution), needReserve = r2(Math.max(pitia, 1) * months);
      add(reserve < needReserve
        ? { code: 'LIQUIDITY_RESERVE_LOW', category: 'liquidity', severity: 'warning', message: `After closing, less than ${months} months of PITIA remain in reserves.`, field: 'equity.available_amount', value: reserve, threshold: needReserve }
        : { code: 'LIQUIDITY_OK', category: 'liquidity', severity: 'info', message: 'Assets cover cash to close and reserves.', field: 'equity.available_amount', value: reserve, threshold: needReserve });
    }
  }

  // 12) Contradictions
  const contra: [string, string, number | null, number | null][] = [];
  if (available != null && d.equity?.amount != null && available + 0.5 < d.equity.amount) contra.push(['equity.available_amount', 'Available assets are lower than the stated down payment and closing funds.', available, d.equity.amount]);
  if (d.property?.land_value != null && price > 0 && d.property.land_value > price) contra.push(['property.land_value', 'Land value is higher than the purchase price.', d.property.land_value, price]);
  const hhInc = num(d.household?.monthly_gross_income) ?? num(d.household?.monthly_net_income);
  const appInc = num(d.household?.monthly_gross_income) != null ? appGross : appNet;
  if (hhInc != null && appInc > 0 && Math.abs(appInc - hhInc) > Math.max(100, hhInc * 0.1))
    contra.push([num(d.household?.monthly_gross_income) != null ? 'household.monthly_gross_income' : 'household.monthly_net_income', 'The sum of applicant incomes differs from the household income.', appInc, hhInc]);
  if (gross != null && net != null && net > gross + 1) contra.push(['household.monthly_net_income', 'Take-home income is higher than gross income.', net, gross]);
  if (price > 0 && equity + loan > totalCost * 1.2 + 1000) contra.push(['loan.requested_amount', 'Funds and loan clearly exceed the total cost.', r2(equity + loan), totalCost]);
  if (d.property?.usage === 'rented' && !(num(d.property?.monthly_cold_rent) ?? 0)) contra.push(['property.monthly_cold_rent', 'Property marked as rented but no rent provided.', null, null]);
  if (contra.length) for (const [field, message, value, threshold] of contra) add({ code: 'CONTRADICTORY_INFORMATION', category: 'consistency', severity: 'warning', message, field, value, threshold });
  else add({ code: 'NO_CONTRADICTIONS', category: 'consistency', severity: 'info', message: 'No contradictory information detected.', field: null, value: null, threshold: null });

  // 13) Document consistency
  const dup = docs.length - new Set(docs.map((x) => x.sha256)).size;
  const rejected = docs.filter((x) => x.status === 'rejected' || x.verification_status === 'rejected').length;
  const infected = docs.filter((x) => x.malware_scan === 'infected').length;
  if (infected) add({ code: 'DOCUMENT_MALWARE', category: 'documents', severity: 'error', message: 'At least one file was flagged by the malware scanner.', field: 'documents', value: infected, threshold: 0 });
  if (rejected) add({ code: 'DOCUMENT_REJECTED', category: 'documents', severity: 'warning', message: 'At least one document was rejected and must be replaced.', field: 'documents', value: rejected, threshold: 0 });
  if (dup) add({ code: 'DOCUMENT_DUPLICATE', category: 'documents', severity: 'warning', message: 'The same file was uploaded more than once.', field: 'documents', value: dup, threshold: 0 });
  if (!dup && !rejected && !infected) add({ code: 'DOCUMENTS_CONSISTENT', category: 'documents', severity: 'info', message: docs.length ? 'Documents are formally consistent (type, checksum, file signature).' : 'No documents uploaded yet.', field: 'documents', value: docs.length, threshold: null });

  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const bank_readiness = errors.length ? 'not_ready' : warnings.length || completeness < 100 ? 'needs_attention' : 'ready';
  const back = income && income > 0 && pitia > 0 ? r2(((pitia + (debts ?? 0)) / (income + rentIncome)) * 100) : null;
  return {
    completeness_score: completeness, missing_fields: missingFields, missing_documents: missingDocs, checks, warnings, errors, bank_readiness,
    figures: { purchase_price: price || null, ancillary_costs: ancillary || null, renovation_cost: renovation || null, total_cost: totalCost || null, equity: equity || null,
      available_equity: available, loan: loan || null, monthly_rate: pi || null, monthly_pitia: pitia || null, monthly_net_income: net, monthly_gross_income: gross,
      ltv_pct: price > 0 && loan > 0 ? r2((loan / price) * 100) : null, back_end_dti_pct: back, dscr: investment && rent > 0 && pitia > 0 ? r2(rent / pitia) : null, living_allowance: null },
    assumptions: { ...ASSUMPTIONS, interest_assumed: interestAssumed, term_assumed: termAssumed, repayment_assumed: termAssumed, ancillary_estimated: closingGiven == null, taxes_assumed: taxesAssumed, insurance_assumed: insAssumed, income_basis: incomeBasis },
    disclaimer: DISCLAIMER,
  };
}
