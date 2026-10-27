// Rollen im Web-Admin und in der Admin-App. Reine Logik ohne Abhängigkeiten (testbar).
// Inhaber = Adressen in ADMIN_EMAILS (unverändert, volle Rechte). Teammitglieder stehen in lr_admin_roles
// und dürfen nur die Bereiche ihrer Rolle. Alles, was hier nicht freigegeben ist, bleibt dem Inhaber vorbehalten.
export type AdminRole = 'owner' | 'support' | 'finance' | 'viewer';
export type AdminArea = 'stats' | 'mail' | 'termine' | 'support' | 'finance';

export const TEAM_ROLES = ['support', 'finance', 'viewer'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_LABEL: Record<AdminRole, string> = { owner: 'Inhaber', support: 'Support', finance: 'Buchhaltung', viewer: 'Nur lesen' };

export const AREA_ROLES: Record<AdminArea, readonly AdminRole[]> = {
  stats: ['owner', 'support', 'finance', 'viewer'],
  mail: ['owner', 'support'],
  termine: ['owner', 'support'],
  support: ['owner', 'support'],
  finance: ['owner', 'finance'],
};

export const isTeamRole = (r: unknown): r is TeamRole => typeof r === 'string' && (TEAM_ROLES as readonly string[]).includes(r);
export const canAccess = (role: AdminRole | null | undefined, area?: AdminArea): boolean =>
  role === 'owner' || (Boolean(role) && Boolean(area) && AREA_ROLES[area as AdminArea].includes(role as AdminRole));
export const areasOf = (role: AdminRole): AdminArea[] => (Object.keys(AREA_ROLES) as AdminArea[]).filter((a) => canAccess(role, a));
