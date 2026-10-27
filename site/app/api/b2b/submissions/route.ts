import { z } from 'zod';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { effectiveTier, INSTITUTION_LABEL, type B2BAccount } from '@/lib/b2b/core';
import { json, requireMember } from '@/lib/b2b/http';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS = ['eingegangen', 'in_pruefung', 'rueckfrage', 'abgeschlossen', 'abgelehnt'] as const;
const LABEL: Record<string, string> = { eingegangen: 'Received', in_pruefung: 'In review', rueckfrage: 'Question sent', abgeschlossen: 'Completed', abgelehnt: 'Declined' };

// Pre-review submissions inbox: brokers submit registered lender packages to lenders that accept submissions.
// GET ?view=targets  → lenders that accept submissions
// GET ?view=versions → own registered lender packages (to submit)
// GET ?id=…&file=1   → download the submitted lender package (recipient and sender only)
// GET                → inbox (as lender) and outbox (as sender)
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
    if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Invalid request.' }, 400);
    const { data: s } = await db.from('lr_b2b_submissions').select('*').eq('id', id).maybeSingle();
    if (!s || (s.to_account_id !== ctx.account.id && s.from_account_id !== ctx.account.id)) return json({ error: 'Nicht gefunden.' }, 404);
    if (!s.version_id) return json({ error: 'The sender has deleted this lender package.' }, 410);
    const { data: v } = await db.from('lr_kreditmappe_versions').select('storage_path, sha256').eq('id', s.version_id).maybeSingle();
    if (!v?.storage_path) return json({ error: 'File not available.' }, 404);
    const signed = await db.storage.from('bank-ready-pdf').createSignedUrl(v.storage_path, 60, { download: `Kreditmappe_${String(s.object_label || 'Einreichung').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 40)}.pdf` });
    if (signed.error || !signed.data) return json({ error: 'File not available.' }, 502);
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

// Submit. The sender confirms that the client has consented to sharing with the lender.
export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-sub', limit: 20 });
  if (ctx instanceof Response) return ctx;
  if (!effectiveTier(ctx.account)) return json({ error: 'Einreichungen gibt es ab einem gebuchten Tarif.' }, 402);
  const p = Submit.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.path[0] === 'consent' ? 'Please confirm that you have the client\'s consent.' : 'Please choose a lender package and a lender.' }, 400);
  const db = supabaseAdmin();
  const { data: v } = await db.from('lr_kreditmappe_versions').select('id, object_ref, version_no').eq('id', p.data.versionId).eq('owner_id', ctx.user.id).maybeSingle();
  if (!v) return json({ error: 'Lender package not found.' }, 404);
  const { data: t } = await db.from('lr_b2b_accounts').select('*').eq('id', p.data.targetId).maybeSingle();
  const target = t as B2BAccount | null;
  if (!target || !target.accept_submissions || target.status !== 'active' || !effectiveTier(target) || target.id === ctx.account.id) return json({ error: 'Dieses Institut nimmt keine Einreichungen an.' }, 404);
  const { count } = await db.from('lr_b2b_submissions').select('id', { count: 'exact', head: true }).eq('version_id', v.id).eq('to_account_id', target.id);
  if ((count ?? 0) > 0) return json({ error: 'This version has already been submitted to this lender.' }, 409);
  const label = p.data.label || `${v.object_ref} · Version ${v.version_no}`;
  const ins = await db.from('lr_b2b_submissions').insert({
    from_account_id: ctx.account.id, from_user_id: ctx.user.id, to_account_id: target.id, version_id: v.id,
    object_label: label, note: p.data.note || null, consent_confirmed_at: new Date().toISOString(),
  }).select('id').single();
  if (ins.error) return json({ error: 'Submission failed.' }, 500);
  if (mailConfigured()) {
    await sendMail(target.email, `New submission from ${ctx.account.company_name}`,
      `Hello,\n\n${ctx.account.company_name} has submitted a lender package for pre-review: ${label}.\n${p.data.note ? `Note: ${p.data.note}\n` : ''}\nView in your inbox: https://leaserun.com/business-portal#einreichungen\n\nThe lender package is a calculated summary; the credit decision is made by your institution.`, [], { area: 'b2b' });
  }
  return json({ ok: true, id: ins.data.id }, 201);
}

const Update = z.object({ id: z.string().uuid(), status: z.enum(STATUS), reply: z.string().trim().max(1000).optional() });

// Set status and reply (receiving lender only); the sender is notified.
export async function PATCH(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-sub', limit: 60 });
  if (ctx instanceof Response) return ctx;
  const p = Update.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: 'Invalid request.' }, 400);
  const db = supabaseAdmin();
  const { data: s } = await db.from('lr_b2b_submissions').select('*').eq('id', p.data.id).eq('to_account_id', ctx.account.id).maybeSingle();
  if (!s) return json({ error: 'Nicht gefunden.' }, 404);
  const r = await db.from('lr_b2b_submissions').update({ status: p.data.status, reply: p.data.reply ?? s.reply, updated_at: new Date().toISOString() }).eq('id', s.id);
  if (r.error) return json({ error: 'Saving failed.' }, 500);
  if (mailConfigured() && s.status !== p.data.status) {
    const { data: from } = await db.from('lr_b2b_accounts').select('email').eq('id', s.from_account_id).maybeSingle();
    if (from?.email) await sendMail(from.email, `Submission "${s.object_label}": ${LABEL[p.data.status]}`,
      `Hello,\n\n${ctx.account.company_name} has set the status of your submission "${s.object_label}" to "${LABEL[p.data.status]}".${p.data.reply ? `\n\nMessage: ${p.data.reply}` : ''}\n\nhttps://leaserun.com/business-portal#einreichungen`, [], { area: 'b2b' });
  }
  return json({ ok: true });
}
