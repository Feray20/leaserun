import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Echte Google-Bewertungen: Link zum Bewertungsformular und – wenn GOOGLE_PLACES_API_KEY und Place-ID gesetzt –
// Sternedurchschnitt und Anzahl live aus der Google Places API. Keine eigenen oder ausgewählten Bewertungen.
export const REVIEW_KEY = 'google_reviews';
export type ReviewCfg = { reviewUrl: string | null; placeId: string | null };
export type ReviewInfo = ReviewCfg & { rating: number | null; count: number | null; mapsUrl: string | null; at: string | null };

let cache: { until: number; v: ReviewInfo } | null = null;

export async function reviewCfg(): Promise<ReviewCfg> {
  if (!adminConfigured()) return { reviewUrl: null, placeId: null };
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', REVIEW_KEY).maybeSingle();
  const v = (data?.value || {}) as Partial<ReviewCfg>;
  return { reviewUrl: v.reviewUrl || null, placeId: v.placeId || null };
}

export function clearReviewCache() { cache = null; }

export async function reviewInfo(): Promise<ReviewInfo> {
  if (cache && cache.until > Date.now()) return cache.v;
  const cfg = await reviewCfg();
  let rating: number | null = null, count: number | null = null, mapsUrl: string | null = null, at: string | null = null;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (key && cfg.placeId) {
    try {
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(cfg.placeId)}`, {
        headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'rating,userRatingCount,googleMapsUri' }, signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const j = (await r.json()) as { rating?: number; userRatingCount?: number; googleMapsUri?: string };
        rating = typeof j.rating === 'number' ? j.rating : null; count = typeof j.userRatingCount === 'number' ? j.userRatingCount : null;
        mapsUrl = j.googleMapsUri || null; at = new Date().toISOString();
      }
    } catch { /* Google nicht erreichbar – nur Link anzeigen */ }
  }
  const v = { ...cfg, rating, count, mapsUrl, at };
  cache = { until: Date.now() + 6 * 3600_000, v };
  return v;
}
