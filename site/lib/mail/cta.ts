// Knöpfe in Akquise-Mails öffnen immer eine passende Seite auf leaserun.com – nie nur ein leeres Mail-Fenster:
//  • Termin  → /book (freien Slot wählen, Gespräch per Microsoft Teams)
//  • alles andere → /request (Wunsch ankreuzen, absenden; daneben „Termin über Teams“ und „Kein Interesse“)
// Das Token (dasselbe wie im Abmeldelink) ordnet die Antwort der richtigen Mail zu; es enthält keine E-Mail-Adresse.
export const SITE = 'https://leaserun.com';
export type CtaArt = 'termin' | 'kooperation' | 'creator' | 'zugang' | 'unterlagen';

// Was der Empfänger mit dem Knopf anfordert → vorausgewählter Wunsch auf /anfrage.
const WUNSCH: Record<string, string> = {
  infos: 'keyfacts', keyfacts: 'keyfacts', unterlagen: 'keyfacts', details: 'keyfacts',
  zahlen: 'zahlen', rechnung: 'zahlen', muster: 'muster',
  gliederung: 'beitrag', entwurf: 'beitrag', thema: 'beitrag',
};

export function ctaFromLabel(label: string): { art: CtaArt; w?: string } | null {
  const l = label.replace(/&rarr;|→/g, '').trim();
  if (/^termin/i.test(l)) return { art: 'termin' };
  if (/^kurz antworten/i.test(l)) return { art: 'kooperation' };
  if (/^zugang schicken/i.test(l)) return { art: 'creator' };
  if (/^zugang anfordern/i.test(l)) return { art: 'zugang' };
  if (/^thema auswählen/i.test(l)) return { art: 'unterlagen', w: 'beitrag' };
  const m = /^(\S+) anfordern$/i.exec(l);
  if (m) return { art: 'unterlagen', w: WUNSCH[m[1].toLowerCase()] || 'keyfacts' };
  return null;
}

export function ctaUrl(art: CtaArt, w?: string, token?: string | null): string {
  const t = token && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : '';
  if (art === 'termin') return `${SITE}/termin?thema=${encodeURIComponent('Presse & Kooperation')}${t ? `&t=${t}` : ''}`;
  return `${SITE}/anfrage?art=${art}${w ? `&w=${w}` : ''}${t ? `&t=${t}` : ''}`;
}

// Für HTML-Attribute (& → &amp;).
export const ctaHref = (art: CtaArt, w?: string, token?: string | null) => ctaUrl(art, w, token).replace(/&/g, '&amp;');

// Knopf als eigenes Feld am Entwurf (Spalte cta) – bleibt erhalten, wenn der Text überarbeitet wird.
export type Cta = { art: CtaArt; w?: string; label: string; anrede: 'du' | 'ihr' | 'sie' };
const ARTS: CtaArt[] = ['termin', 'kooperation', 'creator', 'zugang', 'unterlagen'];
export function parseCta(v: unknown): Cta | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!ARTS.includes(o.art as CtaArt)) return null;
  const label = String(o.label || '').replace(/&rarr;|→/g, '').trim().slice(0, 40);
  if (label.length < 3) return null;
  const anrede = o.anrede === 'du' || o.anrede === 'ihr' ? o.anrede : 'sie';
  const w = typeof o.w === 'string' && /^[a-z]{2,20}$/.test(o.w) ? o.w : undefined;
  return { art: o.art as CtaArt, ...(w ? { w } : {}), label, anrede };
}
const ANREDE = { du: 'Oder antworte einfach auf diese Mail.', ihr: 'Oder antwortet einfach auf diese Mail.', sie: 'Oder antworten Sie einfach auf diese Mail.' } as const;
const F = 'font-family:Helvetica,Arial,sans-serif';
const escH = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
// Gleicher Knopf wie in den gestalteten Entwürfen (dunkelblau, abgerundet) – in Outlook, Gmail, Apple Mail gleich.
export function ctaBlock(c: Cta, token: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0"><tr><td bgcolor="#0F2C59" style="background-color:#0f2c59;border-radius:10px;mso-padding-alt:14px 26px"><a href="${ctaHref(c.art, c.w, token)}" target="_blank" style="display:inline-block;padding:14px 26px;${F};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${escH(c.label)} &rarr;</a></td></tr></table><p style="margin:10px 0 0;${F};font-size:13px;line-height:20px;color:#64748b">${ANREDE[c.anrede]}</p>`;
}
export const ctaText = (c: Cta, token: string | null) => `${c.label}: ${ctaUrl(c.art, c.w, token)}`;

// Knopf aus einem gestalteten Entwurf auslesen (mailto- oder Seiten-Link), z. B. bevor der Text überarbeitet wird.
export function extractCta(html: string): Cta | null {
  const m = /<a href="[^"]*"[^>]*border-radius:10px">([^<]+)<\/a>/.exec(String(html || ''));
  if (!m) return null;
  const c = ctaFromLabel(m[1]);
  if (!c) return null;
  const s = String(html);
  const anrede = /antwortet einfach/.test(s) ? 'ihr' : /antworte einfach/.test(s) ? 'du' : 'sie';
  return { ...c, label: m[1].replace(/&rarr;|→/g, '').trim(), anrede };
}
