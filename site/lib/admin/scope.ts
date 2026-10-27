// Web-Admin: strikte Trennung der Datenbereiche (Zero-Cross-Data-Leak).
// Jede Admin-Anfrage trägt den aktiven Bereich im Header „x-admin-scope“ (oder ?scope=):
//   b2c    – nur Privatkunden: Einmalkäufe (39 € / 49 €), Investor Pro (29 €), private Konten, Kreditmappen ohne Unternehmen
//   b2b    – nur Unternehmen: Tarife (Basic / Pro / ab 349 € netto, Preise aus dem B2B-Katalog), Unternehmensrechnungen, Partner, Anfragen
//   system – Betrieb gesamt: Einrichtung, Server-Protokolle, Webhooks, Sicherheit (keine Kunden- oder Umsatzlisten)
//   steuer – Steuersoftware (Dropshipping und LeaseRun getrennt); LeaseRun-Rechnungen fragen dort weiter mit b2c bzw. b2b an
// Ohne gültigen Bereich liefern bereichsabhängige Schnittstellen nichts (400) statt gemischter Daten.
export type AdminScope = 'b2c' | 'b2b' | 'system' | 'steuer';
export const SCOPES: readonly AdminScope[] = ['b2c', 'b2b', 'system', 'steuer'];

export function adminScope(req: Request): AdminScope | null {
  const h = (req.headers.get('x-admin-scope') || '').toLowerCase();
  const q = (new URL(req.url).searchParams.get('scope') || '').toLowerCase();
  const v = (h || q) as AdminScope;
  return SCOPES.includes(v) ? v : null;
}

// Für Schnittstellen, die nur einen Kundenbereich bedienen (z. B. Finanzen): b2c oder b2b, sonst null.
export function customerScope(req: Request): 'b2c' | 'b2b' | null {
  const s = adminScope(req);
  return s === 'b2c' || s === 'b2b' ? s : null;
}

export const scopeError = { error: 'Bitte oben einen Bereich wählen (B2C oder B2B). Diese Ansicht zeigt nie beide Bereiche gemischt.' };
