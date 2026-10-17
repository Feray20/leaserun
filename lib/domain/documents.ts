export type DocumentKind='expose'|'lease'|'weg_minutes'|'economic_plan'|'land_register'|'energy_certificate'|'tax_notice'|'income_proof'|'division_declaration'|'other';
export type EvidenceRef={documentId:string;page?:number;field?:string;excerptHash?:string};
export type ExtractedField<T=unknown>={value:T;confidence:number;source:EvidenceRef};
export type DocumentRecord={id:string;kind:DocumentKind;fileName:string;sha256:string;mimeType:string;status:'uploaded'|'ocr'|'extracted'|'validated'|'rejected';fields:Record<string,ExtractedField>;createdAt:string};
export function assertConfidence(field:ExtractedField,min=0.85){if(field.confidence<0||field.confidence>1)throw new Error('invalid_confidence');return field.confidence>=min;}
