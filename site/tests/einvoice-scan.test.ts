import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staticScan } from '../lib/security/filescan.ts';

// Malware scan of attachments (mailbox, support uploads): PDFs with embedded files are blocked.
// The allowEInvoice exception (embedded e-invoice XML, a German/EU tax format) is never used by the LeaseRun mailbox;
// these tests only make sure the exception stays narrow wherever it might still be used.
const pdf = (body: string) => Buffer.from(`%PDF-1.7\n1 0 obj << /Type /Catalog /Names << /EmbeddedFiles 2 0 R >> >> endobj\n${body}\n%%EOF`, 'latin1');
test('PDF with embedded XML is blocked by default (mailbox setting)', () => {
  const b = pdf('3 0 obj << /Type /Filespec /F (factur-x.xml) /UF (factur-x.xml) /EF << /F 4 0 R >> >> endobj');
  assert.equal(staticScan(b).clean, false);
  assert.equal(staticScan(b, { allowEInvoice: true }).clean, true);
});
test('other embedded files stay blocked', () => {
  const b = pdf('3 0 obj << /Type /Filespec /F (invoice.exe) /EF << /F 4 0 R >> >> endobj');
  assert.equal(staticScan(b, { allowEInvoice: true }).clean, false);
});
test('e-invoice with JavaScript stays blocked', () => {
  const b = pdf('3 0 obj << /Type /Filespec /F (factur-x.xml) >> endobj 5 0 obj << /S /JavaScript /JS (app.alert(1)) >> endobj');
  assert.equal(staticScan(b, { allowEInvoice: true }).clean, false);
});
test('any invoice XML name allowed in the exception, but not .xml.exe', () => {
  assert.equal(staticScan(pdf('3 0 obj << /Type /Filespec /F (invoice_2026.xml) >> endobj'), { allowEInvoice: true }).clean, true);
  assert.equal(staticScan(pdf('3 0 obj << /Type /Filespec /F (a.xml.exe) >> endobj'), { allowEInvoice: true }).clean, false);
});
