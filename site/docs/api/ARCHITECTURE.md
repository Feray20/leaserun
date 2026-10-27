# Architektur der API v1

```
CRM / ERP / Partner ──► /api/v1/* (Next.js Route Handler, Vercel fra1, Node-Runtime)
                          │  lib/api/pipeline.ts  (Request-ID → Auth → Key → Status → Mandant → Entitlement → Scope → IP → Rate-Limit → Body → Idempotenz)
                          ├─ lib/api/service.ts   (Fälle, Vorprüfung, Unterlagen, Berichte)
                          ├─ lib/api/validation-engine.ts (reine Berechnung, getestet)
                          ├─ lib/api/webhooks.ts  (Ereignisse, Signatur, Zustellung, Backoff)
                          └─ lib/api/audit.ts     (Hash-Kette)
Supabase Postgres (api_* Tabellen, RLS) · Supabase Storage (privater Bucket api-private)
Web-Admin (/internal/web-admin → API Management) ──► /api/admin/api (ADMIN_EMAILS + MFA)
```

## Bestand, der wiederverwendet wird
- Mandanten, Tarife, Sperren: `lr_b2b_accounts`, `effectiveTier` (lib/b2b/core.ts)
- Admin-Zugang mit zweitem Faktor: `requireAdmin` (lib/security/admin.ts)
- Dateisignaturen: `detectMime` (lib/documents/files.ts)
- Kaufnebenkosten, Raten: `kaufnebenkosten`, `monthlyRate` (public/src/calc.mjs)
- PDF-Berichte: `ReportDocument` (lib/pdf/report.tsx)
- Täglicher Lauf: `/api/cron/cleanup` → `lib/api/maintenance.ts`

## Datenmodell (docs/sql/2026-10-27_api_v1.sql)
`api_tenant_policies`, `api_keys` (Scopes als Array – ersetzt eine eigene `api_key_scopes`-Tabelle), `api_requests`, `api_rate_counters` + `api_rate_take()`, `api_idempotency_keys`, `api_cases`, `api_validation_runs`, `api_documents`, `api_reports`, `api_webhook_endpoints`, `api_webhook_deliveries`, `api_audit_events` (Hash-Kette, unveränderlich), Auswertung `api_usage_series()` statt einer Tabelle `api_usage`.

## Asynchrone Verarbeitung auf Vercel
- Berichte: Anlage mit `queued`, Erzeugung direkt nach der Antwort (`after()`), Wiederanstoß beim Statusabruf und im täglichen Lauf.
- Webhooks: sofortige Zustellung; fällige Wiederholungen werden bei jeder API-Anfrage des Mandanten und im täglichen Lauf abgearbeitet (Vercel-Cron ist täglich). Für engere Wiederholungstakte einen häufigeren Cron auf `/api/cron/cleanup` einrichten.

## Umgebungsvariablen
`API_KEY_PEPPER`, `API_ENCRYPTION_KEY` (Pflicht), `API_BASE_URL`, `MALWARE_SCAN_URL`, `MALWARE_SCAN_TOKEN` (optional). Ohne Pflichtwerte antwortet die API mit 503 `CONFIGURATION_REQUIRED` und der Web-Admin zeigt „Configuration Required“.

## Tests
- `tests/api.test.ts` – Schlüssel, Entitlements (Basic/Pro/Enterprise), IP-Allowlist, SSRF, Signatur, Verschlüsselung, Idempotenz-Hash, Paginierung, Schemas, Vorprüfung
- `tests/openapi.test.ts` – OpenAPI ↔ echte Routen (Methoden, Scopes, keine undokumentierten Endpunkte)
- `scripts/api-e2e.mjs` – End-to-End gegen eine laufende Instanz (Admin-Token + echte Datenbank)
