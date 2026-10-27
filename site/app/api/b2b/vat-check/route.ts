import { json, requireMember } from '@/lib/b2b/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// USt-IdNr. des eigenen Unternehmens beim EU-System VIES prüfen (Mehrwertsteuer-Informationsaustauschsystem).
// Es wird nur die im Konto hinterlegte Nummer geprüft; Ergebnis ohne Speicherung personenbezogener Daten.
const RE = /^([A-Z]{2})([0-9A-Z+*.]{2,12})$/;
export async function POST(req: Request) {
  const ctx = await requireMember(req, { bucket: 'b2b-vat', limit: 10 });
  if (ctx instanceof Response) return ctx;
  const raw = String(ctx.account.tax_id || '').replace(/\s+/g, '').toUpperCase();
  const m = RE.exec(raw);
  if (!m) return json({ checked: false, error: 'Im Profil ist keine USt-IdNr. (z. B. DE123456789) hinterlegt – eine Steuernummer kann VIES nicht prüfen.' }, 400);
  const countryCode = m[1] === 'GR' ? 'EL' : m[1];
  try {
    const r = await fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number', {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ countryCode, vatNumber: m[2] }), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return json({ checked: false, error: 'VIES ist gerade nicht erreichbar. Bitte später erneut prüfen.' }, 502);
    const d = (await r.json()) as { valid?: boolean; name?: string; requestDate?: string; userError?: string };
    if (d.userError && d.userError !== 'VALID' && d.userError !== 'INVALID') return json({ checked: false, error: `VIES meldet: ${d.userError}. Bitte später erneut prüfen.` }, 502);
    return json({ checked: true, valid: Boolean(d.valid), vatId: raw, name: d.name && d.name !== '---' ? d.name : null, at: d.requestDate || new Date().toISOString() });
  } catch {
    return json({ checked: false, error: 'VIES ist gerade nicht erreichbar. Bitte später erneut prüfen.' }, 502);
  }
}
