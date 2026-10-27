// Direkte Antworten auf „Gib mir den Link zu …“ im Headquarters – ohne KI, damit sie immer sofort und richtig kommen
// (auch wenn das Anthropic-Guthaben leer ist). Nur offizielle Adressen der Anbieter bzw. dieses Projekts.
type L = { keys: RegExp; title: string; url: string; note?: string };
const LINKS: L[] = [
  // Stripe
  { keys: /paypal|zahlungsart|zahlungsmethod|payment.?method|klarna|sepa|apple.?pay|google.?pay|giropay|sofort/i, title: 'Stripe · Zahlungsarten (z. B. PayPal einschalten)', url: 'https://dashboard.stripe.com/settings/payment_methods', note: 'Die Kasse zeigt eingeschaltete Zahlungsarten automatisch an – im Code ist nichts zu ändern. Neue Anbieter (z. B. PayPal) vorher in die Datenschutzerklärung aufnehmen.' },
  { keys: /auszahlung|payout/i, title: 'Stripe · Auszahlungen', url: 'https://dashboard.stripe.com/payouts' },
  { keys: /stripe.*(zahlung|umsatz|kauf|payment)|zahlungen|umsätze/i, title: 'Stripe · Zahlungen', url: 'https://dashboard.stripe.com/payments' },
  { keys: /stripe.*(abo|subscription)|abonnement/i, title: 'Stripe · Abos', url: 'https://dashboard.stripe.com/subscriptions' },
  { keys: /stripe.*(rechnung|invoice)/i, title: 'Stripe · Rechnungen', url: 'https://dashboard.stripe.com/invoices' },
  { keys: /stripe.*(kunde|customer)/i, title: 'Stripe · Kunden', url: 'https://dashboard.stripe.com/customers' },
  { keys: /stripe.*(webhook|ereignis)/i, title: 'Stripe · Webhooks', url: 'https://dashboard.stripe.com/webhooks' },
  { keys: /stripe.*(steuer|tax)/i, title: 'Stripe · Steuern', url: 'https://dashboard.stripe.com/settings/tax' },
  { keys: /stripe.*(produkt|preis|price|product)/i, title: 'Stripe · Produkte & Preise', url: 'https://dashboard.stripe.com/products' },
  { keys: /stripe.*(kasse|checkout|branding|logo|farbe)/i, title: 'Stripe · Kasse & Branding', url: 'https://dashboard.stripe.com/settings/branding' },
  { keys: /stripe/i, title: 'Stripe · Übersicht', url: 'https://dashboard.stripe.com/dashboard' },
  // Anthropic (KI-Guthaben)
  { keys: /anthropic|guthaben|credit|ki.?kosten|claude.*(kosten|guthaben|billing)/i, title: 'Anthropic · Guthaben aufladen', url: 'https://console.anthropic.com/settings/billing', note: 'Ohne Guthaben antworten die Agenten nur regelbasiert und freigegebene Aufträge warten.' },
  // Vercel
  { keys: /vercel.*(domain|dns)|^(?!.*(resend|mail)).*(domain|dns)/i, title: 'Vercel · Domains', url: 'https://vercel.com/feray20/leaserun/settings/domains' },
  { keys: /vercel.*(env|variabl|schlüssel|secret)|umgebungsvariabl/i, title: 'Vercel · Umgebungsvariablen', url: 'https://vercel.com/feray20/leaserun/settings/environment-variables' },
  { keys: /vercel.*(log|fehler)|server.?log/i, title: 'Vercel · Logs', url: 'https://vercel.com/feray20/leaserun/logs' },
  { keys: /deploy|vercel/i, title: 'Vercel · Projekt & Deployments', url: 'https://vercel.com/feray20/leaserun' },
  // Resend (E-Mail-Versand)
  { keys: /resend.*(domain|dns)|mail.?domain|spf|dkim|dmarc/i, title: 'Resend · Domains', url: 'https://resend.com/domains' },
  { keys: /resend|versandprotokoll|mail.?versand/i, title: 'Resend · Gesendete E-Mails', url: 'https://resend.com/emails' },
  // Supabase
  { keys: /supabase|datenbank|database/i, title: 'Supabase · Projekt', url: 'https://supabase.com/dashboard/project/mieoylqhtvghcnvaxutg' },
  // GitHub
  { keys: /github|repo|quellcode/i, title: 'GitHub · LeaseRun', url: 'https://github.com/Feray20/LeaseRun' },
  { keys: /github.*(action|lauf|workflow)|umsetzungs.?lauf/i, title: 'GitHub · Abläufe (Actions)', url: 'https://github.com/Feray20/LeaseRun/actions' },
  // Google
  { keys: /search.?console|google.*(index|suche|ranking)/i, title: 'Google Search Console', url: 'https://search.google.com/search-console' },
];

// Nur antworten, wenn wirklich nach einem Link/Ort gefragt wird (sonst übernimmt der Agent).
const ASKS_LINK = /\blink|url|adresse|wo (finde|kann|ist|stell|schalt|aktivier)|wo genau|öffne|dashboard|einstellung|aktivier|einschalt|freischalt/i;

export function serviceLinks(text: string): string | null {
  const t = String(text || '');
  if (!ASKS_LINK.test(t)) return null;
  const hits: L[] = [];
  for (const l of LINKS) if (l.keys.test(t) && !hits.some((h) => h.url === l.url)) hits.push(l);
  if (!hits.length) return null;
  // Spezifischere Treffer zuerst (die Liste ist von speziell nach allgemein sortiert); höchstens drei.
  return hits.slice(0, 3).map((h) => `**${h.title}**\n${h.url}${h.note ? `\n${h.note}` : ''}`).join('\n\n');
}
