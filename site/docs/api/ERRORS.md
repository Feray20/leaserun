# Fehlermodell

Alle Fehler folgen RFC 9457 (Problem Details), `Content-Type: application/problem+json`:

```json
{
  "type": "https://leaserun.com/docs/api/errors#validation-error",
  "title": "Validation failed",
  "status": 422,
  "code": "VALIDATION_ERROR",
  "detail": "The request contains invalid data.",
  "request_id": "req_4fK…",
  "errors": [{ "field": "property.purchase_price", "code": "too_small", "message": "Number must be greater than or equal to 0" }]
}
```

Fehlermeldungen enthalten nie Eingabewerte, Geheimnisse oder interne Details. Bei Support-Anfragen die `request_id` (auch Header `X-Request-Id`) angeben.

| Status | Codes |
|---|---|
| 400 | `BAD_REQUEST`, `INVALID_JSON`, `INVALID_CURSOR`, `IDEMPOTENCY_KEY_INVALID` |
| 401 | `UNAUTHENTICATED`, `INVALID_API_KEY`, `API_KEY_REVOKED`, `API_KEY_EXPIRED`, `API_KEY_DISABLED` |
| 403 | `API_NOT_ENABLED`, `PLAN_NOT_ENTITLED`, `LIVE_NOT_ENABLED`, `TENANT_LOCKED`, `INSUFFICIENT_SCOPE`, `IP_NOT_ALLOWED` |
| 404 | `RESOURCE_NOT_FOUND` – auch für Ressourcen anderer Mandanten (keine Auskunft über deren Existenz) |
| 405 | `METHOD_NOT_ALLOWED` |
| 409 | `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`, `CONFLICT` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | `VALIDATION_ERROR`, `UNSAFE_WEBHOOK_URL` |
| 429 | `RATE_LIMIT_EXCEEDED` (Header `Retry-After`) |
| 500 | `INTERNAL_ERROR` |
| 503 | `SERVICE_UNAVAILABLE`, `CONFIGURATION_REQUIRED` |

## Idempotenz

Anlegende Anfragen (`POST /cases`, `/validations`, `/documents`, `/reports`, `/webhooks`, `/api-keys`, Rotation) akzeptieren `Idempotency-Key` (8–120 Zeichen `A–Z a–z 0–9 _ . : -`, 24 Stunden gültig, je Mandant und Umgebung):

- gleicher Schlüssel + gleiche Anfrage → gespeicherte Antwort, Header `Idempotent-Replayed: true`, kein Duplikat
- gleicher Schlüssel + andere Anfrage → 409 `IDEMPOTENCY_CONFLICT`
- parallele Wiederholung während der Verarbeitung → 409 `IDEMPOTENCY_IN_PROGRESS`
- Serverfehler (5xx) werden nicht gespeichert; ein erneuter Versuch wird ausgeführt.

## Rate-Limit

Header bei jeder authentifizierten Antwort: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix-Zeit). Zähler je Mandant und Umgebung, atomar in der Datenbank (gilt über alle Serverinstanzen): Minutenfenster laut Tarif plus Burst-Fenster je 10 Sekunden.

## Versionierung

Hauptversion im Pfad (`/api/v1`). Breaking Changes nur mit `/api/v2`. Abkündigungen werden mit den Headern `Deprecation` und `Sunset` angekündigt und im [Changelog](CHANGELOG.md) dokumentiert.
