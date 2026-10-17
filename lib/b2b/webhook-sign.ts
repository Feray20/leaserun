import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

// Reine Hilfsfunktionen für Webhooks (testbar, ohne Datenbank).
export const newWebhookSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

export function signPayload(secret: string, ts: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

// Schutz vor Anfragen ins interne Netz: nur https, nur öffentliche Adressen.
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}

