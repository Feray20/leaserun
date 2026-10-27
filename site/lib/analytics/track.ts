import { createHash, createHmac } from 'node:crypto';
import { secretFor } from '@/lib/security/secrets';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';

// Reichweitenmessung ohne Cookies und ohne Speicherung von IP-Adressen (ähnlich Plausible/Matomo „cookieless“):
// Besucher-Kennung = Hash aus täglich wechselndem Geheimwert + gekürzter IP + Browserkennung. Sie ist nur innerhalb
// eines Tages gleich und lässt sich nicht auf eine Person zurückführen; der Tageswert wird nirgends gespeichert.
// Ort: Land, Bundesland und Stadt, wie sie der Hoster aus der IP-Adresse ableitet (ungefähr); die IP selbst wird nicht gespeichert.
export type Seg = 'b2c' | 'b2b';
export type Ev = { seg: Seg; ev: string; path?: string | null; ref?: string | null; src?: string | null; med?: string | null; camp?: string | null; plan?: string | null };

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|httpclient|vercel/i;

function daySecret(): string {
  const base = secretFor('analytics');
  const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  return createHmac('sha256', base).update('day:' + day).digest('hex');
}

export function visitorOf(req: Request): string | null {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const ua = req.headers.get('user-agent') || '';
  if (!ua) return null;
  const short = ip.includes(':') ? ip.split(':').slice(0, 4).join(':') : ip.split('.').slice(0, 3).join('.');
  return createHash('sha256').update(daySecret() + '|' + short + '|' + ua).digest('hex').slice(0, 16);
}

export function isBot(req: Request): boolean {
  return BOTS.test(req.headers.get('user-agent') || '');
}

export function deviceInfo(ua: string) {
  const device = /iPad|Tablet|(Android(?!.*Mobile))/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'mobile' : 'desktop';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Chrome|CriOS/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Sonstige';
  const os = /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Sonstige';
  return { device, browser, os };
}

// Ereignis speichern. req optional (serverseitige Ereignisse wie „purchase“ haben keine Besucher-Kennung).
export async function track(e: Ev, req?: Request): Promise<void> {
  if (!adminConfigured()) return;
  try {
    const ua = req?.headers.get('user-agent') || '';
    const country = req?.headers.get('x-vercel-ip-country') || null;
    const region = (req?.headers.get('x-vercel-ip-country-region') || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 10) || null;
    let city: string | null = null;
    try { city = decodeURIComponent(req?.headers.get('x-vercel-ip-city') || '').replace(/[<>"]/g, '').slice(0, 80) || null; } catch { city = null; }
    const di = req ? deviceInfo(ua) : { device: null, browser: null, os: null };
    await supabaseAdmin().from('lr_analytics').insert({
      seg: e.seg, ev: e.ev, visitor: req ? visitorOf(req) : null,
      path: e.path?.slice(0, 160) || null, ref: e.ref?.slice(0, 80) || null, src: e.src?.slice(0, 60) || null, med: e.med?.slice(0, 40) || null, camp: e.camp?.slice(0, 60) || null,
      device: di.device, browser: di.browser, os: di.os, country: country && /^[A-Z]{2}$/.test(country) ? country : null, region, city, plan: e.plan?.slice(0, 40) || null,
    });
  } catch { /* Messung darf nie stören */ }
}
