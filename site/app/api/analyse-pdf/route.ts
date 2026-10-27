import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { z } from 'zod';
import { userFromRequest } from '@/lib/billing/auth';
import { allowRequest } from '@/lib/security/rate-limit';
import { ReportDocument } from '@/lib/pdf/report';
import { billingEnabled, entitlementsFor } from '@/lib/billing/stripe';
import { deliverPdf } from '@/lib/export/deliver';
import { paidAccess } from '@/lib/billing/paid';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const str = (max: number) => z.string().max(max);
const Pair = z.tuple([str(120), str(120)]);
const Body = z.object({
  title: str(160).min(1),
  subtitle: str(200).optional(),
  url: z.string().max(600).regex(/^https:\/\/\S+$/).optional().or(z.literal('')),
  chips: z.array(Pair).max(12),
  sections: z.array(z.object({ title: str(80), rows: z.array(Pair).max(14) })).max(8),
  hints: z.array(str(300)).max(10),
  email: z.boolean().optional(),
});

const isAdmin = (email: string) => (process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());

// Objekt-Analyse als PDF. Rendert ausschließlich die übergebenen, bereits berechneten Werte.
// Solange die Bezahlung nicht aktiv ist, für alle angemeldeten Nutzer; danach für Käufer-Pass, Investor Pro und Administratoren.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte anmelden.' }, { status: 401 });
  if (billingEnabled() && !isAdmin(user.email)) {
    try {
      const ent = await entitlementsFor(user.id, user.email);
      if (ent.tier === 'free') return NextResponse.json({ error: 'Das Analyse-PDF ist im Käufer-Pass und in Investor Pro enthalten.' }, { status: 402 });
    } catch {
      return NextResponse.json({ error: 'Freischaltung konnte nicht geprüft werden.' }, { status: 502 });
    }
  }
  if (!allowRequest(`analyse-pdf:${user.id}`, 10, 60_000)) return NextResponse.json({ error: 'Zu viele Anfragen.' }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Daten.' }, { status: 400 });
  const { email, ...rest } = parsed.data;
  const r = { ...rest, url: rest.url || undefined };
  const dataHash = createHash('sha256').update(JSON.stringify(r)).digest('hex');
  try {
    // Zahlende Kunden und Administratoren: ohne Wasserzeichen. Gratis-Nutzung: mit LeaseRun-Wasserzeichen.
    const { clean: paid } = await paidAccess(user).catch(() => ({ clean: false }));
    const el = createElement(ReportDocument, { r, reportId: randomUUID(), createdAt: new Date().toISOString(), hash: dataHash, reportType: 'RenditeRadar · Objekt-Analyse', clean: paid }) as unknown as Parameters<typeof renderToBuffer>[0];
    const pdf = await renderToBuffer(el);
    const name = `LeaseRun_RenditeRadar_${r.title.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60)}.pdf`;
    return deliverPdf({ pdf, filename: name, email, user, subject: `RenditeRadar: ${r.title}`, text: 'Im Anhang finden Sie Ihre RenditeRadar-Objekt-Analyse als PDF.' });
  } catch (e) {
    console.error('analyse_pdf_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'PDF konnte nicht erstellt werden.' }, { status: 500 });
  }
}
