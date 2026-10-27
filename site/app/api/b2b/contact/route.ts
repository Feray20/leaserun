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
const HR_FORMS = ['GmbH', 'UG (haftungsbeschränkt)', 'AG', 'KG', 'GmbH & Co. KG', 'OHG', 'e. K. (eingetragener Kaufmann)', 'PartG / PartG mbB', 'eG', 'SE'];
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

// Anfrage für ein Unternehmenskonto (Zugang vergibt LeaseRun im Web-Admin), Demo, Enterprise-Angebot oder Kooperation.
export async function POST(req: Request) {
  if (await intakeClosed()) return json({ error: 'Vorübergehend nicht möglich (Wartung). Bitte später erneut versuchen.' }, 503);
  if (!adminConfigured()) return json({ error: 'Nicht verfügbar.' }, 503);
  const ip = anonymizedIpHash(req) ?? 'x';
  if (!allowRequest(`b2b-contact:${ip}`, 3, 10 * 60_000)) return json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' }, 429);
  // JSON (Demo/Kooperation) oder multipart/form-data (Kontoanfrage mit Nachweis als PDF/JPG/PNG, max. 4 MB).
  let raw: Record<string, unknown> | null = null;
  let file: File | null = null;
  if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
    if (Number(req.headers.get('content-length') || 0) > MAX + 64 * 1024) return json({ error: 'Der Nachweis ist größer als 4 MB.' }, 413);
    const fd = await req.formData().catch(() => null);
    if (!fd) return json({ error: 'Bitte die Angaben prüfen.' }, 400);
    raw = {};
    for (const [k, v] of fd.entries()) if (typeof v === 'string') raw[k] = v; else if (k === 'proof' && v.size) file = v;
  } else raw = await req.json().catch(() => null);
  const p = Schema.safeParse(raw);
  if (!p.success) {
    const f = String(p.error.issues[0]?.path[0] ?? '');
    return json({ error: f === 'privacy' ? 'Bitte die Datenschutzhinweise bestätigen.' : 'Bitte die Angaben prüfen.' }, 400);
  }
  const b = p.data;
  const guard = await guardSubmission({ email: b.email, name: b.name, message: b.message, website: b.website, ts: b.ts, bucket: 'b2b-contact' });
  if (guard.action === 'drop') return json({ ok: true }, 201);
  if (guard.action === 'reject') return json({ error: guard.error, field: guard.field, suggestion: guard.suggestion }, 400);
  const flag = guard.action === 'allow' && guard.flagged ? ' [Spam-Verdacht]' : '';
  const db = supabaseAdmin();
  const id = randomUUID();
  let proof: { proof_kind: string; proof_path: string; proof_name: string; proof_size: number; proof_sha256: string } | null = null;
  // Eingetragene Gesellschaften (HR/PR/GnR): Registernummer genügt, Nachweis optional.
  // Einzelunternehmen, Freiberufler, GbR und sonstige: Steuernummer/USt-IdNr. und Nachweis sind Pflicht.
  const registered = HR_FORMS.includes(b.legalForm);
  if (b.kind === 'konto') {
    if (!b.legalForm) return json({ error: 'Bitte die Rechtsform wählen.', field: 'legalForm' }, 400);
    if (registered && !/[0-9]{2,}/.test(b.registerNumber)) return json({ error: 'Bitte die Handelsregisternummer angeben (z. B. HRB 12345, Amtsgericht).', field: 'registerNumber' }, 400);
    if (!registered && !b.taxId) return json({ error: 'Bitte Steuernummer oder USt-IdNr. angeben.', field: 'taxId' }, 400);
    if (!registered && !file) return json({ error: 'Bitte einen Nachweis hochladen (z. B. Gewerbeanmeldung als PDF).', field: 'proof' }, 400);
  }
  if (b.kind === 'konto' && file) {
    if (file.size > MAX) return json({ error: 'Der Nachweis ist größer als 4 MB.', field: 'proof' }, 413);
    const buf = Buffer.from(await file.arrayBuffer());
    const type = sniff(buf);
    if (!type) { logSecurity('upload_rejected', `b2b-contact:${ip}`, { detail: 'Nachweis-Upload (kein PDF/Bild)' }); return json({ error: 'Bitte den Nachweis als PDF, JPG oder PNG hochladen.', field: 'proof' }, 415); }
    { const sc = await scanUpload(buf); if (!sc.clean) { logSecurity('upload_rejected', `b2b-contact:${ip}`, { detail: `Virenprüfung: ${sc.threat}`.slice(0, 120) }); return json({ error: threatMessage(sc), field: 'proof' }, 422); } }
    const path = `requests/${id}.${type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg'}`;
    const up = await db.storage.from('b2b-verify').upload(path, buf, { contentType: type, upsert: false });
    if (up.error) return json({ error: 'Der Nachweis konnte nicht gespeichert werden. Bitte erneut versuchen.' }, 502);
    const name = (file.name || 'nachweis').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'nachweis';
    proof = { proof_kind: b.proofKind || 'gewerbe', proof_path: path, proof_name: name, proof_size: buf.length, proof_sha256: createHash('sha256').update(buf).digest('hex') };
  }
  const ins = await db.from('lr_b2b_contact').insert({ id, kind: b.kind, name: b.name, company: b.company, email: b.email, phone: b.phone || null, institution_type: b.institutionType || null, city: b.city || null,
    legal_form: b.legalForm || null, register_number: b.registerNumber || null, tax_id: b.taxId || null, ...(proof || {}), message: (b.message || '') + flag || null, ip_hash: ip });
  if (ins.error) { if (proof) await db.storage.from('b2b-verify').remove([proof.proof_path]); return json({ error: 'Anfrage konnte nicht gespeichert werden.' }, 500); }
  await track({ seg: 'b2b', ev: b.kind === 'konto' ? 'b2b_request' : 'b2b_contact', path: '/business', camp: b.camp || null }, req);
  if (mailConfigured()) {
    for (const to of [supportInbox()]) await sendMail(to, `B2B-Anfrage (${b.kind}): ${b.company}`, `${b.name}, ${b.company}\n${b.email} · ${b.phone || '–'}${proof ? '\nNachweis: ' + proof.proof_name + ' (im Web-Admin unter Anfragen)' : ''}\n\n${b.message || '–'}`);
  }
  await pushAdmins('mail', b.kind === 'konto' ? 'Neue Unternehmensanfrage' : 'Neue B2B-Anfrage', 'Im Postfach wartet eine neue Anfrage.', 'anfrage').catch(() => {});
  return json({ ok: true }, 201);
}
