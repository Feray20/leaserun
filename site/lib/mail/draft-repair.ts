// Bring finished drafts (design "fertig") up to the current LeaseRun email standard – automatically when sending and in the
// preview, and in the Web-Admin via the "Repair drafts" button. Only changes the header (sharp logo), signature and footer;
// text, buttons and the unsubscribe link (token) stay unchanged.
// Signature and footer come from lib/mail/template.ts – one source for every email, nothing maintained twice.
// The patterns below also match the legacy German layouts (e.g. "LeaseRun auf LinkedIn", ".de" links) so that drafts
// created before the US port are repaired too.
import { SIGNATURE, footer, footerNote } from '@/lib/mail/template';
import { ctaFromLabel, ctaHref } from '@/lib/mail/cta';

// Button that only opens a mail window → link to the matching page (/book or /request), see lib/mail/cta.ts.
const MAILTO_CTA = /<a href="mailto:support@leaserun\.(?:de|com)[^"]*"([^>]*border-radius:10px">)([^<]+)<\/a>/g;
const TOKEN_IN = /\/api\/abmelden\?t=([A-Za-z0-9_-]{16,64})/;
// Interim version from Oct 26, 2026 (LinkedIn only as a text link) → current standard with the LinkedIn button.
const SIG_TEXT_LINKEDIN = /<span style="color:#cbd5e1">&nbsp;&nbsp;·&nbsp;&nbsp;<\/span><a href="https:\/\/www\.linkedin\.com\/company\/leaserun\/" style="color:#0284c7;text-decoration:none">LinkedIn<\/a><\/p><\/td><\/tr><\/table>/;
const INTERIM_SIG = /<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="2" style="padding:0 0 14px"><img src="cid:att2"[^\n]*?<\/td><\/tr><\/table>/;
// Variant of it: signature as a single image above the table (without its own table row). Without this rule the draft
// stayed flagged as "outdated" although "Fix" could not repair it – the item kept coming back.
const INTERIM_SIG_LOOSE = /<img src="cid:att2"[^>]*><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td valign="middle"[^\n]*?LinkedIn<\/a><\/p><\/td><\/tr><\/table>/;

const LOGO_ROW = '<tr><td style="padding:22px 28px 18px"><a href="https://leaserun.com" style="text-decoration:none"><img src="cid:att1" width="180" height="34" alt="LeaseRun" style="display:block;border:0;outline:none;width:180px;height:34px;max-width:180px;-ms-interpolation-mode:bicubic"></a></td></tr>';
const SIG = '<img src="cid:att2" width="117" height="46" alt="" style="display:block;width:117px;height:46px;border:0;margin:0 0 4px">';
export const draftFooter = (unsub: string) => footer(unsub);

const OLD_HEADER = /<tr><td style="padding:22px 28px 18px;[^\n]*?<img src="cid:att1" width="36" height="31"[^\n]*?<\/table><\/td><\/tr>/;
const OLD_FOOTER = /<tr><td bgcolor="#F8FAFC" style="background-color:#f8fafc;border-top:1px solid #eef2f6;padding:10px 28px 12px;[^\n]*?(https:\/\/leaserun\.(?:de|com)\/api\/abmelden\?t=[A-Za-z0-9_-]+)"[^\n]*?<\/td><\/tr>/;
const BAD_SIG = /<img src="cid:att2" width="176" height="40"[^>]*>/g;
// Oldest signature: photo centered left, signature to the right (on phones the photo slipped down).
const OLD_SIG_TABLE = /<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" width="86" style="width:86px;padding:0 14px 0 0;vertical-align:middle"><img src="cid:att0"[^\n]*?LeaseRun (?:auf|on) LinkedIn<\/a><\/td><\/tr><\/table><\/td><\/tr><\/table>/;
// Previous signature: signature top left, then photo, vertical line, name, support@ and a large LinkedIn button –
// looked restless (signature "floated", support@ appeared twice).
const PREV_SIG_TABLE = /<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td colspan="3" style="padding:0 0 10px"><img src="cid:att2"[^\n]*?LeaseRun (?:auf|on) LinkedIn<\/a><\/td><\/tr><\/table><\/td><\/tr><\/table>/;
// Small gray note between button and sign-off ("We found your address on your website …") – belongs in the footer.
const BODY_NOTE = /<p style="margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#94a3b8">([^<]*)<\/p>/;
const FOOTER_OPEN = /(<tr><td(?: class="lr-pad")? bgcolor="#F8FAFC"[^>]*>)/;

export type DraftIssue = 'logo' | 'footer' | 'signature' | 'sig_layout' | 'note' | 'cta' | 'no_unsub' | 'foreign_img';
export function draftIssues(html: string): DraftIssue[] {
  const s = String(html || ''), out: DraftIssue[] = [];
  if (OLD_HEADER.test(s)) out.push('logo');
  if (OLD_FOOTER.test(s)) out.push('footer');
  if (/<img src="cid:att2" width="176" height="40"/.test(s)) out.push('signature');
  if (OLD_SIG_TABLE.test(s) || PREV_SIG_TABLE.test(s) || SIG_TEXT_LINKEDIN.test(s)) out.push('sig_layout');
  if (/<a href="mailto:support@leaserun\.(?:de|com)[^"]*"[^>]*border-radius:10px">/.test(s)) out.push('cta');
  if (BODY_NOTE.test(s) && FOOTER_OPEN.test(s)) out.push('note');
  if (!/\/api\/abmelden\?t=/.test(s)) out.push('no_unsub');
  if (/<img[^>]+src="(?!cid:att[012]"|https:\/\/leaserun\.com\/)/i.test(s)) out.push('foreign_img');
  return out;
}
export const repairable = (i: DraftIssue[]) => i.some((x) => x === 'logo' || x === 'footer' || x === 'signature' || x === 'sig_layout' || x === 'note' || x === 'cta');

export function repairDraftHtml(html: string): string {
  let s = String(html || '')
    .replace(OLD_HEADER, LOGO_ROW)
    .replace(OLD_FOOTER, (_m, unsub: string) => draftFooter(unsub))
    .replace(BAD_SIG, SIG)
    .replace(OLD_SIG_TABLE, SIGNATURE)
    .replace(PREV_SIG_TABLE, SIGNATURE);
  if (SIG_TEXT_LINKEDIN.test(s)) s = s.replace(INTERIM_SIG, SIGNATURE);
  if (SIG_TEXT_LINKEDIN.test(s)) s = s.replace(INTERIM_SIG_LOOSE, SIGNATURE);
  const token = TOKEN_IN.exec(s)?.[1] ?? null;
  s = s.replace(MAILTO_CTA, (all, rest: string, label: string) => {
    const c = ctaFromLabel(label);
    return c ? `<a href="${ctaHref(c.art, c.w, token)}" target="_blank"${rest.replace(/^\s*target="_blank"/, '')}${label}</a>` : all;
  });
  const note = BODY_NOTE.exec(s);
  if (note && FOOTER_OPEN.test(s)) s = s.replace(BODY_NOTE, '').replace(FOOTER_OPEN, (open) => open + footerNote(note[1]));
  return s;
}
