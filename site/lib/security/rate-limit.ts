// Einfache Begrenzung je Schlüssel und Zeitfenster (pro Serverinstanz).
type Entry = { count: number; resetAt: number; logged?: boolean };

const buckets = new Map<string, Entry>();
const MAX_KEYS = 5000;
let lastSweep = 0;

// Abgelaufene Einträge entfernen, damit die Tabelle bei langer Laufzeit nicht wächst.
function sweep(now: number) {
  if (now - lastSweep < 60_000 && buckets.size < MAX_KEYS) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  // Notbremse bei sehr vielen aktiven Schlüsseln: älteste zuerst verwerfen.
  if (buckets.size >= MAX_KEYS) {
    const drop = buckets.size - MAX_KEYS + 500;
    let i = 0;
    for (const k of buckets.keys()) {
      if (i++ >= drop) break;
      buckets.delete(k);
    }
  }
}

export function allowRequest(key: string, limit = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  sweep(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= limit) {
    // Erste Drosselung je Fenster ins Sicherheitsprotokoll (nachgeladen, damit die Begrenzung selbst ohne Datenbank funktioniert).
    if (!current.logged) {
      current.logged = true;
      import('@/lib/security/seclog').then((m) => m.logSecurity('rate_limit', key), () => null);
    }
    return false;
  }
  current.count += 1;
  return true;
}
