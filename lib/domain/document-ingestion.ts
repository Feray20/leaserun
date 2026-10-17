export type DocumentKind='expose'|'lease'|'declaration_of_division'|'weg_minutes'|'economic_plan'|'land_register'|'energy_certificate'|'tax_notice'|'income_proof'|'other';
export type ExtractedField={key:string;value:string|number|null;confidence:number;sourcePage?:number;sourceText?:string};
export type IngestedDocument={id:string;kind:DocumentKind;filename:string;sha256:string;mimeType:string;pages:number;fields:ExtractedField[];status:'uploaded'|'ocr_complete'|'classified'|'validated'|'rejected'};
export function assertConfidence(v:number){if(v<0||v>1)throw new Error('invalid_confidence');return v;}
