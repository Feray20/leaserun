import { createHmac, timingSafeEqual } from 'node:crypto';

// Short-lived download token for a prospect's financing summary (only for whoever submitted the inquiry).
const secret = () => process.env.LEAD_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TTL = 2 * 60 * 60 * 1000;

export function leadToken(id: string, now = Date.now()): string {
  const exp = now + TTL;
  const sig = createHmac('sha256', `lead-pdf:${secret()}`).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
  return `${exp}.${sig}`;
}

export function checkLeadToken(id: string, token: string, now = Date.now()): boolean {
  if (!secret()) return false;
  const [expS, sig] = token.split('.');
  const exp = Number(expS);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  const want = createHmac('sha256', `lead-pdf:${secret()}`).update(`${id}.${exp}`).digest('base64url').slice(0, 32);
  return want.length === sig.length && timingSafeEqual(Buffer.from(want), Buffer.from(sig));
}
