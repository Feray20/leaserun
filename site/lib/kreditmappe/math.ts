// Pure calculation functions without dependencies (testable with node:test).

// ---------- US mortgage math (used by the Lender Package) ----------

// Monthly principal & interest of a fully amortizing fixed-rate loan (US standard: 30-year fixed).
export function mortgagePayment(loan: number, ratePa: number, years: number): number {
  if (loan <= 0) return 0;
  const n = Math.max(1, Math.round(years * 12));
  const r = ratePa / 12;
  return r > 0 ? (loan * r) / (1 - Math.pow(1 + r, -n)) : loan / n;
}

// Remaining balance of a fully amortizing loan after a number of monthly payments.
export function amortizedBalance(loan: number, ratePa: number, years: number, months: number): number {
  if (loan <= 0) return 0;
  const r = ratePa / 12;
  const pmt = mortgagePayment(loan, ratePa, years);
  if (r === 0) return Math.max(0, loan - pmt * months);
  return Math.max(0, loan * Math.pow(1 + r, months) - (pmt * (Math.pow(1 + r, months) - 1)) / r);
}

// Interest and principal paid in the first 12 months of an amortizing loan.
export function firstYearSplit(loan: number, ratePa: number, years: number): { interest: number; principal: number } {
  if (loan <= 0) return { interest: 0, principal: 0 };
  const pmt = mortgagePayment(loan, ratePa, years);
  let b = loan, interest = 0;
  for (let m = 0; m < 12; m++) { const i = (b * ratePa) / 12; interest += i; b -= pmt - i; }
  return { interest, principal: loan - Math.max(0, b) };
}

// Federal straight-line depreciation period (MACRS, IRS Pub. 527/946): residential rental 27.5 years,
// nonresidential (commercial) real property 39 years. Land is never depreciable.
export function depreciationYears(propertyType: string): number {
  return /commercial|office|retail|industrial/i.test(propertyType || '') ? 39 : 27.5;
}

// Cash-on-cash style return: cash flow (+ principal paydown, + assumed appreciation) relative to cash invested.
export function equityReturn(equity: number, cashflowPa: number, principalPa = 0, valueGrowthPa = 0): number | null {
  if (equity <= 0) return null;
  return (cashflowPa + principalPa + valueGrowthPa) / equity;
}

// ---------- Legacy helpers (kept for compatibility with existing callers and tests; not used for US figures) ----------

// Legacy (German straight-line rates by year built). US depreciation: see depreciationYears().
export function afaRate(yearBuilt: number): number {
  if (yearBuilt >= 2023) return 0.03;
  if (yearBuilt > 0 && yearBuilt < 1925) return 0.025;
  return 0.02;
}

// Remaining balance of a loan with a fixed initial repayment rate after n years (monthly payments).
export function balanceAfterYears(loan: number, ratePa: number, repaymentPa: number, years: number): number {
  if (loan <= 0) return 0;
  const i = ratePa / 12;
  const rate = (loan * (ratePa + repaymentPa)) / 12;
  const m = years * 12;
  if (i === 0) return Math.max(0, loan - rate * m);
  return Math.max(0, loan * Math.pow(1 + i, m) - rate * ((Math.pow(1 + i, m) - 1) / i));
}

// Legacy declining-balance schedule (5 % of the remaining value per year) or straight-line at linearRate.
export function afaSchedule(basis: number, years: number, mode: 'linear' | 'degressiv', linearRate: number): number[] {
  const out: number[] = [];
  let rest = basis;
  for (let y = 0; y < years; y++) {
    const a = mode === 'linear' ? Math.min(rest, basis * linearRate) : rest * 0.05;
    out.push(a);
    rest -= a;
  }
  return out;
}

// Legacy rent-cap helpers (German rules). US rent regulation is state/local – shown as "check your state/city".
export function mietpreisbremseMax(vergleichsmieteProQm: number, flaeche: number, vormiete = 0): number {
  return Math.max(vergleichsmieteProQm * 1.1 * flaeche, vormiete);
}
export function kappungsgrenzeMax(mieteVorDreiJahren: number, vergleichsmiete: number, angespannt: boolean): number {
  return Math.min(mieteVorDreiJahren * (angespannt ? 1.15 : 1.2), vergleichsmiete);
}
