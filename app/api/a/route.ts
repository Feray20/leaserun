import { z } from 'zod';
import { isBot, track } from '@/lib/analytics/track';
import { allowRequest } from '@/lib/security/rate-limit';
import { anonymizedIpHash } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Reichweitenmessung (cookielos, siehe lib/analytics/track.ts). Antwortet immer 204.
const EVENTS = ['pv', 'offer_view', 'checkout_open', 'checkout_start', 'register', 'login', 'b2b_login', 'b2b_request', 'purchase_return'] as const;
const s = (n: number) => z.string().max(n).optional().nullable();
const Body = z.object({ ev: z.enum(EVENTS), seg: z.enum(['b2c', 'b2b']), path: s(400), ref: s(400), src: s(120), med: s(80), camp: s(120), plan: s(40) });
const none = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });

const host = (u?: string | null) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : null; } catch { return null; } };
const clean = (t?: string | null) => (t ? t.toLowerCase().replace(/[^a-z0-9._ -]/g, '').trim() || null : null);
const REF_NAMES: [RegExp, string][] = [[/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/duckduckgo/, 'DuckDuckGo'], [/(^|\.)ecosia\.org$/, 'Ecosia'], [/(^|\.)(facebook|fb)\.com$|^l\.facebook/, 'Facebook'], [/instagram/, 'Instagram'], [/linkedin|lnkd\.in/, 'LinkedIn'], [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X / Twitter'], [/tiktok/, 'TikTok'], [/youtube|youtu\.be/, 'YouTube'], [/whatsapp/, 'WhatsApp'], [/chatgpt|openai/, 'ChatGPT'], [/perplexity/, 'Perplexity'], [/claude\.ai/, 'Claude']];

export async function POST(req: Request) {
  if (isBot(req)) return none();
  if (req.headers.get('sec-gpc') === '1' || req.headers.get('dnt') === '1') return none();
  if (!allowRequest(`a:${anonymizedIpHash(req) ?? 'x'}`, 120, 60_000)) return none();
  const raw = await req.text().catch(() => '');
  if (raw.length > 3000) return none();
  let j: unknown = null; try { j = JSON.parse(raw); } catch { return none(); }
  const p = Body.safeParse(j);
  if (!p.success) return none();
  const b = p.data;
  const path = (b.path || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  if (/^\/(intern|api)\b/.test(path)) return none();
  const h = host(b.ref);
  const self = /(^|\.)immoadv\.de$/.test(h || '') || h === host(req.url);
  const ref = h && !self ? (REF_NAMES.find(([r]) => r.test(h))?.[1] || h) : null;
  await track({ seg: b.seg, ev: b.ev, path: path.replace(/\/[0-9a-f-]{20,}/gi, '/…'), ref, src: clean(b.src), med: clean(b.med), camp: clean(b.camp), plan: b.plan || null }, req);
  return none();
}
