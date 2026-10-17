// Reine Rechenfunktionen ohne Abhängigkeiten (testbar mit node:test).

// Lineare AfA nach § 7 Abs. 4 EStG nach Fertigstellungsjahr.
export function afaRate(yearBuilt: number): number {
  if (yearBuilt >= 2023) return 0.03;
  if (yearBuilt > 0 && yearBuilt < 1925) return 0.025;
  return 0.02;
}

// Restschuld eines Annuitätendarlehens nach n Jahren (monatliche Zahlung).
export function balanceAfterYears(loan: number, ratePa: number, repaymentPa: number, years: number): number {
  if (loan <= 0) return 0;
  const i = ratePa / 12;
  const rate = (loan * (ratePa + repaymentPa)) / 12;
  const m = years * 12;
  if (i === 0) return Math.max(0, loan - rate * m);
  return Math.max(0, loan * Math.pow(1 + i, m) - rate * ((Math.pow(1 + i, m) - 1) / i));
}

// Degressive AfA nach § 7 Abs. 5a EStG: 5 % vom jeweiligen Restwert (vereinfacht ohne Zeitanteil im ersten Jahr).
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

// Mietpreisbremse (§ 556d BGB): höchstens 10 % über der ortsüblichen Vergleichsmiete;
// eine höhere Vormiete darf beibehalten werden (§ 556e Abs. 1 BGB).
export function mietpreisbremseMax(vergleichsmieteProQm: number, flaeche: number, vormiete = 0): number {
  return Math.max(vergleichsmieteProQm * 1.1 * flaeche, vormiete);
}

// Kappungsgrenze (§ 558 Abs. 3 BGB): +20 % (bzw. +15 % in ausgewiesenen Gebieten) in drei Jahren,
// zugleich höchstens bis zur ortsüblichen Vergleichsmiete.
export function kappungsgrenzeMax(mieteVorDreiJahren: number, vergleichsmiete: number, angespannt: boolean): number {
  return Math.min(mieteVorDreiJahren * (angespannt ? 1.15 : 1.2), vergleichsmiete);
}

// Eigenkapitalrendite: Cashflow (+ Tilgung, + angenommene Wertsteigerung) im Verhältnis zum Eigenkapital.
export function equityReturn(equity: number, cashflowPa: number, principalPa = 0, valueGrowthPa = 0): number | null {
  if (equity <= 0) return null;
  return (cashflowPa + principalPa + valueGrowthPa) / equity;
}
