import { createHash } from 'node:crypto';
import { validateUpload } from '@/lib/security/file-validation';
import { staticScan, threatMessage } from '@/lib/security/filescan';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Direct upload through the function (Vercel limit around 4.5 MB)
export const MAX_DIRECT_BYTES = 50 * 1024 * 1024; // Upload via signed URL directly into storage
export const MAX_DOCUMENTS_PER_USER = 60;

// US document categories offered for upload, data-room sharing and requests (in display order).
// Requires the DB check constraints on lr_documents.category / lr_document_requests.category to allow these keys.
export const CURRENT_CATEGORIES = ['id', 'pay_stubs', 'w2', 'form_1099', 'tax_returns', 'bank_statements', 'purchase_agreement', 'leases', 'insurance', 'llc', 'appraisal', 'inspection', 'hoa', 'title', 'other'] as const;
// Legacy keys from the original data model: still accepted and readable (existing rows/shares, older clients), not offered in new UI.
export const LEGACY_CATEGORIES = ['objekt', 'miete', 'weg', 'grundbuch', 'technik', 'finanzen', 'steuer'] as const;
export type CurrentCategory = (typeof CURRENT_CATEGORIES)[number];
export type Category = CurrentCategory | (typeof LEGACY_CATEGORIES)[number];
// Display order: US categories first, then legacy keys (so existing documents still sort and show).
export const CATEGORIES: readonly Category[] = [...CURRENT_CATEGORIES, ...LEGACY_CATEGORIES];
// zod-friendly tuple of every accepted key.
export const ALL_CATEGORY_KEYS = [...CURRENT_CATEGORIES, ...LEGACY_CATEGORIES] as [Category, ...Category[]];
export const CATEGORY_LABEL: Record<Category, string> = {
  id: 'ID (driver’s license, passport)',
  pay_stubs: 'Pay stubs',
  w2: 'W-2 forms',
  form_1099: '1099 forms',
  tax_returns: 'Tax returns',
  bank_statements: 'Bank statements',
  purchase_agreement: 'Purchase agreement',
  leases: 'Leases',
  insurance: 'Insurance (homeowners / landlord policy)',
  llc: 'LLC documents',
  appraisal: 'Appraisal',
  inspection: 'Inspection report',
  hoa: 'HOA documents',
  title: 'Title documents',
  other: 'Other',
  // legacy
  objekt: 'Property (listing, floor plans)',
  miete: 'Leases',
  weg: 'HOA documents',
  grundbuch: 'Title documents',
  technik: 'Inspection report',
  finanzen: 'Personal finances',
  steuer: 'Tax returns',
};
// Accepted category (US or legacy).
export const isCategory = (v: unknown): v is Category => typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
// One of the US categories offered in the UI.
export const isCurrentCategory = (v: unknown): v is CurrentCategory => typeof v === 'string' && (CURRENT_CATEGORIES as readonly string[]).includes(v);
// Categories whose sharing also shows the property data (price, rent, loan) in the data room.
export const PROPERTY_DATA_CATEGORIES: readonly Category[] = ['purchase_agreement', 'appraisal', 'leases', 'objekt'];

// Detect the file type from the first bytes (magic bytes), regardless of file name and browser claim.
export function detectMime(b: Uint8Array): { mime: string; ext: string } | null {
  const starts = (sig: number[], off = 0) => sig.every((v, i) => b[off + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' };
  if (starts([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a])) return { mime: 'image/tiff', ext: 'tif' };
  return null;
}

export type CheckedFile = { bytes: Buffer; mime: string; ext: string; sha256: string; size: number };

export function checkFile(bytes: Buffer, declaredMime: string, maxBytes = MAX_UPLOAD_BYTES): { ok: true; file: CheckedFile } | { ok: false; reason: string } {
  const detected = detectMime(bytes);
  const result = validateUpload({
    mimeType: detected?.mime ?? declaredMime,
    sizeBytes: bytes.length,
    maxBytes,
    signatureMatches: detected !== null,
  });
  if (!result.valid || !detected) {
    const msg: Record<string, string> = {
      EMPTY_FILE: 'The file is empty.',
      TOO_LARGE: `The file is larger than ${Math.round(maxBytes / 1048576)} MB.`,
      MIME_NOT_ALLOWED: 'Allowed formats: PDF, JPG, PNG and TIFF.',
      SIGNATURE_MISMATCH: 'The file content doesn’t match an allowed format (PDF, JPG, PNG, TIFF).',
    };
    return { ok: false, reason: msg[result.reason ?? 'SIGNATURE_MISMATCH'] ?? 'File rejected.' };
  }
  // Malware check (static): scripts, program launches, embedded files, hidden executables.
  const scan = staticScan(bytes);
  if (!scan.clean) return { ok: false, reason: threatMessage(scan) };
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { ok: true, file: { bytes, mime: detected.mime, ext: detected.ext, sha256, size: bytes.length } };
}

export const safeFilename = (name: string) =>
  name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140) || 'document';
