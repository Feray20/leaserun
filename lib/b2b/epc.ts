// Reine Rechenfunktionen für Rechnungen (ohne PDF-Abhängigkeiten, testbar).

export const VAT_RATE = 19;
export type Item = { description: string; quantity: number; unitNetCents: number };

export const totals = (items: Item[], vatRate = VAT_RATE) => {
  const net = items.reduce((s, i) => s + Math.round(i.quantity * i.unitNetCents), 0);
  const vat = Math.round((net * vatRate) / 100);
  return { net, vat, gross: net + vat };
};

// EPC069-12 (GiroCode), Version 002, UTF-8. Betrag max. 999.999.999,99 €.
export function epcPayload(o: { name: string; iban: string; bic?: string; cents: number; reference: string }): string {
  const amount = (o.cents / 100).toFixed(2);
  return ['BCD', '002', '1', 'SCT', o.bic || '', o.name.slice(0, 70), o.iban, `EUR${amount}`, '', '', o.reference.slice(0, 140), ''].join('\n').trimEnd();
}

