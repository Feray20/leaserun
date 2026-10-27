import { createHash, createHmac, createPrivateKey, randomBytes, sign as edSign, timingSafeEqual } from 'node:crypto';
import { secretFor } from '@/lib/security/secrets';

// Express sign-in (Google, Apple, Microsoft) directly through our own domain (leaserun.com / partner.leaserun.com):
// the provider then shows "continue to leaserun.com" instead of the Supabase project URL. Flow:
// start (own page) → provider → return to /api/auth/sso/callback/<provider> → exchange code for ID token →
// sign in to Supabase with the ID token (grant_type=id_token) → session as before at /auth/callback or /business-portal.
// Active per provider only if its keys are set in Vercel – otherwise the existing Supabase sign-in keeps working.
export type Prov = 'google' | 'apple' | 'azure';
export const PROVS: Prov[] = ['google', 'apple', 'azure'];

const env = (k: string) => (process.env[k] || '').trim();
export function provReady(p: Prov): boolean {
  if (p === 'google') return Boolean(env('GOOGLE_OAUTH_CLIENT_ID') && env('GOOGLE_OAUTH_CLIENT_SECRET'));
  if (p === 'azure') return Boolean(env('AZURE_OAUTH_CLIENT_ID') && env('AZURE_OAUTH_CLIENT_SECRET'));
  return Boolean(env('APPLE_SERVICES_ID') && env('APPLE_TEAM_ID') && env('APPLE_KEY_ID') && env('APPLE_PRIVATE_KEY'));
}
export const directProviders = () => PROVS.filter(provReady);

const tenant = () => env('AZURE_OAUTH_TENANT') || 'common';
const AUTH: Record<Prov, () => string> = {
  google: () => 'https://accounts.google.com/o/oauth2/v2/auth',
  azure: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize`,
  apple: () => 'https://appleid.apple.com/auth/authorize',
};
const TOKEN: Record<Prov, () => string> = {
  google: () => 'https://oauth2.googleapis.com/token',
  azure: () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`,
  apple: () => 'https://appleid.apple.com/auth/token',
};
const clientId = (p: Prov) => (p === 'google' ? env('GOOGLE_OAUTH_CLIENT_ID') : p === 'azure' ? env('AZURE_OAUTH_CLIENT_ID') : env('APPLE_SERVICES_ID'));

// Allowed return paths after sign-in (own pages only, no foreign URLs).
export const BACKS = ['/auth/callback', '/business-portal'] as const;
export const callbackUrl = (origin: string, p: Prov) => `${origin}/api/auth/sso/callback/${p}`;

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const key = () => secretFor('internal');
export function seal(o: Record<string, unknown>): string {
  const body = b64u(JSON.stringify(o));
  return `${body}.${createHmac('sha256', key()).update(`sso:${body}`).digest('base64url')}`;
}
export function unseal<T>(v: string | null | undefined): T | null {
  const [body, mac] = String(v || '').split('.');
  if (!body || !mac) return null;
  const want = createHmac('sha256', key()).update(`sso:${body}`).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T; } catch { return null; }
}

export type Flow = { p: Prov; st: string; n: string; back: string; t: number };
// New sign-in attempt: state (against forgery) and nonce (against ID token reuse).
export function newFlow(p: Prov, back: string): Flow {
  return { p, st: randomBytes(16).toString('base64url'), n: randomBytes(16).toString('base64url'), back, t: Date.now() };
}
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');

export function authorizeUrl(f: Flow, origin: string): string {
  const q = new URLSearchParams({ client_id: clientId(f.p), redirect_uri: callbackUrl(origin, f.p), response_type: 'code', state: f.st, nonce: sha256hex(f.n) });
  if (f.p === 'google') { q.set('scope', 'openid email profile'); q.set('prompt', 'select_account'); }
  if (f.p === 'azure') { q.set('scope', 'openid email profile'); q.set('response_mode', 'query'); q.set('prompt', 'select_account'); }
  // Apple: name/email are only returned via form POST.
  if (f.p === 'apple') { q.set('scope', 'name email'); q.set('response_mode', 'form_post'); }
  return `${AUTH[f.p]()}?${q.toString()}`;
}

// Apple requires as "client_secret" a short-lived token signed with our own key (.p8) (ES256).
function appleSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'ES256', kid: env('APPLE_KEY_ID') }));
  const body = b64u(JSON.stringify({ iss: env('APPLE_TEAM_ID'), iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: env('APPLE_SERVICES_ID') }));
  const pem = env('APPLE_PRIVATE_KEY').replace(/\\n/g, '\n');
  const sig = edSign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(pem), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${b64u(sig)}`;
}
const secretOf = (p: Prov) => (p === 'google' ? env('GOOGLE_OAUTH_CLIENT_SECRET') : p === 'azure' ? env('AZURE_OAUTH_CLIENT_SECRET') : appleSecret());

// Exchange the code for the ID token with the provider.
export async function codeToIdToken(p: Prov, code: string, origin: string): Promise<string> {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(origin, p), client_id: clientId(p), client_secret: secretOf(p) });
  if (p === 'azure') body.set('scope', 'openid email profile');
  const r = await fetch(TOKEN[p](), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body, signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!r.ok || !j.id_token) throw new Error(j.error_description || j.error || `Anbieter antwortet ${r.status}`);
  return j.id_token;
}

export type Session = { access_token: string; refresh_token: string; expires_in: number; token_type: string };
// Sign in to Supabase with the ID token (same accounts as before – Supabase matches by email/identity).
export async function supabaseSession(p: Prov, idToken: string, rawNonce: string): Promise<Session> {
  const url = env('SUPABASE_URL'), apikey = env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');
  const r = await fetch(`${url}/auth/v1/token?grant_type=id_token`, { method: 'POST', headers: { apikey, 'content-type': 'application/json' }, body: JSON.stringify({ provider: p, id_token: idToken, nonce: rawNonce }), signal: AbortSignal.timeout(10_000) });
  const j = (await r.json().catch(() => ({}))) as Partial<Session> & { msg?: string; error_description?: string; message?: string };
  if (!r.ok || !j.access_token || !j.refresh_token) throw new Error(j.error_description || j.msg || j.message || `Anmeldung abgelehnt (${r.status})`);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_in: Number(j.expires_in) || 3600, token_type: j.token_type || 'bearer' };
}
