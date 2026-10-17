export type EvidenceStatus = "VERIFIED" | "REVIEW_REQUIRED" | "CONFLICT";

export interface EvidenceRef {
  id: string;
  documentId: string;
  page?: number;
  field: string;
  confidence: number;
  extractionMethod: "OCR" | "MANUAL" | "IMPORT" | "AI_EXTRACTION";
  excerptHash?: string;
  status: EvidenceStatus;
}

export interface EvidenceValue<T> {
  value: T;
  evidence: EvidenceRef[];
  status: EvidenceStatus;
}

export const EVIDENCE_REVIEW_THRESHOLD = 0.85;

export function evidenceStatus(confidence: number): EvidenceStatus {
  return confidence >= EVIDENCE_REVIEW_THRESHOLD ? "VERIFIED" : "REVIEW_REQUIRED";
}
