import { createHash } from "node:crypto";
export interface BankPackageManifest { version:string; generatedAt:string; pages:number; sourceDocumentIds:string[]; calculationIds:string[]; pdfSha256?:string; }
export function sha256Buffer(data:Buffer){return createHash("sha256").update(data).digest("hex");}
export function buildManifest(input:Omit<BankPackageManifest,"pdfSha256">):BankPackageManifest{return {...input};}
