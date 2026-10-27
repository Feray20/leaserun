// Adapter: LeaseRun Card → Stripe Issuing (nur Firmenkarten; in der EU lässt Stripe keine Privatkundenkarten zu).
// Karten gehören jeweils zu einem Unternehmenskonto. Mit Stripe Connect läuft jede Karte über das verbundene
// Stripe-Konto des Unternehmens (stripeAccount) und zahlt aus dessen eigenem Issuing-Guthaben – LeaseRun
// verwahrt kein Geld und gibt keinen Kredit. Im Testbetrieb (SANDBOX) nur mit Testschlüssel.
import Stripe from 'stripe';
import { stripeIssuingKey } from './status';
import type { CardProvider, ProviderResult } from './provider';

let client: Stripe | null = null;
let clientKey = '';
export function issuingClient(): Stripe | null {
  const key = stripeIssuingKey();
  if (!key) return null;
  if (!client || clientKey !== key) { client = new Stripe(key); clientKey = key; }
  return client;
}

const fail = (e: unknown): ProviderResult<never> => {
  const msg = e instanceof Error ? e.message : String(e);
  console.warn('[karten] stripe issuing', msg.slice(0, 200));
  return { ok: false, code: 'PROVIDER_ERROR', message: 'Der Kartenpartner hat die Anfrage gerade nicht angenommen. Ihre Daten wurden nicht verändert.' };
};
const NOT: ProviderResult<never> = { ok: false, code: 'NOT_CONFIGURED', message: 'Diese Funktion ist derzeit noch nicht aktiviert. Ihre Daten wurden nicht verändert.' };

export type CardholderInput = {
  name: string; email: string; phone?: string;
  companyName: string; taxId?: string | null;
  address: { line1: string; postalCode: string; city: string; country?: string };
  stripeAccount?: string | null;
};

// Karteninhaber (Mitarbeiter eines Unternehmens) und virtuelle Firmenkarte in EUR anlegen.
export async function issueBusinessCard(input: CardholderInput & { immoCardId: string; b2bAccountId: string }): Promise<ProviderResult<{ providerRef: string; cardholderRef: string; last4: string }>> {
  const s = issuingClient(); if (!s) return NOT;
  const opt = input.stripeAccount ? { stripeAccount: input.stripeAccount } : undefined;
  try {
    const holder = await s.issuing.cardholders.create({
      type: 'individual', name: input.name.slice(0, 24), email: input.email, ...(input.phone ? { phone_number: input.phone } : {}),
      billing: { address: { line1: input.address.line1, postal_code: input.address.postalCode, city: input.address.city, country: input.address.country || 'DE' } },
      metadata: { lr_b2b_account_id: input.b2bAccountId, company: input.companyName.slice(0, 100) },
    }, { ...opt, idempotencyKey: `immo-holder-${input.immoCardId}` });
    const card = await s.issuing.cards.create({
      cardholder: holder.id, currency: 'eur', type: 'virtual', status: 'active',
      metadata: { lr_card_id: input.immoCardId, lr_b2b_account_id: input.b2bAccountId },
    }, { ...opt, idempotencyKey: `immo-card-${input.immoCardId}` });
    return { ok: true, data: { providerRef: card.id, cardholderRef: holder.id, last4: card.last4 } };
  } catch (e) { return fail(e); }
}

// Sperren / entsperren beim Kartenpartner (zusätzlich zur eigenen Sperre in der Echtzeit-Freigabe).
export async function setStripeCardStatus(providerRef: string, on: boolean, stripeAccount?: string | null): Promise<ProviderResult<null>> {
  const s = issuingClient(); if (!s) return NOT;
  try { await s.issuing.cards.update(providerRef, { status: on ? 'inactive' : 'active' }, stripeAccount ? { stripeAccount } : undefined); return { ok: true, data: null }; }
  catch (e) { return fail(e); }
}

export const stripeCardProvider: CardProvider = {
  issueCard: async () => NOT, // Firmenkarten werden über issueBusinessCard (Web-Admin) mit vollständigen Inhaberdaten ausgegeben.
  freeze: async (providerRef, on) => setStripeCardStatus(providerRef, on),
};
