// Per-feature overrides for personal accounts (Web-Admin → B2C → Grant access): each feature can be explicitly granted
// ("on") or revoked ("off") regardless of plan. If a feature is missing, the plan decides ("auto").
export const B2C_FEATURES = {
  t_nk: ['Software tools', 'Closing costs & cash to close', 'free'],
  t_price: ['Software tools', 'Price check', 'free'],
  t_special: ['Software tools', 'Extra principal payments', 'free'],
  t_offers: ['Software tools', 'Compare Loan Estimates', 'starter'],
  t_bank: ['Software tools', 'Prepare for the lender meeting', 'starter'],
  t_portfolio: ['Software tools', 'Portfolio metrics', 'pro'],
  t_fwd: ['Software tools', 'Refinance & rate lock', 'pro'],
  t_bk: ['Software tools', 'Operating expense reconciliation', 'pro'],
  druck: ['Output', 'Print, PDF and offer letters from the tools', 'starter'],
  pdf_clean: ['Output', 'PDFs and forms without watermark', 'starter'],
  objekte: ['Properties', 'Unlimited properties (otherwise 2)', 'starter'],
  wissen: ['Content', 'Full Learn center (all answers)', 'starter'],
  beispiele: ['Content', 'Full examples (sample Lender Package and sample PDFs)', 'starter'],
  rechner: ['Content', 'Calculators with your own numbers', 'starter'],
} as const;
export type B2CFeature = keyof typeof B2C_FEATURES;
export type FeatureMap = Partial<Record<B2CFeature, 'on' | 'off'>>;
export const FEATURE_KEYS = Object.keys(B2C_FEATURES) as B2CFeature[];

const RANK = { free: 0, starter: 1, pro: 2 } as const;
// Is a feature on for this account? Override beats plan.
export function featureOn(key: B2CFeature, tier: string, f?: FeatureMap | null): boolean {
  const v = f?.[key];
  if (v === 'on') return true;
  if (v === 'off') return false;
  return (RANK[tier as keyof typeof RANK] ?? 0) >= RANK[B2C_FEATURES[key][2]];
}
// Accept only valid keys/values (database data is not trusted).
export function cleanFeatures(x: unknown): FeatureMap {
  const out: FeatureMap = {};
  if (x && typeof x === 'object') for (const k of FEATURE_KEYS) { const v = (x as Record<string, unknown>)[k]; if (v === 'on' || v === 'off') out[k] = v; }
  return out;
}
