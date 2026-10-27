# Authentifizierung

```
Authorization: Bearer <API_KEY>
```

## Schlüssel

- Format: `test_<8 Zeichen>_<43 Zeichen>` bzw. `live_…`. Der Präfix (`test_AbCd1234`) ist nicht geheim und erscheint in Protokollen.
- Gespeichert werden nur Präfix und `HMAC-SHA-256(API_KEY_PEPPER, Schlüssel)` – nie der Schlüssel im Klartext. Das Geheimnis wird bei Anlage oder Rotation **einmal** angezeigt, danach nur maskiert (`test_AbCd1234_********`).
- Der Mandant ergibt sich ausschließlich aus dem Schlüssel. Eine `tenant_id` im Body wird nicht ausgewertet.
- `test_`-Schlüssel sehen nur Testdaten, `live_`-Schlüssel nur Live-Daten. Live-Schlüssel erst nach Freigabe im Web-Admin.

## Lebenszyklus

| Aktion | Wirkung | Antwort bei Nutzung |
|---|---|---|
| Anlegen | Web-Admin oder `POST /api-keys` | – |
| Deaktivieren / Aktivieren | vorübergehend gesperrt | 401 `API_KEY_DISABLED` |
| Ablaufen lassen / `expires_at` | ab Zeitpunkt ungültig | 401 `API_KEY_EXPIRED` |
| Rotieren | neuer Schlüssel, alter **sofort** widerrufen | 401 `API_KEY_REVOKED` |
| Widerrufen | endgültig | 401 `API_KEY_REVOKED` |

Über die API darf ein Schlüssel nur Schlüssel derselben Umgebung anlegen und höchstens seine eigenen Scopes vergeben.

## Scopes

`cases:read`, `cases:write`, `validation:read`, `validation:execute`, `documents:read`, `documents:write`, `reports:read`, `reports:create`, `webhooks:read`, `webhooks:write`, `webhooks:test`, `usage:read`, `api_keys:read`, `api_keys:write`.

Fehlt der Scope → 403 `INSUFFICIENT_SCOPE`. Enthält der Tarif die Funktion nicht (z. B. Webhooks im Tarif Pro) → 403 `PLAN_NOT_ENTITLED`.

## IP-Allowlist

Optional je Schlüssel: Liste von IPv4/IPv6-Adressen oder CIDR-Bereichen (z. B. `203.0.113.0/24`). Anfragen von anderen Adressen → 403 `IP_NOT_ALLOWED`.

## Reihenfolge der Prüfungen

Request-ID → Authentifizierung → Schlüssel-Lookup → Schlüsselstatus → Mandant → Tarif/Freigabe → Scope → IP-Allowlist → Rate-Limit → Anfragekörper → Idempotenz → Verarbeitung → Audit → Antwort und Anfrageprotokoll.
