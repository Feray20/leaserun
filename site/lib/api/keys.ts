// API keys: format, generation, hash (HMAC-SHA-256 with pepper) and status check.
// Format: <test|live>_<8-character prefix>_<43-character secret>. Only prefix and hash are stored.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { keyPepper } from '@/lib/api/config';

export type Env = 'test' | 'live';
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function randomAlnum(n: number): string {
  const b = randomBytes(n * 2);
  let s = '';
  for (let i = 0; i < b.length && s.length < n; i++) if (b[i] < 248) s += ALNUM[b[i] % ALNUM.length];
  while (s.length < n) s += ALNUM[randomBytes(1)[0] % ALNUM.length];
  return s;
}

export function hashKey(secret: string, pepper = keyPepper()): string {
  if (!pepper) throw new Error('api_key_pepper_missing');
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex');
}

export function generateKey(env: Env, pepper = keyPepper()): { secret: string; prefix: string; hash: string } {
  const prefix = `${env}_${randomAlnum(8)}`;
  const secret = `${prefix}_${randomBytes(32).toString('base64url')}`;
  return { secret, prefix, hash: hashKey(secret, pepper) };
}

const KEY_RE = /^(test|live)_([A-Za-z0-9]{8})_([A-Za-z0-9_-]{43})$/;
export function parseKey(secret: string): { env: Env; prefix: string } | null {
  const m = KEY_RE.exec(secret);
  return m ? { env: m[1] as Env, prefix: `${m[1]}_${m[2]}` } : null;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(\S+)$/i.exec(h.trim());
  return m ? m[1] : null;
}

export const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Display: prefix only, never the secret.
export const maskKey = (prefix: string) => `${prefix}_********`;

export type KeyRow = {
  id: string; tenant_id: string; environment: Env; name: string; key_prefix: string; key_hash: string; scopes: string[]; allowed_ips: string[];
  metadata: Record<string, unknown>; created_by: string; created_at: string; expires_at: string | null; disabled_at: string | null;
  revoked_at: string | null; revoked_reason: string | null; rotated_from: string | null; last_used_at: string | null;
};

export type KeyState = 'active' | 'revoked' | 'expired' | 'disabled';
export function keyState(k: Pick<KeyRow, 'revoked_at' | 'expires_at' | 'disabled_at'>, now = Date.now()): KeyState {
  if (k.revoked_at) return 'revoked';
  if (k.expires_at && new Date(k.expires_at).getTime() <= now) return 'expired';
  if (k.disabled_at) return 'disabled';
  return 'active';
}

export function publicKey(k: KeyRow) {
  return {
    id: k.id, object: 'api_key', name: k.name, environment: k.environment, prefix: k.key_prefix, masked: maskKey(k.key_prefix),
    scopes: k.scopes, allowed_ips: k.allowed_ips, status: keyState(k), created_by: k.created_by, created_at: k.created_at,
    expires_at: k.expires_at, disabled_at: k.disabled_at, revoked_at: k.revoked_at, rotated_from: k.rotated_from, last_used_at: k.last_used_at,
  };
}
