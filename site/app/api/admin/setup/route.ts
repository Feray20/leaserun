import '@/lib/env-alias';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { fromAddress } from '@/lib/notify/mail';
import { liveChecks } from '@/lib/admin/livecheck';
import { graphReady } from '@/lib/booking/graph';
import { apiBaseUrl, configIssues } from '@/lib/api/config';
// Dropshipping/Steuersoftware is not part of LeaseRun.
const ebayConfigured = () => false;
const getSettingsFull = async (): Promise<Record<string, unknown> | null> => null;
import { loadSiteCheck } from '@/lib/admin/optimizer';
import { BUDGET_USD, USAGE_KEY, auswertungText, gespraechsskript, kostenUsd, monatJetzt, type Usage } from '@/lib/telefon/assistent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Einrichtung: was noch fehlt, mit Anleitung. Automatisch geprüfte Punkte erkennen ihren Stand selbst;
// Punkte außerhalb von LeaseRun (Supabase-Dashboard, Stripe-Dashboard, Anwalt …) hakt der Administrator ab.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const has = (k: string) => Boolean(process.env[k] && String(process.env[k]).trim());
const KEY = 'setup_manual';
const VERCEL = 'https://vercel.com/feray20/leaserun/settings/environment-variables';
const SB = 'https://supabase.com/dashboard/project/mieoylqhtvghcnvaxutg';
const a = (href: string, t: string) => `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;

type Item = { id: string; group: string; title: string; why: string; steps: string[]; auto: boolean; ok: boolean | null; optional?: boolean; info?: string; time?: string; need?: string; check?: string; copy?: { label: string; text: string }[] };

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


// PayPal an der Stripe-Kasse eingeschaltet? (null = nicht lesbar)
async function paypalOn(): Promise<boolean | null> {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  try {
    const { stripe } = await import('@/lib/billing/stripe');
    const list = await stripe().paymentMethodConfigurations.list({ limit: 20 });
    const cfg = list.data.find((c) => c.is_default && c.active) || list.data.find((c) => c.active);
    const pp = (cfg as unknown as { paypal?: { available?: boolean; display_preference?: { value?: string } } } | undefined)?.paypal;
    return pp ? Boolean(pp.available && pp.display_preference?.value !== 'off') : false;
  } catch { return null; }
}

async function items(manual: Record<string, string>): Promise<Item[]> {
  const msOk = await graphReady().catch(() => false);
  const db = adminConfigured() ? supabaseAdmin() : null;
  const sk = String(process.env.STRIPE_SECRET_KEY || '');
  const live = sk.startsWith('sk_live') || sk.startsWith('rk_live');
  const dom = await resendDomain();
  const apiIssues = configIssues();
  // Steuersoftware: Stand direkt aus der Datenbank
  const tax = db ? await getSettingsFull().catch(() => null) : null;
  const { count: ebayAcc } = db ? await db.from('lr_tax_accounts').select('id', { count: 'exact', head: true }).eq('platform', 'ebay').eq('active', true) : { count: 0 };
  const siteCheck = db ? await loadSiteCheck().catch(() => null) : null;
  const { count: mailDocs } = db ? await db.from('lr_tax_docs').select('id', { count: 'exact', head: true }).not('from_email', 'is', null) : { count: 0 };
  const { data: qa } = db ? await db.from('lr_b2b_accounts').select('id').ilike('company_name', 'QA Testfirma%').limit(1) : { data: [] };
  const telRow = db ? await db.from('lr_settings').select('value').eq('key', USAGE_KEY).maybeSingle().then((r) => r.data?.value as Usage | null, () => null) : null;
  const tel: Usage = telRow && telRow.monat === monatJetzt() ? telRow : { monat: monatJetzt(), minuten: 0, anrufe: 0 };
  const telHook = has('TELEFON_WEBHOOK_TOKEN') || has('RETELL_API_KEY');
  const [pp, ghKey, openProps] = await Promise.all([
    paypalOn(),
    db ? db.from('lr_settings').select('value').eq('key', 'gh_anthropic').maybeSingle().then((r) => r.data?.value as { has?: boolean; at?: string } | null, () => null) : Promise.resolve(null),
    db ? import('@/lib/admin/hq-store').then((m) => m.loadProposals()).then((l) => l.filter((x) => x.status === 'offen'), () => []) : Promise.resolve([]),
  ]);
  const L: Item[] = [
    // ---------- E-Mail ----------
    { id: 'resend', group: 'E-Mail-Versand', title: 'Resend-Schlüssel und Absender in Vercel', auto: true, ok: has('RESEND_API_KEY') && Boolean(fromAddress()), time: '5 Minuten',
      need: 'Zugang zu resend.com und zu Vercel.',
      why: 'Ohne Versand gehen keine Zugangsdaten, Rechnungen, Bestätigungs-Mails oder Neuigkeiten raus.',
      steps: [
        `${a('https://resend.com/api-keys', 'resend.com → API Keys')} öffnen und anmelden.`,
        'Oben rechts auf <strong>„Create API Key“</strong> klicken. Name: <code>leaserun-production</code>. Permission: <strong>Sending access</strong>. Domain: <code>leaserun.com</code>. Auf „Add“ klicken.',
        'Den angezeigten Schlüssel (beginnt mit <code>re_</code>) sofort kopieren – er wird nur einmal gezeigt. Nicht in Chat oder E-Mail einfügen.',
        `${a(VERCEL, 'Vercel → Projekt leaserun → Settings → Environment Variables')} öffnen.`,
        'Auf <strong>„Add New“</strong> klicken. Key: <code>RESEND_API_KEY</code>, Value: den kopierten Schlüssel einfügen. Bei „Environments“ nur <strong>Production</strong> anhaken. „Save“.',
        'Noch einmal „Add New“: Key <code>NOTIFY_FROM_EMAIL</code>, Value <code>LeaseRun &lt;noreply@leaserun.com&gt;</code>, nur Production, „Save“.',
        'Neu deployen: Vercel → Reiter <strong>Deployments</strong> → beim obersten Eintrag rechts auf „⋯“ → <strong>„Redeploy“</strong> → bestätigen. Nach ca. 2 Minuten ist der Punkt hier automatisch grün.'],
      check: 'Web-Admin → System → „Test 1: LeaseRun-E-Mail an mich“. Die E-Mail muss innerhalb einer Minute ankommen.' },
    { id: 'resend_domain', group: 'E-Mail-Versand', title: 'Domain leaserun.com bei Resend bestätigt', auto: dom !== null, ok: dom === null ? manual.resend_domain ? true : false : dom, time: '10 Minuten + Wartezeit',
      need: 'Zugang zu resend.com und zu Hostinger (DNS).',
      info: dom === null ? 'Stand mit dem Sende-Schlüssel nicht lesbar – nach „Test 1“ im Reiter System selbst abhaken.' : undefined,
      why: 'Nur mit bestätigter Domain kommen E-Mails von noreply@leaserun.com an und landen nicht im Spam.',
      steps: [
        `${a('https://resend.com/domains', 'resend.com → Domains')} → <strong>„Add Domain“</strong> → <code>leaserun.com</code> eintragen, Region <strong>Frankfurt (eu-central-1)</strong> → „Add“.`,
        'Resend zeigt jetzt eine Tabelle mit 3–4 DNS-Einträgen (Typ, Name, Wert). Dieses Fenster offen lassen.',
        'In einem zweiten Tab: Hostinger → <strong>Domains</strong> → leaserun.com → <strong>DNS / Nameserver</strong> → „DNS-Einträge verwalten“.',
        'Für jede Zeile aus Resend einen Eintrag anlegen: <strong>Typ</strong> genau wie bei Resend (MX oder TXT), <strong>Name</strong> genau wie bei Resend (z. B. <code>send</code> oder <code>resend._domainkey</code> – ohne „.leaserun.com“ dahinter), <strong>Wert/Inhalt</strong> per Kopieren-Knopf übernehmen, bei MX die Priorität <code>10</code>. TTL unverändert lassen.',
        'Zusätzlich einen TXT-Eintrag anlegen: Name <code>_dmarc</code>, Wert <code>v=DMARC1; p=none;</code>.',
        'Zurück bei Resend auf <strong>„Verify DNS Records“</strong> klicken. Grün wird es meist nach 5–60 Minuten, selten bis 24 Stunden. Einfach später erneut auf „Verify“ klicken.'],
      check: 'Bei Resend steht neben leaserun.com „Verified“. Danach Web-Admin → System → „Test 1“.' },
    { id: 'smtp', group: 'E-Mail-Versand', title: 'Supabase sendet über eigenen Absender (SMTP)', auto: false, ok: Boolean(manual.smtp), time: '5 Minuten',
      need: 'Den Resend-API-Schlüssel (oder einen zweiten nur für Supabase).',
      why: 'Sonst kommen Registrierungs- und Passwort-Mails vom Absender „Supabase Auth“ und sind stark begrenzt (wenige Mails pro Stunde).',
      steps: [
        `${a(SB + '/auth/smtp', 'Supabase → Authentication → Emails → SMTP Settings')} öffnen.`,
        'Schalter <strong>„Enable custom SMTP“</strong> einschalten.',
        'Felder ausfüllen: Sender email <code>noreply@leaserun.com</code> · Sender name <code>LeaseRun</code> · Host <code>smtp.resend.com</code> · Port <code>465</code> · Username <code>resend</code> · Password = Resend-API-Schlüssel.',
        'Unten auf <strong>„Save changes“</strong>.',
        'Gleiche Seite, Abschnitt „Rate Limits“ (oder Authentication → Rate Limits): E-Mails pro Stunde auf mindestens <code>30</code> setzen.'],
      check: 'Web-Admin → System → „Test 2: Konto-E-Mail über Supabase an mich“. Kommt sie mit Absender „LeaseRun“ an, hier „Erledigt“ klicken.' },
    { id: 'templates', group: 'E-Mail-Versand', title: 'LeaseRun-Vorlagen für Konto-E-Mails in Supabase', auto: false, ok: Boolean(manual.templates), time: '10 Minuten',
      why: 'Bestätigungs- und Passwort-Mails im LeaseRun-Design statt im englischen Standardtext.',
      steps: [
        'Web-Admin → Reiter <strong>System</strong> → Abschnitt „E-Mail-Versand“ → die Vorlagen (Bestätigung, Passwort zurücksetzen, Magic Link, E-Mail ändern) öffnen.',
        `${a(SB + '/auth/templates', 'Supabase → Authentication → Emails → Templates')} öffnen.`,
        'Links die Vorlage <strong>„Confirm signup“</strong> wählen: Feld „Subject“ mit dem Betreff aus dem Web-Admin ersetzen, Feld „Message body“ komplett leeren und den HTML-Text aus dem Web-Admin einfügen. „Save changes“.',
        'Dasselbe für <strong>„Reset Password“</strong>, <strong>„Magic Link“</strong> und <strong>„Change Email Address“</strong>.'],
      check: 'Auf leaserun.com/auth/reset ein Passwort-Zurücksetzen für Ihre eigene Adresse anfordern – die Mail muss im LeaseRun-Design ankommen.' },
    { id: 'urls', group: 'E-Mail-Versand', title: 'Supabase: Website-Adresse und erlaubte Rücksprung-Adressen', auto: false, ok: Boolean(manual.urls), time: '3 Minuten',
      why: 'Sonst führen Links in Bestätigungs- und Passwort-Mails ins Leere.',
      steps: [
        `${a(SB + '/auth/url-configuration', 'Supabase → Authentication → URL Configuration')} öffnen.`,
        'Feld <strong>„Site URL“</strong>: <code>https://leaserun.com</code> → „Save“.',
        'Bei <strong>„Redirect URLs“</strong> auf „Add URL“ und nacheinander eintragen: <code>https://leaserun.com/auth/login</code>, <code>https://leaserun.com/auth/reset</code>, <code>https://leaserun.com/auth/callback</code>, <code>https://leaserun.com/auth/confirm</code>, <code>https://leaserun.com/business-portal</code>, <code>https://partner.leaserun.com</code>. Jeweils speichern.'],
      check: 'Link aus einer Passwort-Mail anklicken – er muss auf leaserun.com landen, nicht auf localhost.' },
    { id: 'inbound', group: 'E-Mail-Versand', title: 'Postfach: E-Mails sofort empfangen (Resend-Webhook)', auto: true, ok: has('RESEND_INBOUND_SECRET') || has('RESEND_WEBHOOK_SECRET'), optional: true, time: '3 Minuten',
      need: 'Zugang zu resend.com und zu Vercel.',
      why: 'E-Mails an @leaserun.com kommen bereits an und werden beim Öffnen des Postfachs abgerufen. Mit dem Webhook erscheinen sie sofort und Sie bekommen eine Benachrichtigung.',
      steps: [
        `${a('https://resend.com/webhooks', 'resend.com → Webhooks')} → <strong>„Add Endpoint“</strong>.`,
        'Endpoint URL: <code>https://leaserun.com/api/mail/inbound</code> · Event: <strong>email.received</strong> anhaken → „Add“.',
        'Den neuen Webhook öffnen und das <strong>Signing Secret</strong> (beginnt mit <code>whsec_</code>) kopieren.',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>RESEND_INBOUND_SECRET</code>, Value einfügen, nur Production, „Save“ → Redeploy.`],
      check: 'Eine E-Mail an support@leaserun.com schicken – sie erscheint innerhalb von Sekunden im Web-Admin-Postfach.' },
    { id: 'teams', group: 'E-Mail-Versand', title: 'Termine: mit Microsoft Teams & Outlook verbinden', auto: true, ok: msOk, optional: true, time: '2 Minuten',
      need: 'Ihr Microsoft-365-Konto (E-Mail und Passwort).',
      why: 'Die Buchungsseite leaserun.com/termin läuft bereits. Nach der Anmeldung wird beim Annehmen automatisch ein Teams-Termin in Ihrem Outlook-Kalender angelegt, der Gast bekommt den Teams-Link, und belegte Zeiten aus Outlook werden nicht mehr angeboten.',
      steps: [
        'Web-Admin → <strong>Postfach &amp; Termine → Termine</strong> → „Mit Microsoft anmelden“.',
        'Den angezeigten Code kopieren, die Microsoft-Seite öffnen, Code einfügen und mit Ihrem Microsoft-365-Konto anmelden.',
        'Den Zugriff auf Ihren Kalender mit „Akzeptieren“ bestätigen – der Web-Admin zeigt danach „Verbunden“.'],
      check: 'Termine → „Verbindung testen“ zeigt „Verbunden mit dem Kalender von …“.' },
    // ---------- Zahlungen ----------
    { id: 'stripe_pk', group: 'Zahlungen', title: 'Bezahlung direkt auf leaserun.com (eingebettet)', auto: true, ok: has('STRIPE_PUBLISHABLE_KEY'), optional: true, time: '3 Minuten',
      need: 'Zugang zum Stripe-Dashboard und zu Vercel.',
      why: 'Mit dem veröffentlichbaren Schlüssel läuft die Bezahlung auf leaserun.com/kasse im LeaseRun-Design – Kunden verlassen die Website nicht. Ohne ihn öffnet sich weiter die Stripe-Bezahlseite.',
      steps: [
        `${a('https://dashboard.stripe.com/apikeys', 'Stripe → Entwickler → API-Schlüssel')} öffnen (Live-Modus, Testmodus aus).`,
        'Den <strong>Veröffentlichbaren Schlüssel</strong> kopieren (beginnt mit <code>pk_live_</code>).',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>STRIPE_PUBLISHABLE_KEY</code>, Wert einfügen, nur Production → „Save“ → Redeploy.`,
        'Optional für Vorschau-Deployments: denselben Key mit dem Testschlüssel (<code>pk_test_…</code>) nur für Preview anlegen.'],
      check: 'Auf leaserun.com/angebote ein Angebot wählen → es öffnet sich leaserun.com/kasse mit dem Zahlformular.' },
    { id: 'stripe_brand', group: 'Zahlungen', title: 'Stripe: Zahlarten, Logo und schwarzer Bezahlknopf', auto: false, ok: Boolean(manual.stripe_brand), time: '10 Minuten',
      why: 'Bezahlseite, Rechnungen und Kundenportal erscheinen im LeaseRun-Design, der Bezahlknopf ist schwarz wie Apple Pay, und PayPal/Klarna/SEPA werden angeboten.',
      steps: [
        `${a('https://dashboard.stripe.com/settings/payment_methods', 'Stripe → Einstellungen → Zahlungsmethoden')} öffnen (erst im Testmodus).`,
        'Bei <strong>PayPal</strong>, <strong>Apple Pay</strong>, <strong>Google Pay</strong>, <strong>Klarna</strong> und <strong>SEPA-Lastschrift</strong> jeweils auf „Aktivieren“ bzw. den Schalter einschalten. PayPal verlangt einmal die Verknüpfung mit Ihrem PayPal-Geschäftskonto – den Anweisungen folgen.',
        `${a('https://dashboard.stripe.com/settings/branding', 'Stripe → Einstellungen → Branding')} öffnen.`,
        'Logo hochladen: Datei von <code>https://leaserun.com/brand/leaserun-stripe-logo.png</code> (vorher im Browser öffnen und speichern). Symbol: <code>https://leaserun.com/brand/leaserun-stripe-icon.png</code>.',
        'Markenfarbe <code>#0F2C59</code>. <strong>Akzentfarbe (Buttons) <code>#000000</code></strong> – so ist der Bezahlknopf schwarz wie auf LeaseRun. „Speichern“.',
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
      info: has('STRIPE_WEBHOOK_SECRETT') && !has('STRIPE_WEBHOOK_SECRET') ? 'Tippfehler gefunden: Die Variable heißt in Vercel „STRIPE_WEBHOOK_SECRETT“ (doppeltes T). Die Website liest übergangsweise beide Namen – Zahlungsbestätigungen laufen. Zum Aufräumen: in Vercel eine neue Variable „STRIPE_WEBHOOK_SECRET“ mit demselben Wert (Stripe → Webhooks → Signaturgeheimnis) anlegen, danach die alte löschen → Redeploy.' : undefined,
      why: 'Ohne Webhook werden Tarife nach der Zahlung nicht automatisch aktiviert und Käufe nicht gezählt.',
      steps: [
        `${a('https://dashboard.stripe.com/test/webhooks', 'Stripe → Entwickler → Webhooks')} öffnen (Testmodus an).`,
        'Auf <strong>„Endpunkt hinzufügen“</strong> klicken. Endpunkt-URL: <code>https://leaserun.com/api/stripe/webhook</code>.',
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
    { id: 'vercel_2fa', group: 'Sicherheit & Betrieb', title: 'Vercel-Konto mit zweitem Faktor schützen', auto: false, ok: Boolean(manual.vercel_2fa), time: '3 Minuten',
      why: 'Wer dein Vercel-Konto übernimmt, kann die komplette Website austauschen und alle Schlüssel lesen. Vercel fragt beim Anmelden bereits danach – bisher ist er nicht eingerichtet.',
      steps: [
        `${a('https://vercel.com/account/settings/authentication', 'Vercel → Account Settings → Authentication')} → bei „Two-Factor Authentication“ auf „Enable“.`,
        'Mit der Authenticator-App (z. B. Microsoft Authenticator) den QR-Code scannen und den 6-stelligen Code eingeben.',
        'Die angezeigten Wiederherstellungscodes im Passwort-Manager speichern.'],
      check: 'Beim nächsten Anmelden bei Vercel fragt es nach dem Code aus der App.' },
    { id: 'vercel_watch', group: 'Sicherheit & Betrieb', title: 'Olivia überwacht neue Versionen (Vercel-Schlüssel)', auto: true, ok: has('VERCEL_API_TOKEN'), optional: true, time: '3 Minuten',
      why: 'Lässt sich eine neue Version nicht bauen, bleibt live still die alte stehen. Mit diesem Schlüssel sieht Agentin Olivia das sofort und meldet es.',
      steps: [
        `${a('https://vercel.com/account/settings/tokens', 'Vercel → Account Settings → Tokens')} → „Create Token“: Name <code>leaserun-hq</code>, Scope = Team Feray20, Ablauf 1 Jahr → „Create“ → kopieren.`,
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>VERCEL_API_TOKEN</code>, Value = der Schlüssel, nur Production, „Sensitive“ an, „Save“.`,
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“.'],
      check: 'Headquarters → Olivia → „Jetzt erledigen“: in ihrer Zeile steht „Neue Versionen“ nicht mehr als fehlend; die Prüfung zeigt „Die neueste Version ist live“.' },
    { id: 'anthropic', group: 'LeaseRun Intelligence', title: 'Claude für die Headquarters-Agenten (Anthropic-Schlüssel)', auto: true, ok: has('ANTHROPIC_API_KEY'), time: '10 Minuten',
      need: 'Eine Kreditkarte für das Anthropic-Konto und Zugang zu Vercel.',
      why: 'Damit verstehen die Agenten jede Formulierung, finden Ursachen selbst, beheben Internes und machen Vorschläge mit Begründung. Abgerechnet wird nur, wenn ein Agent wirklich denkt (bei neuen Funden, deinen Aufträgen und einmal am Tag je Abteilung) – die Wache rund um die Uhr ist kostenlos. Tagesbudget im Headquarters einstellbar (Start: 3 $ am Tag).',
      steps: [
        `${a('https://console.anthropic.com/', 'console.anthropic.com')} öffnen und mit der Firmen-E-Mail ein Konto anlegen (oder anmelden).`,
        '<strong>Settings → Billing</strong>: Zahlungsmethode hinterlegen und Guthaben aufladen (z. B. 20 $). Unter <strong>Settings → Limits</strong> ein Monatslimit setzen (Empfehlung: 50 $) – darüber antwortet Claude nicht mehr, die Agenten arbeiten dann regelbasiert weiter.',
        '<strong>Settings → API Keys → „Create Key“</strong>: Name <code>leaserun-hq</code> → „Create“ → Schlüssel (beginnt mit <code>sk-ant-</code>) sofort kopieren. Nicht in Chat oder E-Mail einfügen.',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>ANTHROPIC_API_KEY</code>, Value = der Schlüssel, nur <strong>Production</strong>, „Sensitive“ an, „Save“.`,
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“. Nach ca. 2 Minuten ist der Punkt hier grün.'],
      check: 'Headquarters öffnen: oben steht „Claude: Opus 5.5 / Sonnet 5.5“. Einen Agenten antippen und in eigenen Worten etwas fragen – die Antwort kommt mit Daten statt „nicht verstanden“.' },
    { id: 'gh_dispatch', group: 'LeaseRun Intelligence', title: 'Lösungen sofort umsetzen lassen (GitHub-Schlüssel)', auto: true, ok: has('GITHUB_HQ_TOKEN'), time: '5 Minuten',
      need: 'Zugang zu GitHub und Vercel.',
      why: 'Wenn du bei einer Lösung „Erledigen“ tippst, startet der Umsetzungs-Agent damit sofort und setzt sie im Code um. Ohne diesen Schlüssel wartet der Auftrag, bis die Website das nächste Mal aktualisiert wird. Der Schlüssel darf nur diesen einen Ablauf starten – keinen Code lesen oder ändern.',
      steps: [
        `${a('https://github.com/settings/personal-access-tokens/new', 'GitHub → Fine-grained token anlegen')} öffnen.`,
        'Token name: <code>leaserun-hq</code> · Resource owner: <strong>Feray20</strong> · Expiration: <strong>Custom → in einem Jahr</strong>.',
        'Repository access: <strong>„Only select repositories“</strong> anklicken und im Feld darunter <strong>LeaseRun</strong> auswählen. Wichtig: Bei „Public repositories“ lassen sich keine Rechte vergeben – das ist der häufigste Grund, warum es „nicht geht“.',
        'Unter <strong>Permissions</strong> auf <strong>„+ Add permissions“</strong> klicken → in der Liste <strong>„Actions“</strong> anhaken → daneben von „Read-only“ auf <strong>„Read and write“</strong> umstellen. „Metadata: Read-only“ trägt GitHub automatisch mit ein – das ist Pflicht und richtig. (Ältere Ansicht ohne „+ Add permissions“: „Repository permissions“ aufklappen → bei „Actions“ „Read and write“ wählen.)',
        'Ganz unten <strong>„Generate token“</strong> → Schlüssel (beginnt mit <code>github_pat_</code>) sofort kopieren – er wird nur einmal angezeigt.',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>GITHUB_HQ_TOKEN</code>, Value = der Schlüssel, nur <strong>Production</strong>, „Sensitive“ an, „Save“.`,
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“. Nach ca. 2 Minuten ist der Punkt hier grün.'],
      check: 'Bei einer Lösung „Erledigen“ tippen: Sie springt auf „Wird gerade umgesetzt …“, nach 5–15 Minuten steht dort „✓ …“ und du bekommst eine Mitteilung.' },
    { id: 'hq_loesungen', group: 'LeaseRun Intelligence', title: `Lösungen der Agenten entscheiden${openProps.length ? ` (${openProps.length} offen)` : ''}`, auto: true, ok: openProps.length === 0, time: '2 Minuten',
      why: 'Die Agenten haben Lösungen vorbereitet, die nach außen wirken (Website, Beiträge, Einstellungen). Sie warten nur auf dein „Erledigen“ oder „Verwerfen“.',
      steps: [
        'Web-Admin → <strong>Headquarters</strong> öffnen und oben auf deine Karte <strong>„Feray Korkmaz · Founder Head“</strong> tippen.',
        ...openProps.slice(0, 8).map((x) => `<strong>${x.title.replace(/[<>&]/g, '')}</strong> – „Erledigen“ oder „Verwerfen“.`),
        'Der Punkt verschwindet hier, sobald keine Lösung mehr offen ist.'],
      check: 'In deiner Karte steht „Lösungen zur Freigabe (0)“.' },
    { id: 'paypal', group: 'Zahlungen', title: 'PayPal an der Kasse einschalten', auto: pp !== null, ok: pp === null ? Boolean(manual.paypal) : pp, time: '5 Minuten',
      need: 'Zugang zu stripe.com (dein LeaseRun-Konto) und dein PayPal-Geschäftskonto.',
      why: 'An deiner Kasse fehlt PayPal – für viele Käufer in Deutschland die bevorzugte Zahlart. Ohne PayPal brechen sie häufiger ab.',
      steps: [
        `${a('https://dashboard.stripe.com/settings/payment_methods', 'Stripe → Einstellungen → Zahlungsmethoden')} öffnen.`,
        'Bei <strong>PayPal</strong> auf „Aktivieren“ bzw. „Turn on“ klicken und den Schritten folgen (PayPal-Geschäftskonto verbinden).',
        'Fertig – Website und Kasse zeigen PayPal danach automatisch an. Der Punkt hier verschwindet von selbst.'],
      check: 'Auf leaserun.com „Kreditmappe erstellen“ → weiter zur Bezahlung: PayPal steht bei den Zahlarten.' },
    // Express-Anmeldung über die eigene Adresse: Anbieter zeigt „leaserun.com“ statt der Supabase-Adresse (lib/auth/sso.ts).
    ...(['google', 'azure', 'apple'] as const).map((p): Item => {
      const name = p === 'google' ? 'Google' : p === 'azure' ? 'Microsoft' : 'Apple';
      const cb = (h: string) => `https://${h}/api/auth/sso/callback/${p}`;
      const envs = p === 'google' ? ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'] : p === 'azure' ? ['AZURE_OAUTH_CLIENT_ID', 'AZURE_OAUTH_CLIENT_SECRET'] : ['APPLE_SERVICES_ID', 'APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY'];
      const sbProv = `${a(SB + '/auth/providers', 'Supabase → Authentication → Sign In / Providers')} → <strong>${name}</strong>`;
      const steps = p === 'google' ? [
        `${a('https://console.cloud.google.com/apis/credentials', 'Google Cloud → APIs &amp; Dienste → Anmeldedaten')} öffnen und den <strong>bestehenden OAuth-Client</strong> öffnen, den LeaseRun schon nutzt (dieselbe Client-ID wie bei ${sbProv}).`,
        'Bei <strong>„Autorisierte Weiterleitungs-URIs“</strong> die beiden Adressen unten hinzufügen (die alte Supabase-Adresse stehen lassen) → <strong>„Speichern“</strong>.',
        'Unter <strong>„OAuth-Zustimmungsbildschirm“ → Branding</strong>: App-Name <code>LeaseRun</code>, Startseite <code>https://leaserun.com</code>, autorisierte Domain <code>leaserun.com</code>.',
        `${a(VERCEL, 'Vercel → Environment Variables')}: <code>GOOGLE_OAUTH_CLIENT_ID</code> und <code>GOOGLE_OAUTH_CLIENT_SECRET</code> (Werte aus dem OAuth-Client) für <strong>Production</strong> anlegen → Redeploy.`,
      ] : p === 'azure' ? [
        `${a('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', 'Azure → App-Registrierungen')} öffnen und die <strong>bestehende App</strong> öffnen, die LeaseRun schon nutzt (dieselbe Client-ID wie bei ${sbProv}).`,
        '<strong>Authentifizierung → Web → Umleitungs-URIs</strong>: die beiden Adressen unten hinzufügen (alte stehen lassen) → <strong>„Speichern“</strong>.',
        '<strong>Branding</strong>: Name <code>LeaseRun</code>, Startseite <code>https://leaserun.com</code>.',
        `${a(VERCEL, 'Vercel → Environment Variables')}: <code>AZURE_OAUTH_CLIENT_ID</code> (Anwendungs-ID) und <code>AZURE_OAUTH_CLIENT_SECRET</code> (unter „Zertifikate &amp; Geheimnisse“ ein neues Geheimnis erstellen, den <em>Wert</em> kopieren) für <strong>Production</strong> anlegen → Redeploy.`,
      ] : [
        `${a('https://developer.apple.com/account/resources/identifiers/list/serviceId', 'Apple Developer → Identifiers → Services IDs')} öffnen und die <strong>bestehende Services ID</strong> öffnen, die LeaseRun schon nutzt (dieselbe wie bei ${sbProv}).`,
        'Bei <strong>Sign in with Apple → Configure</strong>: unter „Domains“ <code>leaserun.com</code> und <code>partner.leaserun.com</code>, unter „Return URLs“ die beiden Adressen unten eintragen → „Done“ → „Save“.',
        `Unter ${a('https://developer.apple.com/account/resources/authkeys/list', 'Keys')} einen Schlüssel mit „Sign in with Apple“ nehmen (oder neu erstellen) und die <code>.p8</code>-Datei herunterladen.`,
        `${a(VERCEL, 'Vercel → Environment Variables')} für <strong>Production</strong>: <code>APPLE_SERVICES_ID</code> (Services ID), <code>APPLE_TEAM_ID</code> (oben rechts im Apple-Konto), <code>APPLE_KEY_ID</code> (ID des Schlüssels) und <code>APPLE_PRIVATE_KEY</code> (kompletten Inhalt der .p8-Datei einfügen) → Redeploy.`,
      ];
      return { id: `sso_${p}`, group: 'Anmeldung', title: `${name}-Anmeldung über leaserun.com statt Supabase`, auto: true, ok: envs.every(has), optional: true, time: p === 'apple' ? '15 Minuten' : '10 Minuten',
        need: `Zugang zu ${p === 'google' ? 'Google Cloud' : p === 'azure' ? 'Azure (Microsoft)' : 'Apple Developer'} und zu Vercel.`,
        why: `Beim Anmelden mit ${name} steht dann „weiter zu leaserun.com“ statt der kryptischen Supabase-Adresse – das wirkt vertrauenswürdiger. Konten bleiben dieselben; bis die Werte eingetragen sind, läuft die Anmeldung wie bisher.`,
        steps: [...steps, 'Der Punkt hakt sich nach dem Redeploy von selbst ab.'],
        copy: [{ label: 'Rücksprung leaserun.com', text: cb('leaserun.com') }, { label: 'Rücksprung partner.leaserun.com', text: cb('partner.leaserun.com') }],
        check: `Auf leaserun.com abmelden → „Mit ${name} anmelden“: Im Anmeldefenster steht leaserun.com, danach bist du eingeloggt.` };
    }),
    { id: 'gsc_sitemap', group: 'Recht & Sichtbarkeit', title: 'Google: Sitemap neu einreichen und Indexierung anstoßen', auto: false, ok: Boolean(manual.gsc_sitemap), time: '10 Minuten',
      need: 'Zugang zur Google Search Console (leaserun.com).',
      why: 'Nach dem kurzen Ausfall und den neuen Kurzantworten auf allen Wissen-Seiten soll Google schnell neu crawlen. Von 110 Seiten sind erst wenige im Index.',
      steps: [
        `${a('https://search.google.com/search-console/sitemaps', 'Search Console → Sitemaps')} öffnen, <code>sitemap.xml</code> eintragen → <strong>„Senden“</strong>.`,
        'Oben in die Suchleiste nacheinander diese Adressen eintragen und jeweils <strong>„Indexierung beantragen“</strong> tippen (Google erlaubt ca. 10 pro Tag): <code>https://leaserun.com/</code>, <code>https://leaserun.com/learn</code>, <code>https://leaserun.com/calculators</code>, <code>https://leaserun.com/guides</code>, <code>https://leaserun.com/pricing</code>, <code>https://leaserun.com/business</code>, <code>https://leaserun.com/learn/wie-viel-immobilie-kann-ich-mir-leisten</code>, <code>https://leaserun.com/learn/wie-viel-eigenkapital-brauche-ich</code>.',
        'Unter <strong>Indexierung → Seiten</strong> die Tabelle „Warum Seiten nicht indexiert werden“ ansehen; Gründe, die du nicht verstehst, als Screenshot an Claude.',
        'Hier „Fertig – als erledigt markieren“.'],
      check: 'In 1–3 Wochen steigt in der Search Console die Zahl „indexierte Seiten“.' },
    { id: 'rotate', group: 'Sicherheit & Betrieb', title: 'Im Chat gezeigte Schlüssel austauschen', auto: false, ok: Boolean(manual.rotate), time: '10 Minuten',
      why: 'Schlüssel, die einmal sichtbar waren, gelten als kompromittiert.',
      steps: [
        `${a(SB + '/settings/api-keys', 'Supabase → Project Settings → API Keys')} → bei „Secret keys“ auf <strong>„Add new secret key“</strong>, Name <code>vercel-production</code>, erstellen und kopieren.`,
        `${a(VERCEL, 'Vercel')} → <code>SUPABASE_SERVICE_ROLE_KEY</code> → „⋯“ → „Edit“ → neuen Schlüssel einfügen → „Save“ → Redeploy.`,
        'Nach dem Redeploy prüfen, dass der Web-Admin lädt. Dann in Supabase den alten Secret key über „⋯“ → <strong>„Delete“</strong> entfernen.',
        'Stripe-Testschlüssel rollen (siehe Punkt „Stripe-Testschlüssel“).',
        'BANKSapi-Zugang „leaserun-test“ beim Anbieter ändern oder löschen, falls nicht mehr gebraucht.',
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
    // ---------- API Management ----------
    { id: 'api_secrets', group: 'API Management', title: 'API-Schlüssel und Verschlüsselung (Vercel)', auto: true, ok: !apiIssues.includes('API_KEY_PEPPER') && !apiIssues.includes('API_ENCRYPTION_KEY'), time: 'erledigt',
      info: apiIssues.length ? `Fehlt: ${apiIssues.join(', ')}` : 'API_KEY_PEPPER und API_ENCRYPTION_KEY sind gesetzt.',
      why: 'Ohne diese beiden Geheimnisse kann LeaseRun keine API-Schlüssel ausgeben und keine Webhooks signieren – das API Management bleibt gesperrt.',
      steps: [
        'Beide Werte sind in Vercel als geheime Variablen hinterlegt (Production und Preview). Nichts weiter zu tun.',
        '<strong>Wichtig:</strong> Die Werte nie ändern oder löschen – sonst werden alle ausgegebenen API-Schlüssel ungültig und Webhook-Signaturen unlesbar.',
        `Falls dieser Punkt rot ist: ${a(VERCEL, 'Vercel → Environment Variables')} prüfen, ob <code>API_KEY_PEPPER</code> (mind. 32 Zeichen) und <code>API_ENCRYPTION_KEY</code> (64 Hex-Zeichen) vorhanden sind, dann neu deployen.`],
      check: 'Web-Admin → API Management öffnet ohne Warnhinweis; „Neuer API-Schlüssel“ ist möglich.' },
    { id: 'api_db', group: 'API Management', title: 'API-Datenbank und privater Speicher', auto: true, ok: !apiIssues.includes('SUPABASE') && Boolean(db), time: 'erledigt',
      info: 'Tabellen api_* und Speicher „api-private“ sind angelegt.',
      why: 'Hier liegen Mandanten, Schlüssel (nur als Hash), Fälle, Dokumente, Protokolle und Webhook-Zustellungen.',
      steps: ['Bereits eingerichtet – keine Aktion nötig.'] },
    { id: 'api_domain', group: 'API Management', title: 'Eigene Adresse api.leaserun.com (optional)', auto: true, ok: Boolean(process.env.API_BASE_URL) || process.env.VERCEL_ENV === 'production', optional: true, time: '10 Minuten',
      info: `Aktuelle API-Adresse: ${apiBaseUrl()}`,
      why: 'Die API läuft bereits unter leaserun.com/api/v1. Eine eigene Subdomain wirkt professioneller in der Partner-Dokumentation, ist aber nicht nötig.',
      steps: [
        'Vercel → Projekt leaserun → Settings → <strong>Domains</strong> → <code>api.leaserun.com</code> hinzufügen; den angezeigten CNAME bei Hostinger (DNS) eintragen.',
        `${a(VERCEL, 'Vercel → Environment Variables')}: <code>API_BASE_URL</code> = <code>https://api.leaserun.com/api/v1</code> (Production), danach neu deployen.`] },
    { id: 'api_scan', group: 'API Management', title: 'Virenprüfung für hochgeladene Dokumente', auto: true, ok: true, optional: true, time: '15 Minuten',
      info: process.env.MALWARE_SCAN_URL ? 'Virenprüfung aktiv: eigene Prüfung + externer Scanner.' : 'Eigene Virenprüfung aktiv (alle PDF- und Bild-Uploads sowie Postfach-Anhänge: Skripte, Programmstarts, eingebettete Dateien, versteckte Programme). Ein externer Scanner ist optional zusätzlich möglich.',
      why: 'Partner laden über die API Unterlagen hoch. Ein externer Scanner (z. B. ClamAV-Dienst) prüft sie zusätzlich auf Schadsoftware.',
      steps: ['Scanner-Dienst mit HTTP-Schnittstelle bereitstellen (POST mit Dateiinhalt, Antwort „clean“/„infected“).', `In ${a(VERCEL, 'Vercel')} <code>MALWARE_SCAN_URL</code> und ggf. <code>MALWARE_SCAN_TOKEN</code> setzen, neu deployen.`] },
    { id: 'legal', group: 'Recht & Sichtbarkeit', title: 'Rechtstexte prüfen lassen', auto: false, ok: Boolean(manual.legal), time: '1–2 Wochen (extern)',
      why: 'Impressum, Datenschutz, Nutzungsbedingungen, Widerruf, AVV und Preise sollten vor dem Start mit zahlenden Kunden fachlich geprüft sein.',
      steps: [
        'Einen Rechtstexte-Dienst (z. B. IT-Recht Kanzlei, Händlerbund) oder einen Anwalt für IT- und Wettbewerbsrecht beauftragen. Pauschalpakete kosten meist 10–40 € pro Monat bzw. einmalig einige hundert Euro.',
        'Diese Seiten prüfen lassen: <code>/legal-notice</code>, <code>/privacy</code>, <code>/terms</code>, <code>/widerruf</code>, <code>/pricing</code> (Preisangaben) und die AVV im B2B-Portal.',
        'Ausdrücklich fragen lassen: Hinweise zu § 34i GewO (keine Kreditvermittlung), StBerG (keine Steuerberatung), RDG (Vorlagen) und die Bank-Akzeptanz-Garantie bei der Kreditmappe.',
        'Die Änderungen schicken Sie mir als Text oder PDF – ich übernehme sie.'],
      check: 'Schriftliche Bestätigung der Kanzlei liegt vor.' },
    { id: 'impressum', group: 'Recht & Sichtbarkeit', title: 'Telefonnummer und Angaben im Impressum', auto: false, ok: Boolean(manual.impressum), time: '2 Minuten',
      why: 'Das Impressum braucht einen schnellen, direkten Kontaktweg; je nach Rechtsform auch USt-IdNr. bzw. Registerangaben.',
      steps: ['Schicken Sie mir: Telefonnummer, Rechtsform, ggf. USt-IdNr. und Handelsregister-Nummer – ich trage alles ein.'],
      check: 'leaserun.com/impressum zeigt die Angaben.' },
    { id: 'gsc', group: 'Recht & Sichtbarkeit', title: 'Google Search Console einrichten (wichtigster Punkt für die Sichtbarkeit)', auto: false, ok: Boolean(manual.gsc), time: '10 Minuten',
      info: has('GOOGLE_SITE_VERIFICATION') ? 'Bestätigungs-Code (GOOGLE_SITE_VERIFICATION) ist in Vercel hinterlegt.' : 'Noch kein Bestätigungs-Code in Vercel (GOOGLE_SITE_VERIFICATION). Stand heute kennt Google leaserun.com nicht – die Seite taucht in keiner Suche auf.',
      why: 'Ohne Search Console bekommt Google die Sitemap nie gemeldet, und Sie sehen nicht, welche Seiten Google kennt und mit welchen Suchbegriffen Besucher kommen.',
      steps: [
        `${a('https://search.google.com/search-console', 'Google Search Console')} öffnen, mit Ihrem Google-Konto anmelden.`,
        'Auf <strong>„Property hinzufügen“</strong> → rechte Box <strong>„URL-Präfix“</strong> → <code>https://leaserun.com</code> → „Weiter“.',
        'Bei „Bestätigung“ die Methode <strong>„HTML-Tag“</strong> wählen. Google zeigt <code>&lt;meta name="google-site-verification" content="…"&gt;</code> – nur den Wert aus <code>content="…"</code> kopieren.',
        `${a(VERCEL, 'Vercel')} → „Add New“: Key <code>GOOGLE_SITE_VERIFICATION</code>, Value einfügen, Production, „Save“ → Redeploy. Oder den Wert im Chat an Claude schicken – wird dann eingetragen.`,
        'Nach dem Redeploy zurück bei Google auf <strong>„Bestätigen“</strong>.',
        'Links „Sitemaps“ → <code>https://leaserun.com/sitemap.xml</code> eintragen → „Senden“.',
        'Optional dasselbe bei Bing: Bing Webmaster Tools → „Mit Google Search Console importieren“ (eine Minute, übernimmt alles).'],
      check: 'Unter „Sitemaps“ steht Status „Erfolgreich“; nach einigen Tagen erscheinen unter „Seiten“ indexierte Seiten.' },
    // ---------- Steuersoftware ----------
    { id: 'tax_daten', group: 'Steuersoftware', title: 'Steuerdaten und Kanzlei eintragen', auto: true, ok: Boolean(tax?.firma && tax?.steuernummer && tax?.beraterNr && tax?.mandantNr && tax?.kanzleiEmail), time: '10 Minuten',
      need: 'Steuernummer, Berater- und Mandantennummer (stehen auf Post der Steuerkanzlei), E-Mail der Kanzlei.',
      why: 'Ohne diese Angaben kann kein DATEV-Buchungsstapel erzeugt und kein Monatspaket an die Kanzlei geschickt werden.',
      steps: ['Web-Admin → <strong>Steuersoftware</strong> → Kanzlei → <strong>„Steuerdaten“</strong> öffnen.', 'Firmenname, Anschrift, Steuernummer, Finanzamt und Besteuerung (Regel/Kleinunternehmer) eintragen.', 'Beraternummer, Mandantennummer, E-Mail der Kanzlei und – falls vorhanden – die DATEV-Upload-Adresse eintragen.', 'Auf <strong>„Speichern“</strong> klicken. Der Punkt wird hier automatisch grün.'],
      check: 'Steuersoftware → Start zeigt keine Meldung „Steuerdaten fehlen“ mehr.' },
    { id: 'tax_ebay_keys', group: 'Steuersoftware', title: 'eBay-Entwicklerzugang in Vercel hinterlegen', auto: true, ok: ebayConfigured() && has('EBAY_VERIFICATION_TOKEN'), time: '20 Minuten',
      need: 'Zugang zu developer.ebay.com (mit einem der eBay-Konten anmelden) und zu Vercel.',
      why: 'Ohne den Zugang kann die Software Verkäufe und Gebühren nicht automatisch von eBay abholen.',
      steps: [`${a('https://developer.ebay.com/my/keys', 'developer.ebay.com → My Account → Application Keys')} öffnen und anmelden.`, 'Bei <strong>Production</strong> ein Schlüsselpaar erzeugen (Name z. B. <code>LeaseRun Steuer</code>). App ID (Client ID) und Cert ID (Client Secret) kopieren – nicht in Chat oder E-Mail einfügen.', 'Unter <strong>User Tokens → Get a Token from eBay via Your Application</strong> eine Weiterleitungsadresse (RuName) anlegen: Accept-URL <code>https://leaserun.com/api/tax/ebay/callback</code>. Den RuName kopieren.', 'Unter <strong>Alerts &amp; Notifications → Marketplace Account Deletion</strong>: Endpunkt <code>https://leaserun.com/api/tax/ebay/loeschung</code>, dazu einen selbst ausgedachten Bestätigungs-Code (32–80 Zeichen, nur Buchstaben/Zahlen) eintragen.', `${a(VERCEL, 'Vercel → Environment Variables')}: <code>EBAY_CLIENT_ID</code>, <code>EBAY_CLIENT_SECRET</code>, <code>EBAY_RU_NAME</code> und <code>EBAY_VERIFICATION_TOKEN</code> (der Bestätigungs-Code) anlegen, jeweils nur Production.`, 'Neu deployen (Deployments → „⋯“ → Redeploy). Danach bei eBay unter Account Deletion auf „Send Test Notification“ klicken.'],
      check: 'eBay zeigt beim Endpunkt einen grünen Haken; hier wird der Punkt grün.' },
    { id: 'tax_ebay_konten', group: 'Steuersoftware', title: 'Beide eBay-Geschäftskonten verbinden', auto: true, ok: (ebayAcc || 0) >= 2, time: '5 Minuten',
      why: 'Erst dann holt die Software jeden Tag Verkäufe, Erstattungen und Gebühren beider Konten.',
      steps: ['Web-Admin → Steuersoftware → Dropshipping → <strong>Konten</strong>.', 'Auf <strong>„eBay-Konto verbinden“</strong> klicken, mit dem ersten Geschäftskonto anmelden und zustimmen.', 'Abmelden bei eBay, dann dasselbe mit dem zweiten Geschäftskonto.', 'Bei jedem Konto einmal <strong>„Verlauf laden“</strong> klicken (holt die letzten Monate).'],
      check: `Konten zeigt zwei verbundene eBay-Konten (aktuell: ${ebayAcc || 0}).` },
    { id: 'tax_belege', group: 'Steuersoftware', title: 'Rechnungen aus Gmail automatisch weiterleiten', auto: true, ok: (mailDocs || 0) > 0, time: '10 Minuten',
      why: 'Amazon-, Abo- und sonstige Rechnungen landen dann ohne Zutun in der Steuersoftware und werden zugeordnet.',
      steps: ['Gmail → Einstellungen (Zahnrad) → <strong>Alle Einstellungen</strong> → <strong>Weiterleitung und POP/IMAP</strong> → „Weiterleitungsadresse hinzufügen“: <code>belege@leaserun.com</code>.', 'Web-Admin → <strong>Postfach</strong> (Posteingang): die <strong>neueste</strong> Mail „Gmail: Bestätigen der Weiterleitung“ öffnen und den <strong>Bestätigungslink</strong> darin anklicken (angemeldet mit deinem Gmail-Konto). Einen Code gibt es nicht. Danach in Gmail <strong>nicht</strong> „Weiterleitung aktivieren“ einschalten – nur Rechnungen sollen über den Filter weitergeleitet werden.', 'Gmail → Suchleiste: <code>has:attachment filename:pdf (rechnung OR invoice OR beleg)</code> → Filter-Symbol rechts im Suchfeld → „Filter erstellen“ → <strong>„Weiterleiten an“</strong> anhaken und <code>belege@leaserun.com</code> wählen → „Filter erstellen“.', 'Optional zweiter Filter für Amazon: <code>from:(auto-confirm@amazon.de OR bestellbestaetigung@amazon.de)</code> → weiterleiten.'],
      check: `Steuersoftware → Belege zeigt neue Belege mit Absender (bisher per E-Mail: ${mailDocs || 0}).` },
    { id: 'tax_autopilot', group: 'Steuersoftware', title: 'Autopilot: Monatspaket automatisch an die Kanzlei', auto: true, ok: Boolean(tax?.autopilot), optional: true, time: '1 Minute',
      why: 'Am eingestellten Arbeitstag geht das Paket von selbst raus; ohne Autopilot kommt nur eine Erinnerung zum Freigeben.',
      steps: ['Erst einschalten, wenn ein Monat probeweise geprüft wurde: Steuersoftware → Kanzlei → Paket erstellen und ansehen.', 'Steuersoftware → <strong>Steuerdaten</strong> → <strong>„Autopilot“</strong> einschalten → Speichern.'],
      check: 'Steuersoftware → Start zeigt „Autopilot an“.' },
    // ---------- Website-Inhalte: Vorschau & Freischaltung ----------
    { id: 'gate_einstellen', group: 'Website-Inhalte', title: 'Vorschau & Freischaltung festlegen', auto: false, ok: Boolean(manual.gate_einstellen), time: '3 Minuten',
      why: 'Legt fest, was Besucher ohne Zugang sehen: Wissenszentrale (Leseproben), Rechner (Beispielwerte), Beispiele (Leseprobe der PDFs).',
      steps: ['Web-Admin → oben <strong>B2C</strong> → links <strong>Freischaltung</strong>.', 'Für Wissen, Rechner und Beispiele jeweils „Nur Vorschau ohne Zugang“ oder „Für alle offen“ wählen.', 'Anzahl der Leseproben (Standard 10) und den Anteil der PDF-Seiten (Standard 20 %) prüfen → <strong>Speichern</strong>.', 'Hier auf „Erledigt“ klicken.'],
      check: 'leaserun.com/wissen in einem privaten Fenster öffnen: oben steht „Vorschau“, nur die Leseproben zeigen einen Satz.' },
    { id: 'gate_test', group: 'Website-Inhalte', title: 'Freischaltung mit einem Kundenkonto testen', auto: false, ok: Boolean(manual.gate_test), time: '10 Minuten',
      why: 'Stellt sicher, dass zahlende oder freigeschaltete Kunden wirklich alles sehen – und andere nicht.',
      steps: ['Ein Testkonto (zweite E-Mail-Adresse) als Privatkunde anlegen oder ein vorhandenes nehmen.', 'Web-Admin → B2C → <strong>Nutzer</strong> → beim Testkonto <strong>„Zugriff freischalten“</strong> → unter „Inhalte“ nur <strong>Wissenszentrale komplett</strong> auf „Frei“ → Speichern.', 'Im privaten Fenster mit dem Testkonto anmelden → leaserun.com/wissen: alle Antworten mit Rechenweg sichtbar, nichts markier- oder kopierbar.', 'leaserun.com/mustermappe: weiterhin Vorschau (Beispiele nicht freigeschaltet). Dann auch „Beispiele komplett“ freischalten und prüfen, dass „Ansehen“ das ganze PDF zeigt.', 'Freigaben beim Testkonto wieder entfernen.'],
      check: 'Wissen offen, Beispiele erst nach eigener Freigabe offen – genau wie eingestellt.' },
    // ---------- Darstellungsprüfung ----------
    { id: 'sitecheck', group: 'Sicherheit & Betrieb', title: 'Automatische Darstellungsprüfung (Agent Noah)', auto: true, ok: Boolean(siteCheck), time: 'automatisch',
      why: 'Ein Browser prüft jede Nacht und nach jedem Update alle Seiten am Handy und Computer: überlappende Knöpfe, zu kleine Schrift, doppelte Einträge, kaputte Links, Skriptfehler. Ergebnis im Headquarters.',
      steps: ['Läuft von selbst jede Nacht und nach jedem Update (GitHub → Actions → „Darstellung prüfen“). Kein Handgriff nötig.', 'Sofort starten: GitHub → Repository LeaseRun → Actions → „Darstellung prüfen“ → <strong>„Run workflow“</strong>.'],
      check: 'Headquarters → Noah · Optimierung zeigt „Darstellung geprüft“ mit Datum.' },
    { id: 'testrun', group: 'Recht & Sichtbarkeit', title: 'Einmal alles selbst durchspielen', auto: false, ok: Boolean(manual.testrun), time: '30 Minuten',
      why: 'Echte Daten zeigen Fehler, die Tests mit Beispielwerten nicht finden.',
      steps: [
        'Web-Admin → Partner → <strong>„+ Privatkonto“</strong> mit einer zweiten E-Mail-Adresse anlegen, abmelden und mit dem Startpasswort anmelden.',
        'Ein Objekt anlegen, Schnellrechner und Exposé-Scan testen, Daten exportieren (Konto → Datenschutz).',
        'Web-Admin → Partner → <strong>„+ Unternehmen“</strong> anlegen (Branche wird aus der Art übernommen), im Unternehmensportal anmelden, eine Fall-Analyse mit echten PDFs machen.',
        'Auf leaserun.com/b2b eine Kontoanfrage mit Nachweis senden und im Web-Admin öffnen.',
        'Web-Admin → Testkauf: einen Tarif mit Testkarte 4242 4242 4242 4242 kaufen.',
        'Web-Admin → Postfach: eine E-Mail an Ihre eigene Adresse senden und darauf antworten – die Antwort erscheint im Posteingang.',
        'Alles, was hakt, mit Screenshot an mich schicken.'],
      check: 'Alle Schritte liefen ohne Fehlermeldung.' },
    // ---------- Telefon-Assistent ----------
    // Plan: Retell AI (Abrechnung nur nach Minuten) + nationale 032-Nummer von Telnyx (kein Wohnort sichtbar) + Zusammenfassung
    // per Webhook ins Postfach support@leaserun.com. Ziel: ca. 20 $ im Monat. Reihenfolge = Reihenfolge der Punkte.
    { id: 'tel_plan', group: 'Telefon-Assistent', title: '1 · Der Plan im Überblick (zuerst lesen)', auto: false, ok: Boolean(manual.tel_plan), time: '5 Minuten',
      why: 'Eine KI-Assistentin („Lena“) nimmt Anrufe für LeaseRun an, beantwortet Fragen zu Preisen und Software selbst und schickt dir danach nur eine Zusammenfassung. Ziel: ca. 20 $ im Monat, dein Wohnort und deine Handynummer bleiben privat.',
      steps: [
        '<strong>Telefonnummer:</strong> eine <strong>nationale 032-Nummer</strong> (z. B. 032 2xxx xxxx) von Telnyx, ca. 1–2 $ im Monat. Sie hat <strong>keine Vorwahl und keinen Ortsbezug</strong> – Anrufer sehen nicht, wo du wohnst. Eine Ortsnummer (z. B. 06162) oder 030 würde den Ort verraten bzw. verlangt eine Adresse genau in diesem Ort.',
        '<strong>Deine Adresse</strong> musst du nur Telnyx einmal nachweisen (gesetzliche Pflicht in Deutschland). Sie wird <strong>nicht veröffentlicht</strong>, nicht angesagt und nicht an Anrufer weitergegeben. Einen Telefonbucheintrag gibt es nur, wenn du ihn selbst beantragst.',
        '<strong>Die Assistentin:</strong> Retell AI, natürliche deutsche Stimme, leise Büro-Geräusche im Hintergrund, keine Warteschleife. Sie beginnt immer mit „…Sie sprechen mit Lena, der digitalen Assistentin“ – dieser Hinweis ist seit August 2026 Pflicht (KI-Verordnung) und schützt dich vor Abmahnungen.',
        '<strong>Wissen:</strong> Alle Preise und Leistungen kommen automatisch aus deiner Preisliste auf leaserun.com. Ändern sich Preise, kopierst du das Skript (Punkt 4) einfach neu.',
        '<strong>Nach jedem Anruf</strong> kommt eine Zusammenfassung ins Postfach support@leaserun.com: wer, Nummer, Anliegen, Rückruf ja/nein. Werbeanrufe werden aussortiert. <strong>Kein Mitschnitt</strong>, keine Wortprotokolle.',
        `<strong>Kosten:</strong> ca. 0,10 $ pro Minute + ca. 2 $ für die Nummer. 20 $ reichen für ca. 180 Minuten = rund 50–60 Anrufe à 3 Minuten. Gespräche sind auf 5 Minuten begrenzt. Bei 80 % und 100 % des Budgets bekommst du eine Warnung (Punkt 6).`,
        '<strong>Deine Aufgaben:</strong> Punkte 2–3 (Konten anlegen, Nummer bestellen, ca. 30 Minuten + Prüfzeit bei Telnyx). <strong>Punkt 4–5</strong> ist Kopieren und Einfügen. Punkt 7 (Datenschutz) erledige ich, sobald du mir die Nummer schickst.'],
      check: 'Du weißt, welche Konten du anlegst und was es kostet – dann „Erledigt“.' },
    { id: 'tel_retell', group: 'Telefon-Assistent', title: '2 · Retell-Konto anlegen und Schlüssel hinterlegen', auto: true, ok: has('RETELL_API_KEY'), time: '10 Minuten',
      need: 'Firmen-E-Mail (support@leaserun.com), eine Karte für das Guthaben, Zugang zu Vercel.',
      why: 'Retell ist die Assistentin selbst: Spracherkennung, KI und Stimme. Abgerechnet wird nur pro Gesprächsminute, ohne Grundgebühr.',
      steps: [
        `${a('https://dashboard.retellai.com/', 'dashboard.retellai.com')} öffnen und mit <code>support@leaserun.com</code> registrieren. Du bekommst ca. 10 $ Startguthaben zum Testen.`,
        'Links <strong>Billing</strong>: Karte hinterlegen. <strong>Auto-Recharge / automatisches Aufladen ausgeschaltet lassen</strong>. Nur wenn nötig von Hand Guthaben aufladen (z. B. 20 $). So kann es nie teurer werden als geplant.',
        'Links <strong>Settings → API Keys</strong>: den Schlüssel mit dem Vermerk <strong>„Webhook“</strong> kopieren (falls keiner so markiert ist: „Create“ und diesen nehmen). Nicht in Chat oder E-Mail einfügen.',
        `${a(VERCEL, 'Vercel → Environment Variables')} → „Add New“: Key <code>RETELL_API_KEY</code>, Value = der Schlüssel, nur <strong>Production</strong>, „Sensitive“ an, „Save“.`,
        'Noch einmal „Add New“: Key <code>TELEFON_WEBHOOK_TOKEN</code>, Value = ein Zufallswert mit 40 Zeichen (Passwort-Manager: nur Buchstaben und Ziffern), nur Production, „Sensitive“ an, „Save“. Den Wert brauchst du in Punkt 5 noch einmal.',
        'Deployments → oberster Eintrag → „⋯“ → „Redeploy“. Nach ca. 2 Minuten wird dieser Punkt automatisch grün.'],
      check: 'Der Punkt ist grün.' },
    { id: 'tel_nummer', group: 'Telefon-Assistent', title: '3 · Nationale 032-Nummer bei Telnyx bestellen und verbinden', auto: false, ok: Boolean(manual.tel_nummer), time: '30 Minuten + 1–3 Werktage Prüfung',
      need: 'Personalausweis (Scan), Adressnachweis nicht älter als 3 Monate (z. B. Strom- oder Handyrechnung), Gewerbeanmeldung falls vorhanden.',
      why: 'Die Firmennummer, die auf leaserun.com steht und bei der Lena abnimmt. Ohne Ortsbezug, deine private Handynummer bleibt geheim.',
      steps: [
        `${a('https://telnyx.com/sign-up', 'telnyx.com')} → Konto anlegen (Business, Firmenname LeaseRun), E-Mail bestätigen, Karte hinterlegen und 10 $ aufladen.`,
        '<strong>Numbers → Search &amp; Buy</strong>: Country <strong>Germany</strong>, Number type <strong>National</strong> (nicht „Local“) → eine Nummer auswählen → kaufen.',
        'Telnyx fragt die <strong>Regulatory Requirements</strong> ab: Ausweis-Scan, Adressnachweis und das deutsche Registrierungsformular hochladen (unterschreiben, Firmenname handschriftlich, wenn kein Stempel). Die Prüfung dauert meist 1–3 Werktage. Wichtig: Beim Kauf musst du in Deutschland sein.',
        'Währenddessen die Leitung anlegen: <strong>Voice → SIP Trunking → „Create“</strong>, Name <code>leaserun-retell</code>, Typ <strong>FQDN</strong>.',
        'Bei <strong>Inbound</strong>: FQDN <code>sip.retellai.com</code> hinzufügen, DNS-Typ <strong>SRV</strong>. Number format <code>+E.164</code>, Codecs <code>G722</code>, <code>G711U</code>, <code>G711A</code>, Transport <strong>TCP</strong>, Region <strong>Europe</strong>.',
        'Bei <strong>Authentication</strong>: „Credentials“ wählen, einen Benutzernamen (z. B. <code>leaserunretell</code>) und ein langes Passwort festlegen und im Passwort-Manager speichern.',
        'Bei <strong>Outbound</strong>: „Create new outbound voice profile“ → Name <code>leaserun</code> → speichern und auswählen.',
        'Sobald die Nummer freigegeben ist: <strong>Numbers → My Numbers</strong> → bei der Nummer unter „Connection“ <code>leaserun-retell</code> wählen → speichern.',
        `In Retell: links <strong>Phone Numbers → „+“ → „Connect to your number via SIP trunking“</strong>. Nummer im Format <code>+4932…</code>, Termination URI <code>sip.telnyx.com</code>, Benutzername und Passwort von oben, zusätzlicher SIP-Header <code>X-Telnyx-Username</code> = dein Benutzername. „Test SIP Connection“ → „Save“. (${a('https://docs.retellai.com/deploy/telnyx', 'Retell-Anleitung für Telnyx')})`],
      check: 'Retell zeigt die Nummer unter Phone Numbers; der SIP-Test war grün.' },
    { id: 'tel_agent', group: 'Telefon-Assistent', title: '4 · Assistentin „Lena“ anlegen (Skript einfügen)', auto: false, ok: Boolean(manual.tel_agent), time: '15 Minuten',
      why: 'Hier bekommt die Assistentin Stimme, Wissen und Regeln. Das komplette Gesprächsskript mit allen LeaseRun-Preisen steht unten zum Kopieren.',
      steps: [
        'Retell → <strong>Agents → „Create an Agent“ → „Single Prompt Agent“</strong> → Name <code>Lena · LeaseRun</code>.',
        '<strong>Language:</strong> German (de-DE). <strong>Voice:</strong> eine deutsche Frauenstimme auswählen – mehrere anhören und die natürlichste nehmen.',
        '<strong>Model (LLM):</strong> ein günstiges, schnelles Modell wählen (in der Liste meist mit „mini“ im Namen). Für LeaseRun-Fragen reicht das und hält die Kosten bei ca. 0,10 $ pro Minute.',
        '<strong>Prompt:</strong> unten „Gesprächsskript kopieren“ antippen und alles in das Prompt-Feld einfügen.',
        '<strong>Welcome Message:</strong> „Agent speaks first“ und als Text: <code>Guten Tag, hier ist LeaseRun, Sie sprechen mit Lena, der digitalen Assistentin. Wie kann ich Ihnen helfen?</code>',
        '<strong>Call Settings:</strong> Background Sound = <strong>Office</strong> (leise, ca. 20–30 %), Max Call Duration = <strong>5 Minuten</strong>, End Call on Silence = <strong>20 Sekunden</strong>, Voicemail Detection aus.',
        '<strong>Datenschutz:</strong> Call Recording / Aufzeichnung ausschalten und „Opt out of sensitive data storage“ (keine Speicherung von Mitschnitt und Wortlaut) einschalten.',
        'Rechts oben <strong>„Test“</strong>: im Browser mit Lena sprechen, Fragen zu Preisen, Kündigung und Kooperation stellen. Passt alles: „Save“ / „Publish“.'],
      copy: [{ label: 'Gesprächsskript kopieren', text: gespraechsskript() }],
      check: 'Im Test nennt Lena die richtigen Preise und nimmt bei Kooperationsfragen Name und Rückrufnummer auf.' },
    { id: 'tel_live', group: 'Telefon-Assistent', title: '5 · Zusammenfassung einschalten und Nummer zuweisen', auto: false, ok: telHook && Boolean(manual.tel_live), time: '10 Minuten',
      info: telHook ? undefined : 'Erst Punkt 2 erledigen (Schlüssel in Vercel).',
      why: 'Erst jetzt nimmt Lena echte Anrufe an, und nach jedem Gespräch kommt die Zusammenfassung ins Postfach support@leaserun.com.',
      steps: [
        'Retell → Agent <strong>Lena · LeaseRun</strong> → <strong>Post-Call Analysis</strong>: die sechs Felder unten anlegen (Name, Typ und Beschreibung genau so). Das Modell für die Auswertung: das günstigste.',
        `Beim Agenten (oder <strong>Settings → Webhooks</strong>) als <strong>Webhook URL</strong> eintragen: <code>https://leaserun.com/api/telefon/anruf?k=</code> und direkt dahinter den Wert von <code>TELEFON_WEBHOOK_TOKEN</code> aus Punkt 2 (ohne Leerzeichen). Ereignis: mindestens <strong>call_analyzed</strong>.`,
        'Retell → <strong>Phone Numbers</strong> → deine 032-Nummer → <strong>Inbound Call Agent</strong> = Lena · LeaseRun → speichern.',
        'Mit dem Handy die 032-Nummer anrufen, kurz eine Frage stellen und auflegen. Nach 1–2 Minuten muss im Web-Admin-Postfach eine E-Mail „Telefon: …“ liegen.',
        'Hat alles geklappt: hier „Fertig – als erledigt markieren“. Schick mir dann die Nummer – ich trage sie in Impressum, Kontaktseite und Datenschutz ein (Punkt 7).'],
      copy: [{ label: 'Auswertungs-Felder kopieren', text: auswertungText() }],
      check: 'Testanruf erscheint als Zusammenfassung im Postfach.' },
    { id: 'tel_budget', group: 'Telefon-Assistent', title: `6 · Monatsbudget im Blick (${tel.anrufe} Anrufe, ca. ${kostenUsd(tel).toLocaleString('de-DE')} $ von ${BUDGET_USD} $)`, auto: false, ok: Boolean(manual.tel_budget), optional: true, time: '2 Minuten',
      info: `Stand ${tel.monat}: ${tel.minuten} Minuten.`,
      why: 'Damit es bei ca. 20 $ im Monat bleibt. Der Zähler oben rechnet jede Gesprächsminute mit 0,10 $ plus 2 $ für die Nummer.',
      steps: [
        'Bei <strong>80 %</strong> und <strong>100 %</strong> des Budgets bekommst du automatisch eine E-Mail ins Postfach.',
        'Retell → Billing: Auto-Recharge bleibt aus. Ist das Guthaben leer, kann Lena keine Anrufe mehr annehmen – es entstehen keine weiteren Kosten.',
        'Wird es regelmäßig knapp: Max Call Duration auf 4 Minuten senken oder die Nummer auf leaserun.com weniger prominent zeigen. Lohnt sich ein höheres Budget, einfach mehr Guthaben aufladen.',
        'Die genauen Kosten stehen jederzeit in Retell unter <strong>Billing → Usage</strong>.'],
      check: 'Du hast beide Warn-E-Mails verstanden – dann „Erledigt“.' },
    { id: 'tel_recht', group: 'Telefon-Assistent', title: '7 · Datenschutz und Verträge für den Telefon-Assistenten', auto: false, ok: Boolean(manual.tel_recht), time: '15 Minuten',
      why: 'Anrufe enthalten personenbezogene Daten und laufen über US-Anbieter. Mit Auftragsverarbeitungsvertrag, Hinweis in der Datenschutzerklärung und dem KI-Hinweis am Anfang jedes Gesprächs bist du auf der sicheren Seite.',
      steps: [
        `<strong>Retell:</strong> Auftragsverarbeitungsvertrag (DPA) abschließen – im Dashboard unter Settings bzw. per E-Mail an Retell anfordern (${a('https://www.retellai.com/', 'retellai.com')}), unterschreiben, als PDF ablegen.`,
        `<strong>Telnyx:</strong> Data Processing Addendum (DPA) herunterladen und ablegen (${a('https://telnyx.com/legal', 'telnyx.com/legal')}).`,
        'Unten den Textvorschlag für die Datenschutzerklärung kopieren und an deinen Rechtstexte-Dienst geben (oder mir schicken: „Telefon-Datenschutz eintragen“). Eckige Klammern vorher ausfüllen.',
        'Die Nummer ins Impressum und auf die Kontaktseite: einfach mir schicken (siehe Punkt „Telefonnummer und Angaben im Impressum“).',
        '<strong>Nie</strong> den Satz „digitale Assistentin“ aus der Begrüßung entfernen und keine Aufzeichnung einschalten – beides wäre ein Abmahnrisiko.'],
      copy: [{ label: 'Datenschutz-Text kopieren', text: `Telefonischer Kundenservice mit KI-Assistentin

Wenn Sie uns unter der Rufnummer [032 …] anrufen, nimmt eine KI-gestützte Telefonassistentin Ihren Anruf entgegen. Darauf weisen wir zu Beginn jedes Gesprächs hin. Dabei verarbeiten wir Ihre Rufnummer, Zeitpunkt und Dauer des Anrufs, den Inhalt des Gesprächs zur Beantwortung in Echtzeit sowie die Angaben, die Sie uns nennen (z. B. Name, Anliegen, Rückrufnummer).

Zweck ist die Beantwortung Ihrer Anfrage und gegebenenfalls ein Rückruf. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO, soweit Ihre Anfrage einen Vertrag oder dessen Anbahnung betrifft, im Übrigen Art. 6 Abs. 1 lit. f DSGVO (unser berechtigtes Interesse an einer schnellen Bearbeitung telefonischer Anfragen).

Gespräche werden nicht aufgezeichnet. Gespeichert wird lediglich eine kurze schriftliche Zusammenfassung in unserem Kundenpostfach, die wir nach Erledigung des Anliegens, spätestens nach [6 Monaten], löschen.

Dienstleister: Retell AI, Inc. [Anschrift laut DPA], USA (Spracherkennung, Gesprächsführung und Sprachausgabe) sowie Telnyx LLC, USA (Telefonanbieter). Mit beiden Anbietern haben wir Verträge zur Auftragsverarbeitung geschlossen. Die Übermittlung in die USA erfolgt auf Grundlage [des EU-US Data Privacy Framework / der EU-Standardvertragsklauseln – laut DPA des Anbieters eintragen].

Wenn Sie nicht mit der Assistentin sprechen möchten, schreiben Sie uns gern an support@leaserun.com.` }],
      check: 'Beide DPAs liegen als PDF vor, der Datenschutz-Abschnitt ist online.' },
  ];
  return L;
}

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  // Live-Prüfung: Stripe, Webhook (inkl. Selbsttest), Resend, Datenbank – direkt abgefragt.
  if (new URL(req.url).searchParams.get('live') === '1') {
    const checks = await liveChecks(new URL(req.url).origin);
    await adminAudit(auth.user.email, 'setup_livecheck', null, { fail: checks.filter((c) => c.state === 'fail').map((c) => c.id) });
    return j({ checks, at: new Date().toISOString() });
  }
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const manual = (data?.value as Record<string, string>) || {};
  const list = await items(manual);
  // Jeder Punkt lässt sich abhaken – auch automatisch geprüfte. Abgehakt = erledigt und aus der offenen Liste entfernt;
  // „by“ zeigt, ob die Prüfung ihn erkannt hat oder Feray ihn selbst abgehakt hat (Wieder öffnen jederzeit möglich).
  return j({ items: list.map((x) => ({ ...x, ok: Boolean(x.ok) || Boolean(manual[x.id]), by: x.ok ? (x.auto ? 'auto' : 'manuell') : manual[x.id] ? 'manuell' : null, doneAt: manual[x.id] || null })), env: process.env.VERCEL_ENV || 'lokal' });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = z.object({ id: z.string().regex(/^[a-z0-9_-]{2,40}$/), done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const v = { ...((data?.value as Record<string, string>) || {}) };
  if (p.data.done) v[p.data.id] = new Date().toISOString(); else delete v[p.data.id];
  const r = await db.from('lr_settings').upsert({ key: KEY, value: v, updated_at: new Date().toISOString(), updated_by: auth.user.email });
  if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
  await adminAudit(auth.user.email, 'setup_mark', p.data.id, { done: p.data.done });
  return j({ ok: true });
}
