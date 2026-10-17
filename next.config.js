/** @type {import('next').NextConfig} */

// Die Marketing-Seiten liegen als statische Dateien in public/.
// Diese Rewrites liefern sie unter sauberen URLs aus (/, /impressum, /angebote …).
const STATIC_PAGES = [
  'wissen',
  'pro-begleiter',
  'checkliste',
  'angebote',
  'sicherheit',
  'mustermappe',
  'impressum',
  'datenschutz',
  'nutzungsbedingungen',
  'kuendigen',
  'datenraum',
  'profiler',
  'pruefen',
  'rechner',
  'fristen',
  'start',
  'szenarien',
];

const cspValue = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: cspValue },
];

module.exports = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@react-pdf/renderer'],
  // pdfkit lädt seine Standardschriften dynamisch; ohne diese Angabe fehlen sie im Serverpaket.
  outputFileTracingIncludes: {
    '/api/kreditmappe': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/kreditmappe/preview': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/mustermappe': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/b2b/lead/pdf': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/b2b/avv': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/b2b/qr': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/admin/invoices': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/analyse-pdf': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/unterlagen/[doc]': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
  },
  // Entfernte bzw. zusammengelegte Seiten: dauerhaft weiterleiten, damit Links und Suchmaschinen-Einträge nicht ins Leere führen.
  async redirects() {
    return [
      { source: '/fuer-banken', destination: '/b2b', permanent: true },
      { source: '/fuer-banken/:path*', destination: '/b2b', permanent: true },
      { source: '/wissen/klug-investieren-wie-werde-ich-zum-geld-master', destination: '/wissen/klug-investieren-worauf-kommt-es-an', permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        ...STATIC_PAGES.map((p) => ({ source: `/${p}`, destination: `/${p}/index.html` })),
        { source: '/suche', destination: '/suche/index.html' },
        { source: '/intern/web-admin', destination: '/intern/web-admin/index.html' },
        { source: '/wissen/erwerbsstatus', destination: '/wissen/erwerbsstatus/index.html' },
        // Nur echte Seitennamen (ohne Punkt) – sonst würde die Regel ihr eigenes Ziel „…/index.html“ erneut umschreiben (404).
        { source: '/wissen/:slug([a-z0-9-]+)', destination: '/wissen/:slug/index.html' },
        { source: '/wissen/glossar', destination: '/wissen/glossar/index.html' },
        { source: '/rechner/afa', destination: '/rechner/afa/index.html' },
        { source: '/rechner/mieterhoehung', destination: '/rechner/mieterhoehung/index.html' },
        { source: '/rechner/cashflow', destination: '/rechner/cashflow/index.html' },
        { source: '/rechner/vergleich', destination: '/rechner/vergleich/index.html' },
        { source: '/rechner/kaufen-mieten', destination: '/rechner/kaufen-mieten/index.html' },
        { source: '/rechner/scorecard', destination: '/rechner/scorecard/index.html' },
        { source: '/rechner/budget', destination: '/rechner/budget/index.html' },
        { source: '/rechner/tilgungsplan', destination: '/rechner/tilgungsplan/index.html' },
        { source: '/rechner/kaufnebenkosten', destination: '/rechner/kaufnebenkosten/index.html' },
        { source: '/rechner/kaufnebenkosten/:land([a-z0-9-]+)', destination: '/rechner/kaufnebenkosten/:land/index.html' },
        { source: '/verify/:id', destination: '/pruefen/index.html' },
        { source: '/p/:slug', destination: '/partner/index.html' },
        { source: '/b2b', destination: '/b2b/index.html' },
        { source: '/b2b-portal', destination: '/b2b-portal/index.html' },
        { source: '/auth/login', destination: '/auth-login.html' },
        { source: '/auth/callback', destination: '/auth-login.html' },
        { source: '/auth/confirm', destination: '/auth-login.html' },
        { source: '/auth/register', destination: '/auth-login.html' },
        { source: '/auth/forgot', destination: '/auth-login.html' },
        { source: '/auth/reset', destination: '/auth-login.html' },
        { source: '/app/dashboard', destination: '/auth-login.html' },
      ],
    };
  },
  async headers() {
    // Statische Dateien tragen keinen Inhalts-Hash im Namen: kurze Frische, danach im Hintergrund
    // aktualisieren. Spart den Rundweg je Datei bei jedem Seitenwechsel; ein Deploy wirkt spätestens nach 10 Minuten.
    const swr = [{ key: 'Cache-Control', value: 'public, max-age=600, stale-while-revalidate=604800' }];
    return [
      { source: '/(.*)', headers: securityHeaders },
      // Admin-Zentrale: nie indexieren, nie zwischenspeichern.
      { source: '/intern/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'Cache-Control', value: 'no-store' }] },
      // Next.js-Seiten (Cockpit) brauchen Inline-Skripte für die Hydrierung; alle übrigen Seiten laufen ohne.
      { source: '/cockpit', headers: [{ key: 'Content-Security-Policy', value: cspValue.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") }] },
      // Partnerseite darf als Widget auf fremden Websites eingebettet werden (Freigabe je Domain prüft die Schnittstelle).
      { source: '/p/:slug', headers: [{ key: 'Content-Security-Policy', value: cspValue.replace("frame-ancestors 'none'", 'frame-ancestors *') }, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }, { key: 'Access-Control-Allow-Origin', value: '*' }] },
      { source: '/src/:file*', headers: swr },
      // Fremdbibliotheken mit Versionsnummer im Pfad (z. B. pdf.js) ändern sich nie: lange zwischenspeichern.
      { source: '/vendor/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/data/:file*', headers: swr },
      { source: '/og/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=2592000' }] },
      { source: '/:icon(icon-192.png|icon-512.png|icon-192-maskable.png|icon-512-maskable.png|apple-touch-icon.png)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=2592000' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};
