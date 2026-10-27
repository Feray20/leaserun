import { createHash } from 'node:crypto';
import { validateUpload } from '@/lib/security/file-validation';
import { staticScan, threatMessage } from '@/lib/security/filescan';

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Direkt-Upload über die Funktion (Vercel-Grenze rund 4,5 MB)
export const MAX_DIRECT_BYTES = 50 * 1024 * 1024; // Upload per signierter URL direkt in den Speicher
export const MAX_DOCUMENTS_PER_USER = 60;

export const CATEGORIES = ['objekt', 'miete', 'weg', 'grundbuch', 'technik', 'finanzen', 'steuer'] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  objekt: 'Objekt (Exposé, Grundrisse, Flächen)',
  miete: 'Miete (Mietverträge, Nachträge)',
  weg: 'WEG (Teilungserklärung, Protokolle, Wirtschaftsplan)',
  grundbuch: 'Grundbuch und Flurkarte',
  technik: 'Technik (Energieausweis, Gutachten)',
  finanzen: 'Private Finanzen (Einkommen, Eigenkapital)',
  steuer: 'Steuer (Bescheide, BWA)',
};
export const isCategory = (v: unknown): v is Category => typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);

// Dateityp anhand der ersten Bytes erkennen (Magic Bytes), unabhängig von Dateiname und Browser-Angabe.
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
      EMPTY_FILE: 'Die Datei ist leer.',
      TOO_LARGE: `Die Datei ist größer als ${Math.round(maxBytes / 1048576)} MB.`,
      MIME_NOT_ALLOWED: 'Erlaubt sind PDF, JPG, PNG und TIFF.',
      SIGNATURE_MISMATCH: 'Der Dateiinhalt passt zu keinem erlaubten Format (PDF, JPG, PNG, TIFF).',
    };
    return { ok: false, reason: msg[result.reason ?? 'SIGNATURE_MISMATCH'] ?? 'Datei abgelehnt.' };
  }
  // Virenprüfung (statisch): Skripte, Programmstarts, eingebettete Dateien, versteckte Programme.
  const scan = staticScan(bytes);
  if (!scan.clean) return { ok: false, reason: threatMessage(scan) };
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { ok: true, file: { bytes, mime: detected.mime, ext: detected.ext, sha256, size: bytes.length } };
}

export const safeFilename = (name: string) =>
  name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 140) || 'dokument';
