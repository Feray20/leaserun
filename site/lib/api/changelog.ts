// API-Changelog (auch unter docs/api/CHANGELOG.md). Neue Einträge oben; Breaking Changes nur mit neuer Hauptversion (/api/v2).
export const CHANGELOG = [
  {
    version: '1.0.0',
    date: '2026-10-27',
    status: 'Frühzugang',
    changes: [
      'Erste Version der LeaseRun API: Fälle, Vorprüfung, Unterlagen, Berichte, Webhooks, Nutzung, API-Schlüssel.',
      'Authentifizierung per Bearer-Schlüssel (test_… / live_…), Scopes je Schlüssel, IP-Allowlist.',
      'Rate-Limit je Tarif mit X-RateLimit-Headern, Idempotency-Key für alle anlegenden Anfragen.',
      'Webhooks mit HMAC-SHA-256-Signatur, Wiederholungen mit exponentiellem Backoff und Zustellverlauf.',
      'Testumgebung über test_-Schlüssel, strikt getrennt von Live-Daten.',
    ],
    deprecated: [] as string[],
    breaking: [] as string[],
  },
];

// Für künftige Abkündigungen: Endpunkte mit Datum (RFC 9745 „Deprecation“, RFC 8594 „Sunset“).
export const DEPRECATIONS: Record<string, { deprecation: string; sunset: string; link?: string }> = {};

export function deprecationHeaders(route: string): Record<string, string> {
  const d = DEPRECATIONS[route];
  if (!d) return {};
  return { Deprecation: `@${Math.floor(new Date(d.deprecation).getTime() / 1000)}`, Sunset: new Date(d.sunset).toUTCString(), ...(d.link ? { Link: `<${d.link}>; rel="deprecation"` } : {}) };
}
