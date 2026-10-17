import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, isAdminEmail } from '@/lib/security/admin';
import { adminConfigured, supabaseAdmin } from '@/lib/supabase/admin';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { adminAudit } from '@/lib/b2b/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: { 'Cache-Control': 'no-store' } });
const SITE = 'https://immoadv.de';

// Web-Admin → Nutzer: Konten auflisten (ohne Inhalte), sperren/entsperren, Passwort-Reset senden.
export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const q = new URL(req.url).searchParams;
  const page = Math.max(1, Number(q.get('page')) || 1);
  const term = (q.get('q') || '').trim().toLowerCase().slice(0, 100);
  const seg = (['b2c', 'b2b', 'admin'] as const).find((x) => x === q.get('seg')) || 'b2c';
  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) return j({ error: 'Nutzerliste nicht verfügbar.' }, 502);
  // Unternehmens-Mitgliedschaften: wer einem Unternehmenskonto angehört, zählt zu B2B.
  const { data: mem } = await db.from('immo_b2b_members').select('user_id, role, account_id');
  const accIds = [...new Set((mem || []).map((m) => m.account_id))];
  const { data: accs } = accIds.length ? await db.from('immo_b2b_accounts').select('id, company_name, customer_number, verification_status, verified_at').in('id', accIds) : { data: [] };
  const accById = new Map((accs || []).map((a) => [a.id, a]));
  const memByUser = new Map((mem || []).map((m) => [m.user_id, m]));
  const now = Date.now();
  const users = (data.users || [])
    .filter((u) => !term || (u.email || '').toLowerCase().includes(term))
    .map((u) => ({
      id: u.id,
      email: u.email || '',
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at || null,
      confirmed: Boolean(u.email_confirmed_at),
      mfa: (u.factors || []).some((f) => f.status === 'verified'),
      banned: Boolean((u as { banned_until?: string }).banned_until && new Date((u as { banned_until?: string }).banned_until!).getTime() > now),
      admin: isAdminEmail(u.email || ''),
      company: (() => { const m = memByUser.get(u.id); const a = m ? accById.get(m.account_id) : null; return a ? { name: a.company_name, number: a.customer_number, role: m!.role, verified: Boolean(a.verified_at), status: a.verification_status } : null; })(),
    }))
    .filter((u) => (seg === 'admin' ? u.admin : seg === 'b2b' ? !u.admin && Boolean(u.company) : !u.admin && !u.company));
  await adminAudit(auth.user.email, 'users_list', null, { page, seg: q.get('seg') || 'b2c', term: term ? 'gesetzt' : '' });
  return j({ users, page, seg, more: (data.users || []).length === 200 });
}

const Body = z.object({ action: z.enum(['ban', 'unban', 'reset', 'confirm']), id: z.string().uuid() });

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  const p = Body.safeParse(await req.json().catch(() => null));
  if (!p.success) return j({ error: 'Ungültig.' }, 400);
  const { action, id } = p.data;
  const admin = supabaseAdmin().auth.admin;
  const { data: got } = await admin.getUserById(id);
  const u = got?.user;
  if (!u) return j({ error: 'Konto nicht gefunden.' }, 404);
  const email = (u.email || '').toLowerCase();
  if ((action === 'ban') && (email === auth.user.email.toLowerCase() || isAdminEmail(email))) {
    return j({ error: 'Administratoren können hier nicht gesperrt werden.' }, 409);
  }
  if (action === 'ban' || action === 'unban') {
    const { error } = await admin.updateUserById(id, { ban_duration: action === 'ban' ? '876000h' : 'none' });
    if (error) return j({ error: 'Änderung fehlgeschlagen.' }, 502);
    await adminAudit(auth.user.email, action === 'ban' ? 'user_ban' : 'user_unban', id, {});
    return j({ ok: true });
  }
  if (!email) return j({ error: 'Konto hat keine E-Mail-Adresse.' }, 409);
  // Bestätigungs-E-Mail erneut senden (nur unbestätigte Konten).
  if (action === 'confirm') {
    if (u.email_confirmed_at) return j({ error: 'Dieses Konto ist bereits bestätigt.' }, 409);
    if (mailConfigured()) {
      const { data, error } = await admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${SITE}/app/dashboard` } });
      if (error || !data.properties?.hashed_token) return j({ error: 'Link konnte nicht erstellt werden.' }, 502);
      const ok = await sendMail(email, 'Bitte bestätigen Sie Ihre E-Mail-Adresse – ImmoAdv',
        'Guten Tag,\n\nIhr ImmoAdv-Konto ist noch nicht bestätigt. Über den Knopf bestätigen Sie Ihre E-Mail-Adresse und werden direkt angemeldet.',
        [], { title: 'E-Mail-Adresse bestätigen', button: { label: 'E-Mail-Adresse bestätigen', url: `${SITE}/auth/confirm?th=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink` }, note: 'Der Link ist nur kurze Zeit gültig und kann einmal verwendet werden.' });
      if (!ok) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
    } else {
      const { error } = await supabaseAdmin().auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${SITE}/auth/login` } });
      if (error) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
    }
    await adminAudit(auth.user.email, 'user_resend_confirmation', id, {});
    return j({ ok: true });
  }
  // Passwort-Reset: im ImmoAdv-Design (eigener Versand) oder übergangsweise über Supabase.
  if (mailConfigured()) {
    const { data, error } = await admin.generateLink({ type: 'recovery', email, options: { redirectTo: `${SITE}/auth/reset` } });
    if (error || !data.properties?.hashed_token) return j({ error: 'Link konnte nicht erstellt werden.' }, 502);
    const ok = await sendMail(email, 'Passwort zurücksetzen – ImmoAdv',
      'Guten Tag,\n\nfür Ihr ImmoAdv-Konto wurde das Zurücksetzen des Passworts angestoßen. Über den Knopf legen Sie ein neues Passwort fest.',
      [], { title: 'Neues Passwort festlegen', button: { label: 'Neues Passwort festlegen', url: `${SITE}/auth/confirm?th=${encodeURIComponent(data.properties.hashed_token)}&type=recovery` }, note: 'Wenn Sie das nicht erwartet haben, wenden Sie sich bitte an support@immoadv.de.' });
    if (!ok) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
  } else {
    const { error } = await supabaseAdmin().auth.resetPasswordForEmail(email, { redirectTo: `${SITE}/auth/reset` });
    if (error) return j({ error: 'E-Mail konnte nicht gesendet werden.' }, 502);
  }
  await adminAudit(auth.user.email, 'user_reset_password', id, {});
  return j({ ok: true });
}
