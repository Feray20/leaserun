// Edge-Bereich (Middleware): Serverfehler werden hier nicht gemeldet – die echte Fassung (lib/admin/server-error.ts)
// braucht die Datenbank und läuft nur im Node-Bereich. next.config.js tauscht die Datei für den Edge-Build aus.
export type ServerErrorLevel = 'fehler' | 'ausweichen';
export async function reportServerError(_tag: string, _e: unknown, _path: string, _level: ServerErrorLevel = 'fehler'): Promise<void> { void _tag; void _e; void _path; void _level; }
