// Creator-Status, erlaubte Übergänge, Vollständigkeit des Onboardings und „Nächste beste Aktion“.
// Reine Funktionen: Grundlage für Server-Schnittstellen und Tests.

export const CREATOR_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED', 'ACTIVE', 'REJECTED', 'SUSPENDED'] as const;
export type CreatorStatus = (typeof CREATOR_STATUSES)[number];

export const CATEGORIES = ['immobilien', 'finanzen', 'business', 'entrepreneurship', 'lifestyle', 'technology', 'education', 'other'] as const;
export const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'x', 'linkedin', 'other'] as const;
export const FOLLOWER_RANGES = ['lt_1k', '1k_10k', '10k_50k', '50k_100k', '100k_500k', '500k_1m', 'gt_1m'] as const;

export type AdminAction = 'START_REVIEW' | 'APPROVE' | 'REQUEST_INFO' | 'REJECT' | 'SUSPEND' | 'REACTIVATE';

// Zielstatus je Admin-Aktion und zulässige Ausgangsstatus.
const ADMIN_TRANSITIONS: Record<AdminAction, { from: readonly CreatorStatus[]; to: CreatorStatus }> = {
  START_REVIEW: { from: ['SUBMITTED'], to: 'UNDER_REVIEW' },
  APPROVE: { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'ACTIVE' },
  REQUEST_INFO: { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'INFO_REQUESTED' },
  REJECT: { from: ['SUBMITTED', 'UNDER_REVIEW', 'INFO_REQUESTED'], to: 'REJECTED' },
  SUSPEND: { from: ['ACTIVE'], to: 'SUSPENDED' },
  REACTIVATE: { from: ['SUSPENDED'], to: 'ACTIVE' },
};

export function adminTransition(from: CreatorStatus, action: AdminAction): CreatorStatus | null {
  const t = ADMIN_TRANSITIONS[action];
  return t.from.includes(from) ? t.to : null;
}

export const allowedAdminActions = (from: CreatorStatus): AdminAction[] =>
  (Object.keys(ADMIN_TRANSITIONS) as AdminAction[]).filter((a) => ADMIN_TRANSITIONS[a].from.includes(from));

// Aktionen, bei denen der Creator eine Nachricht erhält / eine Begründung nötig ist.
export const actionNeedsMessage = (a: AdminAction) => a === 'REQUEST_INFO' || a === 'REJECT' || a === 'SUSPEND';

// Was darf der Creator selbst bearbeiten? Während der Prüfung ist alles eingefroren,
// damit der Admin genau das freigibt, was er gesehen hat.
export function creatorCanEdit(status: CreatorStatus, section: 'account' | 'profile' | 'social' | 'business' | 'payout' | 'agreement'): boolean {
  if (status === 'DRAFT' || status === 'INFO_REQUESTED') return true;
  if (status === 'ACTIVE') return section !== 'account' && section !== 'agreement';
  return false;
}

export const creatorCanSubmit = (status: CreatorStatus) => status === 'DRAFT' || status === 'INFO_REQUESTED';

export type OnboardingState = {
  status: CreatorStatus;
  account: { first_name?: string | null; last_name?: string | null; country?: string | null };
  emailConfirmed: boolean;
  profile: { display_name?: string | null; categories?: string[] | null };
  socialCount: number;
  business: { legal_name?: string | null } | null;
  payout: { status: string } | null;
  agreementAccepted: boolean; // aktuelle Fassung akzeptiert
};

export type StepKey = 'account' | 'profile' | 'social' | 'business' | 'payout' | 'agreement';
export const STEP_ORDER: readonly StepKey[] = ['account', 'profile', 'social', 'business', 'payout', 'agreement'];

export function completeness(s: OnboardingState): Record<StepKey, boolean> {
  return {
    account: Boolean(s.account.first_name && s.account.last_name && s.account.country && s.emailConfirmed),
    profile: Boolean(s.profile.display_name && (s.profile.categories?.length ?? 0) > 0),
    social: s.socialCount > 0,
    business: Boolean(s.business?.legal_name),
    payout: Boolean(s.payout && s.payout.status !== 'SUPERSEDED'),
    agreement: s.agreementAccepted,
  };
}

export const missingSteps = (s: OnboardingState): StepKey[] => {
  const c = completeness(s);
  return STEP_ORDER.filter((k) => !c[k]);
};

export type NextAction = { key: string; title: string; text: string; target: string };

// Genau eine wichtigste nächste Aufgabe – Reihenfolge nach Dringlichkeit.
export function nextBestAction(s: OnboardingState, openInfoRequest: string | null): NextAction | null {
  if (s.status === 'INFO_REQUESTED') return { key: 'info', title: 'Angabe ergänzen', text: openInfoRequest ? 'LeaseRun benötigt noch eine Information von dir.' : 'Bitte prüfe deine Angaben und reiche sie erneut ein.', target: 'review' };
  if (s.status === 'DRAFT') {
    const miss = missingSteps(s);
    if (!s.emailConfirmed) return { key: 'email', title: 'E-Mail-Adresse bestätigen', text: 'Bitte öffne den Link in unserer Bestätigungs-E-Mail.', target: 'account' };
    if (miss.length) return { key: `step:${miss[0]}`, title: STEP_TITLE[miss[0]], text: 'Dieser Schritt fehlt noch für deine Bewerbung.', target: miss[0] };
    return { key: 'submit', title: 'Bewerbung einreichen', text: 'Alle Angaben sind vollständig.', target: 'review' };
  }
  if (s.status === 'SUBMITTED' || s.status === 'UNDER_REVIEW') return { key: 'wait', title: 'Bewerbung in Prüfung', text: 'Wir melden uns per E-Mail, sobald die Prüfung abgeschlossen ist.', target: 'review' };
  if (s.status === 'ACTIVE') {
    if (!s.payout || s.payout.status === 'SUPERSEDED') return { key: 'payout', title: 'Zahlungsdaten vervollständigen', text: 'Ohne Zahlungsdaten können wir nichts auszahlen.', target: 'payout' };
    if (!s.agreementAccepted) return { key: 'agreement', title: 'Vereinbarung bestätigen', text: 'Es gibt eine neue Fassung der Vereinbarung.', target: 'agreement' };
    if (s.payout.status === 'VERIFICATION_REQUIRED') return { key: 'payout-review', title: 'Zahlungsdaten in Prüfung', text: 'Deine geänderten Zahlungsdaten werden geprüft.', target: 'payout' };
    return null;
  }
  return null;
}

// Nach der Freigabe: wichtigste Aufgabe im Creator-Alltag (nach Zahlungsdaten/Vereinbarung aus nextBestAction).
export type PortalFacts = {
  contentChangesRequested: number;
  campaigns: { slug: string; name: string; created_at: string; hasMyContent: boolean }[];
  now: Date;
};
export function portalNextAction(f: PortalFacts): NextAction | null {
  if (f.contentChangesRequested > 0) return { key: 'content-fix', title: 'Inhalt überarbeiten', text: f.contentChangesRequested === 1 ? 'LeaseRun hat zu einem deiner Inhalte eine Anmerkung.' : `LeaseRun hat zu ${f.contentChangesRequested} Inhalten Anmerkungen.`, target: 'studio' };
  const fresh = f.campaigns.filter((k) => !k.hasMyContent && f.now.getTime() - new Date(k.created_at).getTime() < 14 * 86_400_000)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (fresh) return { key: `campaign:${fresh.slug}`, title: 'Neue Kampagne ansehen', text: fresh.name, target: 'studio' };
  const open = f.campaigns.find((k) => !k.hasMyContent);
  if (open) return { key: `publish:${open.slug}`, title: 'Content veröffentlichen', text: `Für die Kampagne „${open.name}“ ist noch kein Inhalt eingetragen.`, target: 'studio' };
  return null;
}

export const STEP_TITLE: Record<StepKey, string> = {
  account: 'Konto vervollständigen',
  profile: 'Creator-Profil anlegen',
  social: 'Social-Media-Profil angeben',
  business: 'Rechnungsdaten hinterlegen',
  payout: 'Zahlungsdaten hinterlegen',
  agreement: 'Vereinbarung bestätigen',
};

// Attributions-Kennung: zufällig, ohne personenbezogene Anteile, gut lesbar (keine 0/o/1/l).
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
export function refCodeFrom(bytes: Uint8Array): string {
  if (bytes.length < 10) throw new Error('need_10_bytes');
  let out = '';
  for (let i = 0; i < 10; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Protokoll-Metadaten säubern: keine Zahlungs-, Zugangs- oder Inhaltsdaten, nur einfache Werte, begrenzte Länge.
const BLOCKED_META = /(iban|bic|account|holder|password|token|secret|enc|key|body|message|email|phone|address|street)/i;
export function sanitizeMeta(meta: Record<string, unknown> = {}): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta).slice(0, 20)) {
    if (BLOCKED_META.test(k)) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 120);
  }
  return out;
}
