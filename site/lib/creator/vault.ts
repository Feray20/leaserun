import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

// Feldverschlüsselung für Zahlungsdaten (AES-256-GCM).
//   * Schlüssel nur in der Server-Umgebung: CREATOR_PII_KEY = "v<n>:<32 Byte Base64>"
//     Ältere Schlüssel für die Entschlüsselung nach einer Rotation: CREATOR_PII_KEY_OLD = "v1:…,v2:…"
//   * Das Chiffrat ist an den Creator gebunden (Associated Data = creator_id): Ein in der Datenbank
//     vertauschtes Chiffrat lässt sich für einen anderen Creator nicht entschlüsseln.
//   * Fingerabdruck (HMAC-SHA256 mit abgeleitetem Schlüssel) erkennt doppelt verwendete Konten,
//     ohne die IBAN im Klartext zu speichern oder zu vergleichen.
// Format: v<n>:<iv b64>:<tag b64>:<ciphertext b64>

export type Key = { version: number; key: Buffer };
export type Keyring = { current: Key; all: Map<number, Buffer> };

function parseKey(spec: string): Key {
  const m = /^v([0-9]{1,4}):([A-Za-z0-9+/=]+)$/.exec(spec.trim());
  if (!m) throw new Error('creator_pii_key_invalid');
  const key = Buffer.from(m[2], 'base64');
  if (key.length !== 32) throw new Error('creator_pii_key_invalid');
  return { version: Number(m[1]), key };
}

export function keyringFrom(current: string | undefined, old?: string | undefined): Keyring {
  if (!current) throw new Error('creator_pii_key_missing');
  const cur = parseKey(current);
  const all = new Map<number, Buffer>([[cur.version, cur.key]]);
  for (const part of (old || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const k = parseKey(part);
    if (!all.has(k.version)) all.set(k.version, k.key);
  }
  return { current: cur, all };
}

let cached: Keyring | null = null;
export function envKeyring(): Keyring {
  if (!cached) cached = keyringFrom(process.env.CREATOR_PII_KEY, process.env.CREATOR_PII_KEY_OLD);
  return cached;
}
export const vaultConfigured = () => {
  try { envKeyring(); return true; } catch { return false; }
};

const aad = (creatorId: string) => Buffer.from(`leaserun:creator-payout:${creatorId}`, 'utf8');

export function seal(plain: string, creatorId: string, ring: Keyring = envKeyring()): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', ring.current.key, iv);
  c.setAAD(aad(creatorId));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v${ring.current.version}:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function open(sealed: string, creatorId: string, ring: Keyring = envKeyring()): string {
  const m = /^v([0-9]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+):([A-Za-z0-9+/=]+)$/.exec(sealed);
  if (!m) throw new Error('vault_format');
  const key = ring.all.get(Number(m[1]));
  if (!key) throw new Error('vault_key_unknown');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(m[2], 'base64'));
  d.setAAD(aad(creatorId));
  d.setAuthTag(Buffer.from(m[3], 'base64'));
  return Buffer.concat([d.update(Buffer.from(m[4], 'base64')), d.final()]).toString('utf8');
}

export function fingerprint(normalizedIban: string, ring: Keyring = envKeyring()): string {
  const sub = Buffer.from(hkdfSync('sha256', ring.current.key, Buffer.alloc(0), 'leaserun:iban-fingerprint', 32));
  return createHmac('sha256', sub).update(normalizedIban, 'utf8').digest('hex');
}
