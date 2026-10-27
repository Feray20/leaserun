import { z } from 'zod';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { effectiveTier, INSTITUTION_LABEL, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS = ['eingegangen', 'in_pruefung', 'rueckfrage', 'abgeschlossen', 'abgelehnt'] as const;
const LABEL: Record<string, string> = { eingegangen: 'Eingegangen', in_pruefung: 'In Prüfung', rueckfrage: 'Rückfrage', abgeschlossen: 'Abgeschlossen', abgelehnt: 'Abgelehnt' };

// Vorprüfungs-Postkorb: Vermittler reichen registrierte Kreditmappen bei Instituten ein, die Einreichungen annehmen.
// GET ?view=targets  → Institute, die Einreichungen annehmen
// GET ?view=versions → eigene registrierte Kreditmappen (zum Einreichen)
// GET ?id=…&file=1   → Kreditmappe der Einreichung herunterladen (nur Empfänger und Absender)
// GET                → Eingang (als Institut) und Ausgang (als Absender)
export async function GET(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-sub' });
  if (ctx instanceof Response) return ctx;
  const u = new URL(req.url);
  const db = supabaseAdmin();
  const view = u.searchParams.get('view');
  if (view === 'targets') {
    const { data } = await db.from('lr_b2b_accounts').select('*').eq('accept_submissions', true).eq('status', 'active').neq('id', ctx.account.id).limit(500);
    const list = ((data ?? []) as B2BAccount[]).filter((a) => effectiveTier(a)).map((a) => ({ id: a.id, name: a.company_name, kind: INSTITUTION_LABEL[a.institution_type], city: `${a.postal_code} ${a.city}`, verified: Boolean(a.verified_at) }));
    return json({ targets: list });
  }
  if (view === 'versions') {
    const { data } = await db.from('lr_kreditmappe_versions').select('id, object_ref, version_no, created_at, sha256').eq('owner_id', ctx.user.id).order('created_at', { ascending: false }).limit(50);
    return json({ versions: data ?? [] });
  }
  const id = u.searchParams.get('id');
  if (id) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültig.' }, 400);
    const { data: s } = await db.from('lr_b2b_submissions').select('*').eq('id', id).maybeSingle();
    if (!s || (s.to_account_id !== ctx.account.id && s.from_account_id !== ctx.account.id)) return json({ error: 'Nicht gefunden.' }, 404);
    if (!s.version_id) return json({ error: 'Die Kreditmappe wurde vom Absender gelöscht.' }, 410);
    const { data: v } = await db.from('lr_kreditmappe_versions').select('storage_path, sha256').eq('id', s.version_id).maybeSingle();
    if (!v?.storage_path) return json({ error: 'Datei nicht verfügbar.' }, 404);
    const signed = await db.storage.from('bank-ready-pdf').createSignedUrl(v.storage_path, 60, { download: `Kreditmappe_${String(s.object_label || 'Einreichung').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}.pdf` });
    if (signed.error || !signed.data) return json({ error: 'Datei nicht verfügbar.' }, 502);
    if (s.to_account_id === ctx.account.id && s.status === 'eingegangen') await db.from('lr_b2b_submissions').update({ status: 'in_pruefung', updated_at: new Date().toISOString() }).eq('id', id);
    return NextResponse.redirect(signed.data.signedUrl, 302);
  }
  const cols = 'id, from_account_id, to_account_id, version_id, object_label, note, status, reply, created_at, updated_at';
  const [{ data: inbox }, { data: outbox }] = await Promise.all([
    db.from('lr_b2b_submissions').select(cols).eq('to_account_id', ctx.account.id).order('created_at', { ascending: false }).limit(300),
    db.from('lr_b2b_submissions').select(cols).eq('from_account_id', ctx.account.id).order('created_at', { ascending: false }).limit(300),
  ]);
  const ids = [...new Set([...(inbox ?? []).map((x) => x.from_account_id), ...(outbox ?? []).map((x) => x.to_account_id)])];
  const { data: names } = ids.length ? await db.from('lr_b2b_accounts').select('id, company_name, city').in('id', ids) : { data: [] };
  const nm = new Map((names ?? []).map((n) => [n.id, `${n.company_name} (${n.city})`]));
  const shaOf = async (vid: string | null) => (vid ? (await db.from('lr_kreditmappe_versions').select('sha256').eq('id', vid).maybeSingle()).data?.sha256 ?? null : null);
  const inboxOut = await Promise.all((inbox ?? []).map(async (x) => ({ ...x, from: nm.get(x.from_account_id) ?? '–', sha256: await shaOf(x.version_id) })));
  return json({
    acceptsSubmissions: Boolean(ctx.account.accept_submissions),
    inbox: inboxOut,
    outbox: (outbox ?? []).map((x) => ({ ...x, to: nm.get(x.to_account_id) ?? '–' })),
  });
}

const Submit = z.object({
  versionId: z.string().uuid(),
  targetId: z.string().uuid(),
  label: z.string().trim().max(160).optional().default(''),
  note: z.string().trim().max(1000).optional().default(''),
  consent: z.literal(true),
});

// Einreichen. Der Absender bestätigt, dass die Einwilligung des Kunden zur Weitergabe an das Institut vorliegt.
export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-sub', limit: 20 });
  if (ctx instanceof Response) return ctx;
  if (!effectiveTier(ctx.account)) return json({ error: 'Einreichungen gibt es ab einem gebuchten Tarif.' }, 402);
  const p = Submit.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.path[0] === 'consent' ? 'Bitte bestätigen, dass die Einwilligung des Kunden vorliegt.' : 'Bitte Kreditmappe und Institut wählen.' }, 400);
  const db = supabaseAdmin();
  const { data: v } = await db.from('lr_kreditmappe_versions').select('id, object_ref, version_no').eq('id', p.data.versionId).eq('owner_id', ctx.user.id).maybeSingle();
  if (!v) return json({ error: 'Kreditmappe nicht gefunden.' }, 404);
  const { data: t } = await db.from('lr_b2b_accounts').select('*').eq('id', p.data.targetId).maybeSingle();
  const target = t as B2BAccount | null;
  if (!target || !target.accept_submissions || target.status !== 'active' || !effectiveTier(target) || target.id === ctx.account.id) return json({ error: 'Dieses Institut nimmt keine Einreichungen an.' }, 404);
  const { count } = await db.from('lr_b2b_submissions').select('id', { count: 'exact', head: true }).eq('version_id', v.id).eq('to_account_id', target.id);
  if ((count ?? 0) > 0) return json({ error: 'Diese Version wurde bei diesem Institut bereits eingereicht.' }, 409);
  const label = p.data.label || `${v.object_ref} · Version ${v.version_no}`;
  const ins = await db.from('lr_b2b_submissions').insert({
    from_account_id: ctx.account.id, from_user_id: ctx.user.id, to_account_id: target.id, version_id: v.id,
    object_label: label, note: p.data.note || null, consent_confirmed_at: new Date().toISOString(),
  }).select('id').single();
  if (ins.error) return json({ error: 'Einreichung fehlgeschlagen.' }, 500);
  if (mailConfigured()) {
    await sendMail(target.email, `Neue Einreichung von ${ctx.account.company_name}`,
      `Guten Tag,\n\n${ctx.account.company_name} hat eine Kreditmappe zur Vorprüfung eingereicht: ${label}.\n${p.data.note ? `Hinweis: ${p.data.note}\n` : ''}\nIm Postkorb ansehen: https://leaserun.com/business-portal#einreichungen\n\nDie Kreditmappe ist eine rechnerische Aufbereitung; die Kreditentscheidung trifft Ihr Institut.`, [], { area: 'b2b' });
  }
  return json({ ok: true, id: ins.data.id }, 201);
}

const Update = z.object({ id: z.string().uuid(), status: z.enum(STATUS), reply: z.string().trim().max(1000).optional() });

// Status und Antwort setzen (nur das empfangende Institut); Absender wird benachrichtigt.
export async function PATCH(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-sub', limit: 60 });
  if (ctx instanceof Response) return ctx;
  const p = Update.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const { data: s } = await db.from('lr_b2b_submissions').select('*').eq('id', p.data.id).eq('to_account_id', ctx.account.id).maybeSingle();
  if (!s) return json({ error: 'Nicht gefunden.' }, 404);
  const r = await db.from('lr_b2b_submissions').update({ status: p.data.status, reply: p.data.reply ?? s.reply, updated_at: new Date().toISOString() }).eq('id', s.id);
  if (r.error) return json({ error: 'Speichern fehlgeschlagen.' }, 500);
  if (mailConfigured() && s.status !== p.data.status) {
    const { data: from } = await db.from('lr_b2b_accounts').select('email').eq('id', s.from_account_id).maybeSingle();
    if (from?.email) await sendMail(from.email, `Einreichung „${s.object_label}“: ${LABEL[p.data.status]}`,
      `Guten Tag,\n\n${ctx.account.company_name} hat den Status Ihrer Einreichung „${s.object_label}“ auf „${LABEL[p.data.status]}“ gesetzt.${p.data.reply ? `\n\nNachricht: ${p.data.reply}` : ''}\n\nhttps://leaserun.com/business-portal#einreichungen`, [], { area: 'b2b' });
  }
  return json({ ok: true });
}
