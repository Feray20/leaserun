import { billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { adminConfigured } from '@/lib/supabase/admin';
import { effectiveTier, membershipFor } from '@/lib/b2b/core';

// Zahlender Kunde: gebuchter Tarif (B2C) oder Unternehmenskonto mit aktivem Tarif.
// Administratoren haben auf der Website keine Sonderrechte – ihre Rechte gelten nur im Web-Admin.
// Steuert u. a., ob Dokumente ohne Wasserzeichen ausgegeben werden (Gratis-Nutzung und Beispiele behalten es).
export async function paidAccess(user: { id: string; email: string }): Promise<{ paid: boolean; b2b: boolean; tier: string }> {
  let tier = 'free';
  let b2b = false;
  if (billingEnabled()) {
    try { tier = (await entitlementsFor(user.id, user.email)).tier || 'free'; } catch { tier = 'free'; }
  }
  if (adminConfigured()) {
    try { const m = await membershipFor(user.id); b2b = Boolean(m && effectiveTier(m.account)); } catch { b2b = false; }
  }
  return { paid: b2b || tier !== 'free', b2b, tier };
}
