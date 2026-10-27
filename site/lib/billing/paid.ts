import { accessGrant, billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { adminConfigured } from '@/lib/supabase/admin';
import { effectiveTier, membershipFor } from '@/lib/b2b/core';
import { cleanFeatures, featureOn, type FeatureMap } from '@/lib/billing/features';

// Zahlender Kunde: gebuchter Tarif (B2C) oder Unternehmenskonto mit aktivem Tarif.
// Administratoren haben auf der Website keine Sonderrechte – ihre Rechte gelten nur im Web-Admin.
// Steuert u. a., ob Dokumente ohne Wasserzeichen ausgegeben werden (Gratis-Nutzung und Beispiele behalten es).
// clean: Dokumente ohne Wasserzeichen (Tarif oder Einzelfreigabe „PDFs ohne Wasserzeichen“); features: Einzelfreigaben aus dem Web-Admin.
export async function paidAccess(user: { id: string; email: string }): Promise<{ paid: boolean; b2b: boolean; tier: string; clean: boolean; features: FeatureMap; areas: { wissen: boolean; beispiele: boolean; rechner: boolean } }> {
  let tier = 'free';
  let b2b = false;
  let features: FeatureMap = {};
  // Stripe-Käufe (nur bei aktiver Abrechnung) und manuelle Freischaltung durch den Web-Admin.
  if (billingEnabled()) {
    try { const e = await entitlementsFor(user.id, user.email); tier = e.tier || 'free'; features = cleanFeatures(e.grant?.features); } catch { tier = 'free'; }
  } else {
    const g = await accessGrant(user.id);
    tier = g?.tier || 'free'; features = cleanFeatures(g?.features);
  }
  if (adminConfigured()) {
    try { const m = await membershipFor(user.id); b2b = Boolean(m && effectiveTier(m.account)); } catch { b2b = false; }
  }
  // Inhalte der Website (Wissen, Beispiele, Rechner): mit Tarif/Unternehmenskonto oder per Einzelfreigabe im Web-Admin.
  const area = (k: 'wissen' | 'beispiele' | 'rechner') => b2b || featureOn(k, tier, features);
  return { paid: b2b || tier !== 'free', b2b, tier, clean: b2b || featureOn('pdf_clean', tier, features), features, areas: { wissen: area('wissen'), beispiele: area('beispiele'), rechner: area('rechner') } };
}
