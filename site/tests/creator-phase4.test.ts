import test from 'node:test';
import assert from 'node:assert/strict';
import { partialClawback, reducedBase, refundedNetTotal } from '../lib/creator/billing';
import { matchPayouts, parseCamt053, payoutEndToEnd, type OpenPayout } from '../lib/creator/camt';
import { painXml } from '../lib/creator/sepa';
import { readyMail, reminderMail } from '../lib/creator/mails';

test('Teilerstattung: anteilig netto, vollständig = ganzer Netto-Betrag', () => {
  assert.equal(refundedNetTotal(4118, 4900, 2450), 2059);   // halbe Erstattung
  assert.equal(refundedNetTotal(4118, 4900, 4900), 4118);   // voll
  assert.equal(refundedNetTotal(4118, 4900, 9999), 4118);   // nie mehr als netto
  assert.equal(refundedNetTotal(4118, 4900, 0), 0);
  assert.equal(reducedBase(4118, 2059), 2059);
  assert.equal(reducedBase(4118, 9000), 0);
});

test('Rückforderung nach Abschluss: anteilig und nie mehr als die Provision', () => {
  // Provision 824 auf Grundlage 4118; halbe Erstattung → 412
  assert.equal(partialClawback(824, 4118, 2059, 0), 412);
  // zweite Teilerstattung über den Rest: gedeckelt auf die verbleibende Provision
  assert.equal(partialClawback(824, 4118, 2059, 412), 412);
  assert.equal(partialClawback(824, 4118, 4118, 824), 0);
  assert.equal(partialClawback(0, 4118, 100, 0), 0);
  assert.equal(partialClawback(824, 0, 100, 0), 0);
});

const P1 = '11111111-2222-4333-8444-555555555555', P2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', P3 = '99999999-8888-4777-8666-555555555555';
const open: OpenPayout[] = [
  { id: P1, amount_cents: 4635, reference: 'LeaseRun Creator 2026-10 CR-2026-001', status: 'EXPORTED' },
  { id: P2, amount_cents: 30369, reference: 'LeaseRun Creator 2026-10 GS-2026-00001', status: 'EXPORTED' },
  { id: P3, amount_cents: 9500, reference: 'LeaseRun Creator 2026-10 GS-2026-00002', status: 'EXPORTED' },
];

// camt.053.001.08 mit Sammelbuchung (eine Belastung, mehrere Einzelumsätze) und einer Rücküberweisung
const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><GrpHdr><MsgId>M1</MsgId></GrpHdr>
<Stmt><Id>2026-11-20-001</Id><Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>
 <Ntry><Amt Ccy="EUR">350.04</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-11-20</Dt></BookgDt><AcctSvcrRef>BANK-1</AcctSvcrRef>
  <NtryDtls><Btch><NbOfTxs>2</NbOfTxs></Btch>
   <TxDtls><Refs><EndToEndId>${payoutEndToEnd(P1)}</EndToEndId></Refs><Amt Ccy="EUR">46.35</Amt><RmtInf><Ustrd>LeaseRun Creator 2026-10 CR-2026-001</Ustrd></RmtInf></TxDtls>
   <TxDtls><Refs><EndToEndId>${payoutEndToEnd(P2)}</EndToEndId></Refs><AmtDtls><InstdAmt><Amt Ccy="EUR">303.69</Amt></InstdAmt></AmtDtls><RmtInf><Ustrd>LeaseRun Creator 2026-10 GS-2026-00001</Ustrd></RmtInf></TxDtls>
  </NtryDtls></Ntry>
 <Ntry><Amt Ccy="EUR">95.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-11-22</Dt></BookgDt>
  <NtryDtls><TxDtls><Refs><EndToEndId>${payoutEndToEnd(P3)}</EndToEndId></Refs><RmtInf><Ustrd>RETOURE AC04 LeaseRun Creator 2026-10 GS-2026-00002</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
 <Ntry><Amt Ccy="EUR">12.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts><BookgDt><Dt>2026-11-21</Dt></BookgDt><NtryDtls><TxDtls><RmtInf><Ustrd>Kontofuehrung</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;

test('camt.053: Sammelbuchung, Beträge je Umsatz, Buchungsdatum, Konto', () => {
  const st = parseCamt053(camt);
  assert.equal(st.id, '2026-11-20-001');
  assert.equal(st.ibanLast4, '3000');
  assert.equal(st.transactions.length, 4);
  assert.deepEqual(st.transactions.slice(0, 2).map((t) => t.amountCents), [4635, 30369]);
  assert.equal(st.transactions[0].bookingDate, '2026-11-20');
  assert.equal(st.transactions[0].bankRef, 'BANK-1');
  assert.equal(st.transactions[2].direction, 'CRDT');
});

test('Abgleich: Referenz der SEPA-Datei, Rückläufer werden nicht übernommen, Fremdbuchungen ignoriert', () => {
  const r = matchPayouts(parseCamt053(camt).transactions, open);
  assert.deepEqual(r.matches.map((m) => m.payout_id).sort(), [P1, P2].sort());
  assert.ok(r.matches.every((m) => m.via === 'end_to_end' && m.booking_date === '2026-11-20'));
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].kind, 'returned');
  assert.equal(r.issues[0].payout_id, P3);
  assert.equal(r.unrelated, 1);
});

test('Abgleich: ohne Ende-zu-Ende-Referenz über Verwendungszweck + Betrag; abweichender Betrag wird gemeldet', () => {
  const tx = (amt: number, ustrd: string, e2e: string | null = null) => ({ amountCents: amt, currency: 'EUR', direction: 'DBIT' as const, reversal: false, booked: true, bookingDate: '2026-11-20', endToEndId: e2e, remittance: ustrd, bankRef: null });
  const r = matchPayouts([tx(4635, 'LEASERUN CREATOR 2026-10 CR-2026-001')], open);
  assert.equal(r.matches[0]?.via, 'reference');
  const wrong = matchPayouts([tx(4600, '', payoutEndToEnd(P1))], open);
  assert.equal(wrong.matches.length, 0);
  assert.equal(wrong.issues[0].kind, 'amount_mismatch');
  // gleicher Betrag, aber anderer Verwendungszweck → keine Zuordnung
  assert.equal(matchPayouts([tx(4635, 'Miete November')], open).matches.length, 0);
  // vorgemerkte (nicht gebuchte) Umsätze werden nicht übernommen
  assert.equal(matchPayouts([{ ...tx(4635, '', payoutEndToEnd(P1)), booked: false }], open).issues[0].kind, 'not_booked');
});

test('camt.053: unsichere oder fremde Dateien werden abgelehnt', () => {
  assert.throws(() => parseCamt053('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Document>&e;</Document>'), /camt_doctype/);
  assert.throws(() => parseCamt053('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09"><CstmrCdtTrfInitn/></Document>'), /camt_format/);
  assert.throws(() => parseCamt053(''), /camt_empty/);
});

test('Referenz aus dem SEPA-Export ist im Kontoauszug wiederzuerkennen', () => {
  const x = painXml({ msgId: 'IA-CR-1', createdAt: new Date('2026-11-18T10:00:00Z'), executionDate: '2026-11-19', debtor: { name: 'LeaseRun', iban: 'DE89370400440532013000' },
    payments: [{ endToEndId: payoutEndToEnd(P1), name: 'Nahim Sky', iban: 'DE02120300000000202051', amountCents: 4635, remittance: open[0].reference }] });
  assert.ok(x.includes(`<EndToEndId>${payoutEndToEnd(P1)}</EndToEndId>`));
  assert.ok(payoutEndToEnd(P1).length <= 35);
});

test('E-Mails: Rechnungs-Creator werden zur Rechnung geführt, Gutschrift-Creator müssen nichts tun', () => {
  const inv = readyMail('INVOICE', '2026-10', 4635, 'Nahim');
  assert.match(inv.subject, /Oktober 2026/);
  assert.match(inv.text, /Rechnung/);
  assert.match(inv.text, /46,35/);
  assert.match(readyMail('CREDIT_NOTE', '2026-10', 9500, 'Max').text, /Du musst nichts tun/);
  assert.match(reminderMail('2026-10', 'Nahim').text, /noch keine Rechnung/);
  for (const m of [inv, reminderMail('2026-10', 'X')]) assert.doesNotMatch(m.text, /DE\d{2}\d{4,}/); // keine IBAN in Mails
});

test('Abgleich: Rückläufer einer bereits bezahlten Auszahlung wird erkannt, nie erneut als bezahlt', () => {
  const paid = [{ ...open[0], status: 'PAID' }];
  const tx = (dir: 'DBIT' | 'CRDT', e2e: string | null, ustrd = '') => ({ amountCents: 4635, currency: 'EUR', direction: dir, reversal: false, booked: true, bookingDate: '2026-11-25', endToEndId: e2e, remittance: ustrd, bankRef: null });
  const r = matchPayouts([tx('CRDT', payoutEndToEnd(P1))], [], paid);
  assert.equal(r.issues[0]?.kind, 'returned');
  assert.equal(r.issues[0]?.payout_id, P1);
  const viaText = matchPayouts([tx('CRDT', null, 'RETOURE AC04 LeaseRun Creator 2026-10 CR-2026-001')], [], paid);
  assert.equal(viaText.issues[0]?.payout_id, P1);
  // dieselbe Belastung erneut eingelesen → keine zweite Bezahlt-Meldung
  const again = matchPayouts([tx('DBIT', payoutEndToEnd(P1))], [], paid);
  assert.equal(again.matches.length, 0);
  assert.equal(again.unrelated, 1);
});
