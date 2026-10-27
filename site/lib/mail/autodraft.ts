import { supabaseAdmin } from '@/lib/supabase/admin';
import { converse, gate } from '@/lib/admin/hq-ai';
import { pushAdmins } from '@/lib/admin/push';
import { htmlToText, sanitizeBody } from '@/lib/mail/template';
import { mailboxAddress } from '@/lib/mail/resend';
import { snippetOf } from '@/lib/mail/store';

// Automatischer Antwort-Entwurf (Wunsch Feray, 27.10.2026): Kommt eine E-Mail, die eine Antwort braucht, schreibt Claude
// sofort einen Entwurf im Verlauf – in der Sprache und Anrede (du/Sie) des Absenders, geht auf jede Frage ein. Gesendet
// wird nie automatisch: Feray liest, ändert bei Bedarf und sendet selbst („Entwurf öffnen & senden“).
// Layout, Gruß, Unterschrift und Fußzeile setzt das Postfach beim Senden – der Entwurf enthält nur den Text (keine Bilder,
// keine Signatur), damit nichts doppelt erscheint oder ein Bild nicht lädt.

export const NO_REPLY = /(^|[._-])(no-?reply|do-?not-?reply|noreply|mailer-daemon|postmaster|bounce|notifications?|newsletter|news|info-?mail|system|alerts?|billing|invoice|receipts?|statements?)([._+-]|@)/i;
export const AUTO_SUBJ = /(automatic reply|automatische antwort|abwesenheit|out of office|autoreply|auto-reply|ich bin (derzeit )?nicht im büro|delivery status|undeliverable|unzustellbar|zustellung fehlgeschlagen|read receipt|lesebestätigung|ihre bestellung|order confirmation|rechnung nr|receipt from|your receipt|versendet:|zugestellt:|geliefert:)/i;
const AUTO_BODY = /(nicht jede anfrage persönlich beantworten|this is an automated|automatisch generiert|automatically generated|bitte antworten sie nicht auf diese|please do not reply)/i;

type Row = { id: string; thread_id: string; direction: 'in' | 'out'; folder: string; status: string | null; from_email: string; from_name: string | null; subject: string; text_body: string | null; message_id: string | null; refs: string | null; auth: { unsub?: unknown } | null; created_at: string; received_at: string | null; sent_at: string | null };

const SYSTEM = `Du schreibst Antwort-Entwürfe für das Postfach von LeaseRun (leaserun.com, support@leaserun.com). Absenderin ist Feray Korkmaz, Head of Operations bei LeaseRun.

Über LeaseRun (nur diese Fakten verwenden, nichts dazu erfinden):
- Online-Werkzeug für private Immobilienkäufer: rechnet vor dem Bankgespräch durch, was die Bank prüft – Haushaltsrechnung, Kaufnebenkosten, Eigenkapital, Beleihung, Zins-Stresstest – und erstellt daraus eine fertige Kreditmappe für das Bankgespräch.
- Vermittelt keine Kredite, nimmt keine Provision von Banken. Finanziert über die Nutzer, die für den vollen Zugang bezahlen.
- Daten auf Servern in Frankfurt am Main (EU), DSGVO, keine Weitergabe an Banken oder Vermittler.
- Ergebnis ist eine Einschätzung, keine Finanzierungszusage und keine Anlage- oder Rechtsberatung.
- Für Bezahl-Platzierungen, Werbeanzeigen oder kostenpflichtige Veröffentlichungen hat LeaseRun derzeit kein Budget: freundlich absagen und eine kostenlose Alternative mit Nutzen für beide Seiten anbieten (Win-win).

Regeln für den Entwurf:
- Antworte in derselben Sprache wie die letzte eingegangene Mail und mit derselben Anrede (du oder Sie), passend zum Ton.
- Geh konkret auf jede Frage und jedes Anliegen der letzten Mail ein. Wenn Fragen nummeriert oder aufgelistet sind, beantworte jede einzeln. Verlangt der Absender ein Format (z. B. Fragen unverändert stehen lassen, reiner Text), halte dich daran.
- Erfinde keine Zahlen, Termine, Preise, Namen, Kundenstimmen oder Zusagen. Fehlt eine Information, die nur Feray kennen kann, setze an genau dieser Stelle einen kurzen Platzhalter in eckigen Doppelklammern, z. B. ⟦Datum eintragen⟧. So wenige Platzhalter wie möglich.
- Nenne nie Ferays Wohnort oder private Daten. Erwähne nicht, dass der Text von einer KI stammt.
- Klar, freundlich, auf den Punkt. Keine Floskeln, kein Marketing-Sprech, keine Emojis.
- Beginne mit der Anrede. Beende den Text OHNE Grußformel und OHNE Namen oder Signatur – Gruß, Unterschrift und Fußzeile setzt das Postfach automatisch. Ausnahme: Bei sehr förmlichen Mails darf die letzte Zeile „Mit freundlichen Grüßen“ sein.
- Keine Bilder, keine Links außer https://leaserun.com, wenn er wirklich hilft.

Antworte ausschließlich mit JSON ohne Codeblock:
{"antworten": true|false, "grund": "kurz, warum (keine) Antwort nötig ist", "absaetze": ["Absatz 1", "Absatz 2", ...]}
"antworten" ist false bei automatischen Antworten, Abwesenheitsnotizen, Newslettern, Werbung, Benachrichtigungen, Bestätigungen ohne Frage, reinen Dankesmails ohne offene Punkte und Spam.`;

export async function autoDraftFor(mailId: string, manual = false): Promise<{ ok: boolean; why: string; draftId?: string }> {
  const db = supabaseAdmin();
  const { data: m } = await db.from('lr_mail_messages').select('id, thread_id, direction, folder, status, from_email, from_name, subject, text_body, message_id, refs, auth, created_at, received_at, sent_at').eq('id', mailId).maybeSingle<Row>();
  if (!m || m.direction !== 'in' || (!manual && m.folder !== 'inbox')) return { ok: false, why: 'keine Eingangs-Mail im Posteingang' };
  const from = String(m.from_email || '').toLowerCase();
  if (!from || from.endsWith('@' + (mailboxAddress().split('@')[1] || 'leaserun.com'))) return { ok: false, why: 'eigene Adresse' };
  if (!manual && (NO_REPLY.test(from) || m.auth?.unsub || AUTO_SUBJ.test(m.subject || '') || AUTO_BODY.test(m.text_body || ''))) return { ok: false, why: 'automatische Mail / Newsletter' };
  const { data: thread } = await db.from('lr_mail_messages').select('id, direction, status, from_email, from_name, subject, text_body, created_at, received_at, sent_at').eq('thread_id', m.thread_id).neq('folder', 'trash').order('created_at', { ascending: true }).limit(20);
  const rows = (thread ?? []) as Row[];
  // Schon ein Entwurf im Verlauf, der nach dieser Mail angelegt wurde? Dann nichts doppelt anlegen.
  const mAt = Date.parse(m.received_at || m.created_at);
  if (rows.some((x) => x.direction === 'out' && x.status === 'entwurf' && Date.parse(x.created_at) >= mAt - 1000)) return { ok: false, why: 'Entwurf existiert schon' };

  const g = await gate(manual ? 'user' : 'auto');
  if (!g.ok) return { ok: false, why: g.reason };

  // Verlauf als reiner Text, ältere Zitate abgeschnitten, damit das Modell nur das Wesentliche liest.
  const cut = (t: string) => String(t || '').split(/\n(?:Am .{5,80} schrieb|On .{5,80} wrote|Von: |From: |-----Original|_{5,})/)[0].replace(/\n{3,}/g, '\n\n').trim().slice(0, 9000);
  const hist = rows.filter((x) => x.direction === 'in' || x.status === 'gesendet').slice(-6).map((x) => `### ${x.direction === 'in' ? `Eingang von ${x.from_name ? `${x.from_name} <${x.from_email}>` : x.from_email}` : 'Von uns gesendet'} · ${x.subject || ''}\n${cut(x.text_body || '')}`).join('\n\n');
  const r = await converse({ agent: 'postfach', model: g.settings.rest, system: SYSTEM, messages: [{ role: 'user', content: `Verlauf (älteste zuerst, die letzte Eingangs-Mail ist zu beantworten):\n\n${hist}` }], tools: [], grund: 'antwort-entwurf', maxTurns: 2, maxTokens: 8000, timeoutMs: 120_000 });
  let j: { antworten?: boolean; grund?: string; absaetze?: unknown } = {};
  try { j = JSON.parse((/\{[\s\S]*\}/.exec(r.text) || ['{}'])[0]); } catch { return { ok: false, why: 'Antwort nicht lesbar' }; }
  if (!j.antworten && !manual) return { ok: false, why: `keine Antwort nötig: ${String(j.grund || '').slice(0, 120)}` };
  const paras = (Array.isArray(j.absaetze) ? j.absaetze : []).map((p) => String(p || '').trim()).filter(Boolean).slice(0, 60);
  if (!paras.length) return { ok: false, why: 'leerer Entwurf' };
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Nur Textabsätze – sanitizeBody setzt die LeaseRun-Schrift; Bilder oder fremdes HTML kommen so nie in den Entwurf.
  const body = sanitizeBody(paras.map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''));
  const text = htmlToText(body);
  const subj = /^(re|aw|antw):/i.test(m.subject || '') ? m.subject : `Re: ${m.subject || ''}`.trim();
  const id = crypto.randomUUID();
  const ins = await db.from('lr_mail_messages').insert({
    id, thread_id: m.thread_id, direction: 'out', folder: 'drafts', status: 'entwurf', design: 'frei', from_email: mailboxAddress(),
    to_emails: [from], cc_emails: [], bcc_emails: [], subject: subj.slice(0, 300), html: body, text_body: text, snippet: snippetOf(text),
    with_unsub: false, in_reply_to: m.message_id, refs: [m.refs, m.message_id].filter(Boolean).join(' ').slice(-7900) || null, attachments: [], source: 'claude-auto',
  });
  if (ins.error) return { ok: false, why: ins.error.message };
  const open = (text.match(/⟦/g) || []).length;
  await pushAdmins('mail', 'Antwort-Entwurf bereit', `${m.from_name || from}: ${String(m.subject || '').slice(0, 60)}${open ? ` – ${open} Stelle${open === 1 ? '' : 'n'} ergänzen` : ' – bereit zum Senden'}`, 'mail_draft').catch(() => null);
  return { ok: true, why: 'Entwurf angelegt', draftId: id };
}
