import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';
import { isSuppressed, suppress } from '@/lib/marketing/suppression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Web-Admin → Akquise: Geschäftskontakte (selbst erfasst oder importiert, mit Quelle), Status, Wiedervorlage und Verlauf.
// Werbliche E-Mails gehen nur an Empfänger mit Double-Opt-in (Werbung → Neuigkeiten); hier werden Briefe, Anrufe und Notizen protokolliert.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const KIND = z.enum(['bank', 'vermittler', 'makler', 'finanzberater', 'sonstige']);
const STATUS = z.enum(['neu', 'angeschrieben', 'angerufen', 'interesse', 'termin', 'kunde', 'kein_interesse', 'widerspruch']);
const opt = (n: number) => z.string().trim().max(n).optional().transform((v) => v || null);
const Contact = z.object({
  kind: KIND, company: z.string().trim().min(2).max(160), branch: opt(120), contactName: opt(120), salutation: z.enum(['Frau', 'Herr', '']).optional(), role: opt(120),
  street: opt(160), postalCode: z.string().trim().regex(/^([0-9]{5})?$/).optional().transform((v) => v || null), city: opt(80), phone: opt(40), email: opt(200), website: opt(300),
  source: z.string().trim().min(3, 'Bitte die Quelle angeben (z. B. „Impressum der Website“).').max(300), notes: opt(2000), nextAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
const toRow = (c: z.infer<typeof Contact>) => ({ kind: c.kind, company: c.company, branch: c.branch, contact_name: c.contactName, salutation: c.salutation || null, role: c.role, street: c.street, postal_code: c.postalCode, city: c.city, phone: c.phone, email: c.email, website: c.website, source: c.source, notes: c.notes, next_at: c.nextAt || null });

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const db = supabaseAdmin();
  const q = new URL(req.url).searchParams;
  const id = q.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return j({ error: 'Ungültig.' }, 400);
    const [{ data: c }, { data: acts }] = await Promise.all([
      db.from('lr_crm_contacts').select('*').eq('id', id).maybeSingle(),
      db.from('lr_crm_activities').select('id, at, type, campaign, note, actor').eq('contact_id', id).order('at', { ascending: false }).limit(100),
    ]);
    return c ? j({ contact: c, activities: acts ?? [] }) : j({ error: 'Nicht gefunden.' }, 404);
  }
  const { data, error } = await db.from('lr_crm_contacts').select('id, created_at, updated_at, kind, company, branch, contact_name, salutation, role, postal_code, city, phone, email, status, next_at, source').order('updated_at', { ascending: false }).limit(2000);
  if (error) return j({ error: 'Nicht verfügbar.' }, 502);
  const { data: last } = await db.from('lr_crm_activities').select('contact_id, at, type').order('at', { ascending: false }).limit(4000);
  const lastBy = new Map<string, { at: string; type: string }>();
  for (const a of last ?? []) if (!lastBy.has(a.contact_id)) lastBy.set(a.contact_id, { at: a.at, type: a.type });
  return j({ contacts: (data ?? []).map((c) => ({ ...c, last: lastBy.get(c.id) || null })) });
}

const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), contact: Contact }),
  z.object({ action: z.literal('update'), id: z.string().uuid(), contact: Contact }),
  z.object({ action: z.literal('import'), contacts: z.array(Contact).min(1).max(1000) }),
  z.object({ action: z.literal('status'), ids: z.array(z.string().uuid()).min(1).max(1000), status: STATUS, nextAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() }),
  z.object({ action: z.literal('log'), id: z.string().uuid(), type: z.enum(['anruf', 'email', 'linkedin', 'termin', 'notiz']), note: z.string().trim().max(1000).optional(), campaign: z.string().trim().max(60).optional(), nextAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable() }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().uuid()).min(1).max(1000) }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Act.safeParse(await req.json().catch(() => null));
  if (!p.success) { const i = p.error.issues[0]; return j({ error: i?.message && !/^(Invalid|Expected|Required)/.test(i.message) ? i.message : `Bitte „${String(i?.path.at(-1) ?? '')}“ prüfen.` }, 400); }
  const a = p.data, db = supabaseAdmin(), now = new Date().toISOString(), actor = auth.user.email;
  if (a.action === 'create') {
    if ((await isSuppressed([a.contact]))[0]) return j({ error: 'Dieser Kontakt hat der Werbung widersprochen und steht auf der Sperrliste. Er darf nicht erneut angesprochen werden.' }, 409);
    const r = await db.from('lr_crm_contacts').insert(toRow(a.contact)).select('id').single();
    if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    await adminAudit(actor, 'crm_create', r.data.id);
    return j({ ok: true, id: r.data.id });
  }
  if (a.action === 'update') {
    const r = await db.from('lr_crm_contacts').update({ ...toRow(a.contact), updated_at: now }).eq('id', a.id);
    return r.error ? j({ error: 'Speichern fehlgeschlagen.' }, 500) : j({ ok: true });
  }
  if (a.action === 'import') {
    const sup = await isSuppressed(a.contacts);
    const keep = a.contacts.filter((_, i) => !sup[i]);
    const blocked = a.contacts.length - keep.length;
    if (keep.length) {
      const r = await db.from('lr_crm_contacts').insert(keep.map(toRow));
      if (r.error) return j({ error: 'Import fehlgeschlagen: ' + r.error.message.slice(0, 120) }, 400);
    }
    await adminAudit(actor, 'crm_import', null, { n: keep.length, blocked });
    return j({ ok: true, n: keep.length, blocked });
  }
  if (a.action === 'status') {
    const up: Record<string, unknown> = { status: a.status, updated_at: now };
    if (a.nextAt !== undefined) up.next_at = a.nextAt;
    // Absage: 1 Jahr gesperrt, danach frühestens ein neuer Versuch (Wunsch Feray).
    if (a.status === 'kein_interesse' && !a.nextAt) up.next_at = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
    if (a.status === 'widerspruch') {
      up.objection_at = now; up.next_at = null;
      const { data: cs } = await db.from('lr_crm_contacts').select('email, company, postal_code').in('id', a.ids);
      for (const c of cs ?? []) await suppress(c);
    }
    const r = await db.from('lr_crm_contacts').update(up).in('id', a.ids);
    if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    await db.from('lr_crm_activities').insert(a.ids.map((id) => ({ contact_id: id, type: 'status', note: `Status: ${a.status}`, actor })));
    return j({ ok: true });
  }
  if (a.action === 'log') {
    const r = await db.from('lr_crm_activities').insert({ contact_id: a.id, type: a.type, note: a.note || null, campaign: a.campaign || null, actor });
    if (r.error) return j({ error: 'Speichern fehlgeschlagen.' }, 500);
    const up: Record<string, unknown> = { updated_at: now };
    if (a.type === 'anruf') up.status = 'angerufen';
    if (a.type === 'termin') up.status = 'termin';
    if (a.nextAt !== undefined) up.next_at = a.nextAt;
    await db.from('lr_crm_contacts').update(up).eq('id', a.id).not('status', 'in', '(kunde,widerspruch,interesse,termin)');
    if (a.type === 'termin' || a.nextAt !== undefined) await db.from('lr_crm_contacts').update({ ...(a.type === 'termin' ? { status: 'termin' } : {}), ...(a.nextAt !== undefined ? { next_at: a.nextAt } : {}), updated_at: now }).eq('id', a.id);
    return j({ ok: true });
  }
  // Löschen (z. B. auf Verlangen des Betroffenen, Art. 17 DSGVO).
  const r = await db.from('lr_crm_contacts').delete().in('id', a.ids);
  if (r.error) return j({ error: 'Löschen fehlgeschlagen.' }, 500);
  await adminAudit(actor, 'crm_delete', null, { n: a.ids.length });
  return j({ ok: true });
}
