export interface TrainingLesson{scenario:string;question:string;answer:string;explanation:string;primarySources:string[];calculation?:string;practicalExercise:string;}
export const CURRICULUM=["Fundament + KI-Ingestion","Due Diligence","Notar + Finanzierung","Steuer","15-%-Management","Miete","WEG","Energie","Mietermanagement","Refinanzierung","Strukturierung","Exit"] as const;
