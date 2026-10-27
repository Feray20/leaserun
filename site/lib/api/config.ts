// Configuration of the LeaseRun API v1. All secrets come exclusively from environment variables (Vercel).
import { createHash } from 'node:crypto';

export const API_VERSION = '1.0.0';
export const API_ENGINE_VERSION = '1.0';

// Public base URL: api.leaserun.com/v1 (subdomain set up in Vercel, DNS via Vercel).
// leaserun.com/api/v1 stays reachable as an alternative. API_BASE_URL in Vercel overrides the address.
export const apiBaseUrl = () => (process.env.API_BASE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://api.leaserun.com/v1' : `${process.env.PUBLIC_SITE_URL || 'https://leaserun.com'}/api/v1`)).replace(/\/+$/, '');

// Pepper for key hashes: HMAC-SHA-256(pepper, secret). Without a pepper the API is not operational.
export function keyPepper(): string | null {
  const p = process.env.API_KEY_PEPPER || '';
  return p.length >= 32 ? p : null;
}

// 32-byte key (hex or base64) for encrypting webhook secrets (AES-256-GCM).
export function encryptionKey(): Buffer | null {
  const raw = (process.env.API_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  // Longer passphrase: derive 32 bytes deterministically.
  return raw.length >= 32 ? createHash('sha256').update(`leaserun-api:${raw}`).digest() : null;
}

export type ConfigIssue = 'API_KEY_PEPPER' | 'API_ENCRYPTION_KEY' | 'SUPABASE';
export function configIssues(): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) out.push('SUPABASE');
  if (!keyPepper()) out.push('API_KEY_PEPPER');
  if (!encryptionKey()) out.push('API_ENCRYPTION_KEY');
  return out;
}

export const API_BUCKET = 'api-private';
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel function limit for request bodies ≈ 4.5 MB
export const SIGNED_URL_SECONDS = 300;
