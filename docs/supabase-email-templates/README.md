# ImmoAdv – E-Mail-Vorlagen für Supabase

Supabase → Authentication → Emails → Templates. Für jede Vorlage den Betreff und das HTML einfügen.

| Vorlage | Datei | Betreff |
|---|---|---|
| E-Mail-Adresse bestätigen | 1-confirm-signup.html | Bitte bestätigen Sie Ihre E-Mail-Adresse – ImmoAdv |
| Sie wurden eingeladen | 2-invite.html | Einladung zu ImmoAdv |
| Bei ImmoAdv anmelden | 3-magic-link.html | Ihr Anmeldelink – ImmoAdv |
| Neue E-Mail-Adresse bestätigen | 4-change-email.html | Neue E-Mail-Adresse bestätigen – ImmoAdv |
| Neues Passwort festlegen | 5-reset-password.html | Passwort zurücksetzen – ImmoAdv |
| Ihr Bestätigungscode | 6-reauthentication.html | Ihr Bestätigungscode – ImmoAdv |

Absender: Supabase → Authentication → Emails → SMTP Settings → „Enable custom SMTP“, Sender name **ImmoAdv**, Sender email z. B. noreply@immoadv.de (bei Resend verifiziert), Host smtp.resend.com, Port 465, Benutzer resend, Passwort = Resend-API-Schlüssel.
