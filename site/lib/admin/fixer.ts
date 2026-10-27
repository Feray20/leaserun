import { mfaRequired } from '@/lib/security/admin';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { trustedList } from '@/lib/security/trusted';
import { panicState } from '@/lib/security/panic';
import { mailConfigured } from '@/lib/notify/mail';
import { syncReceivedDetailed, type SyncStatus } from '@/lib/mail/ingest';
import { normalizeRecipient } from '@/lib/notify/mail';
import { isSuppressed } from '@/lib/marketing/suppression';
import { liveChecks, mailDnsChecks, type Check } from '@/lib/admin/livecheck';
import { draftIssues, repairable, repairDraftHtml } from '@/lib/mail/draft-repair';
import { connect } from 'node:tls';

// Web-Admin → „Jetzt prüfen“ / „Alles erledigen“.
// GET: prüft Sicherheit und E-Mail und liefert verständliche Befunde. POST: behebt die Befunde, die sicher automatisch
// behoben werden können. Was behoben wird, ermittelt immer der Server neu (der Browser schickt nur Befund-Kennungen,
// nie IP-Kennungen oder Aktionen). Jede Behebung steht im Protokoll. Einstellungen in Vercel/Resend werden nie
// automatisch geändert – dafür gibt es eine Anleitung.
export type Sev = 'critical' | 'warning' | 'info';
export type Area = 'Sicherheit' | 'E-Mail' | 'Technik' | 'Betrieb';
export type Finding = { id: string; area: Area; sev: Sev; title: string; detail: string; auto: boolean; fixLabel?: string; how?: string; tab?: string };
type Plan = { block?: string[]; blockHours?: number; ackIds?: number[]; cleanBlocks?: boolean; mailSync?: boolean; repairDrafts?: string[]; lockDrafts?: string[]; purgeLog?: boolean };

const ATTACK = ['probe', 'admin_denied', 'admin_ip_blocked', 'admin_mfa_missing', 'login_flood'];
const LABEL: Record<string, string> = { probe: 'Scanner / Angriffsversuch', blocked: 'Zugriff einer gesperrten Quelle', admin_denied: 'Web-Admin ohne Berechtigung', admin_ip_blocked: 'Web-Admin von fremder IP', admin_mfa_missing: 'Web-Admin ohne 2. Faktor', rate_limit: 'Zu viele Anfragen (gedrosselt)', honeypot: 'Formular-Bot', too_fast: 'Formular-Bot', disposable_email: 'Wegwerf-E-Mail', email_no_mx: 'E-Mail-Domain ohne Postfach', content_flagged: 'Spam-Inhalt', login_flood: 'Viele Fehlanmeldungen', upload_rejected: 'Upload abgewiesen' };
const H = 3_600_000, D = 24 * H;
const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
const n = (x: number, one: string, many: string) => `${x} ${x === 1 ? one : many}`;
const ago = (t: string | null | undefined) => {
  if (!t) return 'noch nie';
  const h = Math.round((Date.now() - new Date(t).getTime()) / H);
  return h < 1 ? 'vor weniger als einer Stunde' : h < 48 ? `vor ${h} Stunden` : `vor ${Math.round(h / 24)} Tagen`;
};

// Teure Prüfungen über das Netz (Website-Header, Zertifikat, DNS, Stripe/Webhook/Resend) höchstens alle 15 Minuten neu –
// so bleiben Headquarters und „Jetzt prüfen“ schnell, auch wenn die Agenten parallel arbeiten. „Jetzt prüfen“ erzwingt frisch.
const CACHE = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, fresh: boolean, fn: () => Promise<T>, ms = 15 * 60_000): Promise<T> {
  const c = CACHE.get(key);
  if (!fresh && c && Date.now() - c.at < ms) return c.v as T;
  const v = await fn(); CACHE.set(key, { at: Date.now(), v }); return v;
}
export const liveChecksCached = (origin: string, fresh = false): Promise<Check[]> => cached(`live:${origin}`, fresh, () => liveChecks(origin));

export type AnalyseOpts = { areas?: Area[]; origin?: string; fresh?: boolean };
export async function analyse(o: AnalyseOpts = {}): Promise<{ findings: Finding[]; plans: Record<string, Plan>; checkedAt: string }> {
  const db = supabaseAdmin();
  const findings: Finding[] = [], plans: Record<string, Plan> = {};
  const want = (a: Area) => !o.areas || o.areas.includes(a);

  // ---------- Sicherheit ----------
  if (want('Sicherheit')) {
  const own = new Set((await trustedList(true)).map((t) => t.ip));
  const [{ data: ev }, { data: bl }] = await Promise.all([
    db.from('lr_security_log').select('id, kind, ip_hash, created_at').is('acknowledged_at', null).gte('created_at', iso(7 * D)).limit(5000),
    db.from('lr_security_blocks').select('ip_hash, until'),
  ]);
  const now = Date.now();
  const active = new Set((bl ?? []).filter((b) => !b.until || new Date(b.until).getTime() > now).map((b) => b.ip_hash));
  const expired = (bl ?? []).filter((b) => b.until && new Date(b.until).getTime() <= now).length;
  const open = (ev ?? []).filter((r) => !r.ip_hash || !own.has(r.ip_hash));
  // Angreifer: mind. 3 Angriffsereignisse von derselben Quelle, nicht eigene, noch nicht gesperrt → 30 Tage sperren.
  const byIp = new Map<string, { ids: number[]; kinds: Set<string>; last: string }>();
  for (const r of open) if (r.ip_hash && ATTACK.includes(r.kind) && !active.has(r.ip_hash)) {
    const g: { ids: number[]; kinds: Set<string>; last: string } = byIp.get(r.ip_hash) || { ids: [] as number[], kinds: new Set<string>(), last: String(r.created_at) };
    g.ids.push(r.id); g.kinds.add(r.kind); if (r.created_at > g.last) g.last = r.created_at; byIp.set(r.ip_hash, g);
  }
  const attackers = [...byIp.entries()].filter(([, g]) => g.ids.length >= 3);
  const covered = new Set<number>();
  if (attackers.length) {
    const id = 'sec:block';
    findings.push({ id, area: 'Sicherheit', sev: 'warning', title: `${n(attackers.length, 'Quelle greift', 'Quellen greifen')} an`, detail: attackers.slice(0, 4).map(([ip, g]) => `${ip.slice(0, 8)}: ${n(g.ids.length, 'Versuch', 'Versuche')} (${[...g.kinds].map((k) => LABEL[k] || k).join(', ')}), zuletzt ${ago(g.last)}`).join(' · ') + (attackers.length > 4 ? ` · und ${attackers.length - 4} weitere` : ''), auto: true, fixLabel: '30 Tage sperren', tab: 'sicherheit' });
    plans[id] = { block: attackers.map(([ip]) => ip), ackIds: attackers.flatMap(([, g]) => g.ids) };
    attackers.forEach(([, g]) => g.ids.forEach((x) => covered.add(x)));
  }
  const rest = open.filter((r) => !covered.has(r.id));
  if (rest.length) {
    const kinds = new Map<string, number>(); rest.forEach((r) => kinds.set(r.kind, (kinds.get(r.kind) || 0) + 1));
    const id = 'sec:ack';
    findings.push({ id, area: 'Sicherheit', sev: 'info', title: `${n(rest.length, 'Ereignis', 'Ereignisse')} wurden automatisch abgewehrt`, detail: [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, c]) => `${LABEL[k] || k}: ${c}`).join(' · ') + '. Keine Gefahr – nur noch nicht als gesehen markiert.', auto: true, fixLabel: 'Als gesehen markieren', tab: 'sicherheit' });
    plans[id] = { ackIds: rest.map((r) => r.id) };
  }
  if (expired) {
    findings.push({ id: 'sec:clean', area: 'Sicherheit', sev: 'info', title: `${n(expired, 'abgelaufene Sperre', 'abgelaufene Sperren')} aufräumen`, detail: 'Die Sperrfrist ist vorbei; die Einträge haben keine Wirkung mehr.', auto: true, fixLabel: 'Aufräumen', tab: 'sicherheit' });
    plans['sec:clean'] = { cleanBlocks: true };
  }
  if (!mfaRequired()) findings.push({ id: 'sec:mfa', area: 'Sicherheit', sev: 'critical', title: 'Zweiter Faktor für den Web-Admin ist abgeschaltet', detail: 'Der Web-Admin ist nur durch das Passwort geschützt.', auto: false, how: 'Vercel → Projekt leaserun → Settings → Environment Variables → ADMIN_MFA löschen (oder nicht auf „off“ setzen) → Redeploy.' });
  const p = await panicState();
  if (p.active) findings.push({ id: 'sec:panic', area: 'Sicherheit', sev: 'warning', title: 'Not-Aus ist aktiv', detail: `Seit ${p.since ? new Date(p.since).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }) : 'unbekannt'}. Kunden können die Seite nur eingeschränkt nutzen.`, auto: false, how: 'Wenn der Vorfall vorbei ist: unten bei „Not-Aus“ auf „Not-Aus beenden“ tippen.' });

  // Angriffswelle: sehr viele Ereignisse in der letzten Stunde → alle lauten Quellen (≥ 10 Ereignisse) für 24 Std. sperren.
  const hourAgo = Date.now() - H;
  const lastHour = open.filter((r) => new Date(r.created_at as string).getTime() >= hourAgo);
  if (lastHour.length >= 150) {
    const cnt = new Map<string, number>();
    for (const r of lastHour) if (r.ip_hash && !active.has(r.ip_hash) && !byIp.has(r.ip_hash)) cnt.set(r.ip_hash, (cnt.get(r.ip_hash) || 0) + 1);
    const loud = [...cnt.entries()].filter(([, c]) => c >= 10).map(([ip]) => ip);
    findings.push({ id: 'sec:flood', area: 'Sicherheit', sev: 'critical', title: `Angriffswelle: ${lastHour.length} abgewehrte Zugriffe in der letzten Stunde`, detail: loud.length ? `${n(loud.length, 'Quelle ist', 'Quellen sind')} besonders laut. Sperren entlastet die Seite sofort; eigene Geräte werden nie gesperrt.` : 'Die Zugriffe kommen von vielen verschiedenen Quellen. Wird es schlimmer: unten „Not-Aus“ einschalten.', auto: loud.length > 0, fixLabel: 'Laute Quellen 24 Std. sperren', how: loud.length ? undefined : 'Bei weiter steigenden Zahlen unten auf „Not-Aus“ tippen; danach im Chat mit Claude melden.', tab: 'sicherheit' });
    if (loud.length) plans['sec:flood'] = { block: loud, blockHours: 24 };
  }
  // Protokoll-Aufbewahrung: Einträge älter als 31 Tage löschen (Datensparsamkeit; der tägliche Lauf macht das sonst).
  const { count: oldLog } = await db.from('lr_security_log').select('id', { count: 'exact', head: true }).lt('created_at', iso(31 * D));
  if (oldLog) { findings.push({ id: 'sec:purge', area: 'Sicherheit', sev: 'info', title: `${n(oldLog, 'alter Protokolleintrag', 'alte Protokolleinträge')} (über 30 Tage)`, detail: 'Werden nicht mehr gebraucht und sollten aus Datenschutzgründen gelöscht werden. Hinweis: der tägliche Lauf hat sie nicht entfernt.', auto: true, fixLabel: 'Alte Einträge löschen', tab: 'sicherheit' }); plans['sec:purge'] = { purgeLog: true }; }
  // Live-Prüfung der Website: Schutz-Header und HTTPS-Zertifikat.
  const [hdr, cert] = await Promise.all([cached('hdr', Boolean(o.fresh), siteHeaders), cached('cert', Boolean(o.fresh), () => certDays('leaserun.com'))]);
  if (hdr.missing.length) findings.push({ id: 'sec:headers', area: 'Sicherheit', sev: hdr.missing.includes('HTTPS-Erzwingung (HSTS)') || hdr.missing.includes('Content-Security-Policy') ? 'critical' : 'warning', title: 'Schutz-Header der Website fehlen', detail: `Live auf leaserun.com fehlt: ${hdr.missing.join(', ')}. Ohne sie sind Angriffe wie Clickjacking oder eingeschleuste Skripte leichter.`, auto: false, how: 'Wird im Code eingestellt (next.config.js) – im Chat mit Claude melden.' });
  else if (hdr.error) findings.push({ id: 'sec:headers', area: 'Sicherheit', sev: 'warning', title: 'Website gerade nicht erreichbar', detail: hdr.error, auto: false, how: 'In ein paar Minuten erneut prüfen. Bleibt es so: Vercel → Projekt leaserun → Deployments ansehen.' });
  if (cert !== null && cert < 14) findings.push({ id: 'sec:cert', area: 'Sicherheit', sev: cert < 5 ? 'critical' : 'warning', title: `HTTPS-Zertifikat läuft in ${cert} Tagen ab`, detail: 'Vercel erneuert es normalerweise automatisch. Läuft es ab, zeigen Browser eine Sicherheitswarnung.', auto: false, how: 'Vercel → Projekt leaserun → Settings → Domains → leaserun.com: „Refresh“ bzw. DNS-Einträge prüfen.' });

  }

  // ---------- E-Mail ----------
  if (want('E-Mail')) {
  if (!process.env.RESEND_API_KEY) findings.push({ id: 'mail:key', area: 'E-Mail', sev: 'critical', title: 'E-Mail ist nicht eingerichtet', detail: 'Ohne Resend-Schlüssel wird nichts gesendet oder empfangen.', auto: false, how: 'Vercel → Environment Variables → RESEND_API_KEY (Full access) anlegen → Redeploy.' });
  else {
    if (!mailConfigured()) findings.push({ id: 'mail:from', area: 'E-Mail', sev: 'warning', title: 'Absender für Benachrichtigungen fehlt', detail: 'Bestätigungen und Rechnungen an Kunden werden nicht verschickt.', auto: false, how: 'Vercel → Environment Variables → NOTIFY_FROM_EMAIL (z. B. support@leaserun.com) anlegen → Redeploy.' });
    const [{ data: lastIn }, { data: syncRow }, { data: hookRow }, { data: failedOut }] = await Promise.all([
      db.from('lr_mail_messages').select('received_at').eq('direction', 'in').order('received_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('lr_settings').select('value').eq('key', 'mail_sync_status').maybeSingle(),
      db.from('lr_settings').select('value').eq('key', 'mail_webhook_last').maybeSingle(),
      db.from('lr_mail_messages').select('id, subject, error, updated_at').eq('direction', 'out').eq('status', 'fehler').gte('updated_at', iso(7 * D)).order('updated_at', { ascending: false }).limit(20),
    ]);
    const sync = (syncRow?.value as SyncStatus | undefined) || null;
    const lastAt = (lastIn?.received_at as string | undefined) || null;
    const stale = !lastAt || Date.now() - new Date(lastAt).getTime() > D;
    // Wurde gerade erfolgreich abgerufen und bei Resend lag nichts: dann ist „Jetzt abrufen“ erledigt – der Punkt bleibt
    // nur als Hinweis mit Anleitung stehen, statt nach jedem Erledigen mit demselben Knopf wieder aufzutauchen.
    const justSynced = Boolean(sync?.ok && Date.now() - new Date(sync!.at).getTime() < H);
    if (sync && !sync.ok && sync.error) findings.push({ id: 'mail:sync', area: 'E-Mail', sev: 'warning', title: 'Abruf eingehender E-Mails gestört', detail: `${sync.error} (Abruf ${ago(sync.at)})`, auto: true, fixLabel: 'Erneut abrufen', tab: 'postfach' });
    else if (stale && justSynced) findings.push({ id: 'mail:sync', area: 'E-Mail', sev: 'info', title: 'Seit über 24 Stunden keine E-Mail empfangen', detail: `Abruf bei Resend ist erledigt (${ago(sync!.at)}) – dort liegt nichts Neues. Letzte eingegangene E-Mail: ${ago(lastAt)}. Letzter Webhook von Resend: ${ago((hookRow?.value as { at?: string } | undefined)?.at)}.`, auto: false, how: 'Kommt wirklich keine Post an: Resend → Domains → leaserun.com prüfen, ob alle Einträge „Verified“ sind. Sonst ist nichts zu tun.', tab: 'postfach' });
    else if (stale) findings.push({ id: 'mail:sync', area: 'E-Mail', sev: 'warning', title: 'Seit über 24 Stunden keine E-Mail empfangen', detail: `Letzte eingegangene E-Mail: ${ago(lastAt)}. Letzter Webhook von Resend: ${ago((hookRow?.value as { at?: string } | undefined)?.at)}. „Jetzt abrufen“ holt alles nach, was bei Resend angekommen ist. Bleibt es leer, erreicht Resend keine Mail – dann in Resend → Domains → leaserun.com prüfen, ob alle Einträge „Verified“ sind.`, auto: true, fixLabel: 'Jetzt bei Resend abrufen', tab: 'postfach' });
    if (findings.some((f) => f.id === 'mail:sync' && f.auto)) plans['mail:sync'] = { mailSync: true };
    if (failedOut?.length) findings.push({ id: 'mail:out', area: 'E-Mail', sev: 'warning', title: `${n(failedOut.length, 'E-Mail wurde', 'E-Mails wurden')} nicht gesendet (7 Tage)`, detail: `Grund: ${String(failedOut[0].error || 'unbekannt').slice(0, 220)}`, auto: false, how: 'Im Postfach unter „Entwürfe“ öffnen und erneut senden. Liegt der Grund bei Resend (Domain nicht bestätigt, Schlüssel ohne Rechte), dort beheben.', tab: 'postfach' });
    // Entwürfe: veraltetes Layout (unscharfes Logo, verzerrte Unterschrift, alte Fußzeile), abgemeldete Empfänger,
    // ungültige Adressen, fehlender Abmeldelink oder fremde Bilder.
    const { data: drafts } = await db.from('lr_mail_messages').select('id, subject, to_emails, html, design').eq('direction', 'out').eq('status', 'entwurf').limit(500);
    const dl = drafts ?? [];
    const fix = dl.filter((d) => d.design === 'fertig' && repairable(draftIssues(String(d.html || ''))));
    if (fix.length) { findings.push({ id: 'mail:drafts', area: 'E-Mail', sev: 'warning', title: `${n(fix.length, 'Entwurf hat', 'Entwürfe haben')} ein veraltetes Layout`, detail: 'Unscharfes Logo, verzerrte Unterschrift oder alte Fußzeile. Reparieren ändert nur das Layout – Text, Knöpfe und Abmeldelink bleiben gleich.', auto: true, fixLabel: 'Entwürfe reparieren', tab: 'postfach' }); plans['mail:drafts'] = { repairDrafts: fix.map((d) => d.id) }; }
    const allRcpt = dl.flatMap((d) => ((d.to_emails as string[] | null) || []).map((e) => ({ id: d.id as string, e })));
    const sup: boolean[] = allRcpt.length ? await isSuppressed(allRcpt.map((x) => ({ email: x.e }))).catch(() => allRcpt.map(() => false)) : [];
    const lock: string[] = [...new Set<string>(allRcpt.filter((_x, i) => sup[i]).map((x) => x.id))];
    if (lock.length) { findings.push({ id: 'mail:optout', area: 'E-Mail', sev: 'critical', title: `${n(lock.length, 'Entwurf geht', 'Entwürfe gehen')} an abgemeldete Empfänger`, detail: 'Diese Personen haben widersprochen. Senden wäre unzulässige Werbung (§ 7 UWG).', auto: true, fixLabel: 'Entwürfe sperren', tab: 'postfach' }); plans['mail:optout'] = { lockDrafts: lock }; }
    const badRcpt = dl.filter((d) => { const t = (d.to_emails as string[] | null) || []; return !t.length || t.some((e) => !normalizeRecipient(e)); });
    if (badRcpt.length) findings.push({ id: 'mail:rcpt', area: 'E-Mail', sev: 'warning', title: `${n(badRcpt.length, 'Entwurf hat', 'Entwürfe haben')} keine gültige Empfängeradresse`, detail: badRcpt.slice(0, 3).map((d) => `„${String(d.subject || '(ohne Betreff)').slice(0, 50)}“`).join(' · '), auto: false, how: 'Im Postfach unter „Entwürfe“ öffnen und die Adresse korrigieren.', tab: 'postfach' });
    const noUnsub = dl.filter((d) => d.design === 'fertig' && draftIssues(String(d.html || '')).includes('no_unsub'));
    if (noUnsub.length) findings.push({ id: 'mail:unsub', area: 'E-Mail', sev: 'warning', title: `${n(noUnsub.length, 'Entwurf hat', 'Entwürfe haben')} keinen Abmeldelink`, detail: 'Werbliche E-Mails brauchen eine einfache Abmeldemöglichkeit.', auto: false, how: 'Entwurf öffnen und auf „Brief“-Vorlage umstellen – dort ist der Abmeldelink automatisch drin.', tab: 'postfach' });
    const foreign = dl.filter((d) => draftIssues(String(d.html || '')).includes('foreign_img'));
    if (foreign.length) findings.push({ id: 'mail:img', area: 'E-Mail', sev: 'info', title: `${n(foreign.length, 'Entwurf lädt', 'Entwürfe laden')} Bilder von fremden Seiten`, detail: 'Solche Bilder werden oft blockiert (Outlook, Firmen-Postfächer) und können als Spam gewertet werden.', auto: false, how: 'Bilder im Entwurf entfernen oder auf leaserun.com hochladen.', tab: 'postfach' });
    // Zustellbarkeit: SPF, DKIM, DMARC der Absenderdomain.
    const dom = (process.env.NOTIFY_FROM_EMAIL || process.env.MAILBOX_FROM_EMAIL || 'support@leaserun.com').replace(/^.*<([^>]+)>.*$/, '$1').split('@')[1] || 'leaserun.com';
    const dns = await cached(`dns:${dom}`, Boolean(o.fresh), () => mailDnsChecks(dom).catch(() => [] as Check[]));
    const dnsBad = dns.filter((c) => c.state === 'fail');
    if (dnsBad.length) findings.push({ id: 'mail:dns', area: 'E-Mail', sev: 'critical', title: `E-Mails landen leicht im Spam: ${dnsBad.map((c) => c.label).join(', ')} fehlt`, detail: dnsBad.map((c) => c.info).join(' ').slice(0, 400), auto: false, how: 'Einträge beim DNS-Anbieter (Vercel → Domains → leaserun.com → DNS) anlegen; Werte stehen in Resend → Domains.' });
    if (!process.env.RESEND_INBOUND_SECRET && !process.env.RESEND_WEBHOOK_SECRET) findings.push({ id: 'mail:hook', area: 'E-Mail', sev: 'info', title: 'E-Mails kommen nur beim Öffnen des Postfachs an', detail: 'Ohne Webhook-Geheimnis holt das Postfach neue Mails erst beim Öffnen.', auto: false, how: 'Resend → Webhooks → Endpoint https://leaserun.com/api/mail/inbound (email.received) → Signing Secret kopieren → Vercel: RESEND_INBOUND_SECRET → Redeploy.' });
  }

  }

  // ---------- Technik (live: Stripe, Zahlungs-Webhook, Resend-Domain, Datenbank, täglicher Lauf) ----------
  if (want('Technik') && o.origin) {
    const checks = await liveChecksCached(o.origin, Boolean(o.fresh)).catch(() => [] as Check[]);
    const HOW: Record<string, string> = {
      stripe_key: 'Vercel → Environment Variables → STRIPE_SECRET_KEY prüfen (Live-Schlüssel) → Redeploy.',
      stripe_pm: 'Stripe → Einstellungen → Zahlungsmethoden → Karten aktivieren.',
      wh_reg: 'Stripe → Entwickler → Webhooks → Endpunkt https://leaserun.com/api/stripe/webhook mit den fehlenden Ereignissen anlegen.',
      wh_self: 'STRIPE_WEBHOOK_SECRET in Vercel mit dem Signing Secret aus Stripe abgleichen → Redeploy.',
      mail: 'Resend → Domains → leaserun.com: alle Einträge müssen „Verified“ sein.',
      db: 'Supabase-Projekt prüfen (pausiert?) und SUPABASE_SERVICE_ROLE_KEY in Vercel.',
      cron: 'Vercel → Environment Variables → CRON_SECRET anlegen → Redeploy.',
      deploy: 'Im Chat mit Claude melden – der Bau-Fehler wird im Code behoben. Live bleibt so lange die letzte funktionierende Version.',
    };
    for (const c of checks.filter((x) => x.state !== 'ok')) {
      findings.push({ id: `tech:${c.id}`, area: 'Technik', sev: c.state === 'fail' ? 'critical' : 'info', title: `${c.label}: ${c.state === 'fail' ? 'Störung' : 'Hinweis'}`, detail: c.info, auto: false, how: HOW[c.id] || 'Im Chat mit Claude melden.', tab: 'einrichtung' });
    }
  }

  // ---------- Betrieb ----------
  if (want('Betrieb')) {
  const { data: all } = await db.from('lr_client_errors').select('id, area, count, message').is('resolved_at', null).gte('last_seen', iso(D)).limit(80);
  // Meldungen des Browsers ohne Wirkung für Kunden (abgebrochene Seitenübergänge, ResizeObserver, fremde Skripte) zählen nicht.
  const NOISE = /view ?transition|skipTransition|ResizeObserver loop|^Script error\.?$|AbortError|The operation was aborted/i;
  const errs = (all ?? []).filter((e) => !NOISE.test(String(e.message || '')));
  if (errs.length) findings.push({ id: 'ops:errors', area: 'Betrieb', sev: 'info', title: `${n(errs.length, 'Fehlerart', 'Fehlerarten')} auf der Website (24 Std.)`, detail: `${errs.reduce((s, e) => s + Number(e.count || 1), 0)}× gemeldet. Wird im Code behoben – nicht per Knopf.`, auto: false, how: 'Unter „System“ ansehen; zur Behebung im Chat mit Claude melden.', tab: 'system' });
  }

  // Lernen aus früheren Läufen: Hat „Erledigen“ einen Punkt heute schon zweimal nicht beseitigt, liegt die Ursache
  // woanders. Dann kein Knopf mehr, der scheinbar nichts tut – sondern ein klarer Hinweis an Feray.
  const hist = await loadFixHistory();
  for (const f of findings) {
    const miss = (hist[f.id] || []).filter((t) => Date.now() - t < D).length;
    if (!f.auto || miss < 2) continue;
    f.auto = false; f.fixLabel = undefined;
    if (f.sev === 'info') f.sev = 'warning';
    f.detail = `${f.detail} · Automatisch schon ${miss}× ausgeführt, der Punkt kommt aber wieder – die Ursache liegt außerhalb.`;
    f.how = `${f.how ? `${f.how} ` : ''}Im Chat mit Claude melden, damit die Ursache behoben wird.`;
  }

  const order: Record<Sev, number> = { critical: 0, warning: 1, info: 2 };
  findings.sort((a, b) => order[a.sev] - order[b.sev] || Number(b.auto) - Number(a.auto));
  return { findings, plans, checkedAt: new Date().toISOString() };
}


// Behebt die automatisch behebbaren Befunde (Auswahl über Kennungen oder alle). Der Server ermittelt die Befunde neu.
export type FixResult = { id: string; ok: boolean; text: string };
export async function applyFixes(actor: string, sel: { ids?: string[]; all?: boolean; areas?: Area[]; origin?: string }): Promise<{ results: FixResult[]; findings: Finding[]; checkedAt: string }> {
  const db = supabaseAdmin(), nowIso = new Date().toISOString();
  const first = await analyse({ areas: sel.areas, origin: sel.origin });
  const { findings, plans } = first;
  const want = findings.filter((f) => f.auto && (sel.all || (sel.ids || []).includes(f.id)) && (!sel.areas || sel.areas.includes(f.area)));
  const results: FixResult[] = [];
  for (const f of want) {
    const pl = plans[f.id] || {};
    try {
      if (pl.block?.length) {
        const own = new Set((await trustedList(true)).map((t) => t.ip));
        const ips = pl.block.filter((ip) => !own.has(ip));
        const r = await db.from('lr_security_blocks').upsert(ips.map((ip) => ({ ip_hash: ip, until: new Date(Date.now() + (pl.blockHours ? pl.blockHours * H : 30 * D)).toISOString(), reason: pl.blockHours ? 'Automatisch gesperrt (Angriffswelle)' : 'Automatisch gesperrt (Sicherheits-Check)', created_by: actor, created_at: nowIso })));
        if (r.error) throw new Error('Sperren fehlgeschlagen');
      }
      if (pl.ackIds?.length) {
        for (let i = 0; i < pl.ackIds.length; i += 500) {
          const r = await db.from('lr_security_log').update({ acknowledged_at: nowIso }).in('id', pl.ackIds.slice(i, i + 500)).is('acknowledged_at', null);
          if (r.error) throw new Error('Markieren fehlgeschlagen');
        }
      }
      if (pl.repairDrafts?.length) {
        const { data: rows } = await db.from('lr_mail_messages').select('id, html').in('id', pl.repairDrafts).eq('status', 'entwurf');
        let done = 0;
        for (const r of rows ?? []) {
          const h = repairDraftHtml(String(r.html || ''));
          if (h !== r.html) { const u = await db.from('lr_mail_messages').update({ html: h, updated_at: nowIso }).eq('id', r.id).eq('status', 'entwurf'); if (!u.error) done++; }
        }
        await adminAudit(actor, 'fix_mail_drafts', null, { repaired: done });
        results.push({ id: f.id, ok: true, text: `${n(done, 'Entwurf', 'Entwürfe')} repariert ✓` });
        continue;
      }
      if (pl.lockDrafts?.length) {
        const r = await db.from('lr_mail_messages').update({ status: 'gesperrt', error: 'Empfänger hat widersprochen (automatisch gesperrt)', updated_at: nowIso }).in('id', pl.lockDrafts).eq('status', 'entwurf');
        if (r.error) throw new Error('Sperren fehlgeschlagen');
      }
      if (pl.purgeLog) { const r = await db.from('lr_security_log').delete().lt('created_at', iso(31 * D)); if (r.error) throw new Error('Löschen fehlgeschlagen'); }
      if (pl.cleanBlocks) { const r = await db.from('lr_security_blocks').delete().lte('until', nowIso); if (r.error) throw new Error('Aufräumen fehlgeschlagen'); }
      if (pl.mailSync) {
        const st = await syncReceivedDetailed(50);
        results.push({ id: f.id, ok: st.ok, text: st.ok ? (st.fetched ? `${n(st.fetched, 'neue E-Mail', 'neue E-Mails')} ins Postfach übernommen.` : st.listed ? 'Abruf ok – alle E-Mails bei Resend sind bereits im Postfach.' : 'Abruf ok – bei Resend liegen keine empfangenen E-Mails. Dann erreicht Resend keine Mail: Resend → Domains → leaserun.com prüfen.') : st.error || 'Abruf fehlgeschlagen.' });
        await adminAudit(actor, 'fix_mail_sync', null, { ok: st.ok, fetched: st.fetched, failed: st.failed });
        continue;
      }
      await adminAudit(actor, `fix_${f.id.replace(':', '_')}`, null, { blocked: pl.block?.length || 0, acked: pl.ackIds?.length || 0, locked: pl.lockDrafts?.length || 0, purged: Boolean(pl.purgeLog) });
      results.push({ id: f.id, ok: true, text: `${f.title}: ${f.fixLabel || 'erledigt'} ✓` });
    } catch (e) {
      results.push({ id: f.id, ok: false, text: `${f.title}: ${(e as Error).message || 'fehlgeschlagen'}` });
    }
  }
  // Neu prüfen nur, wenn wirklich etwas erledigt wurde (spart eine komplette Runde).
  if (!results.length) return { results, findings, checkedAt: first.checkedAt };
  const after = await analyse({ areas: sel.areas, origin: sel.origin });
  // Wirkung prüfen: Steht ein eben erledigter Punkt unverändert (mit Knopf) wieder da, hat das Erledigen nichts bewirkt.
  // Das wird ehrlich angezeigt und gemerkt (nach zwei Fehlversuchen am Tag verschwindet der Knopf, siehe analyse).
  const hist = await loadFixHistory(), nowMs = Date.now(); let histChanged = false;
  for (const r of results) {
    if (!r.ok) continue;
    const still = after.findings.find((f) => f.id === r.id && f.auto);
    if (!still) { if (hist[r.id]) { delete hist[r.id]; histChanged = true; } continue; }
    if (RECURRING.has(r.id)) continue;
    r.ok = false; r.text = `${still.title}: ausgeführt, aber der Punkt besteht weiter.${still.how ? ` ${still.how}` : ''}`;
    hist[r.id] = [...(hist[r.id] || []).filter((t) => nowMs - t < D), nowMs]; histChanged = true;
  }
  if (histChanged) await saveFixHistory(hist, actor);
  return { results, findings: after.findings, checkedAt: after.checkedAt };
}

// Punkte, die naturgemäß sofort neu entstehen können (neue Angriffe, neue Ereignisse) – das ist kein Fehlversuch.
const RECURRING = new Set(['sec:block', 'sec:ack', 'sec:flood']);
const FIX_KEY = 'fix_history';
async function loadFixHistory(): Promise<Record<string, number[]>> {
  try { const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', FIX_KEY).maybeSingle(); return (data?.value as Record<string, number[]>) || {}; }
  catch { return {}; }
}
async function saveFixHistory(h: Record<string, number[]>, actor: string): Promise<void> {
  const now = Date.now();
  for (const k of Object.keys(h)) { h[k] = h[k].filter((t) => now - t < 2 * D); if (!h[k].length) delete h[k]; }
  try { await supabaseAdmin().from('lr_settings').upsert({ key: FIX_KEY, value: h, updated_at: new Date().toISOString(), updated_by: actor.includes('@') ? 'admin' : actor }); } catch { /* nur Gedächtnis */ }
}

// Schutz-Header live auf der Startseite prüfen (so, wie Besucher sie bekommen).
async function siteHeaders(): Promise<{ missing: string[]; error?: string }> {
  try {
    const r = await fetch('https://leaserun.com/', { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'LeaseRun-Sicherheitscheck' } });
    const h = r.headers, missing: string[] = [];
    if (!/max-age=\d{7,}/.test(h.get('strict-transport-security') || '')) missing.push('HTTPS-Erzwingung (HSTS)');
    const csp = h.get('content-security-policy') || '';
    if (!csp) missing.push('Content-Security-Policy');
    if (!/frame-ancestors/.test(csp) && !/deny|sameorigin/i.test(h.get('x-frame-options') || '')) missing.push('Schutz vor Einbetten (Clickjacking)');
    if (!/nosniff/i.test(h.get('x-content-type-options') || '')) missing.push('X-Content-Type-Options');
    if (!h.get('referrer-policy')) missing.push('Referrer-Policy');
    return { missing };
  } catch (e) { return { missing: [], error: `leaserun.com antwortet nicht (${(e as Error).name || 'Fehler'}).` }; }
}
// Resttage des HTTPS-Zertifikats (null, wenn nicht prüfbar).
function certDays(host: string): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const s = connect({ host, port: 443, servername: host, timeout: 6000 }, () => {
        const c = s.getPeerCertificate(); s.end();
        resolve(c?.valid_to ? Math.floor((new Date(c.valid_to).getTime() - Date.now()) / D) : null);
      });
      s.on('error', () => resolve(null)); s.on('timeout', () => { s.destroy(); resolve(null); });
    } catch { resolve(null); }
  });
}
