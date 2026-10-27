// Rollen im Creator-Bereich des Web-Admins (Least Privilege).
// Rollen grenzen nur ein: Wer den Web-Admin betritt, braucht weiterhin ADMIN_EMAILS + zweiten Faktor.
// Administratoren ohne Eintrag in lr_creator_admin_roles gelten als SUPER_ADMIN (wie im übrigen Web-Admin).

export const ADMIN_ROLES = ['SUPER_ADMIN', 'FINANCE_ADMIN', 'CREATOR_MANAGER', 'SUPPORT', 'READ_ONLY'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  FINANCE_ADMIN: 'Finance Admin',
  CREATOR_MANAGER: 'Creator Manager',
  SUPPORT: 'Support',
  READ_ONLY: 'Nur lesen',
};

export type Permission =
  | 'creators.list'        // Liste, Status, Profil, Social
  | 'creators.contact'     // Name, E-Mail, Telefon
  | 'creators.business'    // Business- und Rechnungsdaten
  | 'creators.review'      // Prüfen, freigeben, Rückfrage, ablehnen
  | 'creators.suspend'     // sperren / reaktivieren
  | 'bank.masked'          // Zahlungsdaten maskiert + Status
  | 'bank.reveal'          // vollständige Zahlungsdaten (protokolliert)
  | 'bank.verify'          // Zahlungsdaten als geprüft markieren
  | 'audit.read'           // Audit-Protokoll lesen
  | 'campaigns.manage'     // Kampagnen, Assets, Community-Vorteile pflegen
  | 'content.review'       // veröffentlichte Inhalte prüfen
  | 'conversions.read'     // Attribution, Conversions, Umsatz je Creator
  | 'conversions.manage'   // Conversion manuell zurücknehmen
  | 'billing.read'         // Abrechnungen, Rechnungen, Auszahlungen ansehen
  | 'billing.manage'       // Monatsabschluss, Freigabe, Anpassungen, Provisionsregeln, Verfahren
  | 'payouts.manage'       // Auszahlungen freigeben, SEPA-Export, als bezahlt markieren
  | 'roles.manage';        // Rollen vergeben

const MATRIX: Record<AdminRole, readonly Permission[]> = {
  SUPER_ADMIN: ['creators.list', 'creators.contact', 'creators.business', 'creators.review', 'creators.suspend', 'bank.masked', 'bank.reveal', 'bank.verify', 'audit.read', 'roles.manage', 'campaigns.manage', 'content.review', 'conversions.read', 'conversions.manage', 'billing.read', 'billing.manage', 'payouts.manage'],
  FINANCE_ADMIN: ['creators.list', 'creators.contact', 'creators.business', 'bank.masked', 'bank.reveal', 'bank.verify', 'audit.read', 'conversions.read', 'conversions.manage', 'billing.read', 'billing.manage', 'payouts.manage'],
  CREATOR_MANAGER: ['creators.list', 'creators.contact', 'creators.business', 'creators.review', 'creators.suspend', 'bank.masked', 'audit.read', 'campaigns.manage', 'content.review', 'conversions.read', 'billing.read'],
  SUPPORT: ['creators.list', 'creators.contact', 'bank.masked'],
  READ_ONLY: ['creators.list', 'bank.masked', 'conversions.read', 'billing.read'],
};

export const isAdminRole = (v: unknown): v is AdminRole => typeof v === 'string' && (ADMIN_ROLES as readonly string[]).includes(v);

export function can(role: AdminRole, perm: Permission): boolean {
  return MATRIX[role].includes(perm);
}

export function permissionsOf(role: AdminRole): Permission[] {
  return [...MATRIX[role]];
}

// Fehlende Zuordnung → SUPER_ADMIN (abwärtskompatibel); ungültige Werte → READ_ONLY (sicherer Ausfall).
export function effectiveRole(stored: unknown): AdminRole {
  if (stored == null) return 'SUPER_ADMIN';
  return isAdminRole(stored) ? stored : 'READ_ONLY';
}
