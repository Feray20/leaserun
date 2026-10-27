import { supabaseAdmin } from '@/lib/supabase/admin';
import { suppress } from '@/lib/marketing/suppression';
import { pushAdmins } from '@/lib/admin/push';

// Absagen auf Anschreiben erkennen, damit niemand wiederholt angeschrieben wird (Wunsch Feray, 27.10.2026).
// Zwei Stufen:
//  - „widerspruch“: ausdrücklich keine weiteren Mails / abmelden → dauerhafte Sperre (Sperrliste, § 7 UWG). Nichts geht mehr raus.
//  - „kein_interesse“: freundliche Absage → 1 Jahr keine Anschreiben (werbliche Mails), danach frühestens ein neuer Versuch;
//    eine persönliche Antwort bleibt jederzeit möglich.
// Nur der eigene Text der Antwort zählt (zitierte frühere Mail wird abgeschnitten).
const STOP = /(keine (weiteren |zukünftigen )?(e-?mails?|nachrichten|zusendungen|anfragen)|nicht mehr (kontaktieren|anschreiben|schreiben)|(aus|von) (ihrem|eurem|dem|ihrer|der) (verteiler|liste|mailingliste)|bitte (streichen|löschen) sie|abmelden|abbestellen|unsubscribe|widersprech|widerspruch|remove me|stop (emailing|contacting))/i;
const NO = /(kein(e|en)? (weiteres |großes )?interesse|nicht interessiert|kein bedarf|keinen bedarf|nicht in frage|kommt (für uns )?nicht in frage|keine kooperation|keine zusammenarbeit|müssen (ihnen |euch )?(leider )?absagen|sagen (ihnen |euch )?(leider )?ab|passt (leider )?nicht (zu uns|in unser)|(not|no longer) interested|we('| a)re not interested)/i;

export function ownPart(text: string): string {
  const t = String(text || '').replace(/\r/g, '');
  // Bis zur ersten Zitat-Zeile oder „Am … schrieb …“ / „-----Original“ / „From:“
  const cut = t.search(/\n\s*(>|Am .{3,80} schrieb|On .{3,80} wrote|-{2,}\s*(Original|Ursprüngliche)|Von:\s|From:\s)/i);
  return (cut > 0 ? t.slice(0, cut) : t).slice(0, 2000);
}
export function declineKind(text: string): 'widerspruch' | 'kein_interesse' | null {
  const own = ownPart(text);
  if (STOP.test(own)) return 'widerspruch';
  if (NO.test(own)) return 'kein_interesse';
  return null;
}

// Eingehende Antwort prüfen: Nur wenn wir diese Adresse vorher angeschrieben haben.
export const DECLINE_PAUSE_DAYS = 365;
const pauseUntil = () => new Date(Date.now() + DECLINE_PAUSE_DAYS * 864e5).toISOString().slice(0, 10);

export async function handleDecline(fromEmail: string, text: string, subject: string): Promise<void> {
  const email = String(fromEmail || '').trim().toLowerCase();
  if (!email.includes('@')) return;
  const kind = declineKind(text);
  if (!kind) return;
  const db = supabaseAdmin();
  const { count } = await db.from('lr_mail_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('status', 'gesendet').contains('to_emails', [email]);
  if (!count) return;
  const now = new Date().toISOString();
  const { data: cs } = await db.from('lr_crm_contacts').select('id, status, email, company, postal_code').ilike('email', email);
  let ids = (cs ?? []).map((c) => c.id as string);
  if (!ids.length) {
    const ins = await db.from('lr_crm_contacts').insert({ kind: 'sonstige', company: (email.split('@')[1] || email).slice(0, 160), email, status: kind, source: 'Absage per E-Mail', next_at: kind === 'kein_interesse' ? pauseUntil() : null, ...(kind === 'widerspruch' ? { objection_at: now } : {}) }).select('id').single();
    if (ins.data) ids = [ins.data.id as string];
  } else {
    // „widerspruch“ nie zurückstufen.
    const up: Record<string, unknown> = { next_at: kind === 'kein_interesse' ? pauseUntil() : null, updated_at: now };
    if (kind === 'widerspruch') { up.status = 'widerspruch'; up.objection_at = now; }
    await db.from('lr_crm_contacts').update(up).in('id', ids);
    if (kind === 'kein_interesse') await db.from('lr_crm_contacts').update({ status: 'kein_interesse' }).in('id', ids).neq('status', 'widerspruch');
  }
  if (kind === 'widerspruch') await suppress({ email }, 'widerspruch_mail').catch(() => null);
  // Noch offene Anschreiben an diese Adresse sperren (bleiben als Entwurf sichtbar, gehen aber nicht raus).
  await db.from('lr_mail_messages').update({ status: 'gesperrt', error: kind === 'widerspruch' ? 'Widerspruch per E-Mail – nicht mehr anschreiben' : 'Absage per E-Mail – 1 Jahr nicht erneut anschreiben', updated_at: now })
    .eq('direction', 'out').eq('status', 'entwurf').contains('to_emails', [email]).is('in_reply_to', null);
  if (ids.length) await db.from('lr_crm_activities').insert(ids.map((id) => ({ contact_id: id, type: 'status', note: `${kind === 'widerspruch' ? 'Widerspruch' : 'Absage'} per E-Mail erkannt („${subject.slice(0, 120)}“) – ${kind === 'widerspruch' ? 'wird nie mehr angeschrieben' : `gesperrt bis ${pauseUntil()}`}`, actor: 'postfach' })));
  await pushAdmins('mail', kind === 'widerspruch' ? 'Widerspruch erkannt' : 'Absage erkannt', kind === 'widerspruch' ? `${email} wird nie mehr angeschrieben.` : `${email} ist 1 Jahr gesperrt (bis ${pauseUntil()}).`, 'mail_decline').catch(() => null);
}

// Vor dem Senden eines Anschreibens (werbliche Mail, keine Antwort): Absage/Widerspruch im CRM?
export async function declinedRecipients(emails: string[]): Promise<string[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  const { data } = await supabaseAdmin().from('lr_crm_contacts').select('email, status, next_at, updated_at').in('status', ['kein_interesse', 'widerspruch']).in('email', list);
  const today = new Date().toISOString().slice(0, 10);
  // Widerspruch: immer gesperrt. Absage: gesperrt bis next_at (ohne Datum: 1 Jahr ab letzter Änderung).
  const blocked = (data ?? []).filter((c) => {
    if (c.status === 'widerspruch') return true;
    const until = c.next_at ? String(c.next_at).slice(0, 10) : new Date(new Date(String(c.updated_at || Date.now())).getTime() + DECLINE_PAUSE_DAYS * 864e5).toISOString().slice(0, 10);
    return until > today;
  });
  return [...new Set(blocked.map((c) => String(c.email || '').toLowerCase()))];
}
