// Fehlerseite „Seite nicht gefunden“ für unbekannte Adressen (über die Fallback-Umleitung in next.config.js).
// Bewusst als fertiges HTML ohne ein einziges Skript: Die Website-CSP erlaubt keine eingebetteten Skripte, an denen
// die von Next.js aufgebaute 404-Seite im Browser scheiterte (weiße Seite). Status bleibt 404 (richtig für Google).
export const dynamic = 'force-static';

const LINKS: [string, string][] = [
  ['/', 'Startseite'], ['/calculators', 'Alle Rechner'], ['/learn', 'Wissenszentrale'],
  ['/learn/glossar', 'Glossar'], ['/start', 'Meine erste Immobilie'], ['/app/dashboard', 'Mein Konto'],
];

const HTML = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Seite nicht gefunden | LeaseRun</title><link rel="icon" href="/favicon.svg?v=4" type="image/svg+xml"><link rel="preload" href="/fonts/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin><style>
@font-face{font-family:Inter;src:url(/fonts/Inter-Regular.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Inter;src:url(/fonts/Inter-Bold.woff2) format("woff2");font-weight:600 800;font-display:swap}
body{margin:0;background:#fff;line-height:1.55}
.nf{max-width:640px;margin:0 auto;padding:48px 20px 64px;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#0F172A}
.nf-brand{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:21px;color:#0F2C59;text-decoration:none}
.nf-brand span span{color:#0284C7}
.nf-code{margin:40px 0 4px;font-size:13px;letter-spacing:.12em;color:#64748B;font-weight:700}
.nf h1{font-size:30px;line-height:1.15;margin:0 0 12px;color:#0F2C59}
.nf p{font-size:16px}
.nf ul{list-style:none;padding:0;margin:20px 0 0;border-top:1px solid #E2E8F0}
.nf li a{display:block;padding:12px 0;border-bottom:1px solid #E2E8F0;color:#0369A1;text-decoration:none;font-weight:600}
.nf li a:hover{text-decoration:underline}
</style></head><body><main class="nf"><a class="nf-brand" href="/"><img src="/logo-icon.svg" alt="" width="38" height="32"><span>Immo<span>Adv</span></span></a><p class="nf-code">404</p><h1>Diese Seite gibt es nicht (mehr).</h1><p>Vielleicht hat sich die Adresse geändert. Von hier aus geht es weiter:</p><ul>${LINKS.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></main></body></html>`;

export function GET() {
  return new Response(HTML, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex' } });
}
export const HEAD = GET;
