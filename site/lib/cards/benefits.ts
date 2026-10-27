// LeaseRun-Vorteil für Karteninhaber: nur mit aktiver, echter Karte (keine Demo) und nur auf qualifizierte digitale Produkte.
export const BENEFIT = { discountPercent: 20, eligibleProducts: ['credit-map', 'buyer-pass', 'pro-monthly'], excludedProducts: ['b2b-*'] } as const;
export type BenefitEligibility = { eligible: boolean; discount_percent: number; eligible_products: readonly string[]; excluded_products: readonly string[]; valid_from: string | null; valid_until: string | null; reason?: string };

export function benefitFor(cards: { status: string; is_demo: boolean; created_at: string }[], programLive: boolean): BenefitEligibility {
  const active = cards.find((c) => c.status === 'ACTIVE' && !c.is_demo);
  const base = { discount_percent: BENEFIT.discountPercent, eligible_products: BENEFIT.eligibleProducts, excluded_products: BENEFIT.excludedProducts, valid_until: null };
  if (!programLive) return { ...base, eligible: false, valid_from: null, reason: 'Die LeaseRun Card ist noch nicht verfügbar.' };
  if (!active) return { ...base, eligible: false, valid_from: null, reason: 'Voraussetzung ist eine aktive LeaseRun Card.' };
  return { ...base, eligible: true, valid_from: active.created_at };
}
