# LeaseRun Creator Hub

Stand: Phase 1 (Fundament), Phase 2 (Attribution, Kampagnen, Asset Library, Community-Vorteil, Creator Studio, Performance)
Phase 3 (Provision, Monatsabschluss, Rechnung/Gutschrift, Payout Center, Creator Guide)
und Phase 4 (Teilerstattungen, Kontoauszug-Abgleich, automatischer Monatsabschluss mit E-Mails).

## Einrichtung (einmalig, vor dem Livegang)

1. **Migration anwenden**: `docs/sql/2026-10-22_creator_hub.sql` im Supabase SQL Editor ausführen (idempotent).
   Danach empfohlen: `docs/sql/tests/creator_hub_rls_test.sql` ausführen – es rollt am Ende alles zurück und
   endet mit `ALL CREATOR HUB RLS TESTS PASSED`.
2. **Schlüssel für Zahlungsdaten** in Vercel (Production + Preview, *nicht* als `NEXT_PUBLIC_…`):
   ```
   CREATOR_PII_KEY = v1:<32 zufällige Bytes, Base64>
   ```
   Erzeugen: `node -e "console.log('v1:'+require('crypto').randomBytes(32).toString('base64'))"`.
   Ohne diesen Schlüssel nimmt das Portal keine Zahlungsdaten an (Antwort 503) – es gibt keinen unverschlüsselten Rückfall.
   Den Schlüssel zusätzlich sicher offline verwahren: Ohne ihn sind gespeicherte IBANs nicht mehr lesbar.
3. **Vereinbarung ersetzen**: Die Migration legt eine als *Entwurf* gekennzeichnete Platzhalter-Fassung an.
   Vor dem Start eine rechtlich geprüfte Fassung als neue Version einfügen (siehe unten).
4. **Rollen** (optional): Web-Admin → B2B → Creator Operations → „Rollen“.

### Zusätzlich für Phase 2
5. `docs/sql/2026-10-23_creator_hub_phase2.sql` ausführen (legt auch den privaten Bucket `creator-assets` an), danach `docs/sql/tests/creator_hub_phase2_test.sql`.
6. **Stripe-Webhook**: Ereignis `charge.refunded` zusätzlich abonnieren (Stripe → Entwickler → Webhooks), damit Erstattungen Conversions automatisch zurücknehmen.
7. **Community-Vorteil**: Für jeden Creator-Code in Stripe einen gleichnamigen *Aktionscode* (Promotion Code) mit dem gewünschten Rabatt anlegen. Die Bezahlseite erlaubt Aktionscodes bereits.
8. Optional zum Testen im Stripe-Testmodus: `CREATOR_COUNT_TEST_PAYMENTS=1` (nur Preview). Ohne diese Variable zählen Testzahlungen nie.

### Zusätzlich für Phase 3
9. `docs/sql/2026-10-24_creator_hub_phase3.sql` ausführen (legt den privaten Bucket `creator-documents` an), danach `docs/sql/tests/creator_hub_phase3_test.sql`.
10. **Provisionsregel festlegen**: Die Migration legt eine *Platzhalter*-Standardregel (20 % vom Netto-Umsatz) an.
    Vor dem ersten Monatsabschluss im Admin unter **Provision** die vereinbarte Regel als neue Version anlegen (gilt nur für die Zukunft).
11. **Abrechnungsart mit der Steuerberatung klären**: Standard ist `INVOICE` (der Creator stellt per Klick eine eigene Rechnung,
    Nummernkreis `CR-JJJJ-NNN`). Alternativ je Creator `CREDIT_NOTE` (LeaseRun erstellt eine Gutschrift `GS-JJJJ-NNNNN`, § 14 Abs. 2 S. 2 UStG –
    setzt eine vorherige Vereinbarung mit dem Creator voraus). Umstellbar im Creator 360 → Abrechnung.
12. **Auftraggeber-Konto für den SEPA-Export** (Vercel, serverseitig): `CREATOR_PAYOUT_IBAN`, `CREATOR_PAYOUT_BIC`, `CREATOR_PAYOUT_ACCOUNT_HOLDER`
    (fällt sonst auf `INVOICE_IBAN` / `INVOICE_BIC` / `INVOICE_ACCOUNT_HOLDER` zurück). Ohne IBAN ist der Export gesperrt.
13. **Einstellungen** (`lr_settings`): `creator_close_delay_days` (Standard 15 – Monatsabschluss frühestens 15 Tage nach Monatsende,
    deckt die Widerrufsfrist ab) und `creator_payout_four_eyes` (Standard `false`; bei `true` darf die Person, die die Abrechnung freigegeben hat, die Auszahlung nicht selbst freigeben).

### Zusätzlich für Phase 4
14. `docs/sql/2026-10-25_creator_hub_phase4.sql` ausführen, danach `docs/sql/tests/creator_hub_phase4_test.sql`.
15. **Stripe-Webhook**: `charge.refunded` ist seit Phase 2 abonniert – Stripe sendet das Ereignis auch bei Teilerstattungen; keine weitere Einstellung nötig.
16. **Automatik** (optional): Web-Admin → Creator Operations → Abrechnung → „Automatik“ (nur Super Admin). Standard: aus.
    Läuft im bestehenden täglichen Vercel-Cron (`/api/cron/cleanup`, `CRON_SECRET`). E-Mails nur bei eingerichtetem Versand (Resend).

Einstieg für Creator: `https://leaserun.com/creators` (nicht verlinkt, noindex, nicht in der Sitemap, in robots.txt gesperrt).
Admin: Web-Admin → Bereich **B2B** → **Creator Operations**.

## Ablauf

```
Bewerbung beginnen → E-Mail bestätigt → Konto → Profil → Social Media → Rechnungsdaten → Auszahlung → Vereinbarung
→ Einreichen (SUBMITTED) → Prüfung (UNDER_REVIEW) → Freigabe (ACTIVE) | Rückfrage (INFO_REQUESTED) | Ablehnung (REJECTED)
ACTIVE ↔ SUSPENDED
```

- Während SUBMITTED/UNDER_REVIEW sind alle Angaben gesperrt – freigegeben wird genau das, was eingereicht wurde.
- Freigabe prüft die Vollständigkeit serverseitig erneut und vergibt einen zufälligen Attributions-Code (10 Zeichen, ohne personenbezogene Anteile).
- Status-Übergänge nutzen eine optimistische Sperre: zwei Admins können nicht gleichzeitig widersprüchlich entscheiden.

## Attribution (Phase 2)

| Schritt | Umsetzung |
|---|---|
| Link | `https://leaserun.com/<ziel>?ref=<code>[&utm_campaign=<kampagne>]`. Der Code ist zufällig, ohne Personenbezug, und kollidiert nie mit Partner-Slugs. |
| Besuch | Bestehende cookielose Reichweitenmessung (`lr_analytics`, Quelle `partner<code>`). Bei „Do Not Track“/GPC wird nichts gezählt. |
| Weg zur Registrierung | Das Messskript merkt sich `ref` und Kampagne **nur für die Sitzung** (`sessionStorage`, nicht bei DNT/GPC). Die Registrierung übernimmt sie. |
| Registrierung | Eine Zuordnung je Kundenkonto (`lr_creator_attributions`), erster Creator gewinnt. Für Google-Anmeldungen wird die Zuordnung beim ersten Kauf aus den Kontodaten nachgetragen. |
| Kauf | Stripe-Webhook: je bezahlter Checkout-Sitzung höchstens eine Conversion (Netto nach Rabatt). Eingelöster Creator-Code hat Vorrang vor dem Link. Zuordnungsfenster 90 Tage ab Registrierung (`lr_settings.creator_attribution_window_days`). |
| Ausschlüsse | Eigenkäufe des Creators, nicht aktive Creator, Testkäufe, Stripe-Testmodus, Unternehmenskäufe (B2B). |
| Erstattung | `charge.refunded` (vollständig) → Conversion `REVERSED`. Manuelle Rücknahme durch Finance/Super Admin mit Grund. |
| Datenschutz | Creator sehen nur Summen. Admins sehen Kunden nur als gekürzte Kennung. Bei Kontolöschung des Kunden bleibt die Conversion ohne Personenbezug für die Abrechnung erhalten. |

Fehler in der Creator-Zuordnung lassen Registrierung und Zahlungs-Webhook nie scheitern (abgefangen und protokolliert).

## Sicherheit (umgesetzt)

| Maßnahme | Umsetzung |
|---|---|
| Server-seitige Autorisierung | Jede Route prüft Anmeldung (Supabase-Token, serverseitig verifiziert) und lädt den Creator **nur** über die Nutzer-ID des Tokens. |
| Admin-Zugang | Bestehender Web-Admin: `ADMIN_EMAILS`, zweiter Faktor (aal2), IP-Freigabe, Drosselung. |
| RBAC | `lr_creator_admin_roles`, Matrix in `lib/creator/roles.ts`. Verweigerte Zugriffe → `ACCESS_DENIED` im Audit. |
| RLS | Alle Tabellen RLS aktiv; Creator dürfen höchstens eigene, nicht sensible Zeilen **lesen**. Zahlungsdaten, Audit, Rollen: kein Client-Zugriff. |
| IBAN-Verschlüsselung | AES-256-GCM in der Anwendung, gebunden an die Creator-ID (Associated Data), Schlüsselrotation über `CREATOR_PII_KEY_OLD`. |
| Maskierung | Überall `DE••••••••••4821` (Länge nicht erkennbar). Vollanzeige nur per POST, nur Super/Finance, 60 s, vorher protokolliert. |
| Kontowechsel | Atomar in der DB (`lr_creator_payout_replace`), alte Daten bleiben als SUPERSEDED erhalten; Änderung bei aktivem Creator → „Prüfung erforderlich“; Hinweis-Mail an den Creator. Gleiche IBAN bei anderem Creator → immer Prüfung. |
| Unveränderbarkeit | Trigger: Audit (kein UPDATE/DELETE/TRUNCATE), Zustimmungen, Prüfverlauf, veröffentlichte Vereinbarungen, Kontodaten. |
| Bot-Schutz / Drosselung | Honigtopf + Zeitfalle beim Start, Drosselung je Nutzer und je (anonymisierter) IP, bestehende Middleware-Sperrliste. |
| CSRF | Schnittstellen nutzen Bearer-Token aus dem Speicher statt Cookies – klassische CSRF-Angriffe greifen nicht. |
| XSS | Alle Ausgaben escaped, CSP `script-src 'self'`, nur `https://`-Links. |
| Datensparsamkeit im Audit | Akteure pseudonymisiert (bestehendes `pseudo()`), Metadaten-Filter blockiert IBAN, Nachrichten, Kontaktdaten. |

Die Sicherheitstexte im Portal beschreiben **nur** diese umgesetzten Maßnahmen und versprechen keinen absoluten Schutz.

## Abrechnung und Auszahlung (Phase 3)

```
Conversions (PENDING) → Monatsabschluss (frühestens Monatsende + 15 Tage)
  → Abrechnung READY (oder ZERO) mit Provisionen, Rückbuchungen (CLAWBACK) und Übertrag negativer Salden (CARRY_OVER)
  → Rechnung des Creators bzw. Gutschrift von LeaseRun (PDF, unveränderbar)
  → Prüfung der Blocker (Zahlungsdaten geprüft, Steuerangaben, Beleg vorhanden, Betrag > 0 …) → Freigabe
  → Auszahlung READY → APPROVED → EXPORTED (SEPA pain.001.001.09) → PAID | FAILED
```

- Provision berechnet ausschließlich der Server aus Conversions und der zum Zeitpunkt der Conversion gültigen Regel
  (Vorrang: Creator + Kampagne > Creator > Kampagne > Standard). Regeln sind versioniert und nur für die Zukunft änderbar.
- Steuerliche Behandlung je Abrechnung: Kleinunternehmer (§ 19 UStG), 19 % USt, Reverse Charge (EU mit USt-IdNr.), nicht steuerbar
  oder „Prüfung nötig“ – letzteres blockiert die Freigabe.
- Abrechnungen, Provisionen, Belege und Auszahlungsbeträge sind per Datenbank-Trigger unveränderbar; Status laufen nur vorwärts.
  Korrekturen erfolgen als Anpassung (Bonus/Korrektur) im nächsten offenen Monat.
- Der SEPA-Export entschlüsselt die IBAN nur für die Datei und protokolliert das (Recht `bank.reveal` + `payouts.manage`).
  Die PDFs enthalten die IBAN nur maskiert.
- Bei „Bezahlt“ erhält der Creator eine E-Mail; Dokumente lädt er über kurzlebige signierte Links (60 Sekunden).

### Erstattungen (Phase 4)
- Stripe meldet den kumulierten Erstattungsbetrag; der Server rechnet ihn anteilig auf den Netto-Kaufbetrag um und speichert
  je neuem Stand eine unveränderbare Zeile (`lr_creator_refunds`, doppelte Zustellungen werden ignoriert).
- **Vor dem Abschluss**: Die Provision wird auf die verbleibende Grundlage berechnet; die Erstattung wird in derselben
  Datenbank-Transaktion als verrechnet markiert.
- **Nach dem Abschluss**: anteilige Rückforderung (Anteil der Erstattung an der abgerechneten Grundlage) im nächsten Abschluss;
  bei vollständiger Erstattung die noch nicht zurückgeforderte Restprovision. Rückforderungen übersteigen nie die Provision.
- Bei festen Provisionsbeträgen (FIXED/HYBRID) wird ebenfalls anteilig zurückgefordert.

### Kontoauszug-Abgleich (Phase 4)
Payout Center → „Kontoauszug abgleichen“: camt.053-Datei (XML, max. 3 MB) hochladen. Erkannt wird über die Ende-zu-Ende-Referenz
der SEPA-Datei (`CR…`), sonst über Verwendungszweck + exakten Betrag. Vorschau zuerst; bei „Übernehmen“ liest der Server die Datei
erneut und markiert nur gebuchte Belastungen mit passendem Betrag als bezahlt (Buchungsdatum, Bankreferenz, Herkunft „laut Kontoauszug“).
Rückläufer, abweichende Beträge und vorgemerkte Umsätze werden angezeigt, aber nicht übernommen. Dateien mit DOCTYPE/Entitäten
werden abgelehnt. Jeder übernommene Auszug wird mit Prüfsumme vermerkt.

### Rückläufer nach „bezahlt“ (Phase 4)
Gibt die Bank eine bereits bezahlte Überweisung zurück (im Kontoauszug erkannt oder im Payout Center „Zurückgekommen“):
Auszahlung → `RETURNED`, Abrechnung wieder `APPROVED`, Zahlungsdaten → „Prüfung nötig“, Creator erhält eine E-Mail.
Nach Prüfung bzw. Änderung der Zahlungsdaten stößt „Erneut auszahlen“ dieselbe Auszahlung (gleicher Betrag, gleicher Beleg)
auf das aktuelle Konto neu an; danach Freigabe und Export wie gewohnt. Exportierte, noch nicht bezahlte Rückläufer werden „fehlgeschlagen“.

### Automatik und E-Mails (Phase 4)
- Automatischer Monatsabschluss: einmal je Monat für den Vormonat, frühestens nach der Sperrfrist (Einstellung `creator_auto_close`).
- „Abrechnung bereit“: einmal je Abrechnung (nur Abrechnungen der letzten 30 Tage), Rechnungs-Creator mit Link zur 1-Klick-Rechnung.
- Erinnerung „Rechnung fehlt“: einmal, `creator_invoice_reminder_days` (Standard 7) Tage nach dem Hinweis.
- E-Mails enthalten keine Zahlungsdaten. Versand und Zeitpunkte werden protokolliert (`CREATOR_NOTIFIED`).
- Einstellungen (Automatik, Sperrfrist ≥ 14 Tage, Erinnerung, Vier-Augen-Prinzip) ändern nur Super Admins; jede Änderung wird protokolliert.

### Kontolöschung eines Creators
Ohne Conversions, Abrechnungen oder Auszahlungen wird der Creator mit dem Konto vollständig gelöscht.
Liegen solche Daten vor (Aufbewahrungspflicht nach § 147 AO / § 257 HGB), löst die Kontolöschung den Creator vom Login
(`user_id = null`), sperrt ihn, entfernt Social-Profile, Kampagnenzuordnungen sowie Telefon, Bio, Website und protokolliert das
(`CREATOR_ACCOUNT_DELETED`). Abrechnungen, Belege, Rechnungsanschrift und Zahlungsdaten bleiben für die Aufbewahrung erhalten;
offene Auszahlungen können weiter bearbeitet werden. Nach Ablauf der Fristen sind diese Daten manuell zu löschen.

## Rollen

| Recht | Super | Finance | Creator Mgr | Support | Read only |
|---|:-:|:-:|:-:|:-:|:-:|
| Liste, Profil, Social | ✓ | ✓ | ✓ | ✓ | ✓ |
| Kontaktdaten | ✓ | ✓ | ✓ | ✓ | – |
| Business-/Rechnungsdaten | ✓ | ✓ | ✓ | – | – |
| Prüfen / Freigeben / Ablehnen | ✓ | – | ✓ | – | – |
| Pausieren / Reaktivieren | ✓ | – | ✓ | – | – |
| Zahlungsdaten maskiert | ✓ | ✓ | ✓ | ✓ | ✓ |
| Zahlungsdaten vollständig | ✓ | ✓ | – | – | – |
| Zahlungsdaten als geprüft markieren | ✓ | ✓ | – | – | – |
| Audit lesen | ✓ | ✓ | ✓ | – | – |
| Kampagnen, Assets, Vorteile pflegen | ✓ | – | ✓ | – | – |
| Beiträge prüfen | ✓ | – | ✓ | – | – |
| Attribution, Conversions, Umsatz sehen | ✓ | ✓ | ✓ | – | ✓ |
| Conversion zurücknehmen | ✓ | ✓ | – | – | – |
| Abrechnungen sehen | ✓ | ✓ | ✓ | – | ✓ |
| Monatsabschluss, Anpassungen, Freigabe, Abrechnungsart, Provisionsregeln | ✓ | ✓ | – | – | – |
| Auszahlungen freigeben, exportieren, als bezahlt markieren | ✓ | ✓ | – | – | – |
| Kontoauszug abgleichen | ✓ | ✓ | – | – | – |
| Abrechnungs-Einstellungen (Automatik, Vier-Augen) | ✓ | – | – | – | – |
| Rollen vergeben | ✓ | – | – | – | – |

Admins ohne Eintrag gelten als Super Admin (wie im übrigen Web-Admin). Die eigene Rolle kann niemand selbst ändern.

## Neue Vereinbarungsfassung veröffentlichen

```sql
insert into public.lr_creator_agreements (version, title, body, body_sha256, is_draft, published_at)
values ('2026-11', 'LeaseRun Creator-Partnervereinbarung', $txt$…geprüfter Text…$txt$,
        encode(sha256(convert_to($txt$…geprüfter Text…$txt$, 'UTF8')), 'hex'), false, now());
```
Aktive Creator sehen danach „Vereinbarung bestätigen“ als nächste Aufgabe.

## Tests

- Unit: `npm test` (u. a. `tests/creator.test.ts`: IBAN, Tresor, Rollen, Status, Audit-Filter).
- Unit Phase 2: `tests/creator-attribution.test.ts` (Vorrang Code vor Link, Fenster, Eigenkauf, Ausschlüsse, Netto, Link-Aufbau).
- Unit Phase 4: `tests/creator-phase4.test.ts` (Teilerstattung, anteilige Rückforderung, camt.053 inkl. Sammelbuchung/Rückläufer, E-Mail-Texte).
- Unit Phase 3: `tests/creator-billing.test.ts` (Zeiträume, Regeln, Staffeln, Steuer, Summen, Blocker, Nummern, SEPA, PDF ohne volle IBAN).
- Datenbank lokal: `PGHOST=… PGPORT=… PGUSER=postgres bash docs/sql/tests/run_local.sh` (leere PostgreSQL ≥ 15; alle Phasen inkl. Rückbau).
- Datenbank Supabase: `docs/sql/tests/creator_hub_rls_test.sql`, `…_phase2_test.sql`, `…_phase3_test.sql`, `…_phase4_test.sql` (rollen zurück).

## Noch offen (nicht technisch)

- Rechtlich geprüfte Vereinbarung (inkl. Gutschriftverfahren, falls genutzt) und mit der Steuerberatung abgestimmte Provisionsregel.
- Migrationen vor dem Livegang einmal in einer Supabase-Testumgebung (Branch) ausführen; lokal sind alle Phasen getestet, und die
  Live-Datenbank wurde lesend auf alle Voraussetzungen geprüft (Tabellen, Funktionen, Buckets, keine Namenskonflikte).
