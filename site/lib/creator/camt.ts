// Kontoauszug (camt.053, ISO 20022) lesen und mit exportierten Creator-Auszahlungen abgleichen.
// Bewusst ohne XML-Bibliothek: Es werden nur wenige, eindeutig benannte Elemente gelesen; DOCTYPE/Entitäten
// werden abgelehnt (kein Nachladen externer Inhalte). Die Datei stammt aus dem Online-Banking und wird nur gelesen.

export type CamtTx = {
  amountCents: number;
  currency: string;
  direction: 'DBIT' | 'CRDT';
  reversal: boolean;
  booked: boolean;
  bookingDate: string | null;   // JJJJ-MM-TT
  endToEndId: string | null;
  remittance: string;
  bankRef: string | null;
};
export type CamtStatement = { id: string | null; ibanLast4: string | null; transactions: CamtTx[] };

export const CAMT_MAX_BYTES = 3 * 1024 * 1024;

const tag = (name: string) => new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`, 'g');
function all(xml: string, name: string): string[] { return [...xml.matchAll(tag(name))].map((m) => m[1]); }
function first(xml: string, name: string): string | null { const m = tag(name).exec(xml); return m ? m[1] : null; }
function firstWithAttr(xml: string, name: string): { body: string; attrs: string } | null {
  const m = new RegExp(`<(?:[A-Za-z0-9_]+:)?${name}(\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${name}>`).exec(xml);
  return m ? { attrs: m[1] ?? '', body: m[2] } : null;
}
const text = (s: string | null) => (s ?? '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, ' ').trim();

function cents(v: string | null): number | null {
  const t = text(v);
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(t)) return null;
  const [eur, ct = ''] = t.split('.');
  return Number(eur) * 100 + Number((ct + '00').slice(0, 2));
}
function amountOf(xml: string): { cents: number | null; ccy: string } {
  const a = firstWithAttr(xml, 'Amt');
  if (!a) return { cents: null, ccy: 'EUR' };
  const ccy = /Ccy="([A-Z]{3})"/.exec(a.attrs)?.[1] ?? 'EUR';
  return { cents: cents(a.body), ccy };
}
function dateOf(xml: string | null): string | null {
  if (!xml) return null;
  const d = text(first(xml, 'Dt') ?? first(xml, 'DtTm') ?? xml).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

export function parseCamt053(xml: string): CamtStatement {
  if (typeof xml !== 'string' || !xml.trim()) throw new Error('camt_empty');
  if (Buffer.byteLength(xml, 'utf8') > CAMT_MAX_BYTES) throw new Error('camt_too_large');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('camt_doctype');
  if (!/camt\.053/.test(xml) && !/<(?:[A-Za-z0-9_]+:)?BkToCstmrStmt[\s>]/.test(xml)) throw new Error('camt_format');
  const stmts = all(xml, 'Stmt');
  if (!stmts.length) throw new Error('camt_format');
  const transactions: CamtTx[] = [];
  let id: string | null = null; let ibanLast4: string | null = null;
  for (const st of stmts) {
    id ??= text(first(st, 'Id')) || null;
    const acct = first(st, 'Acct');
    const iban = acct ? text(first(acct, 'IBAN')).replace(/\s+/g, '').toUpperCase() : '';
    if (iban) ibanLast4 ??= iban.slice(-4);
    for (const n of all(st, 'Ntry')) {
      const head = n.replace(tag('NtryDtls'), '');
      const amt = amountOf(head);
      const direction = text(first(head, 'CdtDbtInd')) === 'CRDT' ? 'CRDT' : 'DBIT';
      const reversal = text(first(head, 'RvslInd')).toLowerCase() === 'true';
      const sts = first(head, 'Sts');
      const booked = sts ? text(first(sts, 'Cd') ?? sts) === 'BOOK' : true;
      const bookingDate = dateOf(first(head, 'BookgDt')) ?? dateOf(first(head, 'ValDt'));
      const bankRef = text(first(head, 'AcctSvcrRef')) || null;
      const txs = all(n, 'TxDtls');
      const items = txs.length ? txs : [n];
      for (const t of items) {
        const own = txs.length ? (amountOf(first(t, 'AmtDtls') ?? '').cents ?? amountOf(t.replace(tag('RmtInf'), '').replace(tag('RltdPties'), '')).cents) : null;
        const value = own ?? (items.length === 1 ? amt.cents : null);
        if (value === null) continue;
        const refs = first(t, 'Refs');
        const e2e = refs ? text(first(refs, 'EndToEndId')) : '';
        const rmt = first(t, 'RmtInf');
        transactions.push({
          amountCents: value, currency: amt.ccy, direction, reversal, booked, bookingDate,
          endToEndId: e2e && e2e !== 'NOTPROVIDED' ? e2e : null,
          remittance: rmt ? all(rmt, 'Ustrd').map(text).join(' ').slice(0, 400) : '',
          bankRef,
        });
      }
    }
  }
  return { id, ibanLast4, transactions };
}

// ---------------- Abgleich ----------------
export type OpenPayout = { id: string; amount_cents: number; reference: string; status: string };
export type CamtMatch = { payout_id: string; amount_cents: number; booking_date: string | null; bank_ref: string | null; via: 'end_to_end' | 'reference' };
export type CamtIssue = { payout_id: string | null; kind: 'amount_mismatch' | 'returned' | 'not_booked'; amount_cents: number; booking_date: string | null; note: string };

// Die Ende-zu-Ende-Referenz entspricht dem SEPA-Export: „CR“ + die ersten 30 Hex-Zeichen der Auszahlungs-ID.
export const payoutEndToEnd = (payoutId: string) => `CR${payoutId.replace(/-/g, '').slice(0, 30)}`;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

// paid: bereits bezahlte Auszahlungen – nur für die Erkennung von Rückläufern (werden nie erneut als bezahlt erkannt).
export function matchPayouts(txs: CamtTx[], open: OpenPayout[], paid: OpenPayout[] = []): { matches: CamtMatch[]; issues: CamtIssue[]; unrelated: number } {
  const byE2e = new Map(open.map((p) => [payoutEndToEnd(p.id), p]));
  const paidE2e = new Map(paid.map((p) => [payoutEndToEnd(p.id), p]));
  const used = new Set<string>();
  const matches: CamtMatch[] = []; const issues: CamtIssue[] = [];
  let unrelated = 0;
  for (const t of txs) {
    if (t.currency !== 'EUR') { unrelated++; continue; }
    let p = t.endToEndId ? byE2e.get(t.endToEndId) : undefined;
    let via: CamtMatch['via'] = 'end_to_end';
    if (!p && t.remittance) {
      const r = norm(t.remittance);
      const cands = open.filter((x) => !used.has(x.id) && x.amount_cents === t.amountCents && norm(x.reference).length >= 6 && r.includes(norm(x.reference)));
      if (cands.length === 1) { p = cands[0]; via = 'reference'; }
    }
    if (!p && (t.direction === 'CRDT' || t.reversal)) {
      const q = (t.endToEndId ? paidE2e.get(t.endToEndId) : undefined)
        ?? (t.remittance ? paid.find((x) => x.amount_cents === t.amountCents && norm(x.reference).length >= 6 && norm(t.remittance).includes(norm(x.reference))) : undefined);
      if (q) { issues.push({ payout_id: q.id, kind: 'returned', amount_cents: t.amountCents, booking_date: t.bookingDate, note: 'Bereits bezahlte Auszahlung ist zurückgekommen.' }); continue; }
    }
    if (!p) { unrelated++; continue; }
    // Rückläufer: Gutschrift mit unserer Referenz oder stornierte Belastung
    if (t.direction === 'CRDT' || t.reversal) {
      issues.push({ payout_id: p.id, kind: 'returned', amount_cents: t.amountCents, booking_date: t.bookingDate, note: 'Zahlung zurückgekommen – Zahlungsdaten prüfen.' });
      continue;
    }
    if (!t.booked) { issues.push({ payout_id: p.id, kind: 'not_booked', amount_cents: t.amountCents, booking_date: t.bookingDate, note: 'Buchung noch nicht endgültig.' }); continue; }
    if (t.amountCents !== p.amount_cents) {
      issues.push({ payout_id: p.id, kind: 'amount_mismatch', amount_cents: t.amountCents, booking_date: t.bookingDate, note: 'Betrag weicht von der Auszahlung ab.' });
      continue;
    }
    if (used.has(p.id)) continue;
    used.add(p.id);
    matches.push({ payout_id: p.id, amount_cents: t.amountCents, booking_date: t.bookingDate, bank_ref: t.bankRef, via });
  }
  // Ein Rückläufer hebt eine Übereinstimmung derselben Auszahlung auf.
  const returned = new Set(issues.filter((i) => i.kind === 'returned').map((i) => i.payout_id));
  return { matches: matches.filter((m) => !returned.has(m.payout_id)), issues, unrelated };
}
