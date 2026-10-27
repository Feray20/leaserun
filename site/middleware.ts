import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

// Aufgaben der Middleware:
//   1) Subdomains: partner.leaserun.com → Unternehmensportal, admin.leaserun.com → Admin-Zentrale
//      (nur die Startseite wird umgelenkt; Anmeldung und Schnittstellen funktionieren unverändert).
//   2) Alte Vorschau-Links (/zugang) führen zur Startseite; das frühere Vorschau-Cookie wird gelöscht.
//   3) Abwehr: Scanner-Zugriffe auf typische Angriffspfade (WordPress, .env, .git, phpMyAdmin …) werden abgewiesen
//      und gemeldet; gesperrte Quellen (Web-Admin → Sicherheit) erhalten keinen Zugriff auf die Schnittstellen.
//      Gespeichert wird nur eine gekürzte, gehashte Kennung der Quelle – nie die IP-Adresse.
const OLD_COOKIE = 'lr_preview';
const PROBE = /^\/(wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|\.env|\.git|\.aws|\.ssh|\.htaccess|\.DS_Store|phpmyadmin|pma|myadmin|adminer|cgi-bin|vendor\/phpunit|server-status|config\.php|admin\.php|setup\.php|install\.php|shell|backup|db\.sql|dump\.sql|\.well-known\/(?!security\.txt|assetlinks\.json|apple-app-site-association))/i;
const BAD_QS = /(union(\s|%20|\+)+select|<script|%3Cscript|\.\.\/|%2e%2e%2f|etc\/passwd|\bsleep\(|benchmark\(|information_schema)/i;

function hostTarget(req: NextRequest): string | null {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  if (req.nextUrl.pathname !== '/') return null;
  if (host.startsWith('partner.')) return '/business-portal/index.html';
  if (host.startsWith('admin.')) return '/internal/web-admin/index.html';
  return null;
}

function clearOld(res: NextResponse): NextResponse {
  res.headers.append('Set-Cookie', `${OLD_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  res.headers.append('Set-Cookie', `${OLD_COOKIE}=; Path=/; Max-Age=0; Domain=.leaserun.com; Secure; HttpOnly; SameSite=Lax`);
  return res;
}

async function sha(text: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
// Gleiche Kennung wie anonymizedIpHash() auf dem Server: IP auf /24 bzw. /48 gekürzt, gehasht.
async function ipHash(req: NextRequest): Promise<string | null> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return null;
  const t = ip.includes(':') ? ip.split(':').slice(0, 3).join(':') + '::' : ip.split('.').slice(0, 3).join('.') + '.0';
  return (await sha(`leaserun:${t}`)).slice(0, 32);
}

// Sperrliste (60 s je Instanz zwischengespeichert).
// Tempo: Ist die Liste schon einmal geladen, wird sie im Hintergrund aufgefrischt statt jede Anfrage warten zu lassen
// (vorher kostete das je Server-Instanz und Minute rund 300 ms auf einer beliebigen Schnittstellen-Anfrage).
let blocks: { at: number; set: Set<string>; loaded: boolean } = { at: 0, set: new Set(), loaded: false };
let refreshing: Promise<void> | null = null;
async function blocked(h: string | null, ev?: NextFetchEvent): Promise<boolean> {
  if (!h) return false;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  if (Date.now() - blocks.at > 60_000) {
    if (blocks.loaded && ev) {
      if (!refreshing) { blocks.at = Date.now(); refreshing = loadBlocks(url, key).finally(() => { refreshing = null; }); ev.waitUntil(refreshing); }
      return blocks.set.has(h);
    }
    await loadBlocks(url, key);
  }
  return blocks.set.has(h);
}
async function loadBlocks(url: string, key: string): Promise<void> {
  {
    try {
      const r = await fetch(`${url}/rest/v1/lr_security_blocks?select=ip_hash,until`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(1500) });
      if (r.ok) { const rows = (await r.json()) as { ip_hash: string; until: string | null }[]; blocks = { at: Date.now(), loaded: true, set: new Set(rows.filter((x) => !x.until || new Date(x.until).getTime() > Date.now()).map((x) => x.ip_hash)) }; }
      else blocks.at = Date.now();
    } catch { blocks.at = Date.now(); }
  }
}

// Eigenes Gerät (signiertes Cookie aus dem Web-Admin, siehe lib/security/trusted.ts): nie melden, nie sperren.
async function ownDevice(req: NextRequest): Promise<boolean> {
  const m = /^([0-9]{10,16})\.([A-Za-z0-9_-]{43})$/.exec(req.cookies.get('lr_own')?.value || '');
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY, app = process.env.APP_SECRET || '';
  if (!m || !k || Number(m[1]) < Date.now()) return false;
  const enc = new TextEncoder();
  const hmac = async (secret: string, msg: string) => new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), enc.encode(msg)));
  const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hex = (u: Uint8Array) => [...u].map((x) => x.toString(16).padStart(2, '0')).join('');
  try {
    // Gleiche Schlüssel wie lib/security/secrets.ts: eigener Geräte-Schlüssel (aus APP_SECRET) oder der bisherige.
    const keys = [`leaserun-own:${k}`];
    if (process.env.OWN_DEVICE_SECRET) keys.unshift(process.env.OWN_DEVICE_SECRET);
    else if (app.length >= 32) keys.unshift(hex(await hmac(app, 'leaserun:own-device')));
    for (const key of keys) if (b64(await hmac(key, m[1])).slice(0, 43) === m[2]) return true;
    return false;
  } catch { return false; }
}

function report(req: NextRequest, ev: NextFetchEvent, kind: 'probe' | 'blocked', ip: string | null, detail: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return;
  ev.waitUntil(sha(`leaserun-sec:${key}`).then((t) => fetch(new URL('/api/sec/event', req.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-ia-sec': t.slice(0, 40) }, body: JSON.stringify({ kind, ip, detail: detail.slice(0, 160) }) })).then(() => null, () => null));
}

// api.leaserun.com: eigene Adresse für die LeaseRun API v1. /v1/… wird intern auf /api/v1/… geleitet;
// alles andere (Website, Portale) gibt es auf dieser Subdomain nicht.
function apiHost(req: NextRequest): NextResponse | null {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  if (!host.startsWith('api.')) return null;
  const p = req.nextUrl.pathname;
  if (p === '/' || p === '/v1' || p === '/v1/') return NextResponse.json({ name: 'LeaseRun API', version: 'v1', base_url: `https://${host}/v1`, openapi: `https://${host}/v1/openapi.json`, status: `https://${host}/v1/health` }, { headers: { 'Cache-Control': 'no-store' } });
  if (p.startsWith('/v1/')) { const u = req.nextUrl.clone(); u.pathname = '/api' + p; return NextResponse.rewrite(u); }
  if (p.startsWith('/api/v1/')) return NextResponse.next();
  return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Unbekannter Pfad. Basisadresse: /v1' } }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
}

export async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const p = req.nextUrl.pathname;
  { const a = apiHost(req); if (a && !p.startsWith('/api/v1/')) return a; }
  if (p === '/api/sec/event') return NextResponse.next();
  // Scanner / Angriffsmuster
  let qs = req.nextUrl.search || '';
  try { qs = decodeURIComponent(qs); } catch { /* fehlerhafte Kodierung: roh prüfen */ }
  if (PROBE.test(p) || BAD_QS.test(qs.slice(0, 2000))) {
    const h = await ipHash(req);
    if (!(await ownDevice(req))) report(req, ev, 'probe', h, `${req.method} ${p}`.slice(0, 120));
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  // Gesperrte Quellen: Schnittstellen abweisen (Zahlungs-Webhook und täglicher Lauf ausgenommen)
  if (p.startsWith('/api/') && !p.startsWith('/api/stripe/webhook') && !p.startsWith('/api/cron/')) {
    const h = await ipHash(req);
    if (await blocked(h, ev) && !(await ownDevice(req))) {
      report(req, ev, 'blocked', h, `${req.method} ${p}`);
      return NextResponse.json({ error: 'Zugriff gesperrt. Wenn das ein Irrtum ist: support@leaserun.com' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.next();
  }
  if (p === '/zugang') return clearOld(NextResponse.redirect(new URL('/', req.url), 308));
  const target = hostTarget(req);
  const res = target ? NextResponse.rewrite(new URL(target, req.url)) : NextResponse.next();
  return req.cookies.has(OLD_COOKIE) ? clearOld(res) : res;
}

export const config = {
  matcher: [
    '/', '/zugang', '/api/:path*', '/v1', '/v1/:path*',
    '/wp-admin/:path*', '/wp-login.php', '/wp-content/:path*', '/wp-includes/:path*', '/xmlrpc.php',
    '/.env', '/.env.:x', '/.git/:path*', '/.aws/:path*', '/.ssh/:path*', '/.htaccess', '/.DS_Store',
    '/phpmyadmin/:path*', '/pma/:path*', '/myadmin/:path*', '/adminer', '/adminer.php', '/cgi-bin/:path*', '/vendor/phpunit/:path*',
    '/server-status', '/config.php', '/admin.php', '/setup.php', '/install.php', '/shell', '/backup', '/backup/:path*', '/db.sql', '/dump.sql',
  ],
};
