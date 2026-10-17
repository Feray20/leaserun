export interface SourceReference{id:string;title:string;authority:string;url?:string;checkedAt:string;version?:string;}
export const CRITICAL_SOURCES=["BGB §556d","BGB §556f","BGB §557b","EStG §6 Abs.1 Nr.1a","EStG §7","EStG §23","WEG","GModG (vormals GEG)","PfandBG","BelWertV","MaRisk","KWG"] as const;
