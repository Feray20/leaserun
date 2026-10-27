import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticScan } from '../lib/security/filescan.ts';

const pdf = (body: string) => Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog /Names << /EmbeddedFiles 2 0 R >> >> endobj\n${body}\n%%EOF`, 'latin1');
test('ZUGFeRD-Rechnung erlaubt nur im Beleg-Modus', () => {
  const b = pdf('3 0 obj << /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /EF << /F 4 0 R >> >> endobj');
  assert.equal(staticScan(b).clean, false);
  assert.equal(staticScan(b, { allowEInvoice: true }).clean, true);
});
test('andere eingebettete Datei bleibt gesperrt', () => {
  const b = pdf('3 0 obj << /Type /Filespec /F (rechnung.exe) /EF << /F 4 0 R >> >> endobj');
  assert.equal(staticScan(b, { allowEInvoice: true }).clean, false);
});
test('E-Rechnung mit JavaScript bleibt gesperrt', () => {
  const b = pdf('3 0 obj << /Type /Filespec /F (factur-x.xml) >> endobj 5 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj');
  assert.equal(staticScan(b, { allowEInvoice: true }).clean, false);
});
test('beliebig benannte Rechnungs-XML erlaubt, aber nicht .xml.exe', () => {
  assert.equal(staticScan(pdf('3 0 obj << /Type /Filespec /F (invoice_2026.xml) >> endobj'), { allowEInvoice: true }).clean, true);
  assert.equal(staticScan(pdf('3 0 obj << /Type /Filespec /F (a.xml.exe) >> endobj'), { allowEInvoice: true }).clean, false);
});
