// Einzelfreigaben für Privatkonten (Web-Admin → B2C → Zugriff freischalten): jede Funktion lässt sich unabhängig vom
// Tarif ausdrücklich freigeben („on“) oder entziehen („off“). Fehlt eine Funktion, gilt der Tarif („auto“).
export const B2C_FEATURES = {
  t_nk: ['Software-Tools', 'Kaufnebenkosten & Eigenkapital', 'free'],
  t_price: ['Software-Tools', 'Kaufpreis-Check', 'free'],
  t_special: ['Software-Tools', 'Sondertilgung', 'free'],
  t_offers: ['Software-Tools', 'Bankangebote vergleichen', 'starter'],
  t_bank: ['Software-Tools', 'Bankgespräch vorbereiten', 'starter'],
  t_portfolio: ['Software-Tools', 'Portfolio-Kennzahlen', 'pro'],
  t_fwd: ['Software-Tools', 'Anschluss & Forward', 'pro'],
  t_bk: ['Software-Tools', 'Betriebskostenabrechnung', 'pro'],
  druck: ['Ausgabe', 'Drucken, PDF und Angebotsschreiben aus den Tools', 'starter'],
  pdf_clean: ['Ausgabe', 'PDFs und Formulare ohne Wasserzeichen', 'starter'],
  objekte: ['Objekte', 'Unbegrenzt viele Objekte (sonst 2)', 'starter'],
  wissen: ['Inhalte', 'Wissenszentrale komplett (alle Antworten)', 'starter'],
  beispiele: ['Inhalte', 'Beispiele komplett (Mustermappe und Muster-PDFs)', 'starter'],
  rechner: ['Inhalte', 'Rechner mit eigenen Zahlen', 'starter'],
} as const;
export type B2CFeature = keyof typeof B2C_FEATURES;
export type FeatureMap = Partial<Record<B2CFeature, 'on' | 'off'>>;
export const FEATURE_KEYS = Object.keys(B2C_FEATURES) as B2CFeature[];

const RANK = { free: 0, starter: 1, pro: 2 } as const;
// Gilt eine Funktion für dieses Konto? Einzelfreigabe vor Tarif.
export function featureOn(key: B2CFeature, tier: string, f?: FeatureMap | null): boolean {
  const v = f?.[key];
  if (v === 'on') return true;
  if (v === 'off') return false;
  return (RANK[tier as keyof typeof RANK] ?? 0) >= RANK[B2C_FEATURES[key][2]];
}
// Nur gültige Schlüssel/Werte übernehmen (Daten aus der Datenbank sind unverbindlich).
export function cleanFeatures(x: unknown): FeatureMap {
  const out: FeatureMap = {};
  if (x && typeof x === 'object') for (const k of FEATURE_KEYS) { const v = (x as Record<string, unknown>)[k]; if (v === 'on' || v === 'off') out[k] = v; }
  return out;
}
