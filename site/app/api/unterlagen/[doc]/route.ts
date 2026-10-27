import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createElement } from 'react';
import { AnalyseVorlage, BankOnePager, BeraterCheckliste, KreditmappeVorlage } from '@/lib/unterlagen/pdfs';

export const runtime = 'nodejs';
export const dynamic = 'force-static';

const DOCS = {
  'bank-one-pager': { component: BankOnePager, filename: 'LeaseRun_Bank_One_Pager.pdf' },
  'berater-checkliste': { component: BeraterCheckliste, filename: 'LeaseRun_Berater_Checkliste.pdf' },
  'kreditmappe-vorlage': { component: KreditmappeVorlage, filename: 'LeaseRun_Kreditmappe_zum_Ausfuellen.pdf' },
  'analyse-vorlage': { component: AnalyseVorlage, filename: 'LeaseRun_Objekt-Analyse_zum_Ausfuellen.pdf' },
} as const;

export function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

// Next.js 15: params ist asynchron.
export async function GET(_req: Request, { params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  const def = DOCS[doc as keyof typeof DOCS];
  if (!def) return NextResponse.json({ error: 'Nicht gefunden.' }, { status: 404 });
  const element = createElement(def.component) as unknown as Parameters<typeof renderToBuffer>[0];
  const pdf = await renderToBuffer(element);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${def.filename}"`,
      'X-Document-SHA256': createHash('sha256').update(pdf).digest('hex'),
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
