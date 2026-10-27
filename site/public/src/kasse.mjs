// leaserun.com/checkout: Stripe payment form embedded in a LeaseRun page (header, order summary, trust notes).
// The data (clientSecret, summary) is briefly stored in sessionStorage by the buy button; without data → back to plans.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (c) => (Number(c || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const root = $('#kasse');
const CHECK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>';

function fail(msg, back = '/pricing') {
  root.innerHTML = `<div class="ks-card ks-center"><h1>Payment not available</h1><p>${esc(msg)}</p><a class="btn btn-dark" href="${esc(back)}">Back to plans</a></div>`;
}

let stripeP = null;
function loadStripe() {
  if (stripeP) return stripeP;
  stripeP = new Promise((res, rej) => {
    if (window.Stripe) return res(window.Stripe);
    const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.async = true;
    // Never hang: if Stripe.js does not arrive within 15 s, show a clear message with a way back.
    const t = setTimeout(() => rej(Error('The payment form is taking too long to load. Please check your connection or try again in a minute.')), 15000);
    s.onload = () => { clearTimeout(t); window.Stripe ? res(window.Stripe) : rej(Error('Stripe did not load')); };
    s.onerror = () => { clearTimeout(t); rej(Error('The payment form could not be loaded. Please turn off ad blockers for this page or try again later.')); };
    document.head.append(s);
  });
  stripeP.catch(() => { stripeP = null; });
  return stripeP;
}
// Speed: start loading Stripe.js right away while the page is built.
loadStripe().catch(() => {});

// Back button on the checkout page: go straight and cleanly back to the plans (no stuck in-between states of the
// embedded payment form). The checkout session stays valid for up to 23 hours.
function guardBack(back) {
  try {
    if (!history.state?.ksGuard) { history.replaceState({ ksBase: 1 }, ''); history.pushState({ ksGuard: 1 }, ''); }
    addEventListener('popstate', (e) => { if (!e.state?.ksGuard) location.replace(back); });
  } catch { /* older browsers: normal back */ }
}
// Restored from the back/forward cache: rebuild – the payment form cannot be resumed.
addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });

async function start() {
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem('lr-kasse') || 'null'); } catch { /* ignore */ }
  // An open order can be resumed even after closing the tab (the Stripe session is valid for up to 23 hours).
  if (!d) { try { d = JSON.parse(localStorage.getItem('lr-kasse-open') || 'null'); } catch { /* ignore */ } }
  else { try { localStorage.setItem('lr-kasse-open', JSON.stringify(d)); } catch { /* private mode */ } }
  // Abandon (leaving the page): remember the time – the "order still open" hint then shows once, for at most 4 minutes.
  addEventListener('pagehide', () => { try { const o = JSON.parse(localStorage.getItem('lr-kasse-open') || 'null'); if (o) { o.left = Date.now(); localStorage.setItem('lr-kasse-open', JSON.stringify(o)); localStorage.removeItem('lr-kasse-hint-seen'); } } catch { /* private mode */ } });
  if (!d || !d.clientSecret || !d.publishableKey || Date.now() - (d.at || 0) > 23 * 3600_000) { try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } return fail('This checkout session has expired or was already completed. Please choose your plan again.', d?.summary?.back || '/pricing'); }
  const s = d.summary || {}, b2b = s.area === 'b2b', setup = s.kind === 'setup';
  const sub = Boolean(s.interval);
  guardBack(s.back || '/pricing');
  if (setup) document.title = 'Update payment method | LeaseRun';
  // Update payment method (no order): own summary, nothing is charged.
  const steps = setup ? '' : `<ol class="ks-steps" aria-label="Progress"><li class="done">Choose</li><li class="on">Pay</li><li>${b2b ? 'Use in the portal' : 'Start right away'}</li></ol>`;
  document.querySelector('.ks-main')?.insertAdjacentHTML('afterbegin', `<div class="ks-in ks-hero">${steps}<p class="ks-hero-t">${setup ? 'Update your payment method securely' : 'One last step – pay securely'}</p></div>`);
  root.innerHTML = setup ? `<aside class="ks-card ks-sum"><p class="ks-kick">${b2b ? 'Business account' : 'Your account'}</p><h1>Update payment method</h1>
      <p class="ks-tax">Add a new payment method. It becomes your default right away for future charges${b2b ? ' and your subscription' : ' and any active subscription'}. Nothing is charged now.</p>
      <ul class="ks-trust"><li>${CHECK}Encrypted by Stripe – LeaseRun never sees your card details</li><li>${CHECK}Applies right away to all future payments</li><li>${CHECK}Receipts stay in your account and arrive by email</li></ul>
      <a class="ks-back" href="${esc(s.back || '/')}" data-ksback>← Back to your account</a></aside>
    <section class="ks-card ks-pay" aria-label="Payment method"><div id="ksPay"><div class="lr-ld" role="status">Loading form …</div></div></section>` : `<aside class="ks-card ks-sum"><p class="ks-kick">Your order</p><h1>${esc(s.title || 'LeaseRun')}</h1>
      <ul class="ks-lines">${(s.lines || []).map((l) => `<li><span>${esc(l.label)}</span><strong>${usd(l.amount)}</strong></li>`).join('')}</ul>
      ${s.total != null ? `<div class="ks-total"><span>Total${s.interval ? ` <small>${esc(s.interval)}</small>` : ''}</span><strong>${usd(s.total)}</strong></div><p class="ks-tax">Sales tax, if any, is shown in the payment form before you pay · Promo codes can be entered in the payment form</p>` : ''}
      ${sub && !b2b ? `<p class="ks-tax"><strong>Automatic renewal:</strong> ${s.total != null ? usd(s.total) : 'The price above'} ${esc(s.interval)}, charged today and then every month until you cancel. Cancel anytime online at <a href="/cancel">leaserun.com/cancel</a> – access continues until the end of the paid month.</p>` : ''}
      <ul class="ks-trust"><li>${CHECK}Encrypted payment by Stripe</li><li>${CHECK}Receipt automatically by email</li><li>${CHECK}${b2b ? 'Manage your subscription anytime in the portal' : 'Instant access after payment'}</li></ul>
      <p class="ks-help">Questions about your order? <a href="mailto:support@leaserun.com">support@leaserun.com</a> – we’re happy to help.</p>
      <a class="ks-back" href="${esc(s.back || '/pricing')}" data-ksback>← Back to plans</a></aside>
    <section class="ks-card ks-pay" aria-label="Payment"><div id="ksPay"><div class="lr-ld" role="status">Loading payment form …</div></div></section>`;
  // "Back to plans" replaces the history entry – so a later Back never lands on the checkout again.
  root.querySelector('[data-ksback]')?.addEventListener('click', (e) => { e.preventDefault(); location.replace(s.back || '/pricing'); });
  try {
    const Stripe = await loadStripe();
    const stripe = Stripe(d.publishableKey, { locale: 'en' });
    const opts = { fetchClientSecret: async () => d.clientSecret, onComplete: () => { try { sessionStorage.removeItem('lr-kasse'); localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ } } };
    // Newer Stripe.js: createEmbeddedCheckoutPage (for ui_mode "embedded_page"), older: initEmbeddedCheckout.
    const co = stripe.createEmbeddedCheckoutPage ? await stripe.createEmbeddedCheckoutPage(opts) : await stripe.initEmbeddedCheckout(opts);
    $('#ksPay').innerHTML = '';
    co.mount('#ksPay');
  } catch (e) {
    try { localStorage.removeItem('lr-kasse-open'); } catch { /* ignore */ }
    $('#ksPay').innerHTML = `<div class="ks-err"><p>${esc(e.message || 'The payment form could not be loaded.')}</p><a class="btn btn-dark" href="${esc(s.back || '/pricing')}">Back</a></div>`;
  }
}
start();
