/** @type {import('next').NextConfig} */

// Die Marketing-Seiten liegen als statische Dateien in public/.
// Diese Rewrites liefern sie unter sauberen URLs aus (/, /legal-notice, /pricing …).

const STATIC_PAGES = [
  'software',
  'learn',
  'pro-guide',
  'checklist',
  'pricing',
  'security',
  'sample-loan-package',
  'legal-notice',
  'privacy',
  'terms',
  'cancel',
  'refund',
  'data-room',
  'profiler',
  'review',
  'calculators',
  'deadlines',
  'start',
  'scenarios',
  'about',
  'contact',
  'learning-path',
  'book',
  'request',
  'checkout',
];

const cspValue = [
  "default-src 'self'",
  "script-src 'self' https://www.googletagmanager.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

// Geschützte Bereiche (Web-Admin, Konten, Portale): ohne Google-Domains. Google Analytics läuft nur auf öffentlichen
// Seiten; so kann eine eventuelle HTML-Einschleusung dort nie fremde Skripte über Googles Tag-Manager nachladen.
const cspStrict = cspValue
  .replace(" https://www.googletagmanager.com", '')
  .replace(" https://*.google-analytics.com https://*.googletagmanager.com", '')
  .replace(" https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com", '');
// /internal/ hat eine eigene Richtlinie (cspAdmin). Doppelte CSP-Header würden sich gegenseitig einschränken (Bilder blockiert).
const STRICT = ['/business-portal', '/business-portal/:path*', '/creators', '/creators/:path*', '/app/:path*', '/auth/:path*', '/auth-login.html', '/data-room', '/data-room/:path*', '/review', '/review/:path*'];

// Dateien senden/abholen (/files) und Web-Admin: Browser lädt direkt zu bzw. von Microsoft OneDrive (Hochladesitzung).
const ONEDRIVE = 'https://*.sharepoint.com https://*.1drv.com https://api.onedrive.com https://*.onedrive.com';
const cspFiles = cspStrict.replace("connect-src 'self' https://*.supabase.co", `connect-src 'self' https://*.supabase.co ${ONEDRIVE}`)
  // Vorschaubilder in „Meine Cloud“ kommen direkt von Microsoft (kurzlebige Adressen).
  .replace("img-src 'self' data: blob:", `img-src 'self' data: blob: ${ONEDRIVE} https://*.svc.ms`);
const cspAdmin = cspFiles;
const fileHeaders = [{ key: 'Content-Security-Policy', value: cspFiles }, { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'Cache-Control', value: 'no-store' }, { key: 'Referrer-Policy', value: 'no-referrer' }];

// Bezahlseite /kasse: zusätzlich Stripe (Skript js.stripe.com, eingebettetes Zahlformular, 3-D-Secure).
const cspKasse = cspValue
  .replace("script-src 'self' https://www.googletagmanager.com", "script-src 'self' https://js.stripe.com")
  .replace("img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com", "img-src 'self' data: blob: https://*.stripe.com")
  .replace("connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com", "connect-src 'self' https://*.supabase.co https://api.stripe.com https://merchant-ui-api.stripe.com https://*.stripe.com https://*.stripe.network")
  .replace("frame-src 'self' blob:", "frame-src 'self' blob: https://js.stripe.com https://checkout.stripe.com https://hooks.stripe.com https://*.stripe.com https://*.stripe.network");

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Content-Security-Policy', value: cspValue },
  // Zusätzliche Abschottung: kein Zugriff fremder Fenster auf LeaseRun-Seiten, keine Einbettung von Ressourcen in fremde Seiten.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  { key: 'X-Permitted-Cross-Domain-Policies', value: 'none' },
];

module.exports = {
  // Fehlermeldung an die HQ-Mitarbeiter (instrumentation.ts) braucht Datenbank und node:crypto – gibt es nur im Node-Bereich.
  // Für den Edge-Build (Middleware) wird die Datei durch eine leere Fassung ersetzt, sonst scheitert der Build.
  webpack(config, { nextRuntime, webpack }) {
    if (nextRuntime === 'edge') {
      const edge = require('node:path').resolve(__dirname, 'lib/admin/server-error.edge.ts');
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/lib[\\/]admin[\\/]server-error(\.ts)?$/, (r) => { if (!/server-error\.edge/.test(r.request)) r.request = edge; }));
    }
    return config;
  },
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['@react-pdf/renderer', 'tesseract.js', 'tesseract.js-core', 'unpdf'],
  // pdfkit lädt seine Standardschriften dynamisch; ohne diese Angabe fehlen sie im Serverpaket.
  outputFileTracingIncludes: {
    '/api/creator/hub': ['./public/creator-kit/**/*'],
    '/api/admin/creators/assets': ['./public/creator-kit/**/*'],
    '/api/kreditmappe': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/kreditmappe/preview': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/mustermappe': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/b2b/lead/pdf': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/b2b/avv': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/b2b/qr': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/admin/invoices': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/analyse-pdf': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/unterlagen/[doc]': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/v1/cases/[id]/reports': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/v1/cases/[id]/reports/[reportId]': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/admin/api': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
    '/api/cron/cleanup': ['./node_modules/pdfkit/js/**/*', './node_modules/@react-pdf/pdfkit/**/*'],
  },
  // Entfernte bzw. zusammengelegte Seiten: dauerhaft weiterleiten, damit Links und Suchmaschinen-Einträge nicht ins Leere führen.
  async redirects() {
    // Zusammengelegte Themen der Ratgeber-Engine: dauerhaft auf die inhaltliche Nachfolge-URL (eine Stufe, keine Kette).
    const { CONSOLIDATED } = await import('./content/ratgeber/index.mjs');
    return [
      ...CONSOLIDATED.map((c) => ({ source: `/guides/${c.slug}`, destination: c.into, permanent: true })),
      // Earlier LeaseRun URLs
      { source: '/login', destination: '/auth/login', permanent: true },
      { source: '/signup', destination: '/auth/register', permanent: true },
      { source: '/forgot', destination: '/auth/forgot', permanent: true },
      { source: '/reset', destination: '/auth/reset', permanent: true },
      { source: '/business/portal', destination: '/business-portal', permanent: true },
      { source: '/business/portal/:path*', destination: '/business-portal', permanent: true },
      { source: '/admin', destination: '/internal/web-admin', permanent: false },
      // Direkte Anmeldung für Creator (Link zum Weitergeben): öffnet /creators gleich mit dem Anmeldeformular.
      { source: '/creators/anmelden', destination: '/creators?anmelden', permanent: false },
      { source: '/creators/login', destination: '/creators?anmelden', permanent: false },
      { source: '/learn/klug-investieren-wie-werde-ich-zum-geld-master', destination: '/learn/klug-investieren-worauf-kommt-es-an', permanent: true },
      // Früher bei 70 Zeichen abgeschnittene Adresse → vollständiger Titel.
      { source: '/learn/was-ist-der-unterschied-zwischen-erhaltungsaufwand-und', destination: '/learn/was-ist-der-unterschied-zwischen-erhaltungsaufwand-und-herstellungskosten', permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/index.html' },
        { source: '/files', destination: '/files/index.html' },
        // LeaseRun company pages (built by legacy/build.py → copied into public/ by scripts/legacy-pages.mjs)
        { source: '/properties', destination: '/properties/index.html' },
        { source: '/property-management', destination: '/property-management/index.html' },
        { source: '/about-contact', destination: '/about-contact/index.html' },
        ...STATIC_PAGES.map((p) => ({ source: `/${p}`, destination: `/${p}/index.html` })),
        { source: '/search', destination: '/search/index.html' },
        { source: '/internal/web-admin', destination: '/internal/web-admin/index.html' },
        { source: '/learn/erwerbsstatus', destination: '/learn/erwerbsstatus/index.html' },
        // Nur echte Seitennamen (ohne Punkt) – sonst würde die Regel ihr eigenes Ziel „…/index.html“ erneut umschreiben (404).
        { source: '/learn/:slug([a-z0-9-]+)', destination: '/learn/:slug/index.html' },
        { source: '/learn/glossar', destination: '/learn/glossar/index.html' },
        { source: '/calculators/depreciation', destination: '/calculators/depreciation/index.html' },
        { source: '/calculators/rent-increase', destination: '/calculators/rent-increase/index.html' },
        { source: '/calculators/cash-flow', destination: '/calculators/cash-flow/index.html' },
        { source: '/calculators/loan-comparison', destination: '/calculators/loan-comparison/index.html' },
        { source: '/calculators/rent-vs-buy', destination: '/calculators/rent-vs-buy/index.html' },
        { source: '/calculators/scorecard', destination: '/calculators/scorecard/index.html' },
        { source: '/calculators/budget', destination: '/calculators/budget/index.html' },
        { source: '/calculators/amortization', destination: '/calculators/amortization/index.html' },
        { source: '/calculators/closing-costs', destination: '/calculators/closing-costs/index.html' },
        { source: '/calculators/closing-costs/:land([a-z0-9-]+)', destination: '/calculators/closing-costs/:land/index.html' },
        { source: '/calculators/approval-odds', destination: '/calculators/approval-odds/index.html' },
        // Ratgeber-Engine (scripts/build-ratgeber.mjs): nur echte Seitennamen ohne Punkt; unbekannte Namen enden im 404.
        { source: '/guides', destination: '/guides/index.html' },
        { source: '/guides/:slug([a-z0-9-]+)', destination: '/guides/:slug/index.html' },
        { source: '/verify/:id', destination: '/review/index.html' },
        { source: '/p/:slug', destination: '/partners/index.html' },
        { source: '/business', destination: '/business/index.html' },
        // LeaseRun Card (in Vorbereitung): nicht im Menü, nicht in der Sitemap, noindex.
        { source: '/card', destination: '/card/index.html' },
        { source: '/card/pricing', destination: '/card/pricing/index.html' },
        { source: '/card/preise.pdf', destination: '/api/karten/preise-pdf' },
        { source: '/card/account', destination: '/card/account/index.html' },
        { source: '/business-portal', destination: '/business-portal/index.html' },
        // Creator Partner: eigener, nicht verlinkter Bereich (nicht im Menü, nicht in der Sitemap, noindex).
        { source: '/creators', destination: '/creators/index.html' },
        { source: '/creators/apply', destination: '/creators/index.html' },
        { source: '/auth/login', destination: '/auth-login.html' },
        { source: '/auth/callback', destination: '/auth-login.html' },
        { source: '/auth/confirm', destination: '/auth-login.html' },
        { source: '/auth/register', destination: '/auth-login.html' },
        { source: '/auth/forgot', destination: '/auth-login.html' },
        { source: '/auth/reset', destination: '/auth-login.html' },
        { source: '/app/dashboard', destination: '/auth-login.html' },
      ],
      // Alles, was es nicht gibt (keine Seite, keine Datei, keine Schnittstelle): skriptfreie 404-Seite statt der
      // Next.js-Fehlerseite, die unter der strengen CSP im Browser weiß blieb.
      fallback: [
        { source: '/:path((?!api/|_next/|v1/).*)', destination: '/api/not-found' },
      ],
    };
  },
  async headers() {
    // Statische Dateien tragen keinen Inhalts-Hash im Namen: kurze Frische, danach im Hintergrund
    // aktualisieren. Spart den Rundweg je Datei bei jedem Seitenwechsel; ein Deploy wirkt spätestens nach 10 Minuten.
    const swr = [{ key: 'Cache-Control', value: 'public, max-age=600, stale-while-revalidate=604800' }];
    return [
      { source: '/((?!checkout(?:/|$)).*)', headers: securityHeaders },
      ...STRICT.map((source) => ({ source, headers: [{ key: 'Content-Security-Policy', value: cspStrict }] })),
      { source: '/internal/:path*', headers: [{ key: 'Content-Security-Policy', value: cspAdmin }] },
      { source: '/files', headers: fileHeaders },
      { source: '/files/:path*', headers: fileHeaders },
      { source: '/checkout/:path*', headers: [...securityHeaders.filter((h) => h.key !== 'Content-Security-Policy' && h.key !== 'Permissions-Policy'), { key: 'Content-Security-Policy', value: cspKasse }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/checkout', headers: [...securityHeaders.filter((h) => h.key !== 'Content-Security-Policy' && h.key !== 'Permissions-Policy'), { key: 'Content-Security-Policy', value: cspKasse }, { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com" "https://checkout.stripe.com")' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] },
      // Nur leaserun.com soll in Suchmaschinen erscheinen: dieselben Seiten unter *.vercel.app sowie den
      // Subdomains partner./admin. bekommen noindex (Canonical zeigt ohnehin auf leaserun.com). Keine Weiterleitung,
      // damit Webhooks und Anmelde-Rückleitungen über diese Adressen weiter funktionieren.
      { source: '/:path*', has: [{ type: 'host', value: '(?<vhost>.+\\.vercel\\.app)' }], headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] },
      { source: '/:path*', has: [{ type: 'host', value: 'partner.leaserun.com' }], headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] },
      { source: '/:path*', has: [{ type: 'host', value: 'admin.leaserun.com' }], headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // Admin-Zentrale: nie indexieren, nie zwischenspeichern.
      { source: '/internal/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/card', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      { source: '/creators', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/creators/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/card/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // Next.js-Seiten (Cockpit) brauchen Inline-Skripte für die Hydrierung; alle übrigen Seiten laufen ohne.
      { source: '/cockpit', headers: [{ key: 'Content-Security-Policy', value: cspValue.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'") }] },
      // Partnerseite darf als Widget auf fremden Websites eingebettet werden (Freigabe je Domain prüft die Schnittstelle).
      { source: '/p/:slug', headers: [{ key: 'Content-Security-Policy', value: cspValue.replace("frame-ancestors 'none'", 'frame-ancestors *') }, { key: 'X-Frame-Options', value: 'SAMEORIGIN' }] },
      { source: '/widget.js', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }, { key: 'Access-Control-Allow-Origin', value: '*' }] },
      { source: '/src/:file*', headers: swr },
      // Mit Versionsnummer (?v=…, beim Build gesetzt) ändert sich eine Datei nie: ein Jahr zwischenspeichern.
      // Steht weiter unten, damit diese Regel die kurze Frische oben überschreibt; Aufrufe ohne ?v behalten die kurze Frische.
      { source: '/src/:file*', has: [{ type: 'query', key: 'v' }], headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      // Bilder, Logos, Favicons und Creator-Material ändern sich selten.
      { source: '/img/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }] },
      { source: '/creator-kit/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=2592000' }] },
      { source: '/brand/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }] },
      { source: '/:icon(logo-icon.svg|favicon.svg|favicon.ico|favicon-32x32.png|favicon-48x48.png|favicon-96x96.png|og-image.png)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=2592000' }] },
      // Fremdbibliotheken mit Versionsnummer im Pfad (z. B. pdf.js) ändern sich nie: lange zwischenspeichern.
      { source: '/vendor/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      { source: '/fonts/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000, stale-while-revalidate=31536000' }] },
      { source: '/data/:file*', headers: swr },
      { source: '/og/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=2592000' }] },
      { source: '/:icon(icon-192.png|icon-512.png|icon-192-maskable.png|icon-512-maskable.png|apple-touch-icon.png)', headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=2592000' }] },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ];
  },
};
