import { logSecurity } from '@/lib/security/seclog';
import { scanUpload, threatMessage } from '@/lib/security/filescan';
import { supportInbox } from '@/lib/notify/inbox';
import { createHash, randomUUID } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { json, requireMember } from '@/lib/b2b/http';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Business account verification: upload business / license documents and submit for review.
// Review and approval are done by LeaseRun in the admin area (/api/admin/b2b, action approve/reject).
const BUCKET = 'b2b-verify';
const MAX = 10 * 1024 * 1024;
const KINDS = ['gewerbe', 'handelsregister', 'erlaubnis', 'sonstiges'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = {
  gewerbe: 'State business registration / certificate of formation',
  handelsregister: 'Certificate of good standing',
  erlaubnis: 'Professional license (NMLS / state license)',
  sonstiges: 'Other document (e.g. IRS EIN letter)',
};

function sniff(b: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (b.length > 4 && b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

async function docsOf(accountId: string) {
  const { data } = await supabaseAdmin().from('lr_b2b_verification_docs').select('id, kind, file_name, byte_size, created_at').eq('account_id', accountId).order('created_at');
  return data ?? [];
}

// Status and uploaded documents of the own business account.
export async function GET(req: Request) {
  const ctx = await requireMember(req, { allowLocked: true, bucket: 'b2b-verify' });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  return json({
    status: a.verification_status ?? (a.verified_at ? 'geprueft' : 'offen'),
    verified: Boolean(a.verified_at),
    note: a.verification_status === 'abgelehnt' ? a.verification_note ?? null : null,
    submittedAt: a.verification_submitted_at ?? null,
    docs: (await docsOf(a.id)).map((d) => ({ ...d, label: KIND_LABEL[d.kind as Kind] ?? d.kind })),
    isOwner: ctx.role === 'owner',
  });
}

// Upload a document: raw bytes in the body, kind and file name as query (?kind=gewerbe&name=…). PDF, JPG or PNG, max. 10 MB.
export async function POST(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-verify-up', limit: 12 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (a.verified_at) return json({ error: 'Your account is already verified.' }, 409);
  if (a.verification_status === 'eingereicht') return json({ error: 'Your documents have already been submitted for review.' }, 409);
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind') as Kind;
  if (!KINDS.includes(kind)) return json({ error: 'Please choose the document type.' }, 400);
  const name = (q.get('name') || 'nachweis').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'nachweis';
  if (Number(req.headers.get('content-length') || 0) > MAX) return json({ error: 'The file is larger than 10 MB.' }, 413);
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return json({ error: 'The file is empty.' }, 400);
  if (buf.length > MAX) return json({ error: 'The file is larger than 10 MB.' }, 413);
  const type = sniff(buf);
  if (!type) { logSecurity('upload_rejected', `b2b-verify:${ctx.user.id}`, { detail: 'verification upload (not PDF/image)' }); return json({ error: 'Please upload a PDF, JPG or PNG file.' }, 415); }
  { const sc = await scanUpload(buf); if (!sc.clean) { logSecurity('upload_rejected', `b2b-verify:${ctx.user.id}`, { detail: `virus scan: ${sc.threat}`.slice(0, 120) }); return json({ error: threatMessage(sc) }, 422); } }
  const db = supabaseAdmin();
  const existing = await docsOf(a.id);
  if (existing.length >= 8) return json({ error: 'A maximum of 8 documents. Please remove files you do not need.' }, 409);
  const id = randomUUID();
  const path = `${a.id}/${id}.${type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg'}`;
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false });
  if (up.error) return json({ error: 'Saving failed. Please try again.' }, 502);
  const ins = await db.from('lr_b2b_verification_docs').insert({
    id, account_id: a.id, kind, file_name: name, storage_path: path, byte_size: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'), uploaded_by: ctx.user.id,
  });
  if (ins.error) { await db.storage.from(BUCKET).remove([path]); return json({ error: 'Speichern fehlgeschlagen.' }, 500); }
  if (a.verification_status === 'abgelehnt') await db.from('lr_b2b_accounts').update({ verification_status: 'offen' }).eq('id', a.id);
  return json({ ok: true, id }, 201);
}

// Submit for review (requires a business registration, good standing certificate or professional license). Notifies LeaseRun by email.
export async function PUT(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-verify-up', limit: 6 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (a.verified_at) return json({ error: 'Your account is already verified.' }, 409);
  const docs = await docsOf(a.id);
  if (!docs.some((d) => d.kind === 'gewerbe' || d.kind === 'handelsregister' || d.kind === 'erlaubnis')) {
    return json({ error: 'Please first upload your state business registration, certificate of good standing or professional license.' }, 400);
  }
  const now = new Date().toISOString();
  const r = await supabaseAdmin().from('lr_b2b_accounts').update({ verification_status: 'eingereicht', verification_submitted_at: now, verification_note: null, updated_at: now }).eq('id', a.id);
  if (r.error) return json({ error: 'Submitting failed.' }, 500);
  if (mailConfigured()) {
    const text = `New verification to review\n\n${a.company_name} (${a.legal_form})\nCustomer number: ${a.customer_number}\nType: ${a.institution_type}\nNMLS/license / EIN: ${a.register_number || '–'} / ${a.tax_id || '–'}${a.register_number && /^[0-9]{1,10}$/.test(a.register_number) ? `\nNMLS Consumer Access: https://www.nmlsconsumeraccess.org/EntityDetails.aspx/COMPANY/${a.register_number}` : ''}\nContact: ${a.advisor_name}, ${a.email}\nAddress: ${a.street || ''}, ${a.city} ${a.postal_code}\nDocuments: ${docs.map((d) => KIND_LABEL[d.kind as Kind] ?? d.kind).join(', ')}\n\nReview and verify: https://leaserun.com/internal/web-admin#partner`;
    for (const to of [supportInbox()]) await sendMail(to, `Verification: ${a.company_name}`, text);
  }
  return json({ ok: true, status: 'eingereicht' });
}

// Remove a document (only before submission or after a rejection).
export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-verify-up', limit: 20 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (a.verified_at || a.verification_status === 'eingereicht') return json({ error: 'Documents cannot be removed while under review.' }, 409);
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Invalid request.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_verification_docs').select('storage_path').eq('id', id).eq('account_id', a.id).maybeSingle();
  if (!data) return json({ error: 'Not found.' }, 404);
  await db.storage.from(BUCKET).remove([data.storage_path]);
  await db.from('lr_b2b_verification_docs').delete().eq('id', id).eq('account_id', a.id);
  return json({ ok: true });
}
