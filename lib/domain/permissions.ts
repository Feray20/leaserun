export type DataRoomArea="PROPERTY"|"FINANCING"|"LEASE"|"WEG"|"LAND_REGISTER"|"TECHNICAL"|"PRIVATE_FINANCE"|"TAX";
export type DataRoomAction="VIEW"|"DOWNLOAD"|"SHARE";
export interface PermissionGrant{subjectId:string;area:DataRoomArea;actions:DataRoomAction[];expiresAt?:string;}
