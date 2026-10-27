// Fristen für E-Mail-Erinnerungen (gleiche Datumslogik wie public/src/calc.mjs → fristen()).
const DAY = 86_400_000;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
function addMonths(d: Date, n: number): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate();
  x.setUTCDate(Math.min(d.getUTCDate(), last));
  return x;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ReminderObject = { id?: unknown; name?: unknown; purchaseDate?: unknown; payoutDate?: unknown; fixedYears?: unknown };
export type Deadline = { kind: string; title: string; due: string; thresholds: number[]; detail: string; source: string };

export function deadlinesFor(o: ReminderObject): Deadline[] {
  const out: Deadline[] = [];
  const purchase = typeof o.purchaseDate === 'string' && DATE_RE.test(o.purchaseDate) ? parse(o.purchaseDate) : null;
  const payout = typeof o.payoutDate === 'string' && DATE_RE.test(o.payoutDate) ? parse(o.payoutDate) : purchase;
  const fixed = Number(o.fixedYears) || 0;
  if (purchase) {
    out.push({ kind: 'frist15', title: 'Ende der 15-%-Frist für Instandsetzungen', due: iso(addMonths(purchase, 36)), thresholds: [90, 30],
      detail: 'Bis zu diesem Datum zählen Instandsetzungskosten (netto) für die 15-%-Grenze der Gebäude-Anschaffungskosten.', source: '§ 6 Abs. 1 Nr. 1a EStG' });
    out.push({ kind: 'spekulation', title: 'Verkauf ohne Spekulationssteuer möglich', due: iso(new Date(addMonths(purchase, 120).getTime() + DAY)), thresholds: [30],
      detail: 'Ab diesem Tag liegen mehr als zehn Jahre zwischen Kauf- und Verkaufsvertrag.', source: '§ 23 Abs. 1 Satz 1 Nr. 1 EStG' });
  }
  if (payout && fixed > 0) {
    out.push({ kind: 'zinsbindung', title: 'Ende der Zinsbindung', due: iso(addMonths(payout, Math.round(fixed * 12))), thresholds: [365, 180, 90, 30],
      detail: 'Ab diesem Datum gilt ein neuer Zinssatz. Angebote für die Anschlussfinanzierung rechtzeitig einholen und die Restschuld prüfen.', source: 'Darlehensvertrag' });
    if (fixed > 10) {
      out.push({ kind: 'kuendigung489', title: 'Kündigungsrecht nach zehn Jahren', due: iso(addMonths(payout, 120)), thresholds: [60, 14],
        detail: 'Bei Zinsbindung über zehn Jahre kann das Darlehen zehn Jahre nach vollständigem Empfang mit sechs Monaten Frist gekündigt werden.', source: '§ 489 Abs. 1 Nr. 2 BGB' });
    }
  }
  return out;
}

// Fällige Erinnerung: kleinste Schwelle, die erreicht ist (Frist noch nicht vorbei).
export function dueThreshold(d: Deadline, today: Date): { threshold: number; daysLeft: number } | null {
  const daysLeft = Math.round((parse(d.due).getTime() - Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / DAY);
  if (daysLeft < 0) return null;
  const hit = [...d.thresholds].sort((a, b) => a - b).find((t) => daysLeft <= t);
  return hit === undefined ? null : { threshold: hit, daysLeft };
}
