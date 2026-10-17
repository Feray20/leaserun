export interface EvidenceRef{documentId:string;page:number;field:string;confidence:number;snippetHash:string;}
export interface EvidenceValue<T=unknown>{value:T;evidence:EvidenceRef;}
export function assertCriticalEvidence<T>(v:EvidenceValue<T>,threshold=.85){if(v.evidence.confidence<threshold)throw new Error("REVIEW_REQUIRED");return v.value;}
