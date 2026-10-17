export type IngestionStage = "UPLOAD" | "VALIDATE" | "HASH" | "OCR" | "CLASSIFY" | "EXTRACT" | "EVIDENCE" | "CROSS_VALIDATE" | "REVIEW" | "COMPLETE" | "FAILED";
export interface IngestionJob { id:string; documentId:string; stage:IngestionStage; progress:number; errorCode?:string; errorMessage?:string; startedAt?:string; completedAt?:string; }
export interface ExtractionCandidate<T=unknown> { field:string; value:T; confidence:number; page?:number; evidenceId?:string; reviewRequired:boolean; }
export function requiresReview(confidence:number, threshold=0.85){ return confidence < threshold; }
