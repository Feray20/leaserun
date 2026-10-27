// Alle Anfragen und Geschäftsmeldungen (Kontakt, B2B-Anfragen, Nachweise, Termine, Vorschläge, Support) gehen an das
// Support-Postfach – es landet im LeaseRun-Postfach (Web-Admin und App). Sicherheitsmeldungen gehen weiter an die Admins.
export const supportInbox = (): string => (process.env.SUPPORT_INBOX || 'support@leaserun.com').trim().toLowerCase();
