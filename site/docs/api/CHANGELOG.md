# Changelog – LeaseRun API

Breaking Changes nur mit neuer Hauptversion (`/api/v2`). Abkündigungen mit `Deprecation`- und `Sunset`-Headern.

## v1.0.0 – 2026-10-27 (Frühzugang)

- Erste Version: Fälle, Vorprüfung, Unterlagen, Berichte, Webhooks, Nutzung, API-Schlüssel, Status.
- Bearer-Schlüssel (`test_…` / `live_…`), Scopes, IP-Allowlist, Rotation mit sofortigem Widerruf.
- Rate-Limit je Tarif (Pro 60/min, Enterprise vertraglich) mit `X-RateLimit-*`-Headern.
- `Idempotency-Key` für alle anlegenden Anfragen.
- Webhooks mit HMAC-SHA-256-Signatur, Backoff-Wiederholungen, Zustellverlauf und Test-Ereignis.
- Testumgebung über `test_`-Schlüssel, strikt getrennt.

**Deprecated:** keine · **Breaking Changes:** keine
