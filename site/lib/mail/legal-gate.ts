import { supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { isSuppressed } from '@/lib/marketing/suppression';
import { declinedRecipients } from '@/lib/mail/decline';
import type { MailRow } from '@/lib/mail/compose';

// Sendesperre ohne Rechtsgrundlage (§ 7 UWG, Art. 6 DSGVO – Vorschlag Daniel · Recht, freigegeben von Feray).
// Vor jedem Versand aus dem Postfach (einzeln, „Alle senden“, Freigaben) wird je Empfänger geprüft:
//  a) Widerspruch/Abmeldung (Sperrliste oder CRM „widerspruch“) → immer gesperrt.
//  b) Werbliche Mail → nur mit bestätigter Double-Opt-in-Einwilligung (lr_newsletter, confirmed_at, nicht abgemeldet).
//     Bestandskunden-Ausnahme (§ 7 Abs. 3 UWG) gilt nur, wenn beim Kauf nachweisbar auf das Widerspruchsrecht hingewiesen
//     wurde. Dieses Feld gibt es bisher nirgends (Käufe laufen über Stripe ohne solchen Vermerk) – daher nie erfüllt.
//  c) Werbliche Mail ohne Abmeldelink im fertigen HTML → gesperrt (Prüfung in sendRow nach dem Zusammenbau).
//  d) Kaltakquise (auch an Unternehmen) ohne ausdrückliche Einwilligung → gesperrt.
// Gesperrte Entwürfe bleiben unverändert im Ordner „Entwürfe“ (Status „gesperrt“ + Grund); nichts wird gelöscht.
export type LegalKind = 'werbung' | 'transaktion';
export type LegalCheck = { kind: LegalKind; basis: 'einwilligung' | 'bestandskunde' | 'antwort' | 'fehlt'; consentAt: string | null; reason: string | null; label: string };

// Typische Werbesprache in Betreff/Text (vorsichtig weit gefasst – im Zweifel „Werbung“).
const AD = /(newsletter|angebot|rabatt|gutschein|aktion\b|sonderpreis|jetzt (testen|buchen|kaufen|sichern|starten)|kostenlos (testen|ausprobieren)|gratis|probemonat|demo\b|kooperation|partnerschaft|zusammenarbeit|vorstellen (dürfen|möchten)|darf ich (ihnen|euch) .{0,30}vorstellen|presse(anfrage|mitteilung)|neue funktion|webinar|einladung|termin vereinbaren|unverbindlich)/i;
const FREEMAIL = /@(gmail|googlemail|web|gmx|t-online|yahoo|outlook|hotmail|live|icloud|me|aol|freenet|posteo|mailbox|protonmail|proton)\./i;
const de = (t: string) => new Date(t).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
const recipientsOf = (m: Pick<MailRow, 'to_emails' | 'cc_emails' | 'bcc_emails'>) => [...new Set([...(m.to_emails || []), ...(m.cc_emails || []), ...(m.bcc_emails || [])].map((e) => String(e).trim().toLowerCase()).filter(Boolean))];

type Row = Pick<MailRow, 'id' | 'to_emails' | 'cc_emails' | 'bcc_emails' | 'subject' | 'text_body' | 'in_reply_to' | 'with_unsub' | 'design'> & { source?: string | null; werbung?: boolean | null; cta?: unknown };
type Facts = { consent: Map<string, string>; objection: Set<string>; wroteUs: Set<string> };

// Werblich: ausdrücklich markiert, Werbesprache, Abmeldelink/Vorlage/Knopf oder Erstkontakt (keine Antwort, Empfänger hat
// uns nie geschrieben). Antworten in einem bestehenden Verlauf ohne Werbesprache gelten als „Transaktion/Antwort“.
export function isAdvertising(m: Row, wroteUs: Set<string>): boolean {
  if (m.werbung === true) return true;
  if (m.in_reply_to) return false;
  if (m.with_unsub || m.design === 'fertig' || m.source === 'gmail-entwurf' || m.cta) return true;
  if (AD.test(`${m.subject || ''}\n${String(m.text_body || '').slice(0, 6000)}`)) return true;
  return !recipientsOf(m).every((e) => wroteUs.has(e));
}

// Alle nötigen Fakten für viele Entwürfe auf einmal laden (Einwilligungen, Widersprüche, bisheriger Austausch).
async function loadFacts(emails: string[]): Promise<Facts> {
  const db = supabaseAdmin(), list = [...new Set(emails)];
  const consent = new Map<string, string>(), objection = new Set<string>(), wroteUs = new Set<string>();
  if (!list.length) return { consent, objection, wroteUs };
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const [nl, supp, dec, inb] = await Promise.all([
      db.from('lr_newsletter').select('email, confirmed_at').in('email', part).not('confirmed_at', 'is', null).is('unsubscribed_at', null),
      isSuppressed(part.map((email) => ({ email }))),
      declinedRecipients(part),
      db.from('lr_mail_messages').select('from_email').eq('direction', 'in').in('from_email', part).limit(2000),
    ]);
    if (nl.error || inb.error) throw new Error('Rechtsgrundlage nicht prüfbar');
    for (const r of nl.data ?? []) consent.set(String(r.email).toLowerCase(), r.confirmed_at as string);
    part.forEach((e, k) => { if (supp[k]) objection.add(e); });
    // Nur „widerspruch“ ist ein Werbewiderspruch; eine Absage (kein_interesse) sperrt Anschreiben, nicht Antworten.
    for (const e of dec) objection.add(e);
    for (const r of inb.data ?? []) wroteUs.add(String(r.from_email).toLowerCase());
  }
  return { consent, objection, wroteUs };
}

function judge(m: Row, f: Facts): LegalCheck {
  const rcp = recipientsOf(m);
  const kind: LegalKind = isAdvertising(m, f.wroteUs) ? 'werbung' : 'transaktion';
  const objected = rcp.filter((e) => f.objection.has(e));
  if (objected.length) return { kind, basis: 'fehlt', consentAt: null, reason: `Widerspruch (${objected.join(', ')})`, label: 'Rechtsgrundlage: fehlt (Widerspruch)' };
  if (kind === 'transaktion') return { kind, basis: 'antwort', consentAt: null, reason: null, label: 'Rechtsgrundlage: Antwort/Transaktion' };
  const missing = rcp.filter((e) => !f.consent.has(e));
  if (!missing.length) {
    const at = rcp.map((e) => f.consent.get(e) as string).sort()[0];
    return { kind, basis: 'einwilligung', consentAt: at, reason: null, label: `Rechtsgrundlage: Einwilligung vom ${de(at)}` };
  }
  // § 7 Abs. 3 UWG: Hinweis auf das Widerspruchsrecht beim Kauf ist nirgends gespeichert → nicht als erfüllt werten.
  const cold = missing.some((e) => !f.wroteUs.has(e) && !FREEMAIL.test(e));
  const reason = cold ? 'keine Einwilligung (Kaltakquise – auch gegenüber Unternehmen unzulässig)' : 'keine Einwilligung';
  return { kind, basis: 'fehlt', consentAt: null, reason, label: 'Rechtsgrundlage: fehlt' };
}

export async function legalChecks(rows: Row[]): Promise<Map<string, LegalCheck>> {
  const f = await loadFacts(rows.flatMap((r) => recipientsOf(r)));
  return new Map(rows.map((r) => [r.id, judge(r, f)]));
}
export async function legalCheck(m: Row): Promise<LegalCheck> {
  return (await legalChecks([m])).get(m.id) as LegalCheck;
}

// Werbliche Mail ohne Abmeldelink im fertigen HTML (c). Der Link gilt je Empfänger – bei Cc/Bcc hätten die übrigen keinen eigenen.
export const missingUnsub = (c: LegalCheck, m: Pick<MailRow, 'cc_emails' | 'bcc_emails'>, html: string, unsub: string | null) =>
  c.kind === 'werbung' && (!(unsub && html.includes(unsub)) || (m.cc_emails || []).length > 0 || (m.bcc_emails || []).length > 0);

// Sperren: Entwurf bleibt erhalten, bekommt Status „gesperrt“ + Grund; Protokoll ohne Mailinhalt.
export async function blockDraft(id: string, reason: string, actor: string): Promise<void> {
  await supabaseAdmin().from('lr_mail_messages').update({ status: 'gesperrt', error: `Gesperrt: ${reason}`.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id).neq('status', 'gesendet');
  await adminAudit(actor, 'mail_gesperrt', id, { grund: reason.replace(/\s*\([^)]*@[^)]*\)/g, '').slice(0, 120) }).catch(() => null);
}

// Einmalige Einordnung aller wartenden Entwürfe (nur lesen und markieren – nichts wird gesendet oder gelöscht).
// Ergebnis in lr_settings „mail_legal_check“ für Daniel · Recht im Headquarters.
const KEY = 'mail_legal_check';
export type LegalSummary = { at: string; total: number; transaktion: number; werbung_ok: number; gesperrt: number };
export async function loadLegalSummary(): Promise<LegalSummary | null> {
  const { data } = await supabaseAdmin().from('lr_settings').select('value').eq('key', KEY).maybeSingle();
  const v = data?.value as LegalSummary | null;
  return v && typeof v.total === 'number' ? v : null;
}
export async function classifyWaitingDrafts(actor = 'recht'): Promise<LegalSummary> {
  const db = supabaseAdmin();
  const { data, error } = await db.from('lr_mail_messages').select('id, to_emails, cc_emails, bcc_emails, subject, text_body, in_reply_to, with_unsub, design, source, cta').eq('direction', 'out').eq('folder', 'drafts').eq('status', 'entwurf').limit(1000);
  if (error) throw new Error('Entwürfe nicht lesbar');
  const rows = (data ?? []) as unknown as Row[];
  const checks = await legalChecks(rows);
  const s: LegalSummary = { at: new Date().toISOString(), total: rows.length, transaktion: 0, werbung_ok: 0, gesperrt: 0 };
  for (const r of rows) {
    const c = checks.get(r.id) as LegalCheck;
    // Werbung ohne Abmeldelink im Entwurf (mehrere Empfänger oder Abmeldelink abgeschaltet) kann nie zulässig rausgehen.
    const noUnsub = c.kind === 'werbung' && c.basis !== 'fehlt' && (!r.with_unsub || (r.to_emails || []).length !== 1 || (r.cc_emails || []).length || (r.bcc_emails || []).length);
    if (c.basis === 'fehlt' || noUnsub) { s.gesperrt++; await blockDraft(r.id, c.reason || 'Abmeldelink fehlt', actor); }
    else if (c.kind === 'werbung') s.werbung_ok++;
    else s.transaktion++;
  }
  await db.from('lr_settings').upsert({ key: KEY, value: s, updated_at: s.at, updated_by: 'recht' });
  await adminAudit(actor, 'mail_rechtsgrundlage_einordnung', null, { total: s.total, transaktion: s.transaktion, werbung_ok: s.werbung_ok, gesperrt: s.gesperrt }).catch(() => null);
  return s;
}
