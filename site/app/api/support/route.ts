import { NextResponse } from 'next/server';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { membershipFor } from '@/lib/b2b/core';
import { imageType, SUP_CATEGORIES, SUP_MAX_SHOT_BYTES, SUP_MAX_SHOTS, SUP_SLA_HOURS, SupportIn, ticketNo } from '@/lib/support';
import { pushAdmins } from '@/lib/admin/push';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { staticScan, threatMessage } from '@/lib/security/filescan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Technische Probleme melden – Privatkonto (b2c) und Unternehmensportal (b2b), mit bis zu 3 Screenshots.
// Der Bereich wird serverseitig geprüft. Neue Meldungen: Push an die Admin-App, Kurzmail an die Betreiberin,
// Eingangsbestätigung an den Kunden. Ziel: Rückmeldung innerhalb von 12 Stunden.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
const ID = /^[0-9a-f-]{36}$/;

async function ctx(req: Request) {
  if (!adminConfigured()) return { err: j({ error: 'Nicht konfiguriert.' }, 503) };
  const user = await userFromRequest(req);
  if (!user) return { err: j({ error: 'Bitte zuerst anmelden.' }, 401) };
  return { user };
}

// Eigene Meldungen mit Status und Antwort (ohne interne Notiz).
export async function GET(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const area = new URL(req.url).searchParams.get('area') === 'b2b' ? 'b2b' : 'b2c';
  const { data } = await supabaseAdmin().from('lr_support_tickets')
    .select('id, no, created_at, due_at, category, severity, title, text, status, answer, answered_at, shots')
    .eq('user_id', c.user!.id).eq('area', area).order('created_at', { ascending: false }).limit(30);
  return j({ items: (data ?? []).map(({ shots, ...t }) => ({ ...t, ref: ticketNo(t.no), shots: (shots as string[] | null)?.length ?? 0 })), slaHours: SUP_SLA_HOURS });
}

export async function POST(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const user = c.user!;
  if (!allowRequest(`support:${user.id}`, 6, 60 * 60_000)) return j({ error: 'Sie haben in kurzer Zeit mehrere Meldungen gesendet. Bitte etwas warten – wir kümmern uns bereits darum.' }, 429);
  let form: FormData;
  try { form = await req.formData(); } catch { return j({ error: 'Die Meldung ist zu groß. Bitte weniger oder kleinere Screenshots anhängen.' }, 413); }
  let device: unknown = {};
  try { device = JSON.parse(String(form.get('device') || '{}')); } catch { device = {}; }
  const p = SupportIn.safeParse({
    area: form.get('area'), category: form.get('category'), severity: form.get('severity'), title: form.get('title'), text: form.get('text'),
    expected: form.get('expected') || undefined, page: form.get('page') || undefined, device,
  });
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Ungültige Eingabe.' }, 400);
  const d = p.data;
  let accountId: string | null = null;
  if (d.area === 'b2b') {
    const m = await membershipFor(user.id);
    if (!m) return j({ error: 'Kein Unternehmenskonto.' }, 403);
    accountId = m.account.id;
  }
  // Screenshots prüfen: Anzahl, Größe, echter Bildtyp (Kopfbytes).
  const files = form.getAll('shots').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f).slice(0, SUP_MAX_SHOTS + 1);
  if (files.length > SUP_MAX_SHOTS) return j({ error: `Bitte höchstens ${SUP_MAX_SHOTS} Screenshots anhängen.` }, 400);
  const imgs: { bytes: Uint8Array; type: string }[] = [];
  for (const f of files) {
    if (f.size > SUP_MAX_SHOT_BYTES * 2) return j({ error: 'Ein Screenshot ist zu groß (max. 2,8 MB).' }, 413);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = imageType(bytes);
    if (!type) return j({ error: 'Bitte nur Bilder (JPG, PNG oder WebP) anhängen.' }, 400);
    const scan = staticScan(Buffer.from(bytes));
    if (!scan.clean) return j({ error: threatMessage(scan) }, 422);
    imgs.push({ bytes, type });
  }
  const db = supabaseAdmin();
  const { data: t, error } = await db.from('lr_support_tickets').insert({
    area: d.area, user_id: user.id, user_email: user.email, account_id: accountId, category: d.category, severity: d.severity,
    title: d.title, text: d.text, expected: d.expected || null, page: d.page || null, device: d.device,
    due_at: new Date(Date.now() + SUP_SLA_HOURS * 3600_000).toISOString(),
  }).select('id, no, due_at').single();
  if (error || !t) { console.error('support_insert', error?.message); return j({ error: 'Die Meldung konnte nicht gespeichert werden. Bitte schreiben Sie an support@leaserun.com.' }, 500); }
  const paths: string[] = [];
  await Promise.all(imgs.map(async (im, i) => {
    const path = `${d.area}/${t.id}/${i + 1}.${im.type === 'image/png' ? 'png' : im.type === 'image/webp' ? 'webp' : 'jpg'}`;
    const up = await db.storage.from('support-shots').upload(path, im.bytes, { contentType: im.type, upsert: true });
    if (up.error) console.warn('support_shot', up.error.message); else paths.push(path);
  }));
  if (paths.length) await db.from('lr_support_tickets').update({ shots: paths.sort() }).eq('id', t.id);
  const ref = ticketNo(t.no);
  const due = new Date(t.due_at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  // Benachrichtigungen dürfen die Meldung nie scheitern lassen.
  await Promise.allSettled([
    pushAdmins('support', d.severity === 'blockiert' ? 'Dringend: technisches Problem' : 'Technisches Problem gemeldet', `${ref} · ${d.area === 'b2b' ? 'Unternehmen' : 'Privatkunde'} · ${SUP_CATEGORIES[d.category]} · Antwort bis ${due}`, 'support_ticket'),
    (async () => {
      if (!mailConfigured()) return;
      // Keine zweite Kopie ins Postfach: Meldungen erscheinen nur unter „Technische Probleme“ (B2C bzw. B2B getrennt) und als Push.
      await sendMail(user.email, `Ihre Meldung ${ref} ist eingegangen`, `Guten Tag,\n\nvielen Dank – Ihre Meldung „${d.title}“ ist bei uns eingegangen (Vorgangsnummer ${ref}).\n\nWir prüfen das Problem und melden uns spätestens bis ${due} Uhr. Den Stand sehen Sie jederzeit ${d.area === 'b2b' ? 'im Unternehmensportal unter „Technischer Support“' : 'in Ihrem Konto unter „Technischer Support“'}.\n\nMit freundlichen Grüßen\nIhr LeaseRun-Team`, [], {
        area: d.area, title: 'Meldung eingegangen', button: { label: 'Stand ansehen', url: d.area === 'b2b' ? 'https://leaserun.com/business-portal#support' : 'https://leaserun.com/app/dashboard#support' },
      });
    })(),
  ]);
  return j({ ok: true, id: t.id, ref, dueAt: t.due_at, shots: paths.length });
}

// Ergänzung zu einer eigenen Meldung (z. B. auf eine Rückfrage). Setzt den Vorgang wieder auf „Eingegangen“.
export async function PATCH(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const user = c.user!;
  if (!allowRequest(`support-add:${user.id}`, 10, 60 * 60_000)) return j({ error: 'Bitte etwas warten.' }, 429);
  const b = (await req.json().catch(() => null)) as { id?: unknown; text?: unknown } | null;
  const id = typeof b?.id === 'string' && ID.test(b.id) ? b.id : null;
  const text = typeof b?.text === 'string' ? b.text.trim() : '';
  if (!id || text.length < 3 || text.length > 2000) return j({ error: 'Bitte eine Nachricht eingeben.' }, 400);
  const db = supabaseAdmin();
  const { data: t } = await db.from('lr_support_tickets').select('id, no, text, status, area').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!t) return j({ error: 'Meldung nicht gefunden.' }, 404);
  const stamp = new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const merged = `${t.text}\n\n— Ergänzung ${stamp}:\n${text}`.slice(0, 4000);
  const { error } = await db.from('lr_support_tickets').update({ text: merged, status: 'neu', updated_at: new Date().toISOString(), due_at: new Date(Date.now() + SUP_SLA_HOURS * 3600_000).toISOString() }).eq('id', id);
  if (error) return j({ error: 'Konnte nicht gespeichert werden.' }, 500);
  await pushAdmins('support', 'Antwort zu einer Meldung', `${ticketNo(t.no)} · Kunde hat ergänzt`, 'support_ticket').catch(() => {});
  return j({ ok: true });
}
