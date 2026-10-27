// Konfiguration der LeaseRun API v1. Alle Geheimnisse kommen ausschließlich aus Umgebungsvariablen (Vercel).
import { createHash } from 'node:crypto';

export const API_VERSION = '1.0.0';
export const API_ENGINE_VERSION = '1.0';

// Öffentliche Basisadresse: api.leaserun.com/v1 (Subdomain in Vercel eingerichtet, DNS über Vercel).
// Alternativ bleibt leaserun.com/api/v1 erreichbar. API_BASE_URL in Vercel überschreibt die Adresse.
export const apiBaseUrl = () => (process.env.API_BASE_URL || (process.env.VERCEL_ENV === 'production' ? 'https://api.leaserun.com/v1' : `${process.env.PUBLIC_SITE_URL || 'https://leaserun.com'}/api/v1`)).replace(/\/+$/, '');

// Pfeffer für die Schlüssel-Hashes: HMAC-SHA-256(pepper, secret). Ohne Pfeffer ist die API nicht betriebsbereit.
export function keyPepper(): string | null {
  const p = process.env.API_KEY_PEPPER || '';
  return p.length >= 32 ? p : null;
}

// 32-Byte-Schlüssel (hex oder base64) für die Verschlüsselung der Webhook-Geheimnisse (AES-256-GCM).
export function encryptionKey(): Buffer | null {
  const raw = (process.env.API_ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  // Längere Passphrase: deterministisch auf 32 Byte ableiten.
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
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel-Funktionsgrenze für Anfragekörper ≈ 4,5 MB
export const SIGNED_URL_SECONDS = 300;
