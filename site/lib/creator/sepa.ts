// SEPA-Sammelüberweisung (pain.001.001.09) für freigegebene Creator-Auszahlungen.
// Die Datei wird im Online-Banking hochgeladen und dort freigegeben – LeaseRun löst selbst keine Zahlung aus.

export type SepaDebtor = { name: string; iban: string; bic?: string | null };
export type SepaPayment = { endToEndId: string; name: string; iban: string; bic?: string | null; amountCents: number; remittance: string };

// Zulässiger SEPA-Zeichensatz (lateinische Grundzeichen); Umlaute werden umschrieben.
export function sepaText(s: string, max: number): string {
  const map: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', é: 'e', è: 'e', á: 'a', à: 'a', ç: 'c', ñ: 'n' };
  return s.replace(/[äöüÄÖÜßéèáàçñ]/g, (c) => map[c] ?? c).replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const amount = (c: number) => (c / 100).toFixed(2);

export function painXml(o: { msgId: string; createdAt: Date; executionDate: string; debtor: SepaDebtor; payments: SepaPayment[] }): string {
  if (!o.payments.length) throw new Error('sepa_empty');
  if (!/^[A-Za-z0-9\-]{1,35}$/.test(o.msgId)) throw new Error('sepa_msgid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.executionDate)) throw new Error('sepa_date');
  for (const p of o.payments) {
    if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw new Error('sepa_amount');
    if (!/^[A-Za-z0-9\-]{1,35}$/.test(p.endToEndId)) throw new Error('sepa_e2e');
  }
  const sum = o.payments.reduce((a, p) => a + p.amountCents, 0);
  const agt = (bic?: string | null) => (bic ? `<FinInstnId><BICFI>${xml(bic)}</BICFI></FinInstnId>` : '<FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId>');
  const tx = o.payments.map((p) => `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${xml(p.endToEndId)}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${amount(p.amountCents)}</InstdAmt></Amt>
        ${p.bic ? `<CdtrAgt>${agt(p.bic)}</CdtrAgt>` : ''}
        <Cdtr><Nm>${xml(sepaText(p.name, 70))}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${xml(p.iban)}</IBAN></Id></CdtrAcct>
        <RmtInf><Ustrd>${xml(sepaText(p.remittance, 140))}</Ustrd></RmtInf>
      </CdtTrfTxInf>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.09">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${xml(o.msgId)}</MsgId>
      <CreDtTm>${o.createdAt.toISOString().slice(0, 19)}</CreDtTm>
      <NbOfTxs>${o.payments.length}</NbOfTxs>
      <CtrlSum>${amount(sum)}</CtrlSum>
      <InitgPty><Nm>${xml(sepaText(o.debtor.name, 70))}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${xml(o.msgId)}</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${o.payments.length}</NbOfTxs>
      <CtrlSum>${amount(sum)}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt><Dt>${o.executionDate}</Dt></ReqdExctnDt>
      <Dbtr><Nm>${xml(sepaText(o.debtor.name, 70))}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${xml(o.debtor.iban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt>${agt(o.debtor.bic)}</DbtrAgt>
      <ChrgBr>SLEV</ChrgBr>${tx}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>
`;
}
