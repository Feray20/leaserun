import { createHash } from 'node:crypto';
import { panicLevel, panicState } from '@/lib/security/panic';

// Verifies the Supabase access token on the server and returns the signed-in user.
export type AuthUser = { id: string; email: string };

// Short cache (30 s) per token hash: saves a round trip to Supabase on back-to-back calls
// (dashboard loads documents, shares, billing). Rejected tokens are not cached.
const TTL_MS = 30_000;
const cache = new Map<string, { user: AuthUser; until: number }>();

function remember(key: string, user: AuthUser, now: number) {
  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
    if (cache.size > 2000) cache.clear();
  }
  cache.set(key, { user, until: now + TTL_MS });
}

// allowAal1: only for callers that ask for the second factor themselves (admin check) – returns the user before the code is entered.
export async function userFromRequest(req: Request, opts: { allowAal1?: boolean } = {}): Promise<AuthUser | null> {
  const user = await verifiedUser(req, Boolean(opts.allowAal1));
  if (!user) return null;
  // Emergency stop: only administrators stay signed in.
  // Level 1: non-admins read-only; level 2: non-admins rejected.
  const lvl = panicLevel(await panicState().catch(() => ({ active: false })));
  if (lvl) {
    const admins = (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(user.email) && (lvl === 2 || !['GET', 'HEAD'].includes(req.method.toUpperCase()))) return null;
  }
  return user;
}

async function verifiedUser(req: Request, allowAal1 = false): Promise<AuthUser | null> {
  const header = req.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ') || header.length < 20 || header.length > 4096) return null;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  const now = Date.now();
  const cacheKey = createHash('sha256').update(header).digest('hex') + (allowAal1 ? ':a1' : '');
  const hit = cache.get(cacheKey);
  if (hit && hit.until > now) return hit.user;

  let r: Response;
  try {
    r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: header },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return null;
  }
  if (!r.ok) {
    cache.delete(cacheKey);
    return null;
  }
  const u = (await r.json().catch(() => ({}))) as { id?: string; email?: string; factors?: { status?: string }[] };
  if (!u.id || !u.email) return null;
  // Two-factor protection: if the account has a verified second factor (app or SMS), the session only counts after
  // the code was entered (aal2). A password-only session (aal1) then gets no access.
  if (!allowAal1 && (u.factors || []).some((f) => f.status === 'verified') && tokenAalOf(header) !== 'aal2') return null;
  const user = { id: u.id, email: u.email.toLowerCase() };
  remember(cacheKey, user, now);
  return user;
}

function tokenAalOf(header: string): string | null {
  const part = header.replace(/^Bearer\s+/, '').split('.')[1];
  if (!part) return null;
  try { const p = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { aal?: string }; return typeof p.aal === 'string' ? p.aal : null; } catch { return null; }
}
