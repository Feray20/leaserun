// Produktstatus der LeaseRun Card. Ohne angeschlossenen Kartenherausgeber, Identifizierung und Zahlungsdienst
// ist nichts „live“ – die Oberfläche zeigt dann ehrlich „In Vorbereitung“ bzw. „Nicht eingerichtet“.
export type ProgramStatus = 'LIVE' | 'SANDBOX' | 'COMING_SOON' | 'NOT_CONFIGURED';
export type CapabilityStatus = 'IMPLEMENTED' | 'READY_FOR_INTEGRATION' | 'NOT_CONFIGURED' | 'COMPLIANCE_PENDING';

// Kartenpartner: Stripe Issuing (Firmenkarten, CARD_PROVIDER=stripe) oder ein anderer Anbieter über URL/Schlüssel.
// Testbetrieb (SANDBOX) nutzt bei Stripe ausschließlich einen Testschlüssel (sk_test_…).
export function stripeIssuingKey(env: Record<string, string | undefined> = process.env, sandbox = (env.CARD_PROGRAM_STATUS || '').toUpperCase() === 'SANDBOX'): string | null {
  if ((env.CARD_PROVIDER || '').toLowerCase() !== 'stripe') return null;
  const k = sandbox ? (env.STRIPE_TEST_SECRET_KEY || (env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? env.STRIPE_SECRET_KEY : '')) : env.STRIPE_SECRET_KEY;
  if (!k) return null;
  if (sandbox && !k.startsWith('sk_test_')) return null;
  return k;
}
export function providerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean((env.CARD_PROVIDER_API_URL && env.CARD_PROVIDER_API_KEY) || (stripeIssuingKey(env) && env.STRIPE_ISSUING_WEBHOOK_SECRET));
}

export function programStatus(env: Record<string, string | undefined> = process.env): ProgramStatus {
  const s = (env.CARD_PROGRAM_STATUS || '').toUpperCase();
  const provider = providerConfigured(env);
  if (s === 'LIVE' && provider && env.CARD_COMPLIANCE_APPROVED === 'true') return 'LIVE';
  if (s === 'SANDBOX' && provider) return 'SANDBOX';
  if (!provider) return s === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'COMING_SOON';
  return 'COMING_SOON';
}

export function capabilities(env: Record<string, string | undefined> = process.env): Record<string, CapabilityStatus> {
  const card = providerConfigured(env);
  const ident = Boolean(env.IDENTITY_PROVIDER_API_URL && env.IDENTITY_PROVIDER_API_KEY);
  const compliance = env.CARD_COMPLIANCE_APPROVED === 'true';
  return {
    limitEngine: 'IMPLEMENTED',
    pricingDirectory: 'IMPLEMENTED',
    pricingPdf: 'IMPLEMENTED',
    cardIssuing: card ? (compliance ? 'IMPLEMENTED' : 'COMPLIANCE_PENDING') : 'READY_FOR_INTEGRATION',
    identification: ident ? (compliance ? 'IMPLEMENTED' : 'COMPLIANCE_PENDING') : 'READY_FOR_INTEGRATION',
    sepa: 'READY_FOR_INTEGRATION',
    statements: 'READY_FOR_INTEGRATION',
    walletPay: 'NOT_CONFIGURED',
  };
}
