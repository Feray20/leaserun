import { z } from 'zod';
import { NextResponse } from 'next/server';
import { pushAdmins } from '@/lib/admin/push';
import { supportInbox } from '@/lib/notify/inbox';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { guardSubmission } from '@/lib/security/antispam';
import { intakeClosed } from '@/lib/security/panic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Antworten über /request (Knöpfe in persönlichen Akquise-Mails: Unterlagen, Kooperation, Creator- oder Testzugang).
// Landet als E-Mail im Postfach (Antworten-an = Absender) und als Verlaufseintrag beim Akquise-Kontakt.
// Das Token t ist dasselbe wie im Abmeldelink der Mail; daran erkennen wir, auf welche Mail geantwortet wurde.
const ART: Record<string, { label: string; opts: Record<string, string> }> = {
  unterlagen: { label: 'Unterlagen', opts: { keyfacts: 'Kurzporträt & Keyfacts', zahlen: 'Zahlen & Rechenbeispiel', muster: 'Musterunterlagen', beitrag: 'Themenvorschlag / Gliederung / Gastbeitrag', interview: 'Interview / Gesprächspartner' } },
  kooperation: { label: 'Kooperation', opts: { unterlagen: 'Unterlagen & Konditionen', testzugang: 'Testzugang', rueckruf: 'Rückruf' } },
  creator: { label: 'Creator-Zugang', opts: { zugang: 'Persönlicher Zugang (Investor Pro)', code: 'Eigener Rabattcode', provision: 'Infos zu Provision & Abrechnung' } },
  zugang: { label: 'Testzugang', opts: { zugang: 'Testzugang Investor Pro', demo: 'Demo im Teams-Gespräch', community: 'Angebot für Mitglieder / Community' } },
};
const Schema = z.object({
  art: z.enum(['unterlagen', 'kooperation', 'creator', 'zugang']),
  opts: z.array(z.string().max(20)).min(1).max(6),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  org: z.string().trim().max(160).optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
  t: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional().or(z.literal('')).default(''),
  privacy: z.literal(true),
  website: z.string().optional().default(''),
  ts: z.coerce.number().optional(),
});
const json = (b: unknown, status = 200) => NextResponse.json(b, { status, headers: { 'cache-control': 'no-store' } });

export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Vorübergehend nicht möglich. Bitte antworten Sie einfach auf unsere E-Mail.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`anfrage:${ip}`, 4, 10 * 60_000)) return json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);
  const p = Schema.safeParse(await req.json().catch(() => null));
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    const msg = f === 'privacy' ? 'Bitte die Datenschutzhinweise bestätigen.' : f === 'email' ? 'Bitte eine gültige E-Mail-Adresse angeben.' : f === 'opts' ? 'Bitte mindestens eine Sache ankreuzen.' : f === 'name' ? 'Bitte Ihren Namen angeben.' : 'Bitte die Angaben prüfen.';
    return json({ error: msg, field: f }, 400);
  }
  const b = p.data, art = ART[b.art];
  const wishes = b.opts.map((o) => art.opts[o]).filter(Boolean);
  if (!wishes.length) return json({ error: 'Bitte mindestens eine Sache ankreuzen.', field: 'opts' }, 400);
  const guard = await guardSubmission({ email: b.email, name: b.name, message: `${b.message} ${b.org}`.trim() || wishes.join(', '), website: b.website, ts: b.ts, bucket: 'anfrage' });
  if (guard.action === 'drop') return json({ ok: true }, 201);
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field }, 400);

  // Bezug: auf welche Mail geantwortet wurde (Betreff, ursprünglicher Empfänger) – nur mit gültigem Token.
  let ref: { email: string; label: string | null } | null = null;
  if (b.t && adminConfigured()) {
    const { data } = await supabaseAdmin().from('lr_outreach_links').select('email, label').eq('token', b.t).maybeSingle();
    if (data) ref = { email: String(data.email), label: (data.label as string) || null };
  }
  if (!mailConfigured()) return json({ error: 'Das Formular ist gerade nicht erreichbar. Bitte antworten Sie einfach auf unsere E-Mail.' }, 503);
  const flag = guard.flagged ? ' [Spam-Verdacht]' : '';
  const who = b.org || b.name;
  const text = [
    `${b.name} · ${b.email}${b.org ? ` · ${b.org}` : ''}`,
    `Wunsch: ${wishes.join(', ')}`,
    ref ? `Antwort auf: „${ref.label || 'Akquise-Mail'}“ (gesendet an ${ref.email})` : 'Ohne Bezug auf eine bestimmte Mail',
    b.message ? `\n${b.message}` : '',
  ].join('\n');
  const sent = await sendMail(supportInbox(), `Antwort über Anfrage-Seite${flag}: ${art.label} – ${who}`.slice(0, 200), text, [], { replyTo: b.email, title: `Neue Antwort: ${art.label}` });
  if (!sent) return json({ error: 'Die Anfrage konnte gerade nicht gesendet werden. Bitte antworten Sie einfach auf unsere E-Mail.' }, 502);
  await pushAdmins('mail', `Antwort: ${art.label}`, `${who} möchte: ${wishes.join(', ')}`.slice(0, 160), 'anfrage').catch(() => {});

  // Verlauf beim Akquise-Kontakt (falls vorhanden) – Fehler hier dürfen die Antwort nicht verhindern.
  if (ref && adminConfigured()) {
    try {
      const db = supabaseAdmin();
      const { data: cs } = await db.from('lr_crm_contacts').select('id').ilike('email', ref.email).limit(3);
      if (cs?.length) await db.from('lr_crm_activities').insert(cs.map((c) => ({ contact_id: c.id, type: 'notiz', note: `Antwort über Anfrage-Seite (${art.label}): ${wishes.join(', ')} – ${b.name} <${b.email}>`.slice(0, 1000), actor: 'anfrage-seite' })));
    } catch { /* Verlauf ist optional */ }
  }
  return json({ ok: true }, 201);
}
