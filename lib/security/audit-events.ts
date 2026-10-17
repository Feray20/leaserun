export type AuditEventType="share_created"|"share_opened"|"document_viewed"|"document_downloaded"|"permission_changed"|"share_revoked"|"share_expired"|"pdf_generated"|"pdf_downloaded";
export interface AuditEvent{eventType:AuditEventType;actorUserId?:string;entityType?:string;entityId?:string;metadata:Record<string,unknown>;createdAt:string;}
export function sanitizeAuditMetadata(input:Record<string,unknown>){const blocked=new Set(["password","token","secret","accessToken","refreshToken","documentContent"]);return Object.fromEntries(Object.entries(input).filter(([k])=>!blocked.has(k)));}
