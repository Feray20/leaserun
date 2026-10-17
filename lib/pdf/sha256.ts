import crypto from 'node:crypto';

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function assertPdf(bytes: Buffer): void {
  if (bytes.length < 5 || bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('invalid_pdf_output');
  }
}
