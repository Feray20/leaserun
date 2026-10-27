// Zuordnungsregeln Kauf → Creator (reine Funktionen, ohne Datenbank).
//
//  1. Eingelöster Creator-Vorteilscode (aktiv, im Gültigkeitszeitraum) hat Vorrang – Quelle „code“.
//  2. Sonst die Zuordnung des Kundenkontos aus der Registrierung über den Creator-Link – Quelle „link“,
//     nur innerhalb des Zuordnungsfensters (Standard 90 Tage ab Registrierung).
//  3. Nie: Eigenkäufe des Creators, nicht aktive Creator, Testkäufe, Unternehmenskäufe (B2B), unbezahlte Sitzungen.

export type CreatorRef = { id: string; user_id: string; status: string; ref_code: string | null };
export type BenefitRef = { id: string; creator_id: string; code: string; active: boolean; starts_at: string; ends_at: string | null; campaign_slug: string | null };
export type AttributionRef = { creator_id: string; campaign_slug: string | null; created_at: string };

export type CheckoutFacts = {
  paid: boolean;
  test: boolean;
  b2b: boolean;
  userId: string | null;
  promoCodes: string[];       // eingelöste Aktionscodes (Klartext, wie in Stripe angelegt)
  occurredAt: Date;
};

export type Decision =
  | { attribute: true; creatorId: string; source: 'code' | 'link'; benefitId: string | null; campaignSlug: string | null }
  | { attribute: false; reason: 'unpaid' | 'test' | 'b2b' | 'no_user' | 'no_match' | 'self' | 'inactive' | 'expired' };

export const DEFAULT_WINDOW_DAYS = 90;

export function benefitValidAt(b: BenefitRef, at: Date): boolean {
  if (!b.active) return false;
  if (new Date(b.starts_at).getTime() > at.getTime()) return false;
  if (b.ends_at && new Date(b.ends_at).getTime() <= at.getTime()) return false;
  return true;
}

export function decide(
  f: CheckoutFacts,
  ctx: { benefits: BenefitRef[]; attribution: AttributionRef | null; creators: Map<string, CreatorRef>; windowDays?: number },
): Decision {
  if (!f.paid) return { attribute: false, reason: 'unpaid' };
  if (f.test) return { attribute: false, reason: 'test' };
  if (f.b2b) return { attribute: false, reason: 'b2b' };
  if (!f.userId) return { attribute: false, reason: 'no_user' };

  // 1) Vorteilscode
  const codes = new Set(f.promoCodes.map((c) => c.trim().toUpperCase()));
  const benefit = ctx.benefits.find((b) => codes.has(b.code.toUpperCase()) && benefitValidAt(b, f.occurredAt));
  if (benefit) {
    const c = ctx.creators.get(benefit.creator_id);
    if (!c || c.status !== 'ACTIVE') return { attribute: false, reason: 'inactive' };
    if (c.user_id === f.userId) return { attribute: false, reason: 'self' };
    return { attribute: true, creatorId: c.id, source: 'code', benefitId: benefit.id, campaignSlug: benefit.campaign_slug };
  }

  // 2) Link-Zuordnung aus der Registrierung
  const a = ctx.attribution;
  if (!a) return { attribute: false, reason: 'no_match' };
  const c = ctx.creators.get(a.creator_id);
  if (!c || c.status !== 'ACTIVE') return { attribute: false, reason: 'inactive' };
  if (c.user_id === f.userId) return { attribute: false, reason: 'self' };
  const windowMs = Math.max(1, ctx.windowDays ?? DEFAULT_WINDOW_DAYS) * 86_400_000;
  if (f.occurredAt.getTime() - new Date(a.created_at).getTime() > windowMs) return { attribute: false, reason: 'expired' };
  return { attribute: true, creatorId: c.id, source: 'link', benefitId: null, campaignSlug: a.campaign_slug };
}

// Netto-Umsatz einer Checkout-Sitzung: Endbetrag nach Rabatt abzüglich Steuer, nie negativ.
export function netCents(amountTotal: number | null | undefined, amountTax: number | null | undefined): number {
  const t = Number(amountTotal ?? 0), tax = Number(amountTax ?? 0);
  if (!Number.isFinite(t) || !Number.isFinite(tax)) return 0;
  return Math.max(0, Math.round(t - tax));
}

// Eingehende Referenz (aus ?ref=) normalisieren; Creator-Codes und Partner-Slugs teilen sich das Format.
export const REF_RE = /^[a-z0-9-]{3,40}$/;
export const CAMPAIGN_RE = /^[a-z0-9-]{3,40}$/;
export const normRef = (v: unknown): string | null => (typeof v === 'string' && REF_RE.test(v) ? v : null);
export const normCampaign = (v: unknown): string | null => (typeof v === 'string' && CAMPAIGN_RE.test(v.toLowerCase()) ? v.toLowerCase() : null);

// Persönlicher Link: keine personenbezogenen Daten im Parameter, nur der zufällige Code (+ optional Kampagne).
export function creatorLink(origin: string, refCode: string, campaign?: { slug: string; target_path: string } | null): string {
  const u = new URL(campaign?.target_path || '/', origin);
  u.searchParams.set('ref', refCode);
  if (campaign) u.searchParams.set('utm_campaign', campaign.slug);
  return u.toString();
}
