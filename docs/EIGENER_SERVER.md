# LeaseRun auf den eigenen Server (Umzug von Supabase, GitHub und Vercel)

Stand 08.11.2026. Nur mit GO von Feray. Nichts wird gelöscht, bevor der neue Weg geprüft ist.

## Was LeaseRun heute braucht
| Teil | Heute | Ziel |
|---|---|---|
| Seite + Stripe-Webhook + Lead-Admin | Cloudflare Worker `leaserun` (Lead-Admin seit diesem Zweig im Worker, `/api/leads-admin`) | bleibt |
| Build | GitHub Actions | Forgejo (`.forgejo/workflows/cloudflare.yml`, Schalter `FORGEJO_LIVE`) |
| Datenbank, Anmeldung (E-Mail + Passwort), REST, RPC `lr_grant` | Supabase-Projekt `pxexxguhgqfxwhtnwcrj` | eigener kleiner Stack auf dem Server |
| Edge Function `leads-admin` | Supabase | entfällt (im Worker) |
| Domain leaserun.com | Hostinger (Parkseite) | Cloudflare-Zone, Worker-Route |

## Warum ein eigener Stack (nicht die ImmoAdv-Datenbank)
LeaseRun hat eigene Kundenkonten. In der ImmoAdv-Anmeldung (`db.immoadv.de`) würden LeaseRun-Konten zu ImmoAdv-Konten – das verletzt „Logins strikt getrennt“. Deshalb: eigene Datenbank `leaserun` + eigener Auth-Dienst (GoTrue) + eigenes PostgREST, Adresse `https://db.leaserun.com` (Cloudflare Tunnel, wie `db.immoadv.de`). Platz ist da (Server: 16 GB RAM frei, 200 GB Platte frei).

## Ablauf (Umzugsnacht)
1. **Server (über das Freigabe-Gateway, Feray gibt frei):** Postgres-Datenbank `leaserun`, GoTrue und PostgREST mit eigenen Schlüsseln (JWT-Secret, anon, service) neben dem bestehenden Stack; Tunnel-Eintrag `db.leaserun.com` → nur `/auth/v1/*` und `/rest/v1/*` öffentlich, mit Rate-Limit.
2. **Daten:** `pg_dump` aus `pxexxguhgqfxwhtnwcrj` (Schema `public` + Daten aus `auth.users`/`auth.identities`), Import in `leaserun`, RLS-Policies und Funktion `lr_grant` aus `supabase/migrations/` prüfen, Zeilen alt/neu vergleichen.
3. **Auth-Einstellungen:** Site URL `https://leaserun.com`, Redirect-URLs wie im Supabase-Projekt, SMTP (Resend) für Bestätigungs-/Passwort-Mails.
4. **Worker `leaserun` (Cloudflare-Dashboard → Variablen und Geheimnisse):** `LR_SB_URL=https://db.leaserun.com`, `LR_SB_KEY` (anon), Geheimnis `LR_SB_SERVICE_KEY` (service), `LEASERUN_ADMIN_PASSWORD` (neu wählen – Supabase zeigt den alten Wert nicht mehr an; schon jetzt setzen, der Lead-Admin läuft ab diesem Zweig über den Worker). CSP passt sich über `LR_SB_URL` von selbst an.
5. **Browser-Dateien:** In `site/app.js` (Zeile mit `SB_URL`/`SB_KEY`) und `site/lr-app.js` (Zeile 7–8) dieselben zwei Werte eintragen, pushen → Forgejo baut.
6. **Domain:** leaserun.com bei Cloudflare als Zone anlegen, bei Hostinger die Nameserver auf Cloudflare umstellen, in `site/wrangler.jsonc` die `routes` einkommentieren.
7. **Prüfen:** Registrieren, Anmelden, Passwort vergessen, Objekt anlegen, Lead-Formular, Lead-Admin (`/admin`), Testkauf über Stripe (Webhook → `lr_grant`).
8. **Rückweg:** `LR_SB_URL`/`LR_SB_KEY` entfernen und die zwei Browser-Zeilen zurücksetzen – dann läuft wieder alles über Supabase.
9. **Erst nach 1–2 Wochen ohne Fehler (GO):** Supabase-Projekt `pxexxguhgqfxwhtnwcrj` pausieren, später löschen; GitHub-Workflow und Vercel-Projekt entfernen.

## Folgen für Nutzer
Bestehende Konten bleiben (Passwörter werden als Hash mit übernommen); angemeldete Nutzer müssen sich einmal neu anmelden (neuer Schlüssel).
