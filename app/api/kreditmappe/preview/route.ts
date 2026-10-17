import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { z } from 'zod';
import { allowRequest } from '@/lib/security/rate-limit';
import { userFromRequest } from '@/lib/billing/auth';
import { buildKreditmappe } from '@/lib/kreditmappe/model';
import { loadMappeInput } from '@/lib/kreditmappe/load';
import { KreditmappeDocument } from '@/lib/kreditmappe/pdf';
import { deliverPdf } from '@/lib/export/deliver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ objectId: z.string().min(4).max(40), email: z.boolean().optional() });
const PREVIEW_WATERMARK = 'VORSCHAU — NICHT ZUR VORLAGE — IMMOADV.DE';

// Kostenfreie Vorschau der Kreditmappe: vollständiger Inhalt, aber mit Wasserzeichen,
// ohne Versionsregistrierung und ohne Echtheits-QR. Dient zur Kontrolle der eigenen Angaben.
export async function POST(req: Request) {
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Bitte zuerst anmelden.' }, { status: 401 });
  if (!allowRequest(`kreditmappe-preview:${user.id}`, 4, 60_000)) {
    return NextResponse.json({ error: 'Zu viele Anfragen. Bitte kurz warten.' }, { status: 429 });
  }
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ungültige Anfrage.' }, { status: 400 });

  const loaded = await loadMappeInput(req, user.id, parsed.data.objectId);
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  const { object, profile, uploads } = loaded.data;

  try {
    const mappe = buildKreditmappe(object, profile, new Date(), uploads);
    const element = createElement(KreditmappeDocument, { m: mappe, watermark: PREVIEW_WATERMARK }) as unknown as Parameters<typeof renderToBuffer>[0];
    const pdf = await renderToBuffer(element);
    if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('invalid_pdf_output');
    const filename = `ImmoAdv_Kreditmappe_Vorschau_${object.name.replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60)}.pdf`;
    return deliverPdf({ pdf, filename, email: parsed.data.email, user, subject: `BankReady-Kreditmappe (Vorschau): ${object.name}`, text: 'Im Anhang finden Sie die Vorschau Ihrer Kreditmappe. Die Vorschau trägt ein Wasserzeichen und ist nicht zur Vorlage bei der Bank bestimmt.' });
  } catch (e) {
    console.error('kreditmappe_preview_error', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Vorschau konnte nicht erstellt werden.' }, { status: 500 });
  }
}
