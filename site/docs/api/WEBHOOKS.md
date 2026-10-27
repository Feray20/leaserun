# Webhooks (Enterprise)

## Ereignisse

| Ereignis | Auslöser |
|---|---|
| `validation.completed` | Prüflauf abgeschlossen |
| `case.action_required` | Vorprüfung meldet Fehler (Status wechselt auf `action_required`) |
| `case.completed` | Fall vollständig und ohne Beanstandung (Bank-Readiness `ready`) |
| `document.verified` | Unterlage formal geprüft (Signatur, Endung, MIME, SHA-256, ggf. Virenscan) |
| `report.completed` | Bericht erzeugt |
| `webhook.test` | Testereignis (`POST /webhooks/{id}/test` oder Web-Admin) |

## Zustellung

```
POST <Ihre URL>
Content-Type: application/json
X-LeaseRun-Event: report.completed
X-LeaseRun-Delivery: 6b0c…            # eindeutig je Zustellung
X-LeaseRun-Timestamp: 1798000000       # Unix-Sekunden
X-LeaseRun-Signature: v1=<hex>

{ "id": "6b0c…", "object": "event", "type": "report.completed", "created_at": "…", "environment": "live", "test": false, "attempt": 1, "data": { … } }
```

`data` enthält nur Kennungen und Kennzahlen (z. B. `case_id`, `report_id`, `completeness_score`), keine personenbezogenen Falldaten.

## Signatur prüfen

`v1 = HMAC-SHA-256(webhook_secret, timestamp + "." + raw_body)` als Hex.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
export function verify(raw, headers, secret) {
  const ts = headers['x-leaserun-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;           // Replay-Schutz: max. 5 Minuten
  const want = 'v1=' + createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  const got = String(headers['x-leaserun-signature'] || '');
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
```

Zusätzlich die `X-LeaseRun-Delivery` speichern und doppelt eingehende Zustellungen ignorieren (Duplikatschutz auf Empfängerseite). LeaseRun erzeugt jedes Ereignis je Endpunkt nur einmal (eindeutiger Schlüssel in der Datenbank).

## Wiederholungen

Antwort 2xx innerhalb von 8 Sekunden = zugestellt. Sonst Wiederholung nach 1 min, 5 min, 30 min, 2 h, 12 h (max. 6 Versuche), danach `failed` mit Audit-Eintrag `webhook.delivery_failed`. Weiterleitungen werden nicht verfolgt. Verlauf: `GET /webhooks/{id}/deliveries` und Web-Admin → Webhooks (Debugger mit manuellem *Retry*).

## Sicherheit der Ziel-URL

Nur `https`, Port 443, keine Zugangsdaten in der URL, keine internen Hosts (`localhost`, `*.internal`, `*.local`, LeaseRun selbst). Jede aufgelöste IP muss öffentlich sein – geprüft beim Verbindungsaufbau, damit DNS-Rebinding nicht greift (blockiert u. a. 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 inkl. Cloud-Metadaten, 100.64.0.0/10, ::1, fc00::/7, fe80::/10, IPv4-gemappte Adressen).

Das Webhook-Geheimnis wird AES-256-GCM-verschlüsselt gespeichert (`API_ENCRYPTION_KEY`) und nur bei Anlage einmal ausgegeben.
