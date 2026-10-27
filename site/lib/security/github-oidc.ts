import { createPublicKey, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';

// Anmeldung automatischer Läufe ohne gemeinsames Passwort: GitHub signiert für jeden Lauf einen Kurzzeit-Ausweis (OIDC).
// Gültig nur für das Repository Feray20/LeaseRun und den jeweiligen Zweck (Audience). Alternativ ein festes Geheimnis.
const ISS = 'https://token.actions.githubusercontent.com';
const REPO = (process.env.SITECHECK_REPO || 'Feray20/LeaseRun').toLowerCase();
let jwks: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null;
const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export async function githubTokenOk(tok: string, aud: string): Promise<{ ok: boolean; why?: string }> {
  const [h, p, sig] = tok.split('.');
  if (!h || !p || !sig) return { ok: false };
  try {
    const head = JSON.parse(b64(h).toString('utf8')) as { alg?: string; kid?: string };
    const claim = JSON.parse(b64(p).toString('utf8')) as { iss?: string; aud?: string | string[]; repository?: string; exp?: number; nbf?: number };
    if (head.alg !== 'RS256' || claim.iss !== ISS) return { ok: false };
    if (!(Array.isArray(claim.aud) ? claim.aud.includes(aud) : claim.aud === aud)) return { ok: false, why: 'Zweck' };
    if (String(claim.repository || '').toLowerCase() !== REPO) return { ok: false, why: `Repository ${claim.repository}` };
    const now = Date.now() / 1000;
    if (!claim.exp || claim.exp < now || (claim.nbf && claim.nbf > now + 60)) return { ok: false, why: 'Ausweis abgelaufen' };
    if (!jwks || Date.now() - jwks.at > 3_600_000 || !jwks.keys.some((k) => k.kid === head.kid)) {
      const r = await fetch(`${ISS}/.well-known/jwks`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { ok: false, why: 'Schlüssel von GitHub nicht ladbar' };
      jwks = { at: Date.now(), keys: ((await r.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys || [] };
    }
    const jwk = jwks.keys.find((k) => k.kid === head.kid);
    if (!jwk) return { ok: false, why: 'Schlüssel' };
    return { ok: verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), b64(sig)), why: 'Signatur' };
  } catch { return { ok: false }; }
}
export function secretOk(got: string, want: string | undefined): boolean {
  const w = want || '';
  return w.length >= 24 && got.length === w.length && timingSafeEqual(Buffer.from(got), Buffer.from(w));
}
// Bearer-Kopfzeile prüfen: festes Geheimnis (z. B. CRON_SECRET) oder GitHub-Ausweis für den Zweck.
export async function cronAuthOk(req: Request, aud: string, secrets: (string | undefined)[]): Promise<{ ok: boolean; why?: string }> {
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!got) return { ok: false };
  if (secrets.some((s) => secretOk(got, s))) return { ok: true };
  if (got.split('.').length === 3) return githubTokenOk(got, aud);
  return { ok: false };
}
