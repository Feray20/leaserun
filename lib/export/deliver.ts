import { NextResponse } from 'next/server';
import { mailConfigured, sendMail } from '@/lib/notify/mail';
import { allowRequest } from '@/lib/security/rate-limit';

// Auslieferung eines erzeugten PDFs: Download (Standard) oder Versand an die eigene, angemeldete E-Mail-Adresse.
// Bewusst nur an die eigene Adresse – so kann der Versand nicht für Spam an Dritte missbraucht werden.
export type Delivery = {
  pdf: Uint8Array | Buffer;
  filename: string;
  email?: boolean;
  user: { id: string; email: string };
  subject: string;
  text: string;
  headers?: Record<string, string>;
};

const mask = (e: string) => e.replace(/^(.).*?(.)?@/, (_m, a: string, b?: string) => `${a}${'•'.repeat(3)}${b ?? ''}@`);

export async function deliverPdf(d: Delivery): Promise<NextResponse> {
  const extra = d.headers ?? {};
  if (!d.email) {
    return new NextResponse(new Uint8Array(d.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(d.filename)}`,
        'Cache-Control': 'no-store',
        ...extra,
      },
    });
  }
  if (!mailConfigured()) return NextResponse.json({ error: 'Der E-Mail-Versand ist noch nicht eingerichtet. Bitte das PDF herunterladen.' }, { status: 503 });
  if (!allowRequest(`pdf-mail:${d.user.id}`, 6, 60 * 60_000)) return NextResponse.json({ error: 'Zu viele E-Mails in kurzer Zeit. Bitte später erneut versuchen oder herunterladen.' }, { status: 429 });
  if (d.pdf.length > 20 * 1024 * 1024) return NextResponse.json({ error: 'Die Datei ist für den E-Mail-Versand zu groß. Bitte herunterladen.' }, { status: 413 });
  const ok = await sendMail(d.user.email, d.subject, `${d.text}\n\nSie haben diese E-Mail selbst in Ihrem ImmoAdv-Konto angefordert.\nImmoAdv · immoadv.de`, [{ filename: d.filename, content: d.pdf }]);
  if (!ok) return NextResponse.json({ error: 'E-Mail konnte nicht versendet werden. Bitte das PDF herunterladen.' }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: mask(d.user.email), ...(extra['X-Version-Id'] ? { versionId: extra['X-Version-Id'] } : {}) }, { headers: { 'Cache-Control': 'no-store', ...extra } });
}
