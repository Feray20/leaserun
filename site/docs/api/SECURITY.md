# Sicherheit und Datenschutz

## Mandantentrennung
- Mandant = Unternehmenskonto (`lr_b2b_accounts.id`), ermittelt ausschließlich aus dem API-Schlüssel.
- Jede Abfrage filtert nach `tenant_id` **und** `environment`; fremde IDs liefern 404.
- Alle `api_*`-Tabellen: Row Level Security aktiv, keine Richtlinien für `anon`/`authenticated`, Rechte entzogen – Zugriff nur serverseitig mit dem Service-Schlüssel (nie im Browser). Fremdschlüssel mit `ON DELETE CASCADE`, mandantenbezogene Indizes.

## Schlüssel und Geheimnisse
- API-Schlüssel nur als HMAC-SHA-256 mit Pfeffer (`API_KEY_PEPPER`); Vergleich über eindeutigen Hash-Index.
- Webhook-Geheimnisse AES-256-GCM (`API_ENCRYPTION_KEY`), nur einmal sichtbar.
- Schutz gegen Durchprobieren: viele ungültige Schlüssel von derselben Quelle → 429.

## Datenschutz (Privacy by Design)
- Datensparsamkeit: Anfrageprotokoll ohne Inhalte, ohne personenbezogene Daten (IP gekürzt und gehasht), 90 Tage Aufbewahrung.
- Webhook-Nutzdaten nur mit Kennungen und Kennzahlen; Antworttexte der Empfänger gekürzt und maskiert (E-Mail, Telefon, IBAN).
- Löschung: `DELETE /cases/{id}` entfernt Fall, Unterlagen (Dateien), Prüfläufe und Berichte endgültig.
- Testdaten fiktiv und als TEST gekennzeichnet; Reset löscht ausschließlich die Testumgebung.

## Unterlagen
- Erlaubt: PDF, JPG/JPEG, PNG, TIFF; max. 4 MB (je Mandant einstellbar).
- Prüfungen: Dateisignatur (Magic Bytes), Dateiendung passend zum Inhalt, angegebener MIME-Typ, Größe, SHA-256, Kontrolle nach dem Speichern, optionaler Virenscan (`MALWARE_SCAN_URL`). Ohne Scanner: `malware_scan: "not_configured"` – offen ausgewiesen.
- Speicherung im privaten Bucket `api-private`, Originale werden nie überschrieben (`upsert: false`), Download nur über signierte Links (5 Minuten).

## Audit
Alle sicherheitsrelevanten Aktionen (Zugang, Schlüssel, Fälle, Prüfläufe, Unterlagen, Berichte, Webhooks, Sandbox) in `api_audit_events`: Hash-Kette (`hash = SHA-256(prev_hash | Ereignis)`), Änderungen und Löschungen per Trigger gesperrt.

## Sicherheitsprüfung (Stand v1.0.0)

| Risiko | Maßnahme |
|---|---|
| API-Key-Leck | nur Hash gespeichert, einmalige Anzeige, Maskierung, Playground speichert Live-Schlüssel nicht, Code-Beispiele mit `$LEASERUN_API_KEY` |
| Tenant-Breakout / IDOR | Mandant aus Schlüssel, Filter auf jeder Abfrage, 404 für Fremd-IDs, UUID-Prüfung der Pfadparameter |
| Privilegien-Eskalation | Schlüssel können nur Scopes ⊆ eigene vergeben und nur in ihrer Umgebung; Admin-Routen nur mit ADMIN_EMAILS + zweitem Faktor |
| SSRF | https/443, Hostnamen-Sperrliste, IP-Prüfung beim Verbindungsaufbau (DNS-Rebinding), keine Redirects |
| XSS | Admin-Oberfläche escaped alle Werte (`esc`), JSON-Antworten mit `nosniff` |
| SQL-Injection | ausschließlich parametrisierte PostgREST-Abfragen; Filterwerte validiert |
| Datei-Uploads | Signatur, Endung, MIME, Größe, Hash, privater Speicher |
| Replay / Webhook-Spoofing | HMAC-Signatur mit Zeitstempel, Delivery-ID, Anleitung für zeitkonstanten Vergleich |
| Rate-Limit-Umgehung | Zähler je Mandant (nicht je Schlüssel) in der Datenbank; Ausweichlimit je Instanz bei DB-Ausfall |
| Brute-Force | 256-Bit-Geheimnisse, Sperre bei vielen Fehlversuchen je Quelle |
| Log-Leck | keine Bodies, keine Header, keine PII im Anfrageprotokoll |
| Signed-URL-Leck | 5 Minuten Gültigkeit, nur auf Anfrage mit gültigem Schlüssel |
