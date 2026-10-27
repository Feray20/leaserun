// Network helpers: IP allowlist (IPv4/IPv6 with CIDR) and SSRF protection for webhook targets.
import { isIP } from 'node:net';

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
}
const B0 = BigInt(0), B16 = BigInt(16), B32 = BigInt(32), FFFF = BigInt(0xffff), MASK32 = BigInt(0xffffffff);
function v6ToBigInt(ip: string): bigint | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%'); if (zone >= 0) s = s.slice(0, zone);
  // Eingebettete IPv4 (::ffff:1.2.3.4)
  const m4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m4) { const n = v4ToInt(m4[1]); s = s.slice(0, -m4[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16)); }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const all = [...head, ...Array(Math.max(0, fill)).fill('0'), ...tail];
  if (all.length !== 8) return null;
  let v = B0;
  for (const h of all) { if (!/^[0-9a-f]{1,4}$/.test(h)) return null; v = (v << B16) + BigInt(parseInt(h, 16)); }
  return v;
}

// IPv4-mapped IPv6 address → IPv4 text, otherwise unchanged.
export function normalizeIp(ip: string): string {
  const s = ip.trim().replace(/^\[|\]$/g, '');
  if (isIP(s) === 6) {
    const v = v6ToBigInt(s);
    if (v !== null && v >> B32 === FFFF) { const n = Number(v & MASK32); return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  }
  return s;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const a = normalizeIp(ip);
  const [net, bitsRaw] = cidr.trim().split('/');
  const n = normalizeIp(net);
  const fam = isIP(a);
  if (!fam || fam !== isIP(n)) return false;
  if (fam === 4) {
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (!(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (v4ToInt(a) & mask) === (v4ToInt(n) & mask);
  }
  const bits = bitsRaw === undefined ? 128 : Number(bitsRaw);
  if (!(bits >= 0 && bits <= 128)) return false;
  const x = v6ToBigInt(a), y = v6ToBigInt(n);
  if (x === null || y === null) return false;
  const shift = BigInt(128 - bits);
  return x >> shift === y >> shift;
}

export const validCidr = (c: string) => { const [n, b] = c.trim().split('/'); const f = isIP(normalizeIp(n)); if (!f) return false; if (b === undefined) return true; const v = Number(b); return Number.isInteger(v) && v >= 0 && v <= (f === 4 ? 32 : 128); };

export function ipAllowed(ip: string | null, allow: string[]): boolean {
  if (!allow.length) return true;
  if (!ip) return false;
  return allow.some((c) => ipInCidr(ip, c));
}

export function clientIp(req: Request): string | null {
  // Vercel sets x-forwarded-for; the first entry is the client (overwritten by the edge network, cannot be forged by the client).
  return req.headers.get('x-real-ip')?.trim() || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

// Non-public ranges (RFC 1918, loopback, link-local incl. cloud metadata 169.254.169.254, CGNAT, multicast,
// documentation and benchmark ranges, IPv6 ULA/link-local/NAT64 prefix).
const BLOCKED = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
  '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4', '255.255.255.255/32',
  '::/128', '::1/128', '64:ff9b::/96', '64:ff9b:1::/48', '100::/64', '2001::/32', '2001:db8::/32', '2002::/16', 'fc00::/7', 'fe80::/10', 'ff00::/8',
];
export function isPublicIp(ip: string): boolean {
  const a = normalizeIp(ip);
  if (!isIP(a)) return false;
  return !BLOCKED.some((c) => ipInCidr(a, c));
}

const BLOCKED_HOSTS = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|metadata\.google\.internal)$/i;
export function checkWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, reason: 'Invalid URL.' }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Nur https-Adressen sind erlaubt.' };
  if (u.username || u.password) return { ok: false, reason: 'Credentials in the URL are not allowed.' };
  if (u.port && u.port !== '443') return { ok: false, reason: 'Only port 443 is allowed.' };
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || BLOCKED_HOSTS.test(host) || /(^|\.)leaserun\.(com|de)$/i.test(host) || host.endsWith('.vercel.internal')) return { ok: false, reason: 'Internal addresses are not allowed.' };
  if (isIP(host) && !isPublicIp(host)) return { ok: false, reason: 'Internal addresses are not allowed.' };
  if (!isIP(host) && !host.includes('.')) return { ok: false, reason: 'Please enter a fully qualified domain name.' };
  return { ok: true, url: u };
}
