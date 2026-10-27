// Anbieter-Abstraktion: Oberfläche → LeaseRun-Service → Adapter → externer Anbieter.
// Solange kein Anbieter angeschlossen ist, antwortet der Adapter mit „nicht eingerichtet“ – nie mit erfundenem Erfolg.
export type ProviderResult<T> = { ok: true; data: T } | { ok: false; code: 'NOT_CONFIGURED' | 'PROVIDER_ERROR'; message: string };
const NOT = { ok: false as const, code: 'NOT_CONFIGURED' as const, message: 'Diese Funktion ist derzeit noch nicht aktiviert. Ihre Daten wurden nicht verändert.' };

export interface CardProvider { issueCard(input: { userId: string; type: 'debit' | 'charge'; design: string }): Promise<ProviderResult<{ providerRef: string; last4: string }>>; freeze(providerRef: string, on: boolean): Promise<ProviderResult<null>>; }
export interface IdentityProvider { start(userId: string): Promise<ProviderResult<{ redirectUrl: string }>>; }
export interface PaymentProvider { createMandate(userId: string): Promise<ProviderResult<{ mandateReference: string }>>; }

export const notConfiguredCard: CardProvider = { issueCard: async () => NOT, freeze: async () => NOT };
export const notConfiguredIdentity: IdentityProvider = { start: async () => NOT };
export const notConfiguredPayment: PaymentProvider = { createMandate: async () => NOT };

// Adapter-Auswahl: CARD_PROVIDER=stripe → Stripe Issuing (Firmenkarten); sonst „nicht eingerichtet“.
export async function cardProvider(): Promise<CardProvider> {
  if ((process.env.CARD_PROVIDER || '').toLowerCase() === 'stripe') { const m = await import('./stripe-issuing'); if (m.issuingClient()) return m.stripeCardProvider; }
  return notConfiguredCard;
}
export function identityProvider(): IdentityProvider { return notConfiguredIdentity; }
export function paymentProvider(): PaymentProvider { return notConfiguredPayment; }
