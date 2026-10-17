export type AuditEvent={id:string;actorId?:string;entityType:string;entityId:string;action:string;timestamp:string;metadata:Record<string,unknown>;previousEventHash?:string;eventHash:string};
