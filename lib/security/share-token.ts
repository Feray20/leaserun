import crypto from 'node:crypto';

export function generateShareToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function sha256Token(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isValidShareToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}
