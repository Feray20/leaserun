import { accessGrant, billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { adminConfigured } from '@/lib/supabase/admin';
import { effectiveTier, membershipFor } from '@/lib/b2b/core';
import { cleanFeatures, featureOn, type FeatureMap } from '@/lib/billing/features';

// Paying customer: purchased plan (B2C) or business account with an active plan.
// Administrators have no special rights on the website – their rights only apply in the Web-Admin.
// Controls, among other things, whether documents are delivered without watermark (free use and samples keep it).
// clean: documents without watermark (plan or override "PDFs without watermark"); features: overrides from the Web-Admin.
export async function paidAccess(user: { id: string; email: string }): Promise<{ paid: boolean; b2b: boolean; tier: string; clean: boolean; features: FeatureMap; areas: { wissen: boolean; beispiele: boolean; rechner: boolean } }> {
  let tier = 'free';
  let b2b = false;
  let features: FeatureMap = {};
  // Stripe purchases (only with billing enabled) and manual grants from the Web-Admin.
  if (billingEnabled()) {
    try { const e = await entitlementsFor(user.id, user.email); tier = e.tier || 'free'; features = cleanFeatures(e.grant?.features); } catch { tier = 'free'; }
  } else {
    const g = await accessGrant(user.id);
    tier = g?.tier || 'free'; features = cleanFeatures(g?.features);
  }
  if (adminConfigured()) {
    try { const m = await membershipFor(user.id); b2b = Boolean(m && effectiveTier(m.account)); } catch { b2b = false; }
  }
  // Website content (Learn, examples, calculators): with a plan/business account or by override in the Web-Admin.
  const area = (k: 'wissen' | 'beispiele' | 'rechner') => b2b || featureOn(k, tier, features);
  return { paid: b2b || tier !== 'free', b2b, tier, clean: b2b || featureOn('pdf_clean', tier, features), features, areas: { wissen: area('wissen'), beispiele: area('beispiele'), rechner: area('rechner') } };
}
