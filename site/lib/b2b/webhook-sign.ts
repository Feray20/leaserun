import { createHmac, randomBytes } from 'node:crypto';
import { isPublicIp } from '@/lib/api/net';

// Reine Hilfsfunktionen für Webhooks (testbar, ohne Datenbank).
export const newWebhookSecret = () => 'whsec_' + randomBytes(24).toString('base64url');

export function signPayload(secret: string, ts: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

// Schutz vor Anfragen ins interne Netz: nur öffentliche Adressen (gemeinsame, vollständigere Liste aus lib/api/net,
// u. a. IPv4-gemappte IPv6-Adressen, NAT64, Dokumentations- und Benchmark-Netze).
export function isPrivateIp(ip: string): boolean {
  return !isPublicIp(ip);
}
