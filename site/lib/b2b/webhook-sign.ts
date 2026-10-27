import { createHmac, randomBytes } from 'node:crypto';
import { isPublicIp } from '@/lib/api/net';

// Pure webhook helpers (testable, no database).
export const newWebhookSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

export function signPayload(secret: string, ts: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

// Protection against requests into internal networks: public addresses only (shared, more complete list from lib/api/net,
// including IPv4-mapped IPv6 addresses, NAT64, documentation and benchmark ranges).
export function isPrivateIp(ip: string): boolean {
  return !isPublicIp(ip);
}
