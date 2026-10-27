import { logSecurity } from '@/lib/security/seclog';
import { scanUpload, threatMessage } from '@/lib/security/filescan';
import { pushAdmins } from '@/lib/admin/push';
import { supportInbox } from '@/lib/notify/inbox';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { track } from '@/lib/analytics/track';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { json } from '@/lib/b2b/http';
import { adminList } from '@/lib/security/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { guardSubmission } from '@/lib/security/antispam';
import { intakeClosed } from '@/lib/security/panic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX = 4 * 1024 * 1024;
// Licensed professions: the NMLS ID or state license number is enough (verifiable in NMLS Consumer Access / state lookup).
const HR_FORMS = ['Mortgage broker / loan officer', 'Real estate broker / agent', 'CPA', 'Lender / bank / credit union'];
function sniff(b: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
  if (b.length > 4 && b.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}

const Schema = z.object({
  kind: z.enum(['konto', 'demo', 'enterprise', 'kooperation']),
  institutionType: z.enum(['BANK', 'BROKER', 'REALTOR', 'ADVISOR', 'OTHER']).optional(),
  city: z.string().trim().max(80).optional().default(''),
  legalForm: z.string().trim().max(60).optional().default(''),
  incorporationState: z.string().trim().toUpperCase().regex(/^([A-Z]{2})?$/).optional().default(''),
  registerNumber: z.string().trim().max(60).optional().default(''),
  taxId: z.string().trim().max(40).optional().default(''),
  proofKind: z.enum(['gewerbe', 'handelsregister', 'erlaubnis', 'sonstiges']).optional(),
  name: z.string().trim().min(2).max(120),
  company: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional().default(''),
  message: z.string().trim().max(2000).optional().default(''),
  privacy: z.union([z.literal(true), z.literal('true'), z.literal('on')]).transform(() => true as const),
  website: z.string().optional().default(''),
  camp: z.string().regex(/^[a-z0-9-]{3,40}$/).optional().or(z.literal('')),
  ts: z.coerce.number().optional(),
});

// Request for a business account (LeaseRun issues access in the Web-Admin), demo, Enterprise quote or partnership.
export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Temporarily unavailable (maintenance). Please try again later.' }, 503);
  if (!adminConfigured()) return json({ error: 'Not available.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`b2b-contact:${ip}`, 3, 10 * 60_000)) return json({ error: 'Too many requests. Please try again later.' }, 429);
  // JSON (demo/partnership) or multipart/form-data (account request with document as PDF/JPG/PNG, max. 4 MB).
  let raw: Record<string, unknown> | null = null;
  let file: File | null = null;
  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    if (Number(req.headers.get('content-length') || 0) > MAX + 64 * 1024) return json({ error: 'The document is larger than 4 MB.' }, 413);
    const fd = await req.formData().catch(() => null);
    if (!fd) return json({ error: 'Please check your entries.' }, 400);
    raw = {};
    for (const [k, v] of fd.entries()) if (typeof v === 'string') raw[k] = v; else if (k === 'proof' && v.size) file = v;
  } else raw = await req.json().catch(() => null);
  const p = Schema.safeParse(raw);
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    return json({ error: f === 'privacy' ? 'Please confirm the Privacy Policy.' : 'Please check your entries.' }, 400);
  }
  const b = p.data;
  const guard = await guardSubmission({ email: b.email, name: b.name, message: b.message, website: b.website, ts: b.ts, bucket: 'b2b-contact' });
  if (guard.action === 'drop') return json({ ok: true }, 201);
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, 400);
  const flag = guard.action === 'allow' && guard.flagged ? ' [suspected spam]' : '';
  const db = supabaseAdmin();
  const id = randomUUID();
  let proof: { proof_kind: string; proof_path: string; proof_name: string; proof_size: number; proof_sha256: string } | null = null;
  // Licensed professionals: NMLS ID or state license number is enough, document optional.
  // Other businesses (LLC, corporation, sole proprietorship …): a verification document is required; EIN optional.
  const registered = HR_FORMS.includes(b.legalForm);
  if (b.kind === 'konto') {
    if (!b.legalForm) return json({ error: 'Please choose your profession or business type.', field: 'legalForm' }, 400);
    if (registered && !/[0-9]{3,}/.test(b.registerNumber)) return json({ error: 'Please enter your NMLS ID or state license number (e.g. NMLS 1234567).', field: 'registerNumber' }, 400);
    if (b.taxId && !/^[0-9]{2}-?[0-9]{7}$/.test(b.taxId.replace(/\s+/g, ''))) return json({ error: 'Please check the EIN (format 12-3456789) or leave it empty.', field: 'taxId' }, 400);
    if (!registered && !file) return json({ error: 'Please upload a verification document (e.g. state business registration as PDF).', field: 'proof' }, 400);
  }
  if (b.kind === 'konto' && file) {
    if (file.size > MAX) return json({ error: 'The document is larger than 4 MB.', field: 'proof' }, 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniff(buf);
    if (!type) { logSecurity('upload_rejected', `b2b-contact:${ip}`, { detail: 'verification upload (not PDF/image)' }); return json({ error: 'Please upload the document as PDF, JPG or PNG.', field: 'proof' }, 415); }
    { const sc = await scanUpload(buf); if (!sc.clean) { logSecurity('upload_rejected', `b2b-contact:${ip}`, { detail: `virus scan: ${sc.threat}`.slice(0, 120) }); return json({ error: threatMessage(sc), field: 'proof' }, 422); } }
    const path = `requests/${id}.${type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg'}`;
    const up = await db.storage.from('b2b-verify').upload(path, buf, { contentType: type, upsert: false });
    if (up.error) return json({ error: 'The document could not be saved. Please try again.' }, 502);
    const name = (file.name || 'verification').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'verification';
    proof = { proof_kind: b.proofKind || 'gewerbe', proof_path: path, proof_name: name, proof_size: buf.length, proof_sha256: createHash('sha256').update(buf).digest('hex') };
  }
  const ins = await db.from('lr_b2b_contact').insert({ id, kind: b.kind, name: b.name, company: b.company, email: b.email, phone: b.phone || null, institution_type: b.institutionType || null, city: b.city || null,
    legal_form: (b.incorporationState ? `${b.legalForm} (${b.incorporationState})` : b.legalForm) || null, register_number: b.registerNumber || null, tax_id: b.taxId || null, ...(proof || {}), message: (b.message || '') + flag || null, ip_hash: ip });
  if (ins.error) { if (proof) await db.storage.from('b2b-verify').remove([proof.proof_path]); return json({ error: 'Your request could not be saved.' }, 500); }
  await track({ seg: 'b2b', ev: b.kind === 'konto' ? 'b2b_request' : 'b2b_contact', path: '/business', camp: b.camp || null }, req);
  if (mailConfigured()) {
    for (const to of [supportInbox()]) await sendMail(to, `Business request (${b.kind}): ${b.company}`, `${b.name}, ${b.company}\n${b.email} · ${b.phone || '–'}${b.registerNumber ? '\nNMLS/license: ' + b.registerNumber : ''}${proof ? '\nDocument: ' + proof.proof_name + ' (Web-Admin → Requests)' : ''}\n\n${b.message || '–'}`);
  }
  await pushAdmins('mail', b.kind === 'konto' ? 'New business account request' : 'New business inquiry', 'A new request is waiting in the inbox.', 'anfrage').catch(() => {});
  return json({ ok: true }, 201);
}
