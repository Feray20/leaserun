import { createHmac, timingSafeEqual } from 'node:crypto';
import { secretFor, verifySecrets } from '@/lib/security/secrets';

// Bilder in empfangenen E-Mails (Logos, Banner) über leaserun.com laden statt direkt beim Absender:
// – die Website-Sicherheitsrichtlinie erlaubt nur Bilder von der eigenen Adresse,
// – der Absender sieht nie die IP-Adresse oder den Browser der Administratorin.
// Jede Bildadresse ist signiert (HMAC), damit der Bild-Abruf kein offener Proxy für beliebige Adressen ist.
const sign = (u: string, key: string) => createHmac('sha256', key).update(u).digest('base64url').slice(0, 32);
export const signImg = (u: string) => sign(u, secretFor('mail-img'));
export function verifyImg(u: string, s: string): boolean {
  const b = Buffer.from(String(s || ''));
  return verifySecrets('mail-img').some((k) => { const a = Buffer.from(sign(u, k)); return a.length === b.length && timingSafeEqual(a, b); });
}
// Relativ, damit es im Web-Admin (leaserun.com und admin.leaserun.com) und in der App (Basis leaserun.com) gleich funktioniert.
export const proxied = (u: string) => `/api/mail/img?u=${encodeURIComponent(u)}&s=${signImg(u)}`;

const norm = (u: string) => (u.startsWith('//') ? `https:${u}` : u).replace(/&amp;/g, '&').trim();
const ok = (u: string) => /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length <= 2000;

// Bildquellen im HTML umschreiben: <img src>, background="…", CSS url(…). srcset entfällt (würde sonst direkt laden).
export function proxyImages(html: string): string {
  return html
    .replace(/\s(?:srcset|data-srcset)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])((?:https?:)?\/\/[^"']+)\2/gi, (_m, pre, q, u) => { const x = norm(u); return ok(x) ? `${pre}${q}${proxied(x).replace(/&/g, '&amp;')}${q}` : `${pre}${q}${q}`; })
    .replace(/(\sbackground\s*=\s*)(["'])((?:https?:)?\/\/[^"']+)\2/gi, (_m, pre, q, u) => { const x = norm(u); return ok(x) ? `${pre}${q}${proxied(x).replace(/&/g, '&amp;')}${q}` : ''; })
    .replace(/url\(\s*(&quot;|["']?)((?:https?:)?\/\/[^'")\s&]+(?:&amp;[^'")\s&]+)*)\1\s*\)/gi, (_m, _q, u) => { const x = norm(u); return ok(x) ? `url('${proxied(x)}')` : 'none'; });
}
