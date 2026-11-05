// LeaseRun on Cloudflare Workers (moved from Vercel, Nov 2026).
// Static pages come from dist/ (ASSETS); this script only adds what vercel.json did:
// www → apex redirect, security headers, no-store for /app/*, and the Stripe webhook at /api/stripe-webhook.
import { POST, GET } from './api/stripe-webhook.mjs';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://pxexxguhgqfxwhtnwcrj.supabase.co https://www.google-analytics.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

function withHeaders(response, pathname) {
  const res = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  if (pathname.startsWith('/app/')) res.headers.set('Cache-Control', 'no-store');
  return res;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === 'www.leaserun.com') {
      url.hostname = 'leaserun.com';
      return Response.redirect(url.toString(), 308);
    }

    if (url.pathname === '/api/stripe-webhook') {
      if (request.method === 'POST') return POST(request);
      if (request.method === 'GET' || request.method === 'HEAD') return GET();
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, POST' } });
    }

    return withHeaders(await env.ASSETS.fetch(request), url.pathname);
  },
};
