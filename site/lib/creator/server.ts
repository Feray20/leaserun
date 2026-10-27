import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { userFromRequest, type AuthUser } from '@/lib/billing/auth';
import { requireAdmin } from '@/lib/security/admin';
import { allowRequest } from '@/lib/security/rate-limit';
import { adminConfigured, anonymizedIpHash, supabaseAdmin } from '@/lib/supabase/admin';
import { can, effectiveRole, type AdminRole, type Permission } from '@/lib/creator/roles';
import { maskIban } from '@/lib/creator/iban';
import { refCodeFrom, sanitizeMeta, type CreatorStatus, type OnboardingState } from '@/lib/creator/model';
import { isCreatorAuthEmail } from '@/lib/creator/identity';

// Serverseitige Bausteine des Creator Hubs: Zugriff prüfen, Audit schreiben, eigene Daten laden.
// Grundsatz: Jede Prüfung passiert hier auf dem Server – nie nur im Browser.

export const noStore = { 'Cache-Control': 'no-store, private', 'X-Robots-Tag': 'noindex, nofollow' } as const;
export const j = (b: unknown, s = 200) => NextResponse.json(b, { status: s, headers: noStore });

export type CreatorRow = {
  id: string; user_id: string | null; status: CreatorStatus; // null: Login gelöscht (archiviert)
  first_name: string | null; last_name: string | null; country: string | null; phone: string | null;
  display_name: string | null; company: string | null; website: string | null; bio: string | null; categories: string[];
  ref_code: string | null; info_request: string | null;
  submitted_at: string | null; reviewed_at: string | null; approved_at: string | null; created_at: string; updated_at: string;
};
export type PayoutRow = {
  id: string; creator_id: string; holder_name: string; iban_enc: string; iban_last4: string; iban_country: string; iban_fingerprint: string;
  bic: string | null; status: 'PROVIDED' | 'VERIFICATION_REQUIRED' | 'VERIFIED' | 'SUPERSEDED'; confirmed_at: string; verified_at: string | null; created_at: string;
};

// ---------------- Audit ----------------
export type AuditEvent =
  | 'CREATOR_CREATED' | 'APPLICATION_SUBMITTED' | 'REVIEW_STARTED' | 'CREATOR_APPROVED' | 'CREATOR_INFO_REQUESTED' | 'CREATOR_REJECTED'
  | 'CREATOR_SUSPENDED' | 'CREATOR_REACTIVATED' | 'AGREEMENT_ACCEPTED'
  | 'BANK_DATA_ADDED' | 'BANK_DATA_CHANGED' | 'BANK_DETAILS_VIEWED' | 'BANK_DATA_VERIFIED' | 'ADMIN_ROLE_CHANGED' | 'ACCESS_DENIED'
  | 'CAMPAIGN_CHANGED' | 'CAMPAIGN_MEMBERS_CHANGED' | 'ASSET_CHANGED' | 'ASSET_DOWNLOADED' | 'BENEFIT_CHANGED'
  | 'CONTENT_SUBMITTED' | 'CONTENT_REVIEWED' | 'CONVERSION_RECORDED' | 'CONVERSION_REVERSED'
  | 'COMMISSION_CHANGED' | 'ADJUSTMENT_CREATED' | 'PERIOD_CLOSED' | 'BILLING_MODE_CHANGED' | 'STATEMENT_APPROVED' | 'DOCUMENT_DOWNLOADED'
  | 'INVOICE_CREATED' | 'INVOICE_APPROVED' | 'INVOICE_REJECTED' | 'PAYOUT_CREATED' | 'PAYOUT_APPROVED' | 'PAYOUT_EXPORTED' | 'PAYOUT_PAID' | 'PAYOUT_FAILED'
  | 'CREATOR_ACCOUNT_DELETED'
  | 'REFUND_RECORDED' | 'BANK_STATEMENT_IMPORTED' | 'CREATOR_NOTIFIED' | 'SETTINGS_CHANGED'
  | 'PAYOUT_RETURNED' | 'PAYOUT_REISSUED';

export type Actor = { kind: 'creator' | 'admin' | 'system'; ref: string; role: AdminRole | 'CREATOR' | 'SYSTEM' };

// Schreibt synchron (await): Für sicherheitsrelevante Vorgänge (z. B. Anzeigen der IBAN) gilt
// „kein Protokoll – keine Herausgabe“. Die aufrufende Stelle prüft das Ergebnis.
export async function audit(event: AuditEvent, creatorId: string | null, actor: Actor, result: 'SUCCESS' | 'DENIED' | 'FAILED', meta: Record<string, unknown> = {}): Promise<boolean> {
  const { error } = await supabaseAdmin().from('lr_creator_audit').insert({
    event_type: event, creator_id: creatorId, actor_kind: actor.kind, actor_ref: actor.ref.slice(0, 64), actor_role: actor.role, result, meta: sanitizeMeta(meta),
  });
  return !error;
}

const creatorActor = (): Actor => ({ kind: 'creator', ref: 'creator:self', role: 'CREATOR' });

async function adminActor(email: string, role: AdminRole): Promise<Actor> {
  const { pseudo } = await import('@/lib/security/pseudo');
  return { kind: 'admin', ref: await pseudo(email).catch(() => 'ps:unbekannt'), role };
}

// ---------------- Creator-Zugang ----------------
// Ist die Datenbank für den Creator Hub eingerichtet (Migrationen angewendet)? Solange nicht, antworten alle
// Creator-Schnittstellen mit einem freundlichen Hinweis statt mit Fehlern. Positiv wird dauerhaft, negativ 60 s gemerkt.
let schemaReadyAt = 0, schemaMissingAt = 0;
export async function creatorSchemaReady(): Promise<boolean> {
  if (schemaReadyAt) return true;
  if (schemaMissingAt && Date.now() - schemaMissingAt < 60_000) return false;
  const { error } = await supabaseAdmin().from('lr_creators').select('id', { head: true, count: 'exact' }).limit(1);
  const missing = !!error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|Could not find the table/i.test(error.message));
  if (missing) { schemaMissingAt = Date.now(); return false; }
  if (!error) schemaReadyAt = Date.now();
  return true; // andere Fehler normal weiterreichen
}
export const SETUP_PENDING = { error: 'Der Creator-Bereich wird gerade eingerichtet. Bitte schau in Kürze wieder vorbei.', code: 'setup' } as const;

export async function requireCreatorUser(req: Request, bucket: string, limit = 60): Promise<{ user: AuthUser } | NextResponse> {
  if (!adminConfigured()) return j({ error: 'Nicht verfügbar.' }, 503);
  const user = await userFromRequest(req);
  if (!user) return j({ error: 'Bitte anmelden.' }, 401);
  // Getrennte Konten: Im Creator-Bereich gelten nur Creator-Konten – Sitzungen aus Kundenbereich/Unternehmensportal werden abgewiesen.
  if (!isCreatorAuthEmail(user.email)) return j({ error: 'Bitte mit deinem Creator-Konto anmelden.', code: 'wrong_account' }, 401);
  if (!(await creatorSchemaReady())) return j(SETUP_PENDING, 503);
  if (!allowRequest(`creator-${bucket}:${user.id}`, limit, 60_000)) return j({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
  if (!allowRequest(`creator-ip:${anonymizedIpHash(req) ?? 'x'}`, 240, 60_000)) return j({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, 429);
  return { user };
}

// Eigenen Creator-Datensatz laden – IMMER über die angemeldete Nutzer-ID, nie über eine ID aus der Anfrage.
export async function ownCreator(userId: string): Promise<CreatorRow | null> {
  const { data } = await supabaseAdmin().from('lr_creators').select('*').eq('user_id', userId).maybeSingle();
  return (data as CreatorRow) ?? null;
}

export async function ensureOwnCreator(user: AuthUser): Promise<CreatorRow> {
  const have = await ownCreator(user.id);
  if (have) return have;
  const db = supabaseAdmin();
  const { data, error } = await db.from('lr_creators').insert({ user_id: user.id }).select('*').single();
  if (error) {
    // Gleichzeitige Anfrage hat den Datensatz bereits angelegt
    const again = await ownCreator(user.id);
    if (again) return again;
    throw new Error('creator_create_failed');
  }
  await audit('CREATOR_CREATED', (data as CreatorRow).id, creatorActor(), 'SUCCESS');
  return data as CreatorRow;
}

export { creatorActor };

export async function currentAgreement(): Promise<{ id: string; version: string; title: string; body: string; body_sha256: string; is_draft: boolean } | null> {
  const { data } = await supabaseAdmin().from('lr_creator_agreements').select('id, version, title, body, body_sha256, is_draft')
    .not('published_at', 'is', null).order('published_at', { ascending: false }).limit(1).maybeSingle();
  return data ?? null;
}

export async function currentPayout(creatorId: string): Promise<PayoutRow | null> {
  const { data } = await supabaseAdmin().from('lr_creator_payout_accounts').select('*').eq('creator_id', creatorId).neq('status', 'SUPERSEDED').maybeSingle();
  return (data as PayoutRow) ?? null;
}

// Maskierte Sicht auf Zahlungsdaten (für Creator-Portal und Admin-Standardansicht). Nie das Chiffrat herausgeben.
export const maskedPayout = (p: PayoutRow | null) => p ? {
  holder_name: p.holder_name, iban_masked: maskIban(p.iban_country, p.iban_last4), country: p.iban_country,
  bic: p.bic, status: p.status, confirmed_at: p.confirmed_at, verified_at: p.verified_at, created_at: p.created_at,
} : null;

export async function emailConfirmed(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
  return Boolean(data?.user?.email_confirmed_at);
}

// Gesamtzustand des eigenen Onboardings (Grundlage für Vollständigkeit und Next Best Action).
export async function onboardingState(c: CreatorRow, userId: string | null) {
  const db = supabaseAdmin();
  const [soc, bus, pay, agr, confirmed, reviews] = await Promise.all([
    db.from('lr_creator_socials').select('id, platform, platform_label, channel_name, handle, url, follower_range').eq('creator_id', c.id).order('created_at'),
    db.from('lr_creator_business').select('*').eq('creator_id', c.id).maybeSingle(),
    currentPayout(c.id),
    currentAgreement(),
    emailConfirmed(userId),
    db.from('lr_creator_reviews').select('action, message, created_at').eq('creator_id', c.id).eq('visible_to_creator', true).order('created_at', { ascending: false }).limit(10),
  ]);
  let accepted = false;
  if (agr) {
    const { data } = await db.from('lr_creator_agreement_acceptances').select('id').eq('creator_id', c.id).eq('agreement_id', agr.id).maybeSingle();
    accepted = Boolean(data);
  }
  const state: OnboardingState = {
    status: c.status, emailConfirmed: confirmed,
    account: { first_name: c.first_name, last_name: c.last_name, country: c.country },
    profile: { display_name: c.display_name, categories: c.categories },
    socialCount: soc.data?.length ?? 0,
    business: bus.data ? { legal_name: (bus.data as { legal_name: string }).legal_name } : null,
    payout: pay ? { status: pay.status } : null,
    agreementAccepted: accepted,
  };
  return { state, socials: soc.data ?? [], business: bus.data ?? null, payout: pay, agreement: agr, agreementAccepted: accepted, reviews: reviews.data ?? [] };
}

export const newRefCode = () => refCodeFrom(randomBytes(10));

// Attributions-Code, der weder mit einem anderen Creator noch mit einem Partner-Slug (gleiches ?ref=-Format) kollidiert.
export async function uniqueRefCode(): Promise<string> {
  const db = supabaseAdmin();
  for (let i = 0; i < 8; i++) {
    const code = newRefCode();
    const [a, b, c] = await Promise.all([
      db.from('lr_creators').select('id').eq('ref_code', code).maybeSingle(),
      db.from('lr_partners').select('slug').eq('slug', code).maybeSingle(),
      db.from('lr_b2b_accounts').select('id').eq('slug', code).maybeSingle(),
    ]);
    if (!a.data && !b.data && !c.data) return code;
  }
  throw new Error('ref_code_exhausted');
}

// ---------------- Admin-Zugang mit Rolle ----------------
export type AdminCtx = { email: string; role: AdminRole; actor: Actor };

export async function adminRoleOf(email: string): Promise<AdminRole> {
  const { data } = await supabaseAdmin().from('lr_creator_admin_roles').select('role').eq('email', email.toLowerCase()).maybeSingle();
  return effectiveRole(data?.role ?? null);
}

// Web-Admin-Anmeldung (ADMIN_EMAILS, zweiter Faktor, IP-Freigabe, Drosselung) + Rollenrecht.
// Verweigerte Zugriffe werden im Creator-Audit festgehalten.
export async function requireCreatorAdmin(req: Request, perm: Permission, creatorId: string | null = null): Promise<AdminCtx | NextResponse> {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;
  if (!adminConfigured()) return j({ error: 'Nicht konfiguriert.' }, 503);
  if (!(await creatorSchemaReady())) return j({ error: 'Der Creator Hub ist noch nicht eingerichtet: Bitte die Datenbank-Migrationen aus docs/sql (2026-10-22 bis 2026-10-25) im Supabase SQL Editor ausführen.', code: 'setup' }, 503);
  const email = auth.user.email;
  const role = await adminRoleOf(email);
  const actor = await adminActor(email, role);
  if (!can(role, perm)) {
    await audit('ACCESS_DENIED', creatorId, actor, 'DENIED', { permission: perm });
    return j({ error: 'Für diese Aktion fehlt Ihrer Rolle die Berechtigung.', role }, 403);
  }
  return { email, role, actor };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------- Phase 2: nur freigegebene Creator ----------------
export async function requireActiveCreator(req: Request, bucket: string, limit = 60): Promise<{ user: AuthUser; creator: CreatorRow } | NextResponse> {
  const g = await requireCreatorUser(req, bucket, limit);
  if (!('user' in g)) return g;
  const creator = await ownCreator(g.user.id);
  if (!creator || creator.status !== 'ACTIVE') return j({ error: 'Dieser Bereich steht nach der Freigabe deines Creator-Zugangs zur Verfügung.' }, 403);
  return { user: g.user, creator };
}

export const ASSET_BUCKET = 'creator-assets';
export { SITE_ORIGIN } from '@/lib/creator/site';

// Zeitraum für Kennzahlen: 30 Tage, 90 Tage, aktueller Monat, Vormonat, gesamt.
export function rangeOf(v: string | null, now = new Date()): { key: string; from: Date; to: Date } {
  const to = new Date(now.getTime() + 60_000);
  const berlinMonthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1) - 2 * 3600_000); // ausreichend genau für Monatsgrenzen (MEZ/MESZ)
  if (v === '90d') return { key: v, from: new Date(now.getTime() - 90 * 86_400_000), to };
  if (v === 'month') return { key: v, from: berlinMonthStart(now.getUTCFullYear(), now.getUTCMonth()), to };
  if (v === 'last_month') return { key: v, from: berlinMonthStart(now.getUTCFullYear(), now.getUTCMonth() - 1), to: berlinMonthStart(now.getUTCFullYear(), now.getUTCMonth()) };
  if (v === 'all') return { key: v, from: new Date('2026-01-01T00:00:00Z'), to };
  return { key: '30d', from: new Date(now.getTime() - 30 * 86_400_000), to };
}
