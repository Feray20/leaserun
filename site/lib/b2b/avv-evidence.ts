import { AVV_VERSION } from '@/lib/b2b/core';

// Nachweis für den digitalen Abschluss des AVV (Art. 28 DSGVO): wer, wann, welche Fassung, von wo.
// Die IP-Adresse wird gekürzt gespeichert (IPv4 letztes Oktett, IPv6 nach 3 Blöcken) – genug als Nachweis, datensparsam.
export function truncateIp(ip: string): string {
  const v = (ip || '').split(',')[0].trim();
  if (!v) return '';
  if (v.includes('.') && !v.includes(':')) return v.split('.').slice(0, 3).join('.') + '.0';
  return v.split(':').slice(0, 3).join(':') + '::';
}

export function avvEvidence(req: Request, who: { userId: string; email: string; name?: string | null; role?: string }) {
  return {
    at: new Date().toISOString(),
    version: AVV_VERSION,
    userId: who.userId,
    email: who.email,
    name: who.name || null,
    role: who.role || 'owner',
    ip: truncateIp(req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''),
    userAgent: (req.headers.get('user-agent') || '').slice(0, 200),
  };
}
