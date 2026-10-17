export interface OcrPage { page:number; text:string; confidence:number; }
export interface DocumentClassification { kind:string; confidence:number; reviewRequired:boolean; }
export interface OcrResult { documentId:string; pages:OcrPage[]; language:string; classification?:DocumentClassification; completedAt:string; }
export function ocrNeedsReview(confidence:number, threshold=0.85){ return confidence < threshold; }
