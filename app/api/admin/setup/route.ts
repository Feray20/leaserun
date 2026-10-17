import '@/lib/env-alias';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { fromAddress } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Einrichtung: was noch fehlt, mit Anleitung. Automatisch geprüfte Punkte erkennen ihren Stand selbst;
// Punkte außerhalb von ImmoAdv (Supabase-Dashboard, Stripe-Dashboard, Anwalt …) hakt der Administrator ab.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const has = (k: string) => Boolean(process.env[k] && String(process.env[k]).trim());
const KEY = 'setup_manual';
const VERCEL = 'https://vercel.com/klk19/immoadv/settings/environment-variables';
const SB = 'https://supabase.com/dashboard/project/mieoylqhtvghcnvaxutg';
const a = (href: string, t: string) => `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;

type Item = { id: string; group: string; title: string; why: string; steps: string[]; auto: boolean; ok: boolean | null; optional?: boolean; info?: string; time?: string; need?: string; check?: string };

async function resendDomain(): Promise<boolean | null> {
  const key = process.env.RESEND_API_KEY; const from = fromAddress();
  const dom = (/@([^>\s]+)/.exec(from || '')?.[1] || '').toLowerCase();
  if (!key || !dom) return false;
  try {
    const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null; // Schlüssel nur mit Sende-Recht: Stand nicht lesbar
    const d = (await r.json()) as { data?: { name: string; status: string }[] };
    const hit = (d.data || []).find((x) => x.name.toLowerCase() === dom);
    return hit ? hit.status === 'verified' : false;
  } catch { return null; }
}

async function items(manual: Record<string, string>): Promise<Item[]> {
  const db = adminConfigured() ? supabaseAdmin() : null;
  const sk = String(process.env.STRIPE_SECRET_KEY || '');
  const live = sk.startsWith('sk_live') || sk.startsWith('rk_live');
  const dom = await resendDomain();
  const { data: qa } = db ? await db.from('immo_b2b_accounts').select('id').ilike('company_name', 'QA Testfirma%').limit(1) : { data: [] };
  const L: Item[] = [
    // ---------- E-Mail ----------
    { id: 'resend', group: 'E-Mail-Versand', title: 'Resend-Schlüssel und Absender in Vercel', auto: true, ok: has('RESEND_API_KEY') && Boolean(fromAddress()), time: '5 Minuten',
      need: 'Zugang zu resend.com und zu Vercel.',
      why: 'Ohne Versand gehen keine Zugangsdaten, Rechnungen, Bestätigungs-Mails oder Neuigkeiten raus.',
      steps: [
        `${a('https://resend.com/api-keys', 'resend.com → API Keys')} öffnen und anmelden.`,
        'Oben rechts auf <strong>„Create API Key“</strong> klicken. Name: <code>immoadv-production</code>. Permission: <strong>Sending access</strong>. Domain: <code>immoadv.de</code>. Auf „Add“ klicken.',
        'Den angezeigten Schlüssel (beginnt mit <code>re_</code>) sofort kopieren – er wird nur einmal gezeigt. Nicht in Chat oder E-Mail einfügen.',
        `${a(VERCEL, 'Vercel → Projekt immoadv → Settings → Environment Variables')} öffnen.`,
        'Auf <strong>„Add New“</strong> klicken. Key: <code>RESEND_API_KEY</code>, Value: den kopierten Schlüssel einfügen. Bei „Environments“ nur <strong>Production</strong> anhaken. „Save“.',
        'Noch einmal „Add New“: Key <code>NOTIFY_FROM_EMAIL</code>, Value <code>ImmoAdv &lt;noreply@immoadv.de&gt;</code>, nur Production, „Save“.',
        'Neu deployen: Vercel → Reiter <strong>Deployments</strong> → beim obersten Eintrag rechts auf „⋯“ → <strong>„Redeploy“</strong> → bestätigen. Nach ca. 2 Minuten ist der Punkt hier automatisch grün.'],
      check: 'Web-Admin → System → „Test 1: ImmoAdv-E-Mail an mich“. Die E-Mail muss innerhalb einer Minute ankommen.' },
    { id: 'resend_domain', group: 'E-Mail-Versand', title: 'Domain immoadv.de bei Resend bestätigt', auto: dom !== null, ok: dom === null ? manual.resend_domain ? true : false : dom, time: '10 Minuten + Wartezeit',
      need: 'Zugang zu resend.com und zu Hostinger (DNS).',
      info: dom === null ? 'Stand mit dem Sende-Schlüssel nicht lesbar – nach „Test 1“ im Reiter System selbst abhaken.' : undefined,
      why: 'Nur mit bestätigter Domain kommen E-Mails von noreply@immoadv.de an und landen nicht im Spam.',
      steps: [
        `${a('https://resend.com/domains', 'resend.com → Domains')} → <strong>„Add Domain“</strong> → <code>immoadv.de</code> eintragen, Region <strong>Frankfurt (eu-central-1)</strong> → „Add“.`,
        'Resend zeigt jetzt eine Tabelle mit 3–4 DNS-Einträgen (Typ, Name, Wert). Dieses Fenster offen lassen.',
        'In einem zweiten Tab: Hostinger → <strong>Domains</strong> → immoadv.de → <strong>DNS / Nameserver</strong> → „DNS-Einträge verwalten“.',
        'Für jede Zeile aus Resend einen Eintrag anlegen: <strong>Typ</strong> genau wie bei Resend (MX oder TXT), <strong>Name</strong> genau wie bei Resend (z. B. <code>send</code> oder <code>resend._domainkey</code> – ohne „.immoadv.de“ dahinter), <strong>Wert/Inhalt</strong> per Kopieren-Knopf übernehmen, bei MX die Priorität <code>10</code>. TTL unverändert lassen.',
        'Zusätzlich einen TXT-Eintrag anlegen: Name <code>_dmarc</code>, Wert <code>v=DMARC1; p=none;</code>.',
        'Zurück bei Resend auf <strong>„Verify DNS Records“</strong> klicken. Grün wird es meist nach 5–60 Minuten, selten bis 24 Stunden. Einfach später erneut auf „Verify“ klicken.'],
      check: 'Bei Resend steht neben immoadv.de „Verified“. Danach Web-Admin → System → „Test 1“.' },
    { id: 'smtp', group: 'E-Mail-Versand', title: 'Supabase sendet über eigenen Absender (SMTP)', auto: false, ok: Boolean(manual.smtp), time: '5 Minuten',
      need: 'Den Resend-API-Schlüssel (oder einen zweiten nur für Supabase).',
      why: 'Sonst kommen Registrierungs- und Passwort-Mails vom Absender „Supabase Auth“ und sind stark begrenzt (wenige Mails pro Stunde).',
      steps: [
        `${a(SB + '/auth/smtp', 'Supabase → Authentication → Emails → SMTP Settings')} öffnen.`,
        'Schalter <strong>„Enable custom SMTP“</strong> einschalten.',
        'Felder ausfüllen: Sender email <code>noreply@immoadv.de</code> · Sender name <code>ImmoAdv</code> · Host <code>smtp.resend.com</code> · Port <code>465</code> · Username <code>resend</code> · Password = Resend-API-Schlüssel.',
        'Unten auf <strong>„Save changes“</strong>.',
        'Gleiche Seite, Abschnitt „Rate Limits“ (oder Authentication → Rate Limits): E-Mails pro Stunde auf mindestens <code>30</code> setzen.'],
      check: 'Web-Admin → System → „Test 2: Konto-E-Mail über Supabase an mich“. Kommt sie mit Absender „ImmoAdv“ an, hier „Erledigt“ klicken.' },
    { id: 'templates', group: 'E-Mail-Versand', title: 'ImmoAdv-Vorlagen für Konto-E-Mails in Supabase', auto: false, ok: Boolean(manual.templates), time: '10 Minuten',
      why: 'Bestätigungs- und Passwort-Mails im ImmoAdv-Design statt im englischen Standardtext.',
      steps: [
        'Web-Admin → Reiter <strong>System</strong> → Abschnitt „E-Mail-Versand“ → die Vorlagen (Bestätigung, Passwort zurücksetzen, Magic Link, E-Mail ändern) öffnen.',
        `${a(SB + '/auth/templates', 'Supabase → Authentication → Emails → Templates')} öffnen.`,
        'Links die Vorlage <strong>„Confirm signup“</strong> wählen: Feld „Subject“ mit dem Betreff aus dem Web-Admin ersetzen, Feld „Message body“ komplett leeren und den HTML-Text aus dem Web-Admin einfügen. „Save changes“.',
        'Dasselbe für <strong>„Reset Password“</strong>, <strong>„Magic Link“</strong> und <strong>„Change Email Address“</strong>.'],
      check: 'Auf immoadv.de/auth/reset ein Passwort-Zurücksetzen für Ihre eigene Adresse anfordern – die Mail muss im ImmoAdv-Design ankommen.' },
    { id: 'urls', group: 'E-Mail-Versand', title: 'Supabase: Website-Adresse und erlaubte Rücksprung-Adressen', auto: false, ok: Boolean(manual.urls), time: '3 Minuten',
      why: 'Sonst führen Links in Bestätigungs- und Passwort-Mails ins Leere.',
      steps: [
        `${a(SB + '/auth/url-configuration', 'Supabase → Authentication → URL Configuration')} öffnen.`,
        'Feld <strong>„Site URL“</strong>: <code>https://immoadv.de</code> → „Save“.',
        'Bei <strong>„Redirect URLs“</strong> auf „Add URL“ und nacheinander eintragen: <code>https://immoadv.de/auth/login</code>, <code>https://immoadv.de/auth/reset</code>, <code>https://immoadv.de/auth/callback</code>, <code>https://immoadv.de/auth/confirm</code>, <code>https://immoadv.de/b2b-portal</code>, <code>https://partner.immoadv.de</code>. Jeweils speichern.'],
      check: 'Link aus einer Passwort-Mail anklicken – er muss auf immoadv.de landen, nicht auf localhost.' },
    { id: 'b2bnotify', group: 'E-Mail-Versand', title: 'Geschäftsadresse für B2B-Meldungen', auto: true, ok: has('B2B_NOTIFY_EMAIL'), time: '2 Minuten',
      why: 'Kontoanfragen und Registrierungsnachweise gehen sonst an die Admin-Adresse.',
      steps: [
        `${a(VERCEL, 'Vercel → Settings → Environment Variables')} → „Add New“.`,
        'Key <code>B2B_NOTIFY_EMAIL</code>, Value = Ihre Geschäftsadresse, nur Production, „Save“.',
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“.'],
      check: 'Testanfrage auf immoadv.de/b2b senden – die Meldung kommt an die neue Adresse.' },
    // ---------- Zahlungen ----------
    { id: 'stripe_test', group: 'Zahlungen', title: 'Stripe-Testschlüssel für den Testkauf', auto: true, ok: has('STRIPE_TEST_SECRET_KEY'), time: '5 Minuten',
      need: 'Zugang zum Stripe-Dashboard.',
      why: 'Damit Sie im Web-Admin unter „Testkauf“ jeden Tarif ohne echtes Geld durchspielen können.',
      steps: [
        `${a('https://dashboard.stripe.com/test/apikeys', 'Stripe → Entwickler → API-Schlüssel')} öffnen. Oben rechts muss der Schalter <strong>„Testmodus“</strong> an sein (orange Leiste).`,
        'Beim <strong>Geheimschlüssel</strong> (sk_test_…) auf „⋯“ → <strong>„Schlüssel rollen“</strong> (der alte war im Chat sichtbar). Ablauf „Jetzt“ wählen, bestätigen.',
        'Den neuen Schlüssel mit „Kopieren“ übernehmen.',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>STRIPE_TEST_SECRET_KEY</code>, Value einfügen, nur Production, „Save“.`,
        'Den alten Eintrag <code>STRIPE_SECRET_KEY</code> (nur Preview/Development) über „⋯“ → „Edit“ ebenfalls auf den neuen Testschlüssel setzen.',
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“.'],
      check: 'Web-Admin → Testkauf → einen Tarif mit Testkarte 4242 4242 4242 4242 kaufen.' },
    { id: 'stripe_brand', group: 'Zahlungen', title: 'Stripe: Zahlarten, Logo und schwarzer Bezahlknopf', auto: false, ok: Boolean(manual.stripe_brand), time: '10 Minuten',
      why: 'Bezahlseite, Rechnungen und Kundenportal erscheinen im ImmoAdv-Design, der Bezahlknopf ist schwarz wie Apple Pay, und PayPal/Klarna/SEPA werden angeboten.',
      steps: [
        `${a('https://dashboard.stripe.com/settings/payment_methods', 'Stripe → Einstellungen → Zahlungsmethoden')} öffnen (erst im Testmodus).`,
        'Bei <strong>PayPal</strong>, <strong>Apple Pay</strong>, <strong>Google Pay</strong>, <strong>Klarna</strong> und <strong>SEPA-Lastschrift</strong> jeweils auf „Aktivieren“ bzw. den Schalter einschalten. PayPal verlangt einmal die Verknüpfung mit Ihrem PayPal-Geschäftskonto – den Anweisungen folgen.',
        `${a('https://dashboard.stripe.com/settings/branding', 'Stripe → Einstellungen → Branding')} öffnen.`,
        'Logo hochladen: Datei von <code>https://immoadv.de/brand/immoadv-stripe-logo.png</code> (vorher im Browser öffnen und speichern). Symbol: <code>https://immoadv.de/brand/immoadv-stripe-icon.png</code>.',
        'Markenfarbe <code>#0F2C59</code>. <strong>Akzentfarbe (Buttons) <code>#000000</code></strong> – so ist der Bezahlknopf schwarz wie auf ImmoAdv. „Speichern“.',
        `${a('https://dashboard.stripe.com/settings/billing/invoice', 'Stripe → Einstellungen → Rechnungen')}: Präfix z. B. <code>IMMO</code>, Fußzeile mit Anschrift aus dem Impressum und Steuernummer bzw. USt-IdNr. „Speichern“.`,
        'Oben den Schalter <strong>Testmodus ausschalten</strong> und Zahlungsmethoden + Branding im Live-Modus genauso einstellen.'],
      check: 'Web-Admin → Testkauf → Bezahlseite öffnen: Logo sichtbar, Knopf schwarz, PayPal/Klarna/Karte wählbar.' },
    { id: 'invoice', group: 'Zahlungen', title: 'Bankverbindung für B2B-Rechnungen (Kauf auf Rechnung)', auto: true, ok: has('INVOICE_IBAN') && has('INVOICE_BIC'), time: '3 Minuten',
      info: has('INVOICE_BICC') && !has('INVOICE_BIC') ? 'Tippfehler gefunden: Die Variable heißt „INVOICE_BICC“ – richtig ist „INVOICE_BIC“. In Vercel umbenennen.' : undefined,
      why: 'Erscheint auf Rechnungen an Unternehmen, die per Überweisung zahlen.',
      steps: [
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“ dreimal, jeweils nur Production:`,
        '<code>INVOICE_IBAN</code> = Ihre Geschäfts-IBAN (ohne Leerzeichen) · <code>INVOICE_BIC</code> = BIC · <code>INVOICE_BANK_NAME</code> = Name der Bank.',
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“.'],
      check: 'Web-Admin → Rechnungen → eine Rechnung als PDF öffnen: Bankverbindung steht unten.' },
    { id: 'webhook', group: 'Zahlungen', title: 'Stripe-Webhook (Zahlungsbestätigungen)', auto: true, ok: has('STRIPE_WEBHOOK_SECRET'), time: '5 Minuten',
      info: has('STRIPE_WEBHOOK_SECRETT') && !has('STRIPE_WEBHOOK_SECRET') ? 'Tippfehler gefunden: Die Variable heißt „STRIPE_WEBHOOK_SECRETT“ – richtig ist „STRIPE_WEBHOOK_SECRET“. In Vercel umbenennen.' : undefined,
      why: 'Ohne Webhook werden Tarife nach der Zahlung nicht automatisch aktiviert und Käufe nicht gezählt.',
      steps: [
        `${a('https://dashboard.stripe.com/test/webhooks', 'Stripe → Entwickler → Webhooks')} öffnen (Testmodus an).`,
        'Auf <strong>„Endpunkt hinzufügen“</strong> klicken. Endpunkt-URL: <code>https://immoadv.de/api/stripe/webhook</code>.',
        'Bei „Ereignisse auswählen“ diese anhaken: <code>checkout.session.completed</code>, <code>checkout.session.async_payment_succeeded</code>, <code>checkout.session.async_payment_failed</code>, <code>customer.subscription.created</code>, <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>, <code>invoice.paid</code>, <code>invoice.payment_failed</code>. „Endpunkt hinzufügen“.',
        'Im neuen Endpunkt bei <strong>„Signaturgeheimnis“</strong> auf „Anzeigen“ und kopieren (beginnt mit <code>whsec_</code>).',
        `${a(VERCEL, 'Vercel')} → „Add New“: Key <code>STRIPE_WEBHOOK_SECRET</code>, Value einfügen, nur Production, „Save“ → Redeploy.`,
        'Beim Start mit echten Kunden alles im Live-Modus wiederholen und den Wert durch das Live-Geheimnis ersetzen.'],
      check: 'Testkauf durchführen. In Stripe beim Webhook stehen die Ereignisse mit „200 OK“.' },
    { id: 'golive', group: 'Zahlungen', title: 'Live-Zahlungen freischalten (Start mit echten Kunden)', auto: true, ok: live && process.env.BILLING_ENABLED === 'true', time: '30 Minuten',
      info: live ? 'Live-Schlüssel vorhanden' : sk ? 'nur Testschlüssel hinterlegt' : 'kein Schlüssel in Production',
      need: 'Erfolgreicher Testkauf, geprüfte Rechtstexte, vollständig verifiziertes Stripe-Konto.',
      why: 'Erst danach können Kunden wirklich bezahlen.',
      steps: [
        'Stripe → oben auf <strong>„Konto aktivieren“</strong>: Unternehmensdaten, Bankkonto für Auszahlungen und Ausweis vollständig eingeben, bis kein Hinweis mehr erscheint.',
        `Testmodus ausschalten → ${a('https://dashboard.stripe.com/apikeys', 'Entwickler → API-Schlüssel')} → Geheimschlüssel <code>sk_live_…</code> anzeigen und kopieren.`,
        `${a(VERCEL, 'Vercel')}: <code>STRIPE_SECRET_KEY</code> mit „Add New“ für <strong>nur Production</strong> anlegen und den Live-Schlüssel einfügen.`,
        'Webhook im Live-Modus anlegen (gleiche Schritte wie beim Punkt „Stripe-Webhook“) und <code>STRIPE_WEBHOOK_SECRET</code> in Vercel auf das Live-Geheimnis ändern.',
        'In Vercel <code>BILLING_ENABLED</code> = <code>true</code> für Production anlegen → Redeploy.',
        'Einen echten Kauf mit dem günstigsten Produkt machen und danach in Stripe unter „Zahlungen“ erstatten.'],
      check: 'Der Punkt wird automatisch grün. Der echte Kauf erscheint im Web-Admin unter Analyse und Rechnungen.' },
    // ---------- Sicherheit ----------
    { id: 'cron', group: 'Sicherheit & Betrieb', title: 'Täglicher Lauf (Aufräumen, Fristen-Erinnerungen)', auto: true, ok: has('CRON_SECRET'), time: '3 Minuten',
      why: 'Ohne CRON_SECRET läuft der tägliche Job nicht: keine Fristen-Erinnerungen und keine automatische Löschung alter Daten (Datenschutz).',
      steps: [
        'Einen langen Zufallswert erzeugen: im Passwort-Manager ein Passwort mit 40 Zeichen nur aus Buchstaben und Ziffern generieren.',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>CRON_SECRET</code>, Value = dieser Wert, nur Production, „Save“.`,
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“. Vercel übergibt den Wert danach automatisch an den täglichen Lauf.'],
      check: 'Vercel → Projekt → Reiter <strong>Cron Jobs</strong>: der Job steht dort; am nächsten Tag zeigt „Logs“ einen Lauf mit Status 200.' },
    { id: 'rotate', group: 'Sicherheit & Betrieb', title: 'Im Chat gezeigte Schlüssel austauschen', auto: false, ok: Boolean(manual.rotate), time: '10 Minuten',
      why: 'Schlüssel, die einmal sichtbar waren, gelten als kompromittiert.',
      steps: [
        `${a(SB + '/settings/api-keys', 'Supabase → Project Settings → API Keys')} → bei „Secret keys“ auf <strong>„Add new secret key“</strong>, Name <code>vercel-production</code>, erstellen und kopieren.`,
        `${a(VERCEL, 'Vercel')} → <code>SUPABASE_SERVICE_ROLE_KEY</code> → „⋯“ → „Edit“ → neuen Schlüssel einfügen → „Save“ → Redeploy.`,
        'Nach dem Redeploy prüfen, dass der Web-Admin lädt. Dann in Supabase den alten Secret key über „⋯“ → <strong>„Delete“</strong> entfernen.',
        'Stripe-Testschlüssel rollen (siehe Punkt „Stripe-Testschlüssel“).',
        'BANKSapi-Zugang „immoadv-test“ beim Anbieter ändern oder löschen, falls nicht mehr gebraucht.',
        'Das Passwort ändern, das auf einem Screenshot zu sehen war.'],
      check: 'Web-Admin lädt Nutzer und Analyse ohne Fehler.' },
    { id: 'preview_key', group: 'Sicherheit & Betrieb', title: 'Alte Variable SITE_PREVIEW_KEY löschen', auto: true, ok: !has('SITE_PREVIEW_KEY'), time: '1 Minute',
      why: 'Die Vorschau-Sperre gibt es nicht mehr; der Eintrag ist überflüssig.',
      steps: [`${a(VERCEL, 'Vercel → Environment Variables')} → in der Suche <code>SITE_PREVIEW_KEY</code> eingeben → rechts „⋯“ → <strong>„Remove“</strong> → bestätigen.`, 'Deployments → oberster Eintrag → „⋯“ → „Redeploy“.'],
      check: 'Der Punkt wird nach dem Redeploy automatisch grün.' },
    { id: 'pwned', group: 'Sicherheit & Betrieb', title: 'Schutz vor bekannten (geleakten) Passwörtern', auto: false, ok: Boolean(manual.pwned), optional: true, time: '2 Minuten',
      why: 'Verhindert, dass Kunden Passwörter aus Datenlecks verwenden.',
      steps: [`${a(SB + '/auth/providers?provider=Email', 'Supabase → Authentication → Sign In / Providers → Email')} öffnen.`, '<strong>„Prevent use of leaked passwords“</strong> einschalten (nur in kostenpflichtigen Supabase-Tarifen verfügbar – ist der Schalter gesperrt, Punkt überspringen).', '<strong>„Minimum password length“</strong> auf <code>10</code> setzen → „Save“.'],
      check: 'Registrierung mit dem Passwort <code>Passwort123</code> wird abgelehnt.' },
    { id: 'qa', group: 'Sicherheit & Betrieb', title: 'Testkonto „QA Testfirma (temporär)“ entfernen', auto: true, ok: !(qa && qa.length), time: '1 Minute',
      why: 'Das Testkonto blockiert Ihre Gmail-Adresse für ein echtes Unternehmenskonto.',
      steps: ['Schreiben Sie mir im Chat <strong>„Testfirma löschen“</strong> – ich entferne den Eintrag sauber aus der Datenbank.'],
      check: 'Der Punkt wird automatisch grün.' },
    // ---------- Recht & Sichtbarkeit ----------
    { id: 'legal', group: 'Recht & Sichtbarkeit', title: 'Rechtstexte prüfen lassen', auto: false, ok: Boolean(manual.legal), time: '1–2 Wochen (extern)',
      why: 'Impressum, Datenschutz, Nutzungsbedingungen, Widerruf, AVV und Preise sollten vor dem Start mit zahlenden Kunden fachlich geprüft sein.',
      steps: [
        'Einen Rechtstexte-Dienst (z. B. IT-Recht Kanzlei, Händlerbund) oder einen Anwalt für IT- und Wettbewerbsrecht beauftragen. Pauschalpakete kosten meist 10–40 € pro Monat bzw. einmalig einige hundert Euro.',
        'Diese Seiten prüfen lassen: <code>/impressum</code>, <code>/datenschutz</code>, <code>/nutzungsbedingungen</code>, <code>/widerruf</code>, <code>/angebote</code> (Preisangaben) und die AVV im B2B-Portal.',
        'Ausdrücklich fragen lassen: Hinweise zu § 34i GewO (keine Kreditvermittlung), StBerG (keine Steuerberatung), RDG (Vorlagen) und die Zufriedenheitsgarantie bei der Kreditmappe.',
        'Die Änderungen schicken Sie mir als Text oder PDF – ich übernehme sie.'],
      check: 'Schriftliche Bestätigung der Kanzlei liegt vor.' },
    { id: 'impressum', group: 'Recht & Sichtbarkeit', title: 'Telefonnummer und Angaben im Impressum', auto: false, ok: Boolean(manual.impressum), time: '2 Minuten',
      why: 'Das Impressum braucht einen schnellen, direkten Kontaktweg; je nach Rechtsform auch USt-IdNr. bzw. Registerangaben.',
      steps: ['Schicken Sie mir: Telefonnummer, Rechtsform, ggf. USt-IdNr. und Handelsregister-Nummer – ich trage alles ein.'],
      check: 'immoadv.de/impressum zeigt die Angaben.' },
    { id: 'gsc', group: 'Recht & Sichtbarkeit', title: 'Google Search Console einrichten', auto: false, ok: Boolean(manual.gsc), time: '10 Minuten',
      why: 'Damit Google die Seiten schneller findet und Sie sehen, mit welchen Suchbegriffen Besucher kommen.',
      steps: [
        `${a('https://search.google.com/search-console', 'Google Search Console')} öffnen, mit Ihrem Google-Konto anmelden.`,
        'Auf <strong>„Property hinzufügen“</strong> → linke Box <strong>„Domain“</strong> → <code>immoadv.de</code> → „Weiter“.',
        'Google zeigt einen TXT-Wert (<code>google-site-verification=…</code>) – kopieren.',
        'Hostinger → Domains → immoadv.de → DNS → neuer Eintrag: Typ <code>TXT</code>, Name <code>@</code>, Wert einfügen → speichern.',
        'Zurück bei Google auf <strong>„Bestätigen“</strong> (falls es nicht klappt, nach 30 Minuten erneut).',
        'Links „Sitemaps“ → <code>https://immoadv.de/sitemap.xml</code> eintragen → „Senden“.'],
      check: 'Unter „Sitemaps“ steht Status „Erfolgreich“.' },
    { id: 'testrun', group: 'Recht & Sichtbarkeit', title: 'Einmal alles selbst durchspielen', auto: false, ok: Boolean(manual.testrun), time: '30 Minuten',
      why: 'Echte Daten zeigen Fehler, die Tests mit Beispielwerten nicht finden.',
      steps: [
        'Web-Admin → Partner → <strong>„+ Privatkonto“</strong> mit einer zweiten E-Mail-Adresse anlegen, abmelden und mit dem Startpasswort anmelden.',
        'Ein Objekt anlegen, Schnellrechner und Exposé-Scan testen, Daten exportieren (Konto → Datenschutz).',
        'Web-Admin → Partner → <strong>„+ Unternehmen“</strong> anlegen, auf partner.immoadv.de anmelden, Branche wählen, eine Fall-Analyse mit echten PDFs machen.',
        'Auf immoadv.de/b2b eine Kontoanfrage mit Nachweis senden und im Web-Admin öffnen.',
        'Testkauf (sobald der Stripe-Testschlüssel hinterlegt ist).',
        'Alles, was hakt, mit Screenshot an mich schicken.'],
      check: 'Alle Schritte liefen ohne Fehlermeldung.' },
  ];
  return L;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const { data } = await supabaseAdmin().from('immo_settings').select('value').eq('key', KEY).maybeSingle();
  const manual = (data?.value as Record<string, string>) || {};
  const list = await items(manual);
  return j({ items: list.map((x) => ({ ...x, doneAt: manual[x.id] || null })), env: process.env.VERCEL_ENV || 'lokal' });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = z.object({ id: z.string().regex(/^[a-z_]{2,30}$/), done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('immo_settings').select('value').eq('key', KEY).maybeSingle();
  const v = { ...((data?.value as Record<string, string>) || {}) };
  if (p.data.done) v[p.data.id] = new Date().toISOString(); else delete v[p.data.id];
  const r = await db.from('immo_settings').upsert({ key: KEY, value: v, updated_at: new Date().toISOString(), updated_by: auth.user.email });
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  await adminAudit(auth.user.email, 'setup_mark', p.data.id, { done: p.data.done });
  return j({ ok: true });
}
