import { createHmac, timingSafeEqual } from 'node:crypto';
import { secretFor, verifySecrets } from '@/lib/security/secrets';

// Load images in received emails (logos, banners) through leaserun.com instead of directly from the sender:
// – the site's security policy only allows images from our own origin,
// – the sender never sees the admin's IP address or browser.
// Every image URL is signed (HMAC) so the image fetch is not an open proxy for arbitrary URLs.
const sign = (u: string, key: string) => createHmac('sha256', key).update(u).digest('base64url').slice(0, 32);
export const signImg = (u: string) => sign(u, secretFor('mail-img'));
export function verifyImg(u: string, s: string): boolean {
  const b = Buffer.from(String(s || ''));
  return verifySecrets('mail-img').some((k) => { const a = Buffer.from(sign(u, k)); return a.length === b.length && timingSafeEqual(a, b); });
}
// Relative, so it works the same in the Web-Admin (leaserun.com and admin.leaserun.com) and in the app (base leaserun.com).
export const proxied = (u: string) => `/api/mail/img?u=${encodeURIComponent(u)}&s=${signImg(u)}`;

const norm = (u: string) => (u.startsWith('//') ? `https:${u}` : u).replace(/&amp;/g, '&').trim();
const ok = (u: string) => /^https?:\/\/[^\s"'<>]+$/i.test(u) && u.length <= 2000;

// Rewrite image sources in the HTML: <img src>, background="…", CSS url(…). srcset is dropped (it would load directly).
export function proxyImages(html: string): string {
  return html
    .replace(/\s(?:srcset|data-srcset)\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])((?:https?:)?\/\/[^"']+)\2/gi, (_m, pre, q, u) => { const x = norm(u); return ok(x) ? `${pre}${q}${proxied(x).replace(/&/g, '&amp;')}${q}` : `${pre}${q}${q}`; })
    .replace(/(\sbackground\s*=\s*)(["'])((?:https?:)?\/\/[^"']+)\2/gi, (_m, pre, q, u) => { const x = norm(u); return ok(x) ? `${pre}${q}${proxied(x).replace(/&/g, '&amp;')}${q}` : ''; })
    .replace(/url\(\s*(&quot;|["']?)((?:https?:)?\/\/[^'")\s&]+(?:&amp;[^'")\s&]+)*)\1\s*\)/gi, (_m, _q, u) => { const x = norm(u); return ok(x) ? `url('${proxied(x)}')` : 'none'; });
}
