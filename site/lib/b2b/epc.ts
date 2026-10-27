// Pure invoice math (no PDF dependencies, testable).
// US: no VAT. The rate stays a parameter so sales tax (only when Stripe Tax / a state requires it) can be applied.

export const VAT_RATE = 0;
export type Item = { description: string; quantity: number; unitNetCents: number };

export const totals = (items: Item[], vatRate = VAT_RATE) => {
  const net = items.reduce((s, i) => s + Math.round(i.quantity * i.unitNetCents), 0);
  const vat = Math.round((net * vatRate) / 100) + 0; // + 0 turns -0 into 0
  return { net, vat, gross: net + vat };
};

// QR code payload for paying an invoice online: a payment link (for example a Stripe Payment Link or hosted invoice
// page, env INVOICE_PAYMENT_LINK) with the invoice number and amount appended. Replaces the European EPC/GiroCode.
// Only https links are accepted; returns '' if the link is missing or invalid.
export function paymentLinkPayload(o: { url: string; cents: number; reference: string }): string {
  let u: URL;
  try { u = new URL(o.url); } catch { return ''; }
  if (u.protocol !== 'https:') return '';
  u.searchParams.set('client_reference_id', o.reference.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200));
  u.searchParams.set('amount', (o.cents / 100).toFixed(2));
  return u.toString();
}
