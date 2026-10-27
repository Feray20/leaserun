# Quick Start

1. **Zugang aktivieren** – Web-Admin → API Management → *Access*: „API aktivieren“ (Tarif Pro oder Enterprise). Für Tests ohne echtes Kundenkonto: oben „Testmandant anlegen“ (Enterprise, nur Testumgebung).
2. **Schlüssel anlegen** – *API Keys* → „+ Schlüssel“, Umgebung *Test*, Scopes wählen. Das Geheimnis (`test_…`) wird genau einmal angezeigt.
3. **Fall anlegen**

```bash
export LEASERUN_API_KEY='test_XXXXXXXX_…'
curl -X POST https://leaserun.com/api/v1/cases \
  -H "Authorization: Bearer $LEASERUN_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: idem_crm_4711' \
  --data '{
    "external_reference": "TEST-0001",
    "property": { "property_type": "apartment", "address": { "postal_code": "64354", "city": "Reinheim", "state": "hessen" }, "purchase_price": 450000 },
    "household": { "monthly_net_income": 6000, "monthly_expenses": 2200 },
    "equity": { "amount": 100000, "available_amount": 100000 },
    "loan": { "requested_amount": 350000, "repayment_rate": 2 }
  }'
```

4. **Vorprüfung** – `GET /api/v1/cases/{id}/validate`. Beispiel aus dem Testfall: Kaufnebenkosten Hessen 8 % = 36.000 € → Bedarf 386.000 €, Darlehen 350.000 € → Prüfpunkt `FINANCING_GAP` (severity `error`, `value` 350000, `threshold` 386000).
5. **Unterlage hochladen**

```bash
curl -X POST https://leaserun.com/api/v1/cases/{id}/documents \
  -H "Authorization: Bearer $LEASERUN_API_KEY" \
  -F 'file=@selbstauskunft.pdf' -F 'type=self_disclosure'
```

6. **Bericht** – `POST /api/v1/cases/{id}/reports` (Antwort 202, `status: "queued"`), dann `GET /api/v1/cases/{id}/reports/{reportId}` bis `completed`; `download_url` ist 5 Minuten gültig.
7. **Webhook (Enterprise)** – `POST /api/v1/webhooks` mit `url` (https) und `events`, Geheimnis sichern, dann `POST /api/v1/webhooks/{id}/test`.

Alle Schritte lassen sich im Web-Admin unter *Playground* mit echten Anfragen durchspielen (Testdaten vorbelegt, cURL/JavaScript/TypeScript kopierbar). *Sandbox → RESET TEST ENVIRONMENT* löscht danach ausschließlich die Testdaten.
