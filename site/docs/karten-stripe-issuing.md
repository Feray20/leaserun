# LeaseRun Card mit Stripe Issuing (Firmenkarten)

Stripe Issuing gibt in der EU nur **Firmenkarten** aus (geschäftliche Ausgaben, aufgeladen mit Firmengeld). Karten für Privatkunden sind über Stripe nicht möglich.

## Ablauf
1. Stripe Issuing im Stripe-Konto beantragen (Stripe prüft Geschäftsmodell und Einsatzzweck).
2. Datenbank: `docs/sql/2026-10-18_cards.sql` in Supabase einspielen.
3. Stripe-Dashboard → Issuing → Echtzeit-Autorisierung und Webhook: `https://leaserun.com/api/karten/stripe`
   Ereignisse: `issuing_authorization.request`, `issuing_authorization.created`, `issuing_authorization.updated`, `issuing_transaction.created`, `issuing_card.updated`.
4. Umgebungsvariablen in Vercel (nur Platzhalter, keine Geheimnisse ins Repository):

| Variable | Zweck |
| --- | --- |
| `CARD_PROVIDER=stripe` | Stripe Issuing als Kartenpartner |
| `CARD_PROGRAM_STATUS=SANDBOX` | Testbetrieb mit `STRIPE_TEST_SECRET_KEY` (sk_test_…) |
| `CARD_PROGRAM_STATUS=LIVE` + `CARD_COMPLIANCE_APPROVED=true` | Echtbetrieb (erst nach rechtlicher Prüfung) |
| `STRIPE_ISSUING_WEBHOOK_SECRET` | Signaturgeheimnis des Issuing-Webhooks |

5. Web-Admin → B2B → Partner → Aktionen → **Firmenkarten (LeaseRun Card)**: Karte für ein Mitglied ausgeben, Monatslimit setzen.

## Sicherheit
- Jede Zahlung wird in der Echtzeit-Freigabe gegen das Monatslimit geprüft (SQL-Funktion `lr_card_authorize`, Zeilensperre, Idempotenz über die Stripe-Autorisierungs-ID). Bei Fehlern oder nach 1,5 s: ablehnen.
- Abschluss, Erstattung und Storno werden über die Folgeereignisse gebucht.
- Mit Stripe Connect (`stripe_account`, acct_…) zahlt jede Karte aus dem Issuing-Guthaben des jeweiligen Unternehmens; LeaseRun verwahrt kein Kundengeld.
- Vollständige Kartennummern speichert LeaseRun nicht (nur die letzten 4 Ziffern).
