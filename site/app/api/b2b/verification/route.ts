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

// Verifizierung von Unternehmenskonten: Gewerbenachweis hochladen, zur Prüfung einreichen.
// Die Prüfung und Freischaltung erfolgt durch LeaseRun im Admin-Bereich (/api/admin/b2b, Aktion approve/reject).
const BUCKET = 'b2b-verify';
const MAX = 10 * 1024 * 1024;
const KINDS = ['gewerbe', 'handelsregister', 'erlaubnis', 'sonstiges'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = {
  gewerbe: 'Gewerbeanmeldung',
  handelsregister: 'Handelsregisterauszug',
  erlaubnis: 'Erlaubnis § 34c / § 34i GewO',
  sonstiges: 'Sonstiger Nachweis',
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

// Status und hochgeladene Nachweise des eigenen Unternehmenskontos.
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

// Nachweis hochladen: Rohdaten im Body, Art und Dateiname als Query (?kind=gewerbe&name=…). PDF, JPG oder PNG, max. 10 MB.
export async function POST(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-verify-up', limit: 12 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (a.verified_at) return json({ error: 'Ihr Konto ist bereits freigeschaltet.' }, 409);
  if (a.verification_status === 'eingereicht') return json({ error: 'Die Unterlagen sind bereits zur Prüfung eingereicht.' }, 409);
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind') as Kind;
  if (!KINDS.includes(kind)) return json({ error: 'Bitte die Art des Nachweises wählen.' }, 400);
  const name = (q.get('name') || 'nachweis').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'nachweis';
  if (Number(req.headers.get('content-length') || 0) > MAX) return json({ error: 'Die Datei ist größer als 10 MB.' }, 413);
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return json({ error: 'Die Datei ist leer.' }, 400);
  if (buf.length > MAX) return json({ error: 'Die Datei ist größer als 10 MB.' }, 413);
  const type = sniff(buf);
  if (!type) { logSecurity('upload_rejected', `b2b-verify:${ctx.user.id}`, { detail: 'Verifizierungs-Upload (kein PDF/Bild)' }); return json({ error: 'Bitte als PDF, JPG oder PNG hochladen.' }, 415); }
  { const sc = await scanUpload(buf); if (!sc.clean) { logSecurity('upload_rejected', `b2b-verify:${ctx.user.id}`, { detail: `Virenprüfung: ${sc.threat}`.slice(0, 120) }); return json({ error: threatMessage(sc) }, 422); } }
  const db = supabaseAdmin();
  const existing = await docsOf(a.id);
  if (existing.length >= 8) return json({ error: 'Maximal 8 Nachweise. Bitte nicht benötigte Dateien entfernen.' }, 409);
  const id = randomUUID();
  const path = `${a.id}/${id}.${type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg'}`;
  const up = await db.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: false });
  if (up.error) return json({ error: 'Speichern fehlgeschlagen. Bitte erneut versuchen.' }, 502);
  const ins = await db.from('lr_b2b_verification_docs').insert({
    id, account_id: a.id, kind, file_name: name, storage_path: path, byte_size: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'), uploaded_by: ctx.user.id,
  });
  if (ins.error) { await db.storage.from(BUCKET).remove([path]); return json({ error: 'Speichern fehlgeschlagen.' }, 500); }
  if (a.verification_status === 'abgelehnt') await db.from('lr_b2b_accounts').update({ verification_status: 'offen' }).eq('id', a.id);
  return json({ ok: true, id }, 201);
}

// Zur Prüfung einreichen (benötigt Gewerbeanmeldung oder Handelsregisterauszug). Benachrichtigt LeaseRun per E-Mail.
export async function PUT(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-verify-up', limit: 6 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (a.verified_at) return json({ error: 'Ihr Konto ist bereits freigeschaltet.' }, 409);
  const docs = await docsOf(a.id);
  if (!docs.some((d) => d.kind === 'gewerbe' || d.kind === 'handelsregister')) {
    return json({ error: 'Bitte zuerst die Gewerbeanmeldung oder einen Handelsregisterauszug hochladen.' }, 400);
  }
  const now = new Date().toISOString();
  const r = await supabaseAdmin().from('lr_b2b_accounts').update({ verification_status: 'eingereicht', verification_submitted_at: now, verification_note: null, updated_at: now }).eq('id', a.id);
  if (r.error) return json({ error: 'Einreichen fehlgeschlagen.' }, 500);
  if (mailConfigured()) {
    const text = `Neue Verifizierung zur Prüfung\n\n${a.company_name} (${a.legal_form})\nKundennummer: ${a.customer_number}\nArt: ${a.institution_type}\nRegister/USt: ${a.register_number || '–'} / ${a.tax_id || '–'}\nAnsprechpartner: ${a.advisor_name}, ${a.email}\nAnschrift: ${a.street || ''}, ${a.postal_code} ${a.city}\nNachweise: ${docs.map((d) => KIND_LABEL[d.kind as Kind] ?? d.kind).join(', ')}\n\nPrüfen und freischalten: https://leaserun.com/internal/web-admin#partner`;
    for (const to of [supportInbox()]) await sendMail(to, `Verifizierung: ${a.company_name}`, text);
  }
  return json({ ok: true, status: 'eingereicht' });
}

// Nachweis entfernen (nur vor der Einreichung bzw. nach einer Ablehnung).
export async function DELETE(req: Request) {
  const ctx = await requireMember(req, { owner: true, bucket: 'b2b-verify-up', limit: 20 });
  if (ctx instanceof Response) return ctx;
  const a = ctx.account;
  if (a.verified_at || a.verification_status === 'eingereicht') return json({ error: 'Während der Prüfung können keine Nachweise entfernt werden.' }, 409);
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Ungültig.' }, 400);
  const db = supabaseAdmin();
  const { data } = await db.from('lr_b2b_verification_docs').select('storage_path').eq('id', id).eq('account_id', a.id).maybeSingle();
  if (!data) return json({ error: 'Nicht gefunden.' }, 404);
  await db.storage.from(BUCKET).remove([data.storage_path]);
  await db.from('lr_b2b_verification_docs').delete().eq('id', id).eq('account_id', a.id);
  return json({ ok: true });
}
