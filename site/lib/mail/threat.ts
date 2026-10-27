// Protection against phishing and hacker emails in the mailbox. Scores every incoming email (sender authentication
// SPF/DKIM/DMARC, spoofed sender names, dangerous attachments, suspicious links and typical scam wording). 5 points or more → Spam.
// The reasons are stored and shown in the mailbox.
export type Threat = { score: number; spam: boolean; reasons: string[] };
const BRANDS = /\b(leaserun|stripe|paypal|venmo|zelle|apple|icloud|microsoft|outlook|office ?365|google|gmail|amazon|ups|fedex|usps|dhl|chase|wells fargo|bank of america|citi|capital one|irs|docusign|vercel|supabase|resend)\b/i;
const BRAND_DOMAINS: Record<string, RegExp> = {
  leaserun: /(^|\.)leaserun\.com$/, stripe: /(^|\.)stripe\.com$/, paypal: /(^|\.)paypal\.com$/, venmo: /(^|\.)venmo\.com$/, apple: /(^|\.)(apple|icloud)\.com$/, icloud: /(^|\.)(apple|icloud)\.com$/,
  microsoft: /(^|\.)(microsoft|outlook|office|live)\.com$/, outlook: /(^|\.)(microsoft|outlook|office|live)\.com$/, google: /(^|\.)(google|gmail)\.com$/, gmail: /(^|\.)(google|gmail)\.com$/,
  amazon: /(^|\.)amazon\.com$/, ups: /(^|\.)ups\.com$/, fedex: /(^|\.)fedex\.com$/, usps: /(^|\.)usps\.(com|gov)$/, dhl: /(^|\.)dhl\.(com|de)$/,
  chase: /(^|\.)chase\.com$/, wells: /(^|\.)wellsfargo\.com$/, bank: /(^|\.)(bankofamerica|bofa)\.com$/, citi: /(^|\.)citi(bank)?\.com$/, capital: /(^|\.)capitalone\.com$/,
  irs: /(^|\.)irs\.gov$/, docusign: /(^|\.)docusign\.(com|net)$/, vercel: /(^|\.)vercel\.(com|app)$/, supabase: /(^|\.)supabase\.(com|io)$/, resend: /(^|\.)resend\.(com|dev)$/,
};
const BAD_EXT = /\.(exe|scr|bat|cmd|com|pif|js|jse|vbs|vbe|wsf|hta|msi|msp|jar|ps1|lnk|iso|img|dmg|apk|html?|shtml|svg|xlsm|docm|pptm)$/i;
const SCAM = /(verify your (account|identity|password)|confirm your (password|account)|password (expired|expires)|account (suspended|locked|on hold|will be (closed|suspended))|unusual (sign-?in|activity)|payment (failed|declined|pending).{0,40}(click|link)|update (your )?(billing|payment) (info|details)|wire (the )?(funds|transfer) (today|immediately|now)|bitcoin|crypto ?wallet|gift ?cards?|act (now|immediately)|within 24 hours|urgent.{0,20}(action|verify|confirm)|invoice attached|open the attached invoice|enable (macros|content)|irs.{0,30}(refund|penalty|warrant)|passwort (bestätigen|zurücksetzen|abgelaufen)|konto (gesperrt|wird gesperrt|eingeschränkt)|ungewöhnliche anmeldung|überweisen sie sofort|makros? aktivieren)/i;

export function assessMail(m: {
  fromEmail: string; fromName: string | null; subject: string; text: string; html: string | null;
  auth: { spf?: string; dkim?: string; dmarc?: string } | null | undefined; files: { name: string; type: string }[]; replyTo?: string | null;
}): Threat {
  const reasons: string[] = []; let score = 0;
  const add = (n: number, r: string) => { score += n; reasons.push(r); };
  const a = m.auth || {};
  const fail = (v?: string) => typeof v === 'string' && /fail/i.test(v);
  const pass = (v?: string) => typeof v === 'string' && /pass/i.test(v);
  const dom = (m.fromEmail.split('@')[1] || '').toLowerCase();
  if (fail(a.dmarc)) add(4, 'Sender authentication DMARC failed');
  if (fail(a.spf) && fail(a.dkim)) add(3, 'SPF and DKIM failed – sender probably spoofed');
  else if (fail(a.spf) || fail(a.dkim)) add(1, `${fail(a.spf) ? 'SPF' : 'DKIM'} failed`);
  if (!pass(a.spf) && !pass(a.dkim) && !pass(a.dmarc) && (a.spf || a.dkim || a.dmarc)) add(1, 'No sender authentication passed');
  // Spoofed name: "Stripe Support <x@whatever.ru>" or our own brand from a foreign domain.
  const nm = (m.fromName || '').toLowerCase();
  const brand = BRANDS.exec(nm)?.[1]?.toLowerCase().replace(/\s+/g, ' ');
  if (brand) { const ok = BRAND_DOMAINS[brand.replace(/ .*/, '')]; if (ok && !ok.test(dom)) add(4, `Sender name "${m.fromName}" does not match the address ${m.fromEmail}`); }
  if (/@/.test(nm) && !nm.includes(m.fromEmail.toLowerCase())) add(3, 'Sender name contains a different email address');
  if (/^xn--|\.xn--/.test(dom)) add(3, 'Sender domain uses look-alike characters (punycode)');
  if (m.replyTo) { const rd = (m.replyTo.split('@')[1] || '').toLowerCase().replace(/>.*/, ''); if (rd && rd !== dom && brand) add(2, `Replies go to a different domain (${rd})`); }
  for (const f of m.files) if (BAD_EXT.test(f.name) || /x-msdownload|x-msdos|javascript|x-sh/i.test(f.type)) { add(5, `Dangerous attachment: ${f.name}`); break; }
  if (m.files.some((f) => /\.(zip|rar|7z)$/i.test(f.name)) && SCAM.test(`${m.subject}\n${m.text}`)) add(2, 'Archive attachment with pressure wording');
  const body = `${m.subject}\n${m.text}`;
  if (SCAM.test(body)) add(2, 'Typical scam/phishing wording');
  const links = [...String(m.html || '').matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 80);
  let mism = 0, ipLink = false;
  for (const [, href, label] of links) {
    let host = ''; try { host = new URL(href).hostname.toLowerCase(); } catch { continue; }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) ipLink = true;
    const shown = /https?:\/\/([^\s<"/]+)/i.exec(label.replace(/<[^>]+>/g, ''))?.[1]?.toLowerCase();
    if (shown && !host.endsWith(shown.replace(/^www\./, '')) && !shown.endsWith(host.replace(/^www\./, ''))) mism++;
  }
  if (ipLink) add(3, 'Link to a bare IP address');
  if (mism) add(Math.min(4, 2 + mism), `Displayed link leads somewhere else (${mism}×)`);
  return { score, spam: score >= 5, reasons };
}

// List-Unsubscribe (RFC 2369/8058) from the headers: https URL, mailto address, one-click unsubscribe.
export function unsubInfo(listUnsub: string | null, listPost: string | null): { url: string | null; mailto: string | null; oneClick: boolean } | null {
  if (!listUnsub) return null;
  const parts = [...listUnsub.matchAll(/<([^>]+)>/g)].map((x) => x[1].trim());
  const url = parts.find((p) => /^https:\/\//i.test(p)) || null;
  const mailto = parts.find((p) => /^mailto:/i.test(p)) || null;
  if (!url && !mailto) return null;
  return { url, mailto, oneClick: Boolean(url && /List-Unsubscribe=One-Click/i.test(listPost || '')) };
}
