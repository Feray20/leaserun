import '@/lib/env-alias';
import { stripe } from '@/lib/billing/stripe';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { fromAddress } from '@/lib/notify/mail';
import { resolveTxt } from 'node:dns/promises';

// Live-Prüfung der Einrichtung (Web-Admin → Einrichtung): fragt Stripe, Resend und die Datenbank direkt ab,
// statt nur Umgebungsvariablen zu prüfen. Liefert je Prüfung ok/warn/fail mit Erklärung.
export type Check = { id: string; label: string; state: 'ok' | 'warn' | 'fail'; info: string };
const NEED_EVENTS = ['checkout.session.completed', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid'];

export async function webhookSelfTest(origin: string, type = 'checkout.session.completed'): Promise<Check> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRETT;
  if (!secret) return { id: 'wh_self', label: 'Webhook-Selbsttest', state: 'fail', info: 'STRIPE_WEBHOOK_SECRET fehlt – Zahlungsbestätigungen können nicht geprüft werden.' };
  // Fiktives Ereignis, als Test markiert: wird signiert und verarbeitet, schaltet aber nichts frei und zählt nicht als Kauf.
  const payload = JSON.stringify({
    id: `evt_selftest_${Date.now()}`, object: 'event', type, api_version: null, created: Math.floor(Date.now() / 1000), livemode: false, pending_webhooks: 0, request: null,
    data: { object: { id: `cs_selftest_${Date.now()}`, object: 'checkout.session', payment_status: 'paid', status: 'complete', metadata: { leaserun_test: '1', plan: 'selftest' }, subscription: null } },
  });
  const header = stripe().webhooks.generateTestHeaderString({ payload, secret });
  const t0 = Date.now();
  try {
    const r = await fetch(`${origin}/api/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header }, body: payload, signal: AbortSignal.timeout(10000) });
    const ms = Date.now() - t0;
    if (r.ok) return { id: 'wh_self', label: 'Webhook-Selbsttest', state: 'ok', info: `Test-Ereignis „${type}“ signiert zugestellt und verarbeitet (HTTP ${r.status}, ${ms} ms).` };
    const body = await r.text().catch(() => '');
    return { id: 'wh_self', label: 'Webhook-Selbsttest', state: 'fail', info: `Abgewiesen mit HTTP ${r.status}${/signature/.test(body) ? ' – Signatur passt nicht: STRIPE_WEBHOOK_SECRET entspricht nicht dem Geheimnis des Endpunkts.' : ''}.` };
  } catch (e) {
    return { id: 'wh_self', label: 'Webhook-Selbsttest', state: 'fail', info: `Nicht erreichbar: ${e instanceof Error ? e.message.slice(0, 120) : 'Fehler'}` };
  }
}

export async function liveChecks(origin: string): Promise<Check[]> {
  const out: Check[] = [];
  const sk = String(process.env.STRIPE_SECRET_KEY || '');
  // Stripe-Schlüssel und Zahlarten
  if (!sk) out.push({ id: 'stripe_key', label: 'Stripe-Schlüssel', state: 'fail', info: 'STRIPE_SECRET_KEY fehlt.' });
  else {
    const live = /^(sk|rk)_live/.test(sk);
    try {
      const cfgs = await stripe().paymentMethodConfigurations.list({ limit: 20 });
      const def = cfgs.data.find((c) => c.is_default && c.active && !c.application) || cfgs.data.find((c) => c.is_default && c.active);
      const card = Boolean((def as unknown as { card?: { available?: boolean } })?.card?.available);
      out.push({ id: 'stripe_key', label: 'Stripe-Schlüssel', state: live ? 'ok' : 'warn', info: live ? 'Live-Schlüssel gültig – echte Zahlungen möglich.' : 'Test-Schlüssel aktiv – es fließt kein echtes Geld.' });
      out.push({ id: 'stripe_pm', label: 'Zahlarten', state: card ? 'ok' : 'fail', info: card ? 'Kartenzahlung freigeschaltet.' : 'Keine Kartenzahlung verfügbar – Stripe-Konto prüfen (Einstellungen → Zahlungsmethoden).' });
    } catch (e) {
      out.push({ id: 'stripe_key', label: 'Stripe-Schlüssel', state: 'fail', info: `Stripe lehnt den Schlüssel ab: ${e instanceof Error ? e.message.slice(0, 120) : 'Fehler'}` });
    }
    // Webhook-Endpunkt bei Stripe registriert, aktiv und mit den nötigen Ereignissen
    try {
      const eps = await stripe().webhookEndpoints.list({ limit: 50 });
      const ep = eps.data.find((e) => /\/api\/stripe\/webhook$/.test(e.url) && /leaserun\.de/.test(e.url)) || eps.data.find((e) => /\/api\/stripe\/webhook$/.test(e.url));
      if (!ep) out.push({ id: 'wh_reg', label: 'Webhook bei Stripe', state: 'fail', info: 'Kein Endpunkt …/api/stripe/webhook bei Stripe registriert.' });
      else {
        const miss = ep.enabled_events.includes('*') ? [] : NEED_EVENTS.filter((x) => !ep.enabled_events.includes(x));
        out.push({ id: 'wh_reg', label: 'Webhook bei Stripe', state: ep.status !== 'enabled' ? 'fail' : miss.length ? 'warn' : 'ok', info: `${ep.url} · ${ep.status === 'enabled' ? 'aktiv' : 'deaktiviert'}${miss.length ? ` · fehlende Ereignisse: ${miss.join(', ')}` : ' · alle nötigen Ereignisse'}` });
      }
    } catch { out.push({ id: 'wh_reg', label: 'Webhook bei Stripe', state: 'warn', info: 'Webhook-Liste nicht lesbar (eingeschränkter Schlüssel?).' }); }
  }
  out.push(await webhookSelfTest(origin));
  // E-Mail: Resend-Domain verifiziert
  const key = process.env.RESEND_API_KEY, from = fromAddress(), dom = (/@([^>\s]+)/.exec(from || '')?.[1] || '').toLowerCase();
  if (!key || !dom) out.push({ id: 'mail', label: 'E-Mail-Absender', state: 'fail', info: 'RESEND_API_KEY oder Absender (NOTIFY_FROM_EMAIL) fehlt.' });
  else {
    try {
      const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) out.push({ id: 'mail', label: 'E-Mail-Absender', state: 'warn', info: `Schlüssel darf Domains nicht lesen (nur Senden). Absender ${dom} – bitte Testmail im Reiter System senden.` });
      else {
        const d = (await r.json()) as { data?: { id: string; name: string; status: string }[] };
        const hit = (d.data || []).find((x) => x.name.toLowerCase() === dom);
        // SPF-Eintrag genau so, wie Resend ihn erwartet (Name je nach Return-Path, z. B. „send“) – samt Prüfstand bei Resend.
        if (hit) {
          try {
            const dr = await fetch(`https://api.resend.com/domains/${hit.id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
            const dd = dr.ok ? ((await dr.json()) as { records?: { record: string; name: string; type: string; value: string; status: string }[] }) : null;
            RESEND_SPF = (dd?.records || []).filter((x) => x.record === 'SPF').map((x) => ({ name: x.name, type: x.type, value: x.value, status: x.status }));
          } catch { /* optional */ }
        }
        out.push({ id: 'mail', label: 'E-Mail-Absender', state: hit?.status === 'verified' ? 'ok' : 'fail', info: hit ? `Domain ${dom}: ${hit.status === 'verified' ? 'verifiziert (SPF/DKIM)' : hit.status}` : `Domain ${dom} ist bei Resend nicht angelegt.` });
      }
    } catch { out.push({ id: 'mail', label: 'E-Mail-Absender', state: 'warn', info: 'Resend nicht erreichbar.' }); }
  }
  // Zustellbarkeit: DMARC, SPF und Markenlogo (BIMI) per DNS prüfen – entscheidend gegen Spam-Einordnung.
  if (dom) out.push(...(await mailDnsChecks(dom)));
  // Datenbank
  if (!adminConfigured()) out.push({ id: 'db', label: 'Datenbank', state: 'fail', info: 'Supabase-Service-Schlüssel fehlt.' });
  else {
    const t0 = Date.now();
    const { error } = await supabaseAdmin().from('lr_settings').select('key').limit(1);
    out.push({ id: 'db', label: 'Datenbank', state: error ? 'fail' : 'ok', info: error ? error.message.slice(0, 120) : `erreichbar (${Date.now() - t0} ms)` });
  }
  out.push({ id: 'cron', label: 'Täglicher Lauf', state: process.env.CRON_SECRET ? 'ok' : 'fail', info: process.env.CRON_SECRET ? 'CRON_SECRET gesetzt (läuft täglich 03:17 UTC).' : 'CRON_SECRET fehlt.' });
  const dep = await deployCheck();
  if (dep) out.push(dep);
  return out;
}

// Neue Versionen der Website (Vercel): Ließ sich die neueste Version nicht bauen, bleibt live die alte stehen – das sieht
// sonst niemand. Nur mit VERCEL_API_TOKEN (nur lesen reicht); ohne Schlüssel entfällt die Prüfung still.
export async function deployCheck(): Promise<Check | null> {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token) return null;
  const project = process.env.VERCEL_PROJECT_ID || 'prj_3kZNIRoKMelnGPFVA2pKAVkH5cvk';
  const team = process.env.VERCEL_TEAM_ID || 'team_Cc9y3hcnikPekxZBf9xymTuC';
  try {
    const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${project}&teamId=${team}&target=production&limit=20`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { id: 'deploy', label: 'Neue Versionen', state: 'warn', info: `Vercel lehnt die Abfrage ab (HTTP ${r.status}) – VERCEL_API_TOKEN prüfen.` };
    const j = (await r.json()) as { deployments?: { state?: string; readyState?: string; created: number; meta?: { githubCommitMessage?: string } }[] };
    const list = (j.deployments || []).sort((a, b) => b.created - a.created);
    const st = (d: (typeof list)[number]) => d.readyState || d.state || '';
    const lastOk = list.findIndex((d) => st(d) === 'READY');
    const failed = list.slice(0, lastOk < 0 ? list.length : lastOk).filter((d) => st(d) === 'ERROR');
    if (!failed.length) return { id: 'deploy', label: 'Neue Versionen', state: 'ok', info: 'Die neueste Version ist live.' };
    const msg = String(failed[0].meta?.githubCommitMessage || '').split('\n')[0].slice(0, 90);
    const since = lastOk >= 0 ? new Date(list[lastOk].created).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'unbekannt';
    return { id: 'deploy', label: 'Neue Versionen', state: failed.length >= 2 ? 'fail' : 'warn', info: `${failed.length === 1 ? 'Die neueste Version ließ' : `${failed.length} neue Versionen ließen`} sich nicht bauen („${msg}“). Live bleibt die Version vom ${since} – Kunden merken nichts, Änderungen fehlen aber.` };
  } catch { return { id: 'deploy', label: 'Neue Versionen', state: 'warn', info: 'Vercel gerade nicht erreichbar.' }; }
}

let RESEND_SPF: { name: string; type: string; value: string; status: string }[] = [];
const txt = async (name: string): Promise<string[]> => {
  try { return (await resolveTxt(name)).map((r) => r.join('')); } catch { return []; }
};

// DNS-Prüfung für die Absenderdomain. DKIM prüft Resend selbst (siehe „E-Mail-Absender“).
export async function mailDnsChecks(dom: string): Promise<Check[]> {
  const out: Check[] = [];
  const root = dom.split('.').slice(-2).join('.');
  const dmarc = (await txt(`_dmarc.${dom}`)).concat(dom !== root ? await txt(`_dmarc.${root}`) : []).find((t) => /^v=DMARC1/i.test(t));
  if (!dmarc) out.push({ id: 'dmarc', label: 'DMARC', state: 'fail', info: `Kein DMARC-Eintrag für ${root}. Beim DNS-Anbieter TXT „_dmarc“ = „v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc@${root}“ anlegen. Ohne DMARC sortieren Gmail und Yahoo Massenmails aus.` });
  else {
    const p = /;\s*p=(\w+)/i.exec(dmarc)?.[1]?.toLowerCase() || 'none';
    out.push({ id: 'dmarc', label: 'DMARC', state: p === 'none' ? 'warn' : 'ok', info: p === 'none' ? `DMARC vorhanden, aber p=none (nur Beobachtung). Nach 2–4 Wochen ohne Fehler auf p=quarantine stellen – Voraussetzung für das Logo in Mail-Apps.` : `DMARC aktiv (p=${p}).` });
  }
  // SPF gilt für die Return-Path-Adresse von Resend (Standard „send.<domain>“), nicht für die Hauptdomain.
  const want = RESEND_SPF.filter((x) => x.type === 'TXT');
  const spfHosts = [...new Set([...want.map((x) => (x.name.endsWith(dom) ? x.name : `${x.name}.${dom}`)), `send.${dom}`, dom])];
  let spf = '', spfHost = '';
  for (const h of spfHosts) { spf = (await txt(h)).find((t) => /^v=spf1/i.test(t)) || ''; if (spf) { spfHost = h; if (/amazonses|resend|rmta/i.test(spf)) break; } }
  // Resend nutzt inzwischen CNAME-Einträge („send“, „rsend“) statt eines eigenen TXT – maßgeblich ist Resends Prüfstand.
  const resendOk = RESEND_SPF.length > 0 && RESEND_SPF.every((x) => x.status === 'verified');
  const fixTxt = RESEND_SPF.length ? RESEND_SPF.map((x) => `${x.type} „${x.name}“ = „${x.value}“${x.status === 'verified' ? ' ✓' : ' (fehlt)'}`).join(' · ') : `TXT „send“ = „v=spf1 include:amazonses.com ~all“ und MX „send“ = „feedback-smtp.eu-west-1.amazonses.com“ (Priorität 10)`;
  const spfOk = resendOk || Boolean(spf && /amazonses|resend|rmta/i.test(spf));
  out.push({ id: 'spf', label: 'SPF', state: spfOk ? 'ok' : spf ? 'warn' : 'fail', info: spfOk ? (resendOk ? 'SPF in Ordnung – von Resend bestätigt (Einträge „send“ und „rsend“).' : `SPF in Ordnung (${spfHost}: ${spf.slice(0, 90)}).`) : `${spf ? `SPF auf ${spfHost} erlaubt Resend nicht: ${spf.slice(0, 90)}. ` : 'Kein passender SPF-Eintrag gefunden. '}Beim DNS-Anbieter (Hostinger → DNS-Zone leaserun.com) anlegen: ${fixTxt}. Den SPF der Hauptdomain nicht doppelt anlegen.` });
  // DKIM (Resend-Schlüssel): Signatur ist der wichtigste Einzelfaktor gegen den Spam-Ordner.
  const dkim = (await txt(`resend._domainkey.${dom}`)).find((t) => /p=/i.test(t));
  out.push({ id: 'dkim', label: 'DKIM-Signatur', state: dkim ? 'ok' : 'fail', info: dkim ? 'DKIM-Schlüssel für Resend veröffentlicht – E-Mails werden signiert.' : `Kein DKIM-Schlüssel unter resend._domainkey.${dom}. Den Eintrag aus Resend → Domains genau so beim DNS-Anbieter anlegen.` });
  const bimi = (await txt(`default._bimi.${root}`)).find((t) => /^v=BIMI1/i.test(t));
  out.push({ id: 'bimi', label: 'Logo in Mail-Apps (BIMI)', state: bimi ? 'ok' : 'warn', info: bimi ? `BIMI aktiv: ${bimi.slice(0, 120)}` : `Optional: TXT „default._bimi“ = „v=BIMI1; l=https://${root}/brand/bimi.svg;“ – zeigt das Logo z. B. bei Yahoo; Gmail und Apple Mail verlangen zusätzlich ein Markenzertifikat (VMC/CMC) und DMARC p=quarantine.` });
  return out;
}
