import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminList, requireAdmin } from '@/lib/security/admin';
import { revealMap } from '@/lib/security/pseudo';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });

// B2B-Anfragen (Demo, Enterprise, Kooperation), Partnercodes und Admin-Protokoll.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const db = supabaseAdmin();
  // Nachweis einer Kontoanfrage ansehen: kurzlebiger signierter Link (5 Minuten), Abruf wird protokolliert.
  const u = new URL(req.url);
  const proofId = u.searchParams.get('proof');
  if (proofId) {
    if (!/^[0-9a-f-]{36}$/.test(proofId)) return j({ error: 'Ungültig.' }, 400);
    const { data: c } = await db.from('immo_b2b_contact').select('proof_path, proof_name').eq('id', proofId).maybeSingle();
    if (!c?.proof_path) return j({ error: 'Kein Nachweis vorhanden.' }, 404);
    const sig = await db.storage.from('b2b-verify').createSignedUrl(c.proof_path, 300, { download: c.proof_name || 'nachweis' });
    if (!sig.data?.signedUrl) return j({ error: 'Nachweis nicht gefunden.' }, 404);
    await adminAudit(auth.user.email, 'b2b_request_proof_view', proofId);
    return j({ url: sig.data.signedUrl });
  }
  const [{ data: contacts }, { data: codes }, { data: audit }] = await Promise.all([
    db.from('immo_b2b_contact').select('id, kind, name, company, email, phone, message, status, created_at, institution_type, city, account_id, legal_form, register_number, tax_id, proof_kind, proof_name, proof_size').order('created_at', { ascending: false }).limit(300),
    db.from('immo_b2b_partner_codes').select('*').order('created_at', { ascending: false }).limit(300),
    db.from('immo_admin_audit').select('actor_email, action, target, meta, created_at').order('created_at', { ascending: false }).limit(200),
  ]);
  // Klartext nur auf ausdrücklichen Wunsch (?reveal=1) und nur für bekannte Adressen (Admins, Unternehmenskonten).
  let rows = audit ?? [];
  if (u.searchParams.get('reveal') === '1') {
    const { data: accs } = await db.from('immo_b2b_accounts').select('email').limit(5000);
    const map = await revealMap([...adminList(), ...(accs ?? []).map((x) => x.email as string)]);
    rows = rows.map((r) => ({ ...r, actor_email: map.get(r.actor_email) ? `${map.get(r.actor_email)}` : r.actor_email, target: r.target && map.get(r.target) ? map.get(r.target) : r.target }));
    await adminAudit(auth.user.email, 'audit_reveal', null, { rows: rows.length });
  }
  return j({ contacts: contacts ?? [], codes: codes ?? [], audit: rows, pseudonymized: u.searchParams.get('reveal') !== '1' });
}

const Act = z.discriminatedUnion('action', [
  z.object({ action: z.literal('contactDone'), id: z.string().uuid() }),
  z.object({ action: z.literal('codeCreate'), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/), description: z.string().trim().max(200).optional(), maxRedemptions: z.number().int().min(1).max(100000).nullable().optional() }),
  z.object({ action: z.literal('codeActive'), code: z.string(), on: z.boolean() }),
]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const p = Act.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültige Aktion.' }, 400);
  const a = p.data;
  const db = supabaseAdmin();
  let r;
  if (a.action === 'contactDone') r = await db.from('immo_b2b_contact').update({ status: 'erledigt' }).eq('id', a.id);
  else if (a.action === 'codeCreate') r = await db.from('immo_b2b_partner_codes').insert({ code: a.code, description: a.description || null, max_redemptions: a.maxRedemptions ?? null });
  else r = await db.from('immo_b2b_partner_codes').update({ active: a.on }).eq('code', a.code);
  if (r.error) return j({ error: /duplicate/.test(r.error.message) ? 'Code existiert bereits.' : r.error.message }, 400);
  await adminAudit(auth.user.email, a.action, 'code' in a ? a.code : 'id' in a ? a.id : null);
  return j({ ok: true });
}
