// Tippfehler-Toleranz für Vercel-Variablen: Geheime („sensitive“) Variablen lassen sich in Vercel nicht umbenennen.
// Steht ein Wert unter einem bekannten Tippfehler-Namen, wird er unter dem richtigen Namen verwendet.
const ALIASES: Record<string, string[]> = {
  STRIPE_WEBHOOK_SECRET: ['STRIPE_WEBHOOK_SECRETT', 'STRIPE_WEBHOOK_SECRE', 'STRIPE_WEBHOOK_SECRETS'],
  INVOICE_BIC: ['INVOICE_BICC', 'INVOICE_BIC_CODE'],
  INVOICE_IBAN: ['INVOICE_IBANN'],
};
for (const [name, alts] of Object.entries(ALIASES)) {
  if (process.env[name] && String(process.env[name]).trim()) continue;
  const hit = alts.find((a) => process.env[a] && String(process.env[a]).trim());
  if (hit) process.env[name] = process.env[hit];
}
export {};
