import type { Instrumentation } from 'next';

// Jeder unbehandelte Serverfehler (Schnittstellen, Seiten) geht automatisch an die HQ-Mitarbeiter (Tyler),
// nicht nur in die Vercel-Logs. Nur im Node-Laufzeitbereich; der Kunde wartet dadurch nicht länger.
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const path = String(request.path || '/').replace(/[?#].*$/, '');
  // Eigene Prüfläufe (Optimierung, Darstellungsprüfung) erzeugen gezielt 404-Antworten – kein Fehler.
  if (/\/_next\/|\.(map|ico|png|txt)$/.test(path)) return;
  const { reportServerError } = await import('@/lib/admin/server-error');
  await reportServerError(`unbehandelt_${context.routeType}`, err, path, 'fehler');
};
