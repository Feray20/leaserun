import { NextResponse } from 'next/server';
import { STATES } from '@/lib/address';

// Approximate location for calculators (convenience only, no SEO): Vercel derives country, region and city from the
// request's IP address and passes them as headers. Here we only turn that into the US state slug (for closing costs and
// transfer tax, same keys as GREST/STATES in calc.mjs, e.g. 'new-york') and the city name for display. Nothing is stored or
// logged and no third-party service is called. Without data (outside the US, VPN, local dev) the API returns null and the
// calculators work as before.
export const dynamic = 'force-dynamic';

const slug = (name: string) => name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

export function GET(req: Request) {
  const h = req.headers;
  const country = (h.get('x-vercel-ip-country') || '').toUpperCase();
  const code = (h.get('x-vercel-ip-country-region') || '').toUpperCase().replace(/^US-/, '');
  let city: string | null = null;
  try { city = decodeURIComponent(h.get('x-vercel-ip-city') || '') || null; } catch { city = null; }
  // Letters, spaces, hyphens, apostrophes and periods only; limited length – the page also renders it as text.
  if (city && !/^[\p{L} .'-]{2,60}$/u.test(city)) city = null;
  const name = country === 'US' && /^[A-Z]{2}$/.test(code) && !['PR', 'GU', 'VI'].includes(code) ? STATES[code] : undefined;
  const land = name ? slug(name) : null;
  return NextResponse.json({ land, state: land ? code : null, city: land ? city : null }, { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } });
}
