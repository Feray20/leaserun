// Schutz vor Phishing- und Hacker-Mails im Postfach. Bewertet jede eingehende Mail (Absender-Prüfung SPF/DKIM/DMARC,
// gefälschte Absendernamen, gefährliche Anhänge, verdächtige Links und typische Betrugstexte). Ab 5 Punkten → Spam.
// Die Gründe werden gespeichert und im Postfach angezeigt.
export type Threat = { score: number; spam: boolean; reasons: string[] };
const BRANDS = /\b(leaserun|stripe|paypal|apple|icloud|microsoft|outlook|office ?365|google|gmail|amazon|dhl|sparkasse|volksbank|deutsche bank|commerzbank|ing|n26|vercel|supabase|resend|finanzamt|elster)\b/i;
const BRAND_DOMAINS: Record<string, RegExp> = {
  leaserun: /(^|\.)leaserun\.de$/, stripe: /(^|\.)stripe\.com$/, paypal: /(^|\.)paypal\.(com|de)$/, apple: /(^|\.)(apple|icloud)\.com$/, icloud: /(^|\.)(apple|icloud)\.com$/,
  microsoft: /(^|\.)(microsoft|outlook|office|live)\.com$/, outlook: /(^|\.)(microsoft|outlook|office|live)\.com$/, google: /(^|\.)(google|gmail)\.com$/, gmail: /(^|\.)(google|gmail)\.com$/,
  amazon: /(^|\.)amazon\.(de|com)$/, dhl: /(^|\.)dhl\.(de|com)$/, vercel: /(^|\.)vercel\.(com|app)$/, supabase: /(^|\.)supabase\.(com|io)$/, resend: /(^|\.)resend\.(com|dev)$/,
};
const BAD_EXT = /\.(exe|scr|bat|cmd|com|pif|js|jse|vbs|vbe|wsf|hta|msi|msp|jar|ps1|lnk|iso|img|dmg|apk|html?|shtml|svg|xlsm|docm|pptm)$/i;
const SCAM = /(passwort (bestätigen|zurücksetzen|abgelaufen)|konto (gesperrt|wird gesperrt|eingeschränkt)|verify your (account|identity)|account (suspended|locked)|unusual (sign-?in|activity)|ungewöhnliche anmeldung|zahlung (fehlgeschlagen|ausstehend).{0,40}(klicken|link)|bitcoin|krypto.?wallet|gift ?card|geschenkkarte|überweisen sie sofort|innerhalb von 24 stunden|dringend.{0,20}(handeln|bestätigen)|invoice attached|rechnung im anhang.{0,30}(öffnen|aktivieren)|makros? aktivieren|enable (macros|content))/i;

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
  if (fail(a.dmarc)) add(4, 'Absender-Prüfung DMARC fehlgeschlagen');
  if (fail(a.spf) && fail(a.dkim)) add(3, 'SPF und DKIM fehlgeschlagen – Absender vermutlich gefälscht');
  else if (fail(a.spf) || fail(a.dkim)) add(1, `${fail(a.spf) ? 'SPF' : 'DKIM'} fehlgeschlagen`);
  if (!pass(a.spf) && !pass(a.dkim) && !pass(a.dmarc) && (a.spf || a.dkim || a.dmarc)) add(1, 'Keine bestandene Absender-Prüfung');
  // Gefälschter Name: „Stripe Support <x@irgendwas.ru>“ oder die eigene Marke von fremder Domain.
  const nm = (m.fromName || '').toLowerCase();
  const brand = BRANDS.exec(nm)?.[1]?.toLowerCase().replace(/\s+/g, ' ');
  if (brand) { const ok = BRAND_DOMAINS[brand.replace(/ .*/, '')]; if (ok && !ok.test(dom)) add(4, `Absendername „${m.fromName}“ passt nicht zur Adresse ${m.fromEmail}`); }
  if (/@/.test(nm) && !nm.includes(m.fromEmail.toLowerCase())) add(3, 'Absendername enthält eine andere E-Mail-Adresse');
  if (/^xn--|\.xn--/.test(dom)) add(3, 'Absender-Domain mit verwechselbaren Zeichen (Punycode)');
  if (m.replyTo) { const rd = (m.replyTo.split('@')[1] || '').toLowerCase().replace(/>.*/, ''); if (rd && rd !== dom && brand) add(2, `Antworten gehen an eine fremde Domain (${rd})`); }
  for (const f of m.files) if (BAD_EXT.test(f.name) || /x-msdownload|x-msdos|javascript|x-sh/i.test(f.type)) { add(5, `Gefährlicher Anhang: ${f.name}`); break; }
  if (m.files.some((f) => /\.(zip|rar|7z)$/i.test(f.name)) && SCAM.test(`${m.subject}\n${m.text}`)) add(2, 'Archiv-Anhang mit Drucktext');
  const body = `${m.subject}\n${m.text}`;
  if (SCAM.test(body)) add(2, 'Typischer Betrugs-/Phishing-Text');
  const links = [...String(m.html || '').matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 80);
  let mism = 0, ipLink = false;
  for (const [, href, label] of links) {
    let host = ''; try { host = new URL(href).hostname.toLowerCase(); } catch { continue; }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) ipLink = true;
    const shown = /https?:\/\/([^\s<"/]+)/i.exec(label.replace(/<[^>]+>/g, ''))?.[1]?.toLowerCase();
    if (shown && !host.endsWith(shown.replace(/^www\./, '')) && !shown.endsWith(host.replace(/^www\./, ''))) mism++;
  }
  if (ipLink) add(3, 'Link auf eine nackte IP-Adresse');
  if (mism) add(Math.min(4, 2 + mism), `Angezeigter Link führt woandershin (${mism}×)`);
  return { score, spam: score >= 5, reasons };
}

// List-Unsubscribe (RFC 2369/8058) aus den Kopfzeilen: https-Adresse, mailto-Adresse, Ein-Klick-Abmeldung.
export function unsubInfo(listUnsub: string | null, listPost: string | null): { url: string | null; mailto: string | null; oneClick: boolean } | null {
  if (!listUnsub) return null;
  const parts = [...listUnsub.matchAll(/<([^>]+)>/g)].map((x) => x[1].trim());
  const url = parts.find((p) => /^https:\/\//i.test(p)) || null;
  const mailto = parts.find((p) => /^mailto:/i.test(p)) || null;
  if (!url && !mailto) return null;
  return { url, mailto, oneClick: Boolean(url && /List-Unsubscribe=One-Click/i.test(listPost || '')) };
}
