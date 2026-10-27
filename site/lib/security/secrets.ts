import { createHmac } from 'node:crypto';

// Eigene Schlüssel je Zweck, abgeleitet aus einem App-Geheimnis (APP_SECRET in Vercel) – unabhängig vom
// Supabase-Hauptschlüssel. So bleiben Abmeldelinks, Bild-Links, Geräte-Cookie usw. gültig, wenn der
// Supabase-Schlüssel einmal erneuert wird. Ältere Links (mit dem bisherigen Schlüssel signiert) werden weiter
// akzeptiert; neu signiert wird nur noch mit dem eigenen Schlüssel.
export type Purpose = 'newsletter' | 'mail-img' | 'own-device' | 'internal' | 'analytics' | 'ms-graph' | 'tax';
const ENV: Record<Purpose, string> = { newsletter: 'NEWSLETTER_SECRET', 'mail-img': 'MAIL_IMG_SECRET', 'own-device': 'OWN_DEVICE_SECRET', internal: 'INTERNAL_SECRET', analytics: 'ANALYTICS_SECRET', 'ms-graph': 'MS_GRAPH_SECRET', tax: 'TAX_SECRET' };
const svc = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Bisherige Schlüssel (nur noch zum Prüfen alter Links und Daten).
export function legacySecret(p: Purpose): string {
  switch (p) {
    case 'newsletter': return process.env.NEWSLETTER_SECRET || svc() || 'leaserun-newsletter';
    case 'mail-img': return process.env.MAIL_IMG_SECRET || process.env.CRON_SECRET || svc() || 'leaserun-mail-img';
    case 'own-device': return `leaserun-own:${svc()}`;
    case 'internal': return `leaserun-sec:${svc()}`;
    case 'analytics': return process.env.ANALYTICS_SECRET || svc() || 'leaserun';
    case 'ms-graph': return `ms-graph:${svc()}`;
    case 'tax': return `leaserun-tax:${svc()}`;
  }
}

export function secretFor(p: Purpose): string {
  const own = process.env[ENV[p]];
  if (own) return own;
  const master = process.env.APP_SECRET || '';
  if (master.length >= 32) return createHmac('sha256', master).update(`leaserun:${p}`).digest('hex');
  return legacySecret(p);
}

// Alle gültigen Schlüssel zum Prüfen: zuerst der aktuelle, dann der bisherige (falls verschieden).
export function verifySecrets(p: Purpose): string[] {
  const a = secretFor(p), b = legacySecret(p);
  return a === b ? [a] : [a, b];
}
