// Buttons in outreach emails always open a matching page on leaserun.com – never just an empty mail window:
//  • meeting  → /book (pick a free slot, call via Microsoft Teams)
//  • anything else → /request (tick what you want, submit; next to it "Book a Teams call" and "Not interested")
// The token (the same one as in the unsubscribe link) ties the response to the right email; it contains no email address.
export const SITE = 'https://leaserun.com';
// Internal keys (stored in the cta column and used as ?art= on /request) – do not rename.
export type CtaArt = 'termin' | 'kooperation' | 'creator' | 'zugang' | 'unterlagen';

// What the recipient requests with the button → preselected wish on /request.
const WUNSCH: Record<string, string> = {
  info: 'keyfacts', infos: 'keyfacts', keyfacts: 'keyfacts', facts: 'keyfacts', details: 'keyfacts', overview: 'keyfacts', unterlagen: 'keyfacts',
  numbers: 'zahlen', figures: 'zahlen', data: 'zahlen', example: 'zahlen', zahlen: 'zahlen', rechnung: 'zahlen',
  sample: 'muster', samples: 'muster', muster: 'muster',
  outline: 'beitrag', draft: 'beitrag', topic: 'beitrag', topics: 'beitrag', gliederung: 'beitrag', entwurf: 'beitrag', thema: 'beitrag',
};

// Button label → button type. English labels first; German labels are still recognized for drafts written before the port.
export function ctaFromLabel(label: string): { art: CtaArt; w?: string } | null {
  const l = label.replace(/&rarr;|→/g, '').trim();
  if (/^(book a (call|meeting|time)|schedule a (call|meeting)|pick a time|suggest a time|termin)/i.test(l)) return { art: 'termin' };
  if (/^(quick reply|reply in one click|let'?s talk|kurz antworten)/i.test(l)) return { art: 'kooperation' };
  if (/^(send me access|get creator access|zugang schicken)/i.test(l)) return { art: 'creator' };
  if (/^(request access|get access|try it free|zugang anfordern)/i.test(l)) return { art: 'zugang' };
  if (/^(choose a topic|pick a topic|thema auswählen)/i.test(l)) return { art: 'unterlagen', w: 'beitrag' };
  const en = /^(?:request|get|see) (?:the |a )?(\S+)(?: \S+)?$/i.exec(l);
  if (en && WUNSCH[en[1].toLowerCase()]) return { art: 'unterlagen', w: WUNSCH[en[1].toLowerCase()] };
  const de = /^(\S+) anfordern$/i.exec(l);
  if (de) return { art: 'unterlagen', w: WUNSCH[de[1].toLowerCase()] || 'keyfacts' };
  return null;
}

// Topic preselected on /book (?topic=) for meetings booked from an outreach email. /book topics: Business partnership,
// Product demo, Support, Press, Other.
export const BOOK_TOPIC = 'Press';

export function ctaUrl(art: CtaArt, w?: string, token?: string | null): string {
  const t = token && /^[A-Za-z0-9_-]{16,64}$/.test(token) ? token : '';
  if (art === 'termin') return `${SITE}/book?topic=${encodeURIComponent(BOOK_TOPIC)}${t ? `&t=${t}` : ''}`;
  return `${SITE}/request?art=${art}${w ? `&w=${w}` : ''}${t ? `&t=${t}` : ''}`;
}

// For HTML attributes (& → &amp;).
export const ctaHref = (art: CtaArt, w?: string, token?: string | null) => ctaUrl(art, w, token).replace(/&/g, '&amp;');

// Button as its own field on the draft (cta column) – survives when the text is rewritten.
// anrede (du/ihr/sie) only matters for German-language drafts; English output is the same for all three.
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
const REPLY_HINT = 'Or simply reply to this email.';
const ANREDE = { du: REPLY_HINT, ihr: REPLY_HINT, sie: REPLY_HINT } as const;
const F = 'font-family:Helvetica,Arial,sans-serif';
const escH = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
// Same button as in the designed drafts (dark blue, rounded) – identical in Outlook, Gmail and Apple Mail.
export function ctaBlock(c: Cta, token: string | null): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0"><tr><td bgcolor="#0F2C59" style="background-color:#0f2c59;border-radius:10px;mso-padding-alt:14px 26px"><a href="${ctaHref(c.art, c.w, token)}" target="_blank" style="display:inline-block;padding:14px 26px;${F};font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px">${escH(c.label)} &rarr;</a></td></tr></table><p style="margin:10px 0 0;${F};font-size:13px;line-height:20px;color:#64748b">${ANREDE[c.anrede]}</p>`;
}
export const ctaText = (c: Cta, token: string | null) => `${c.label}: ${ctaUrl(c.art, c.w, token)}`;

// Read the button from a designed draft (mailto or page link), e.g. before the text is rewritten.
export function extractCta(html: string): Cta | null {
  const m = /<a href="[^"]*"[^>]*border-radius:10px">([^<]+)<\/a>/.exec(String(html || ''));
  if (!m) return null;
  const c = ctaFromLabel(m[1]);
  if (!c) return null;
  const s = String(html);
  const anrede = /antwortet einfach/.test(s) ? 'ihr' : /antworte einfach/.test(s) ? 'du' : 'sie';
  return { ...c, label: m[1].replace(/&rarr;|→/g, '').trim(), anrede };
}
