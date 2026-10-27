// AES-256-GCM for secrets LeaseRun needs to read back (webhook signing keys).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { encryptionKey } from '@/lib/api/config';

export function encryptSecret(plain: string, key = encryptionKey()): string {
  if (!key) throw new Error('api_encryption_key_missing');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

export function decryptSecret(blob: string, key = encryptionKey()): string {
  if (!key) throw new Error('api_encryption_key_missing');
  const [v, iv, tag, data] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('bad_secret_blob');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}

export const newWebhookSecret = () => 'whsec_' + randomBytes(32).toString('base64url');

// Signatur: HMAC-SHA-256(secret, "<timestamp>.<raw_body>") als Hex, Header-Wert "v1=<hex>".
export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export const sha256Hex = (data: string | Buffer | Uint8Array) => createHash('sha256').update(data).digest('hex');

// Checksum over the canonicalized request body (idempotency).
export function canonicalHash(method: string, route: string, body: unknown): string {
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  return sha256Hex(`${method} ${route} ${JSON.stringify(canon(body ?? null))}`);
}
