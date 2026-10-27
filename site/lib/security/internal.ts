import { createHash } from 'node:crypto';
// Schlüssel für interne Meldungen der Middleware an /api/sec/event (abgeleitet, nie im Klartext übertragen).
export const internalToken = () => createHash('sha256').update(`leaserun-sec:${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`).digest('hex').slice(0, 40);
