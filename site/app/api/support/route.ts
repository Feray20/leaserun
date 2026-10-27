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

// Report technical problems – consumer account (b2c) and Business Portal (b2b), with up to 3 screenshots.
// The area is checked server-side. New reports: push to the admin app and a confirmation email to the customer.
// Goal: a response within 12 hours.
const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
const ID = /^[0-9a-f-]{36}$/;

async function ctx(req: Request) {
  if (!adminConfigured()) return { err: j({ error: 'Not configured.' }, 503) };
  const user = await userFromRequest(req);
  if (!user) return { err: j({ error: 'Please sign in first.' }, 401) };
  return { user };
}

// Own reports with status and answer (without the internal note).
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
  if (!allowRequest(`support:${user.id}`, 6, 60 * 60_000)) return j({ error: "You've sent several reports in a short time. Please wait a bit – we're already on it." }, 429);
  let form: FormData;
  try { form = await req.formData(); } catch { return j({ error: 'The report is too large. Please attach fewer or smaller screenshots.' }, 413); }
  let device: unknown = {};
  try { device = JSON.parse(String(form.get('device') || '{}')); } catch { device = {}; }
  const p = SupportIn.safeParse({
    area: form.get('area'), category: form.get('category'), severity: form.get('severity'), title: form.get('title'), text: form.get('text'),
    expected: form.get('expected') || undefined, page: form.get('page') || undefined, device,
  });
  if (!p.success) return j({ error: p.error.issues[0]?.message || 'Invalid input.' }, 400);
  const d = p.data;
  let accountId: string | null = null;
  if (d.area === 'b2b') {
    const m = await membershipFor(user.id);
    if (!m) return j({ error: 'No business account.' }, 403);
    accountId = m.account.id;
  }
  // Check screenshots: count, size, real image type (header bytes).
  const files = form.getAll('shots').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f).slice(0, SUP_MAX_SHOTS + 1);
  if (files.length > SUP_MAX_SHOTS) return j({ error: `Please attach at most ${SUP_MAX_SHOTS} screenshots.` }, 400);
  const imgs: { bytes: Uint8Array; type: string }[] = [];
  for (const f of files) {
    if (f.size > SUP_MAX_SHOT_BYTES * 2) return j({ error: 'A screenshot is too large (max. 2.8 MB).' }, 413);
    const bytes = new Uint8Array(await f.arrayBuffer());
    const type = imageType(bytes);
    if (!type) return j({ error: 'Please attach images only (JPG, PNG or WebP).' }, 400);
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
  if (error || !t) { console.error('support_insert', error?.message); return j({ error: "Your report couldn't be saved. Please email support@leaserun.com." }, 500); }
  const paths: string[] = [];
  await Promise.all(imgs.map(async (im, i) => {
    const path = `${d.area}/${t.id}/${i + 1}.${im.type === 'image/png' ? 'png' : im.type === 'image/webp' ? 'webp' : 'jpg'}`;
    const up = await db.storage.from('support-shots').upload(path, im.bytes, { contentType: im.type, upsert: true });
    if (up.error) console.warn('support_shot', up.error.message); else paths.push(path);
  }));
  if (paths.length) await db.from('lr_support_tickets').update({ shots: paths.sort() }).eq('id', t.id);
  const ref = ticketNo(t.no);
  const due = new Date(t.due_at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  // Notifications must never make the report fail.
  await Promise.allSettled([
    pushAdmins('support', d.severity === 'blockiert' ? 'Urgent: technical problem' : 'Technical problem reported', `${ref} · ${d.area === 'b2b' ? 'Business' : 'Consumer'} · ${SUP_CATEGORIES[d.category]} · respond by ${due}`, 'support_ticket'),
    (async () => {
      if (!mailConfigured()) return;
      // No second copy into the mailbox: reports only appear under "Technical problems" (B2C and B2B separate) and as a push.
      await sendMail(user.email, `We received your report ${ref}`, `Hi there,\n\nthank you – we received your report "${d.title}" (ticket number ${ref}).\n\nWe're looking into it and will get back to you by ${due} at the latest. You can check the status any time ${d.area === 'b2b' ? 'in the Business Portal under "Technical support"' : 'in your account under "Technical support"'}.\n\nBest regards,\nThe LeaseRun team`, [], {
        area: d.area, title: 'Report received', button: { label: 'Check status', url: d.area === 'b2b' ? 'https://leaserun.com/business-portal#support' : 'https://leaserun.com/app/dashboard#support' },
      });
    })(),
  ]);
  return j({ ok: true, id: t.id, ref, dueAt: t.due_at, shots: paths.length });
}

// Follow-up on an own report (e.g. answering a question). Sets the ticket back to "Received".
export async function PATCH(req: Request) {
  const c = await ctx(req); if (c.err) return c.err;
  const user = c.user!;
  if (!allowRequest(`support-add:${user.id}`, 10, 60 * 60_000)) return j({ error: 'Please wait a moment.' }, 429);
  const b = (await req.json().catch(() => null)) as { id?: unknown; text?: unknown } | null;
  const id = typeof b?.id === 'string' && ID.test(b.id) ? b.id : null;
  const text = typeof b?.text === 'string' ? b.text.trim() : '';
  if (!id || text.length < 3 || text.length > 2000) return j({ error: 'Please enter a message.' }, 400);
  const db = supabaseAdmin();
  const { data: t } = await db.from('lr_support_tickets').select('id, no, text, status, area').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (!t) return j({ error: 'Report not found.' }, 404);
  const stamp = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' });
  const merged = `${t.text}\n\n— Follow-up ${stamp}:\n${text}`.slice(0, 4000);
  const { error } = await db.from('lr_support_tickets').update({ text: merged, status: 'neu', updated_at: new Date().toISOString(), due_at: new Date(Date.now() + SUP_SLA_HOURS * 3600_000).toISOString() }).eq('id', id);
  if (error) return j({ error: 'Could not be saved.' }, 500);
  await pushAdmins('support', 'Reply on a report', `${ticketNo(t.no)} · customer added details`, 'support_ticket').catch(() => {});
  return j({ ok: true });
}
