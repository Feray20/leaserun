import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';

// Aufgaben der Middleware:
//   1) Subdomains: partner.immoadv.de → Unternehmensportal, admin.immoadv.de → Admin-Zentrale
//      (nur die Startseite wird umgelenkt; Anmeldung und Schnittstellen funktionieren unverändert).
//   2) Alte Vorschau-Links (/zugang) führen zur Startseite; das frühere Vorschau-Cookie wird gelöscht.
//   3) Abwehr: Scanner-Zugriffe auf typische Angriffspfade (WordPress, .env, .git, phpMyAdmin …) werden abgewiesen
//      und gemeldet; gesperrte Quellen (Web-Admin → Sicherheit) erhalten keinen Zugriff auf die Schnittstellen.
//      Gespeichert wird nur eine gekürzte, gehashte Kennung der Quelle – nie die IP-Adresse.
const OLD_COOKIE = 'ia_preview';
const PROBE = /^\/(wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|\.env|\.git|\.aws|\.ssh|\.htaccess|\.DS_Store|phpmyadmin|pma|myadmin|adminer|cgi-bin|vendor\/phpunit|server-status|config\.php|admin\.php|setup\.php|install\.php|shell|backup|db\.sql|dump\.sql|\.well-known\/(?!security\.txt|assetlinks\.json|apple-app-site-association))/i;
const BAD_QS = /(union(\s|%20|\+)+select|<script|%3Cscript|\.\.\/|%2e%2e%2f|etc\/passwd|\bsleep\(|benchmark\(|information_schema)/i;

function hostTarget(req: NextRequest): string | null {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0];
  if (req.nextUrl.pathname !== '/') return null;
  if (host.startsWith('partner.')) return '/b2b-portal/index.html';
  if (host.startsWith('admin.')) return '/intern/web-admin/index.html';
  return null;
}

function clearOld(res: NextResponse): NextResponse {
  res.headers.append('Set-Cookie', `${OLD_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax`);
  res.headers.append('Set-Cookie', `${OLD_COOKIE}=; Path=/; Max-Age=0; Domain=.immoadv.de; Secure; HttpOnly; SameSite=Lax`);
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
  return (await sha(`immoadv:${t}`)).slice(0, 32);
}

// Sperrliste (60 s je Instanz zwischengespeichert).
let blocks: { at: number; set: Set<string> } = { at: 0, set: new Set() };
async function blocked(h: string | null): Promise<boolean> {
  if (!h) return false;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  if (Date.now() - blocks.at > 60_000) {
    try {
      const r = await fetch(`${url}/rest/v1/immo_security_blocks?select=ip_hash,until`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(1500) });
      if (r.ok) { const rows = (await r.json()) as { ip_hash: string; until: string | null }[]; blocks = { at: Date.now(), set: new Set(rows.filter((x) => !x.until || new Date(x.until).getTime() > Date.now()).map((x) => x.ip_hash)) }; }
      else blocks.at = Date.now();
    } catch { blocks.at = Date.now(); }
  }
  return blocks.set.has(h);
}

function report(req: NextRequest, ev: NextFetchEvent, kind: 'probe' | 'blocked', ip: string | null, detail: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return;
  ev.waitUntil(sha(`immoadv-sec:${key}`).then((t) => fetch(new URL('/api/sec/event', req.url), { method: 'POST', headers: { 'content-type': 'application/json', 'x-ia-sec': t.slice(0, 40) }, body: JSON.stringify({ kind, ip, detail: detail.slice(0, 160) }) })).then(() => null, () => null));
}

export async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const p = req.nextUrl.pathname;
  if (p === '/api/sec/event') return NextResponse.next();
  // Scanner / Angriffsmuster
  let qs = req.nextUrl.search || '';
  try { qs = decodeURIComponent(qs); } catch { /* fehlerhafte Kodierung: roh prüfen */ }
  if (PROBE.test(p) || BAD_QS.test(qs.slice(0, 2000))) {
    const h = await ipHash(req);
    report(req, ev, 'probe', h, `${req.method} ${p}`.slice(0, 120));
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  // Gesperrte Quellen: Schnittstellen abweisen (Zahlungs-Webhook und täglicher Lauf ausgenommen)
  if (p.startsWith('/api/') && !p.startsWith('/api/stripe/webhook') && !p.startsWith('/api/cron/')) {
    const h = await ipHash(req);
    if (await blocked(h)) {
      report(req, ev, 'blocked', h, `${req.method} ${p}`);
      return NextResponse.json({ error: 'Zugriff gesperrt. Wenn das ein Irrtum ist: support@immoadv.de' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
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
    '/', '/zugang', '/api/:path*',
    '/wp-admin/:path*', '/wp-login.php', '/wp-content/:path*', '/wp-includes/:path*', '/xmlrpc.php',
    '/.env', '/.env.:x', '/.git/:path*', '/.aws/:path*', '/.ssh/:path*', '/.htaccess', '/.DS_Store',
    '/phpmyadmin/:path*', '/pma/:path*', '/myadmin/:path*', '/adminer', '/adminer.php', '/cgi-bin/:path*', '/vendor/phpunit/:path*',
    '/server-status', '/config.php', '/admin.php', '/setup.php', '/install.php', '/shell', '/backup', '/backup/:path*', '/db.sql', '/dump.sql',
  ],
};
