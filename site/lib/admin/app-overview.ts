import '@/lib/env-alias';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { billingEnabled, stripe } from '@/lib/billing/stripe';
import { mailConfigured } from '@/lib/notify/mail';
import { panicState } from '@/lib/security/panic';
import { mfaRequired } from '@/lib/security/admin';
import { canAccess, type AdminArea, type AdminRole } from '@/lib/security/roles';

// Admin-App „Control Center“: beantwortet in einer Anfrage „Läuft LeaseRun? Ist etwas dringend? Was ist passiert?“.
// Alles aus echten Daten (Datenbank, Stripe, Konfiguration) – nichts geschätzt, nichts erfunden.
// Rollen: Jede Angabe ist einem Bereich zugeordnet; Teammitglieder sehen nur ihre Bereiche, System und Sicherheit nur Inhaber.
// Datensparsam: keine Kunden-E-Mail-Adressen, Inhalte oder Beträge auf Einzelpersonen in Hinweisen.

export type Level = 'ok' | 'warn' | 'critical';
export type SysState = 'ok' | 'warn' | 'fail' | 'off';
export type Severity = 'critical' | 'warning' | 'info';
// Ziele in der App (nur Bildschirme, die es dort wirklich gibt).
export type Target = 'jetzt' | 'zahlungen' | 'postfach' | 'termine' | 'anfragen' | 'unternehmen' | 'sicherheit' | 'system' | 'statistik' | 'audit';

export type SystemItem = { key: string; label: string; state: SysState; info: string; checkedAt: string; ms?: number };
export type AlertItem = {
  id: string; severity: Severity; title: string; detail: string; at: string | null;
  ref?: string | null; target?: Target; targetId?: string; attention: boolean;
  action?: { kind: 'ack_security'; label: string; kindKey?: string };
};
export type ActivityItem = { id: string; kind: string; title: string; detail?: string; at: string; target?: Target; targetId?: string };
export type Metric = { key: string; label: string; value: number; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neutral'; target?: Target };
export type Overview = {
  generatedAt: string;
  role: AdminRole;
  status: { level: Level; title: string; detail: string };
  metrics: Metric[];
  systems: SystemItem[];
  alerts: AlertItem[];
  activity: ActivityItem[];
  deploy: { env: string; commit: string | null; deploymentId: string | null; region: string | null };
};

const H = 3_600_000, D = 24 * H;
const iso = (ms: number) => new Date(Date.now() - ms).toISOString();
const eur = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Läuft eine Teilabfrage zu lange oder scheitert sie, bleibt der Rest der Übersicht nutzbar.
async function safe<T>(p: PromiseLike<T> | (() => PromiseLike<T>), fallback: T, ms = 4500): Promise<T> {
  try {
    const run = typeof p === 'function' ? p() : p;
    return await Promise.race([Promise.resolve(run), new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
  } catch { return fallback; }
}

// Prüfung mit Zeitmessung: unterscheidet „gestört“ von „nicht geprüft (Zeitüberschreitung)“.
type Probe = { ok: boolean; ms: number; timeout: boolean };
async function probe(f: () => PromiseLike<boolean>, ms = 4500): Promise<Probe> {
  const t0 = Date.now();
  const TIMEOUT = Symbol('timeout');
  try {
    const r = await Promise.race([Promise.resolve(f()), new Promise<typeof TIMEOUT>((res) => setTimeout(() => res(TIMEOUT), ms))]);
    return r === TIMEOUT ? { ok: false, ms: Date.now() - t0, timeout: true } : { ok: Boolean(r), ms: Date.now() - t0, timeout: false };
  } catch { return { ok: false, ms: Date.now() - t0, timeout: false }; }
}

// Externe Prüfungen (Stripe, Speicher) höchstens einmal pro Minute je Server-Instanz.
const memo = new Map<string, { at: number; v: unknown }>();
async function cached<T>(key: string, ttl: number, f: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v as T;
  const v = await f();
  memo.set(key, { at: Date.now(), v });
  return v;
}

const SEC_IMPORTANT = ['admin_denied', 'admin_ip_blocked', 'admin_mfa_missing', 'login_flood', 'upload_rejected'];
const SEC_LABEL: Record<string, string> = {
  admin_denied: 'Zugriff auf den Web-Admin ohne Berechtigung', admin_ip_blocked: 'Web-Admin-Zugriff von fremder IP',
  admin_mfa_missing: 'Web-Admin-Zugriff ohne zweiten Faktor', login_flood: 'Viele Fehlanmeldungen', upload_rejected: 'Upload abgewiesen',
};
const AUDIT_LABEL: Record<string, string> = {
  panic_on: 'Not-Aus eingeschaltet', panic_off: 'Not-Aus ausgeschaltet', invoice_paid: 'Rechnung als bezahlt markiert', invoice_remind: 'Zahlungserinnerung gesendet',
  invoice_create: 'Rechnung erstellt', invoice_storno: 'Rechnung storniert', sec_block: 'Quelle gesperrt', sec_unblock: 'Sperre aufgehoben', sec_ack: 'Sicherheitsereignisse gesehen',
  team_add: 'Teammitglied hinzugefügt', team_remove: 'Teammitglied entfernt', contactDone: 'Anfrage erledigt', user_delete: 'Konto gelöscht', user_create: 'Konto angelegt',
  app_diagnose: 'Systemcheck durchgeführt', push_test: 'Push-Test gesendet', app_signout_others: 'Andere Sitzungen beendet', app_device_remove: 'Gerät abgemeldet',
  access_grant: 'Zugang freigeschaltet', access_revoke: 'Zugang entzogen', newsletter_send: 'Newsletter versendet', datev_export: 'DATEV-Export erstellt',
};

export async function buildOverview(role: AdminRole): Promise<Overview> {
  const can = (a?: AdminArea) => canAccess(role, a);
  const owner = role === 'owner';
  const alerts: AlertItem[] = [];
  const activity: ActivityItem[] = [];
  const systems: SystemItem[] = [];
  const metrics: Metric[] = [];

  if (!adminConfigured()) {
    return {
      generatedAt: new Date().toISOString(), role,
      status: { level: 'critical', title: 'Datenbank nicht verbunden', detail: 'Der Server hat keinen Zugang zur Datenbank.' },
      metrics, systems: [{ key: 'db', label: 'Datenbank', state: 'fail', info: 'Nicht konfiguriert', checkedAt: new Date().toISOString() }],
      alerts: [{ id: 'db', severity: 'critical', title: 'Datenbank nicht verbunden', detail: 'SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY in Vercel prüfen.', at: new Date().toISOString(), attention: true, target: 'system' }],
      activity, deploy: { env: process.env.VERCEL_ENV || 'lokal', commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null, deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null, region: process.env.VERCEL_REGION || null },
    };
  }
  const db = supabaseAdmin();
  const count = async (table: string, f?: (q: any) => any): Promise<number | null> => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = db.from(table).select('*', { count: 'exact', head: true });
    if (f) q = f(q);
    const { count: c, error } = await q;
    return error ? null : c ?? 0;
  };

  // Alle Abfragen sofort gleichzeitig starten (statt rund 25 nacheinander) – unten wird nur noch auf die Ergebnisse gewartet.
  // Was eine Rolle nicht sehen darf, wird gar nicht erst abgefragt.
  const mailOk = mailConfigured();
  const pMailErr = mailOk ? safe(count('lr_mail_messages', (q) => q.eq('status', 'fehler').gte('updated_at', iso(D))), null) : null;
  const pDbP = probe(() => db.from('lr_settings').select('key').limit(1).then((r) => !r.error));
  const pPanic = safe(panicState(), { active: false } as Awaited<ReturnType<typeof panicState>>);
  const pStoreP = cached('storage', 60_000, () => probe(() => db.storage.listBuckets().then((r) => !r.error)));
  const pSp = billingEnabled() ? cached('stripe', 60_000, () => probe(() => stripe().balance.retrieve().then(() => true))) : (null as never);
  const pPushRows = safe(db.from('lr_admin_push_tokens').select('token', { count: 'exact', head: true }).then((r) => (r.error ? null : r.count ?? 0)), null);
  const pSec = owner ? safe(db.from('lr_security_log').select('kind, created_at').is('acknowledged_at', null).gte('created_at', iso(7 * D)).order('created_at', { ascending: false }).limit(2000).then((r) => r.data ?? []), [] as { kind: string; created_at: string }[]) : (null as never);
  const pErrs = owner ? safe(db.from('lr_client_errors').select('id, message, area, count, last_seen').is('resolved_at', null).gte('last_seen', iso(D)).order('last_seen', { ascending: false }).limit(20).then((r) => r.data ?? []), [] as { id: string; message: string; area: string; count: number; last_seen: string }[]) : (null as never);
  const pHookErr = owner ? safe(count('lr_webhook_log', (q) => q.not('error', 'is', null).gte('created_at', iso(D))), null) : (null as never);
  const pVerify = owner ? safe(db.from('lr_b2b_accounts').select('id, company_name, verification_submitted_at').eq('verification_status', 'eingereicht').order('verification_submitted_at', { ascending: false }).limit(20).then((r) => r.data ?? []), [] as { id: string; company_name: string; verification_submitted_at: string | null }[]) : (null as never);
  const pContacts = owner ? safe(db.from('lr_b2b_contact').select('id, company, kind, created_at').eq('status', 'offen').order('created_at', { ascending: false }).limit(50).then((r) => r.data ?? []), [] as { id: string; company: string | null; kind: string | null; created_at: string }[]) : (null as never);
  const pTickets = owner ? safe(db.from('lr_support_tickets').select('id, no, severity, due_at, created_at').in('status', ['neu', 'in_arbeit', 'rueckfrage']).order('created_at', { ascending: false }).limit(50).then((r) => r.data ?? []), [] as { id: string; no: number; severity: string; due_at: string; created_at: string }[]) : (null as never);
  const pFb = owner ? safe(count('lr_feedback', (q) => q.eq('status', 'neu')), null) : (null as never);
  const pDevs = owner ? safe(db.from('lr_admin_push_tokens').select('created_at, platform').gte('created_at', iso(14 * D)).order('created_at', { ascending: false }).limit(3).then((r) => r.data ?? []), [] as { created_at: string; platform: string }[]) : (null as never);
  const pOpen = can('finance') ? safe(db.from('lr_invoices').select('id, invoice_number, gross_cents, due_date, payment_status').eq('kind', 'invoice').in('payment_status', ['PENDING', 'OVERDUE']).not('account_id', 'is', null).limit(500).then((r) => r.data ?? []), [] as { id: string; invoice_number: string; gross_cents: number; due_date: string | null; payment_status: string }[]) : (null as never);
  const pFailedAt = can('finance') && billingEnabled() ? cached('stripe-failed', 120_000, () => safe(stripe().charges.list({ created: { gte: Math.floor((Date.now() - 7 * D) / 1000) }, limit: 100 }).then((r) => r.data.filter((c) => c.status === 'failed').map((c) => new Date(c.created * 1000).toISOString())), [] as string[], 5000)) : (null as never);
  const pPaid = can('finance') ? safe(db.from('lr_invoices').select('id, invoice_number, gross_cents, paid_at').eq('kind', 'invoice').not('paid_at', 'is', null).gte('paid_at', iso(7 * D)).order('paid_at', { ascending: false }).limit(5).then((r) => r.data ?? []), [] as { id: string; invoice_number: string; gross_cents: number; paid_at: string }[]) : (null as never);
  const pUnread = can('mail') ? safe(count('lr_mail_messages', (q) => q.eq('folder', 'inbox').eq('direction', 'in').is('read_at', null)), null) : (null as never);
  const pReq = can('termine') ? safe(db.from('lr_bookings').select('id, company, starts_at, created_at').eq('status', 'angefragt').gte('starts_at', new Date().toISOString()).order('starts_at', { ascending: true }).limit(20).then((r) => r.data ?? []), [] as { id: string; company: string | null; starts_at: string; created_at: string }[]) : (null as never);
  const pRecent = can('termine') ? safe(db.from('lr_bookings').select('id, company, created_at').gte('created_at', iso(7 * D)).order('created_at', { ascending: false }).limit(4).then((r) => r.data ?? []), [] as { id: string; company: string | null; created_at: string }[]) : (null as never);
  const pNewUsers = safe(db.from('lr_user_data').select('user_id, created_at').gte('created_at', iso(7 * D)).order('created_at', { ascending: false }).limit(4).then((r) => r.data ?? []), [] as { user_id: string; created_at: string }[]);
  const pMaps = safe(db.from('lr_kreditmappe_versions').select('id, b2b_account_id, created_at').gte('created_at', iso(7 * D)).order('created_at', { ascending: false }).limit(4).then((r) => r.data ?? []), [] as { id: string; b2b_account_id: string | null; created_at: string }[]);
  const pAccsAudit = owner ? Promise.all([safe(db.from('lr_b2b_accounts').select('id, company_name, created_at').gte('created_at', iso(14 * D)).order('created_at', { ascending: false }).limit(5).then((r) => r.data ?? []), [] as { id: string; company_name: string; created_at: string }[]),
      safe(db.from('lr_admin_audit').select('id, action, created_at').in('action', Object.keys(AUDIT_LABEL)).gte('created_at', iso(14 * D)).order('created_at', { ascending: false }).limit(5).then((r) => r.data ?? []), [] as { id: string; action: string; created_at: string }[])]) : (null as never);
  const pMaps7Users7 = Promise.all([safe(count('lr_kreditmappe_versions', (q) => q.gte('created_at', iso(7 * D))), null),
    safe(count('lr_user_data', (q) => q.gte('created_at', iso(7 * D))), null)]);

  // ── Systemzustand (für alle Rollen; Details nur für Inhaber) ─────
  // Ehrlich: Was nicht geprüft werden konnte (Zeitüberschreitung), gilt nie als „in Ordnung“.
  const now = new Date().toISOString();
  const dbP = await pDbP;
  const panic = await pPanic;
  const sys = (key: string, label: string, state: SysState, info: string, ms?: number): SystemItem =>
    ({ key, label, state, info: owner ? info : ({ ok: 'läuft', warn: 'eingeschränkt', fail: 'gestört', off: 'aus' } as Record<SysState, string>)[state], checkedAt: now, ...(ms !== undefined ? { ms } : {}) });
  const fromProbe = (p: Probe, okInfo: string, failInfo: string, slowMs = 2500): [SysState, string] =>
    p.timeout ? ['warn', 'nicht geprüft (keine Antwort)'] : !p.ok ? ['fail', failInfo] : p.ms > slowMs ? ['warn', `${okInfo} · langsam (${p.ms} ms)`] : ['ok', `${okInfo} · ${p.ms} ms`];

  systems.push(sys('api', 'API', 'ok', process.env.VERCEL_REGION ? `erreichbar · ${process.env.VERCEL_REGION}` : 'erreichbar'));
  const [dbState, dbInfo] = fromProbe(dbP, 'erreichbar', 'nicht erreichbar');
  systems.push(sys('db', 'Datenbank', dbState, dbInfo, dbP.ms));

  const storeP = await pStoreP;
  const [stState, stInfo] = fromProbe(storeP, 'erreichbar', 'nicht erreichbar');
  systems.push(sys('storage', 'Speicher', stState, stInfo, storeP.ms));

  let pay: SystemItem;
  let payTimeout = false;
  if (!billingEnabled()) pay = sys('payments', 'Zahlungen', 'off', 'nicht eingeschaltet');
  else {
    const key = String(process.env.STRIPE_SECRET_KEY || '');
    const live = key.startsWith('sk_live') || key.startsWith('rk_live');
    const sp = await pSp;
    payTimeout = sp.timeout;
    const hook = Boolean(process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRETT);
    const [ps, pi] = fromProbe(sp, live ? 'Stripe live' : 'Stripe im Testmodus', 'Stripe nicht erreichbar');
    pay = sys('payments', 'Zahlungen', ps === 'ok' && (!hook || !live) ? 'warn' : ps, ps === 'ok' && !hook ? 'Webhook-Geheimnis fehlt' : pi, sp.ms);
  }
  systems.push(pay);

  const mailErr = mailOk ? await pMailErr : null;
  systems.push(sys('mail', 'E-Mail', !mailOk ? 'fail' : mailErr ? 'warn' : 'ok', !mailOk ? 'Versand nicht eingerichtet' : mailErr ? `${plural(mailErr, 'Fehler', 'Fehler')} in 24 Std.` : 'Versand bereit'));

  const pushRows = await pPushRows;
  systems.push(sys('push', 'Mitteilungen', pushRows === null ? 'warn' : 'ok', pushRows === null ? 'nicht geprüft' : `${plural(pushRows, 'Gerät', 'Geräte')} angemeldet`));

  systems.push(sys('security', 'Zugangsschutz', panic.active ? 'fail' : mfaRequired() ? 'ok' : 'warn', panic.active ? `Not-Aus Stufe ${panic.level === 1 ? 1 : 2} aktiv` : mfaRequired() ? 'zweiter Faktor Pflicht' : 'zweiter Faktor nicht Pflicht'));

  // Systemhinweise (für alle Rollen sichtbar; Sprung zur Systemseite nur für Inhaber)
  const sysTarget = owner ? ('system' as const) : undefined;
  if (dbState === 'fail') alerts.push({ id: 'sys-db', severity: 'critical', title: 'Datenbank nicht erreichbar', detail: 'Anmeldungen, Käufe und Daten sind betroffen.', at: now, attention: true, target: sysTarget });
  else if (dbP.timeout) alerts.push({ id: 'sys-db', severity: 'warning', title: 'Datenbank konnte nicht geprüft werden', detail: 'Keine Antwort innerhalb der Zeit.', at: now, attention: true, target: sysTarget });
  if (panic.active) alerts.push({ id: 'sys-panic', severity: 'critical', title: `Not-Aus Stufe ${panic.level === 1 ? 1 : 2} ist aktiv`, detail: panic.level === 1 ? 'Nur lesen: keine Neuanmeldungen, Käufe oder Anfragen.' : 'Alle außer Admins sind abgemeldet.', at: panic.since ?? null, attention: true, target: owner ? 'sicherheit' : undefined });
  if (stState === 'fail') alerts.push({ id: 'sys-storage', severity: 'critical', title: 'Speicher nicht erreichbar', detail: 'Dokumente und Kreditmappen können nicht geladen werden.', at: now, attention: true, target: sysTarget });
  if (pay.state === 'fail') alerts.push({ id: 'sys-pay', severity: 'critical', title: 'Zahlungsdienst gestört', detail: owner ? pay.info : 'Stripe ist nicht erreichbar.', at: now, attention: true, target: sysTarget });
  if (owner) {
    if (pay.state === 'warn') alerts.push({ id: 'sys-pay', severity: 'warning', title: 'Zahlungen eingeschränkt', detail: pay.info, at: null, attention: true, target: 'system' });
    if (!mailOk) alerts.push({ id: 'sys-mail', severity: 'warning', title: 'E-Mail-Versand nicht eingerichtet', detail: 'Bestätigungen und Rechnungen werden nicht verschickt.', at: null, attention: true, target: 'system' });
    if (mailErr) alerts.push({ id: 'sys-mailerr', severity: 'warning', title: 'E-Mail-Versand fehlgeschlagen', detail: `${plural(mailErr, 'Nachricht', 'Nachrichten')} in den letzten 24 Stunden nicht zugestellt.`, at: null, attention: true, target: 'postfach' });
    if (!mfaRequired()) alerts.push({ id: 'sys-mfa', severity: 'warning', title: 'Zweiter Faktor ist nicht Pflicht', detail: 'ADMIN_MFA ist ausgeschaltet. Web-Admin und App sind nur per Passwort geschützt.', at: null, attention: true, target: 'system' });

    // Sicherheit: wichtige, noch nicht gesehene Ereignisse der letzten 7 Tage
    const sec = await pSec;
    const byKind = new Map<string, { n: number; last: string }>();
    let noise = 0;
    for (const r of sec) {
      if (!SEC_IMPORTANT.includes(r.kind)) { noise++; continue; }
      const g = byKind.get(r.kind) || { n: 0, last: r.created_at };
      g.n++; if (r.created_at > g.last) g.last = r.created_at;
      byKind.set(r.kind, g);
    }
    for (const [kind, g] of byKind) {
      alerts.push({ id: `sec-${kind}`, severity: 'warning', title: SEC_LABEL[kind] || 'Sicherheitsereignis', detail: `${plural(g.n, 'Ereignis', 'Ereignisse')} in 7 Tagen, noch nicht gesehen.`, at: g.last, attention: true, target: 'sicherheit', action: { kind: 'ack_security', label: 'Als gesehen markieren', kindKey: kind } });
    }
    if (noise) alerts.push({ id: 'sec-noise', severity: 'info', title: 'Abgewehrte Zugriffe', detail: `${plural(noise, 'automatisch abgewehrter Zugriff', 'automatisch abgewehrte Zugriffe')} (Scanner, Bots, Drosselung) in 7 Tagen.`, at: null, attention: false, target: 'sicherheit' });

    // Technische Fehler auf der Website (aus dem Browser gemeldet, nicht erledigt, letzte 24 Std.)
    const errs = await pErrs;
    if (errs.length) {
      const total = errs.reduce((s, e) => s + Number(e.count || 1), 0);
      const areas = [...new Set(errs.map((e) => ({ admin: 'Web-Admin', portal: 'B2B-Portal', app: 'Anwendung' } as Record<string, string>)[e.area] || 'Website'))].join(', ');
      alerts.push({ id: 'web-errors', severity: 'warning', title: 'Fehler auf der Website', detail: `${plural(errs.length, 'Fehlerart', 'Fehlerarten')} (${total}× gemeldet) in 24 Std. · ${areas}`, at: errs[0].last_seen, attention: true, target: 'system' });
    }

    // Webhook-Zustellungen an Unternehmen (letzte 24 Std.)
    const hookErr = await pHookErr;
    if (hookErr) alerts.push({ id: 'b2b-webhook', severity: 'warning', title: 'Webhook-Zustellung fehlgeschlagen', detail: `${plural(hookErr, 'Zustellung', 'Zustellungen')} an Unternehmenssysteme in 24 Std.`, at: null, attention: true, target: 'unternehmen' });

    // Unternehmen: Prüfung eingereicht
    const verify = await pVerify;
    for (const a of verify.slice(0, 5)) alerts.push({ id: `verify-${a.id}`, severity: 'warning', title: 'Unternehmen wartet auf Prüfung', detail: a.company_name || 'Unternehmen', at: a.verification_submitted_at, ref: a.company_name, attention: true, target: 'unternehmen', targetId: a.id });

    // Neue Unternehmensanfragen
    const contacts = await pContacts;
    if (contacts.length) alerts.push({ id: 'contacts', severity: 'info', title: plural(contacts.length, 'neue Unternehmensanfrage', 'neue Unternehmensanfragen'), detail: contacts.slice(0, 3).map((c) => c.company || 'ohne Firmenname').join(', '), at: contacts[0].created_at, attention: true, target: 'anfragen' });
    metrics.push({ key: 'requests', label: 'Neue Anfragen', value: contacts.length, tone: contacts.length ? 'info' : 'neutral', target: 'anfragen' });

    // Technische Probleme (Ziel: Antwort in 12 Stunden)
    const tickets = await pTickets;
    if (tickets.length) {
      const late = tickets.filter((t) => Date.parse(t.due_at) < Date.now()).length;
      const urgent = tickets.filter((t) => t.severity === 'blockiert').length;
      alerts.push({ id: 'support-tickets', severity: late || urgent ? 'warning' : 'info', title: plural(tickets.length, 'technisches Problem offen', 'technische Probleme offen'), detail: `${late ? `${late} über 12 Std. · ` : ''}${urgent ? `${urgent} blockiert · ` : ''}Web-Admin → Technische Probleme`, at: tickets[0].created_at, ref: `T-${tickets[0].no}`, attention: true });
      for (const t of tickets.slice(0, 3)) activity.push({ id: `tk-${t.id}`, kind: 'lead', title: 'Technisches Problem gemeldet', detail: `T-${t.no}`, at: t.created_at });
    }

    // Verbesserungsvorschläge
    const fb = await pFb;
    if (fb) alerts.push({ id: 'feedback', severity: 'info', title: plural(fb, 'neuer Verbesserungsvorschlag', 'neue Verbesserungsvorschläge'), detail: 'Im Web-Admin unter „Verbesserungsvorschläge“ bewerten.', at: null, attention: false });

    // Aktivität: neue Unternehmen, Anfragen, Admin-Aktionen
    const [accs, audit] = await pAccsAudit;
    for (const a of accs) activity.push({ id: `acc-${a.id}`, kind: 'company', title: 'Neues Unternehmen registriert', detail: a.company_name, at: a.created_at, target: 'unternehmen', targetId: a.id });
    for (const c of contacts.slice(0, 5)) activity.push({ id: `con-${c.id}`, kind: 'lead', title: 'Neue Unternehmensanfrage', detail: c.company || undefined, at: c.created_at, target: 'anfragen' });
    // Aktivität: neue Mitteilungs-Geräte und wichtige Sicherheitsereignisse
    const devs = await pDevs;
    devs.forEach((d, i) => activity.push({ id: `dev-${i}-${d.created_at}`, kind: 'device', title: 'Push-Gerät registriert', detail: d.platform === 'ios' ? 'iPhone/iPad' : 'Android', at: d.created_at, target: 'sicherheit' }));
    for (const [kind, g] of [...byKind].slice(0, 3)) activity.push({ id: `secev-${kind}`, kind: 'security', title: 'Sicherheitsereignis', detail: SEC_LABEL[kind] || kind, at: g.last, target: 'sicherheit' });
    for (const a of audit) activity.push({ id: `aud-${a.id}`, kind: a.action === 'app_diagnose' ? 'check' : 'admin', title: a.action === 'app_diagnose' ? 'Systemcheck' : 'Admin-Aktion', detail: AUDIT_LABEL[a.action] || a.action, at: a.created_at, target: 'audit' });
  }

  // ── Zahlungen (Buchhaltung) ─────────────────────────────────────
  if (can('finance')) {
    const today = new Date().toISOString().slice(0, 10);
    const open = await pOpen;
    const overdue = open.filter((x) => x.payment_status === 'OVERDUE' || (x.due_date && x.due_date < today));
    if (overdue.length) {
      const sum = overdue.reduce((s, x) => s + Number(x.gross_cents || 0), 0);
      alerts.push({ id: 'inv-overdue', severity: 'warning', title: plural(overdue.length, 'Rechnung überfällig', 'Rechnungen überfällig'), detail: `Offen: ${eur(sum)} · ${overdue.slice(0, 3).map((x) => x.invoice_number).join(', ')}`, at: null, ref: overdue[0].invoice_number, attention: true, target: 'zahlungen' });
    }
    // Fehlgeschlagene Kartenzahlungen (Stripe, 7 Tage)
    let failed = 0;
    if (billingEnabled()) {
      const failedAt = await pFailedAt;
      failed = failedAt.length;
      // Aktivität: fehlgeschlagene Zahlungen nur mit Zeitpunkt – keine Namen oder Beträge.
      failedAt.slice(0, 3).forEach((at, i) => activity.push({ id: `payfail-${i}-${at}`, kind: 'payment_failed', title: 'Zahlung fehlgeschlagen', detail: 'Kartenzahlung abgelehnt', at, target: 'zahlungen' }));
      if (failed) alerts.push({ id: 'pay-failed', severity: 'warning', title: plural(failed, 'Zahlung fehlgeschlagen', 'Zahlungen fehlgeschlagen'), detail: 'Kartenzahlungen der letzten 7 Tage, die abgelehnt wurden. Details in Stripe.', at: null, attention: true, target: 'zahlungen' });
    }
    metrics.push({ key: 'payments', label: 'Zahlungen offen', value: overdue.length + failed, tone: overdue.length + failed ? 'warn' : 'ok', target: 'zahlungen' });

    const paid = await pPaid;
    for (const p of paid) activity.push({ id: `pay-${p.id}`, kind: 'payment', title: 'Zahlung eingegangen', detail: `${p.invoice_number} · ${eur(Number(p.gross_cents || 0))}`, at: p.paid_at, target: 'zahlungen' });
  }

  // ── Postfach und Termine (Support) ─────────────────────────────
  let vorgaenge = 0;
  if (can('mail')) {
    const unread = await pUnread;
    if (unread) { vorgaenge += unread; alerts.push({ id: 'mail-unread', severity: 'info', title: plural(unread, 'ungelesene E-Mail', 'ungelesene E-Mails'), detail: 'Im Posteingang', at: null, attention: true, target: 'postfach' }); }
  }
  if (can('termine')) {
    const req = await pReq;
    if (req.length) {
      vorgaenge += req.length;
      const next = new Date(req[0].starts_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' });
      alerts.push({ id: 'bookings', severity: 'info', title: plural(req.length, 'Terminanfrage offen', 'Terminanfragen offen'), detail: `Nächste: ${next}`, at: req[0].created_at, attention: true, target: 'termine' });
    }
    const recent = await pRecent;
    for (const b of recent) activity.push({ id: `bk-${b.id}`, kind: 'booking', title: 'Terminanfrage eingegangen', detail: b.company || undefined, at: b.created_at, target: 'termine' });
  }
  if (owner) {
    const verifyOpen = alerts.filter((a) => a.id.startsWith('verify-')).length;
    vorgaenge += verifyOpen;
  }
  if (can('mail') || can('termine') || owner) metrics.push({ key: 'open', label: 'Offene Vorgänge', value: vorgaenge, tone: vorgaenge ? 'info' : 'neutral', target: 'postfach' });

  // ── Statistik (alle Rollen) ─────────────────────────────────────
  const [maps7, users7] = await pMaps7Users7;
  if (maps7 !== null) metrics.push({ key: 'dossiers', label: 'Kreditmappen (7 T.)', value: maps7, tone: 'neutral', target: 'statistik' });
  if (!owner && users7 !== null) metrics.push({ key: 'users', label: 'Neue Konten (7 T.)', value: users7, tone: 'neutral', target: 'statistik' });
  const newUsers = await pNewUsers;
  for (const u of newUsers) activity.push({ id: `usr-${u.user_id}`, kind: 'user', title: 'Neues Konto', at: u.created_at, target: 'statistik' });
  const maps = await pMaps;
  for (const m of maps) activity.push({ id: `map-${m.id}`, kind: 'dossier', title: 'Kreditmappe erstellt', detail: m.b2b_account_id ? 'Unternehmen' : 'Privatkunde', at: m.created_at, target: 'statistik' });

  // ── Zusammenfassung ─────────────────────────────────────────────
  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || String(b.at || '').localeCompare(String(a.at || '')));
  const crit = alerts.filter((a) => a.severity === 'critical');
  const warn = alerts.filter((a) => a.severity === 'warning');
  metrics.push({ key: 'alerts', label: 'Fehler / Warnungen', value: crit.length + warn.length, tone: crit.length ? 'bad' : warn.length ? 'warn' : 'ok', target: 'jetzt' });
  const sysBad = systems.some((x) => x.state === 'fail');
  // Nicht prüfbar (keine Antwort) ist kein „stabil“: Dann lautet die Lage ehrlich „nicht vollständig prüfbar“.
  const unchecked = [dbP.timeout && 'Datenbank', storeP.timeout && 'Speicher', payTimeout && 'Zahlungen', pushRows === null && 'Mitteilungen'].filter(Boolean) as string[];
  const level: Level = crit.length || dbState === 'fail' ? 'critical' : warn.length || sysBad || unchecked.length ? 'warn' : 'ok';
  const status = level === 'critical'
    ? { level, title: 'Handlung erforderlich', detail: crit[0]?.title || 'Ein Dienst ist gestört.' }
    : level === 'warn'
      ? warn.length || sysBad
        ? { level, title: 'Teilweise Probleme', detail: plural(warn.length || 1, 'Warnung', 'Warnungen') + ' – Details unter „Jetzt wichtig“.' }
        : { level, title: 'Status nicht vollständig prüfbar', detail: `Keine Antwort von: ${unchecked.join(', ')}. Bitte gleich erneut prüfen.` }
      : { level, title: 'Alles stabil', detail: 'Alle geprüften Dienste laufen normal.' };

  activity.sort((a, b) => b.at.localeCompare(a.at));
  return { generatedAt: new Date().toISOString(), role, status, metrics, systems, alerts: alerts.slice(0, 60), activity: activity.slice(0, 14), deploy: { env: process.env.VERCEL_ENV || 'lokal', commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null, deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null, region: process.env.VERCEL_REGION || null } };
}
