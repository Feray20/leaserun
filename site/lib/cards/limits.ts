// Limit-Engine (reine Rechenlogik, identisch zur SQL-Funktion lr_card_authorize).
// Maßgeblich ist immer die serverseitige, atomare Prüfung in der Datenbank – diese Funktionen dienen
// Anzeige, Tests und Vorabprüfung, nie allein der Freigabe einer Zahlung.
import type { Cents } from './money';

export type CardStatus = 'ACTIVE' | 'PENDING' | 'FROZEN' | 'BLOCKED';
export type LimitState = {
  monthlyLimit: Cents;
  settled: Cents;
  reserved: Cents;
  refunded: Cents;
  securityDeposit: Cents;
  refundsReleaseLimit: boolean;
};
export type AuthResult = 'AUTHORIZED' | 'DECLINED_LIMIT_EXCEEDED' | 'DECLINED_CARD_FROZEN' | 'DECLINED_CARD_INACTIVE';

export const MAX_AMOUNT: Cents = 100_000_000; // 1 Mio. € je Vorgang als technische Obergrenze

export function available(l: LimitState): Cents {
  const credit = l.refundsReleaseLimit ? l.refunded : 0;
  return Math.max(0, l.monthlyLimit - l.settled - l.reserved + credit);
}

export function usedShare(l: LimitState): number {
  if (l.monthlyLimit <= 0) return 1;
  return Math.min(1, Math.max(0, (l.monthlyLimit - available(l)) / l.monthlyLimit));
}

export function decide(l: LimitState, status: CardStatus, amount: Cents): AuthResult {
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new Error('invalid_amount');
  if (status === 'FROZEN' || status === 'BLOCKED') return 'DECLINED_CARD_FROZEN';
  if (status !== 'ACTIVE') return 'DECLINED_CARD_INACTIVE';
  const credit = l.refundsReleaseLimit ? l.refunded : 0;
  return l.settled + l.reserved + amount - credit > l.monthlyLimit ? 'DECLINED_LIMIT_EXCEEDED' : 'AUTHORIZED';
}

// Anwendung einer Autorisierung auf den Zustand (für Tests und Simulation in der Sandbox).
export function authorize(l: LimitState, status: CardStatus, amount: Cents): { result: AuthResult; next: LimitState } {
  const result = decide(l, status, amount);
  return { result, next: result === 'AUTHORIZED' ? { ...l, reserved: l.reserved + amount } : l };
}
export const settle = (l: LimitState, amount: Cents): LimitState => ({ ...l, reserved: Math.max(0, l.reserved - amount), settled: l.settled + amount });
export const release = (l: LimitState, amount: Cents): LimitState => ({ ...l, reserved: Math.max(0, l.reserved - amount) });
export const refund = (l: LimitState, amount: Cents): LimitState => ({ ...l, refunded: l.refunded + amount });

// Erlaubte Monatslimits: Charge höchstens bis zur Sicherheitskaution, Debit ohne Kaution (Guthaben entscheidet).
export const LIMIT_STEPS: Cents[] = [50_000, 75_000, 100_000];
export function limitAllowed(type: 'debit' | 'charge' | 'business', newLimit: Cents, deposit: Cents): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(newLimit) || newLimit < 0) return { ok: false, reason: 'Bitte einen gültigen Betrag angeben.' };
  if (newLimit > 5_000_000) return { ok: false, reason: 'Das Limit liegt über dem zulässigen Höchstwert.' };
  if (type === 'charge' && newLimit > deposit) return { ok: false, reason: 'Das Monatslimit darf die hinterlegte Sicherheitskaution nicht übersteigen.' };
  return { ok: true };
}

// Nächster Abrechnungs-Reset: Monatsanfang in Europe/Berlin, als UTC-Zeitpunkt.
export function nextReset(at = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(at);
  const y = Number(parts.find((p) => p.type === 'year')!.value), m = Number(parts.find((p) => p.type === 'month')!.value);
  const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
  // Mitternacht Berlin = 23:00 bzw. 22:00 UTC am Vortag; Versatz über Mittagszeit ermitteln.
  const noon = new Date(Date.UTC(ny, nm - 1, 1, 12));
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hour12: false }).format(noon));
  return new Date(Date.UTC(ny, nm - 1, 1, 0) - (h - 12) * 3_600_000);
}
