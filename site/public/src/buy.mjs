// "Buy now": purchase dialog with product, price, consent checkbox (terms; for subscriptions the automatic-renewal
// disclosure right next to the button) – then straight to the secure checkout page (Stripe Checkout).
// Not signed in: the purchase is remembered for 30 minutes; after signing in it continues to checkout automatically.
const SESSION = 'leaserun-auth-session-v1';
const INTENT = 'lr-buy-intent';
const TTL = 30 * 60 * 1000;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const usd0 = (c) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Colored icons per plan (Lender Package, Buyer Pass, Investor Pro) for plan cards and the purchase dialog.
const IC = {
  'credit-map': ['#0369A1', '#E0F2FE', '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M10 13h6M10 17h4"/>'],
  'buyer-pass': ['#047857', '#D1FAE5', '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><circle cx="12" cy="14" r="2"/><path d="M12 16v2"/>'],
  'pro-monthly': ['#0F2C59', '#E2E8F0', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'],
};
export const planIcon = (id) => { const i = IC[id] || ['#0F2C59', '#E2E8F0', '<circle cx="12" cy="12" r="8"/>']; return `<span class="offer-ic" style="--ic:${i[0]};--icbg:${i[1]}" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${i[2]}</svg></span>`; };

const token = () => { try { return JSON.parse(localStorage.getItem(SESSION) || 'null')?.access_token || ''; } catch { return ''; } };
export function takeIntent() {
  try {
    const x = JSON.parse(localStorage.getItem(INTENT) || 'null');
    localStorage.removeItem(INTENT);
    return x && Date.now() - x.at < TTL ? x : null;
  } catch { return null; }
}
export function peekIntent() {
  try { const x = JSON.parse(localStorage.getItem(INTENT) || 'null'); return x && Date.now() - x.at < TTL ? x : null; } catch { return null; }
}

let cfgP = null;
const config = () => (cfgP ||= fetch('/api/billing/config', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ enabled: false })));

// Loading overlay while the checkout page is being prepared.
function overlay(text) {
  let o = document.getElementById('buyOverlay');
  if (!o) { o = document.createElement('div'); o.id = 'buyOverlay'; o.className = 'buy-overlay'; o.setAttribute('role', 'status'); document.body.append(o); }
  o.innerHTML = `<div class="buy-ov-box"><span class="buy-spin" aria-hidden="true"></span><strong>${esc(text)}</strong><small>Encrypted connection · Payments processed by Stripe</small></div>`;
  return o;
}

// Back from the checkout page (without paying): the browser restores the page from its cache – including the
// overlay and disabled button. Reset everything so the page is usable again immediately (abandon never hangs).
function resetAfterBack() {
  document.getElementById('buyOverlay')?.remove();
  const d = document.getElementById('buyDlg'); if (d?.open) { try { d.close(); } catch { d.removeAttribute('open'); } }
  document.querySelectorAll('#buyGo, .btn-pay[disabled], [data-plan][disabled]').forEach((b) => { b.disabled = false; b.classList.remove('is-busy'); });
  document.documentElement.classList.remove('buy-busy');
}
addEventListener('pageshow', (e) => {
  const nav = performance.getEntriesByType?.('navigation')?.[0];
  if (e.persisted || nav?.type === 'back_forward') resetAfterBack();
});

// Open the checkout page (signed in). Returns an error message or redirects.
export async function goCheckout(plan, addon = null, reviewOk = false) {
  const t = token();
  if (!t) return 'login';
  const o = overlay('Opening secure checkout …');
  try { window.iaTrack?.('checkout_start', { plan }); } catch { /* ignore */ }
  try {
    // Never wait forever: abort after 30 s and show a clear message.
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 30000);
    const r = await fetch('/api/billing/checkout', { method: 'POST', signal: ac.signal, headers: { Authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify({ plan, consent: true, embedded: true, back: (location.pathname + location.hash).slice(0, 200), ...(addon ? { addon } : {}), ...(reviewOk ? { reviewOk: true } : {}) }) }).finally(() => clearTimeout(tm));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { o.remove(); return 'login'; }
    if (r.ok && j.clientSecret) { sessionStorage.setItem('lr-kasse', JSON.stringify({ ...j, at: Date.now() })); location.href = '/checkout'; return null; }
    if (!r.ok || !j.url) throw Error(j.error || 'The checkout page could not be opened.');
    location.href = j.url;
    // If the browser blocks the redirect (e.g. content blocker): offer a link to tap after 8 s.
    setTimeout(() => { if (!document.hidden && document.body.contains(o)) { const box = o.querySelector('.buy-ov-box'); if (box && !box.querySelector('a')) box.insertAdjacentHTML('beforeend', `<a class="btn btn-dark" href="${esc(j.url)}">Open checkout</a><button type="button" class="btn btn-ghost" data-ovx>Cancel</button>`); box?.querySelector('[data-ovx]')?.addEventListener('click', () => o.remove()); } }, 8000);
    return null;
  } catch (e) { o.remove(); return e.name === 'AbortError' ? 'Checkout is not responding right now. Please try again in a minute.' : (e.message === 'Failed to fetch' || e.message === 'Load failed' ? 'No connection. Please check your internet connection and try again.' : e.message); }
}

// Add-on (from preise.json) – never pre-selected.
let ADDON = null;
fetch('/data/preise.json').then((r) => r.json()).then((P) => { ADDON = (P?.privat?.addons || []).find((a) => a.id === 'leitfaden') || null; }).catch(() => {});

// Interest paid in the first 10 years of a 30-year fixed-rate mortgage.
function interest10(loan, z, years = 30) { const r = z / 12, n = years * 12, pmt = r > 0 ? (loan * r) / (1 - Math.pow(1 + r, -n)) : loan / n; let s = loan, sum = 0; for (let m = 0; m < 120 && s > 0; m++) { const i = s * r; sum += i; s -= pmt - i; } return sum; }
const roundTo = (x, k = 100) => Math.round(x / k) * k;

// Decision help in the purchase dialog – only with real numbers: from the customer's account (ctx) or clearly marked as an example.
// ctx = { loan, ratePct, gaps: [..], finPct, mappePct }
function insights(offer, ctx = {}) {
  const loan = Number(ctx.loan) || 0, z = (Number(ctx.ratePct) || 6.75) / 100;
  const own = loan > 0;
  const L = own ? loan : 300000;
  const diff = roundTo(interest10(L, z + 0.0025) - interest10(L, z));
  const anchor = `<p class="buy-anchor"><b>${own ? 'For your loan' : 'Example'}:</b> ${own ? '' : `${usd0(L * 100)} 30-year fixed loan, `}a rate just 0.25 percentage points higher costs about <b>${usd0(diff * 100)}</b> more in interest over 10 years. A complete, lender-ready package helps you compare Loan Estimates and negotiate – for a one-time ${usd(offer.cents)}.</p>`;
  const gaps = Array.isArray(ctx.gaps) ? ctx.gaps.filter(Boolean) : [];
  const gapBox = gaps.length ? `<p class="buy-gaps"><b>Your file has ${gaps.length} open ${gaps.length === 1 ? 'item' : 'items'} lenders typically ask for:</b> ${gaps.slice(0, 4).map(esc).join(', ')}${gaps.length > 4 ? ' …' : ''}. You can still add them after purchase.</p>` : '';
  const fin = Number.isFinite(ctx.finPct) ? Math.round(ctx.finPct) : null, mappe = Number.isFinite(ctx.mappePct) ? Math.round(ctx.mappePct) : null;
  const steps = fin == null && mappe == null ? '' : `<ol class="buy-steps"><li class="${fin >= 100 ? 'done' : ''}"><span>Financial profile</span><b>${fin ?? '–'}%</b></li><li class="${mappe >= 100 ? 'done' : ''}"><span>Package complete</span><b>${mappe ?? '–'}%</b></li><li class="on"><span>Unlock download</span><b>now</b></li></ol>`;
  return steps + anchor + gapBox;
}

// Load the dialog's own styles (also on pages whose stylesheet bundle does not include them, e.g. the home page).
let cssReady = null;
function buyCss() {
  if (cssReady) return cssReady;
  if ([...document.styleSheets].some((s) => /\/buy\.css/.test(s.href || ''))) return (cssReady = Promise.resolve());
  cssReady = new Promise((res) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = new URL('./buy.css' + new URL(import.meta.url).search, import.meta.url).href;
    l.onload = l.onerror = () => res(); document.head.append(l); setTimeout(res, 2500);
  });
  return cssReady;
}
buyCss();

export async function openBuy(offer, opts = {}) {
  const [cfg] = await Promise.all([config(), buyCss()]);
  try { window.iaTrack?.('checkout_open', { plan: offer.id }); } catch { /* ignore */ }
  let d = document.getElementById('buyDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'buyDlg'; d.className = 'buy-dlg'; document.body.append(d); }
  const loggedIn = Boolean(token());
  const sub = /month|monat/i.test(offer.intervall || '');
  d.innerHTML = `<form method="dialog" class="buy-in">
    <div class="buy-head">${IC[offer.id] ? planIcon(offer.id) : '<img src="/logo-icon.svg" alt="" width="34" height="29">'}<div><span class="buy-kick">LeaseRun · Order</span><h2>${esc(offer.name)}</h2></div><button class="buy-x" value="x" aria-label="Close">×</button></div>
    <div class="buy-price"><strong id="buyTotal">${usd(offer.cents)}</strong><span>${esc(offer.intervall || '')}</span></div>
    <p class="buy-tax">Plus sales tax where applicable${sub ? ' · renews monthly, cancel anytime' : ' · one-time, no subscription'}</p>
    ${offer.features?.length ? `<ul class="buy-feat">${offer.basis ? `<li class="offer-basis">${esc(offer.basis)}</li>` : ''}${offer.features.slice(0, offer.basis ? 2 : 3).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${cfg.enabled ? `
    ${/credit-map|buyer-pass/.test(offer.id) ? `<details class="buy-why"><summary>Why it’s worth it</summary>${insights(offer, opts.ctx)}</details>` : ''}
    ${/credit-map|buyer-pass/.test(offer.id) && ADDON ? `<label class="buy-bump"><input type="checkbox" id="buyAddon"> <span><strong>Add ${esc(ADDON.name)} · + ${usd(ADDON.cents)}</strong><small>${esc(ADDON.beschreibung || '')}</small></span></label>` : ''}
    ${cfg.testMode ? '<p class="buy-test">Test mode – nothing is charged. Test card 4242 4242 4242 4242, any future expiration date, any CVC.</p>' : ''}
    <label class="consent buy-consent"><input type="checkbox" id="buyOk"> <span>${sub
      ? 'I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and authorize LeaseRun to charge ' + usd(offer.cents) + ' per month (plus applicable sales tax), starting today and renewing automatically every month until I cancel.'
      : 'I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and the <a href="/refund" target="_blank" rel="noopener">Refund Policy</a>. One-time charge, no subscription; access starts right after payment.'}</span></label>
    ${sub ? `<p class="buy-renew"><strong>Auto-renewal:</strong> ${usd(offer.cents)}/month until you cancel. Cancel anytime online at <a href="/cancel" target="_blank" rel="noopener">leaserun.com/cancel</a>; you keep access until the end of the paid month.</p>` : ''}
    <button class="btn btn-pay buy-go" type="button" id="buyGo"><svg class="pay-lock" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>${loggedIn ? 'Continue to secure checkout' : 'Sign in and continue to checkout'} <span aria-hidden="true">→</span></button>
    <p class="buy-legal">See our <a href="/refund" target="_blank" rel="noopener">Refund Policy</a>.${/credit-map|buyer-pass/.test(offer.id) ? ' <a href="/terms#guarantee" target="_blank" rel="noopener">Money back</a> if your lender rejects the format.' : ''}</p>
    <label class="chk buy-rvok"><input type="checkbox" id="buyReview"> <span>You may email me once later to ask for a short review (optional).</span></label>
    ${loggedIn ? '' : '<p class="buy-note">No account yet? You’ll create one in about a minute in the next step.</p>'}
    <p class="buy-msg" id="buyMsg" role="alert"></p>` : `
    <p class="buy-soon"><strong>Purchases open soon.</strong> Payments are being switched on right now. Until then, you can try everything for free.</p>
    <a class="btn btn-dark buy-go" href="/auth/register">Start for free</a>`}
    <p class="buy-secure"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg> SSL encrypted · Secure payment by Stripe</p>
  </form>`;
  const go = d.querySelector('#buyGo');
  if (go) go.onclick = async () => {
    const ok = d.querySelector('#buyOk');
    if (!ok.checked) { ok.closest('label').classList.add('consent-missing'); d.querySelector('#buyMsg').textContent = 'Please check the box to accept the terms first.'; ok.focus(); return; }
    go.disabled = true;
    if (!token()) {
      try { localStorage.setItem(INTENT, JSON.stringify({ plan: offer.id, name: offer.name, addon: d.querySelector('#buyAddon')?.checked ? 'leitfaden' : null, reviewOk: Boolean(d.querySelector('#buyReview')?.checked), consentAt: new Date().toISOString(), at: Date.now() })); } catch { /* ignore */ }
      location.href = '/auth/login';
      return;
    }
    const addon = d.querySelector('#buyAddon')?.checked ? 'leitfaden' : null;
    const reviewOk = Boolean(d.querySelector('#buyReview')?.checked);
    // Remove the dialog's history entry cleanly first and only then go to checkout – otherwise a late history.back()
    // (especially Safari/iPad) can cancel the redirect or "Back" lands nowhere.
    d._leaving = true;
    if (history.state && history.state.iaBuy) await new Promise((ok) => { const t = setTimeout(ok, 450); addEventListener('popstate', () => { clearTimeout(t); ok(); }, { once: true }); history.back(); });
    d.close();
    const err = await goCheckout(offer.id, addon, reviewOk);
    if (err === 'login') { try { localStorage.setItem(INTENT, JSON.stringify({ plan: offer.id, name: offer.name, addon: d.querySelector('#buyAddon')?.checked ? 'leitfaden' : null, reviewOk: Boolean(d.querySelector('#buyReview')?.checked), consentAt: new Date().toISOString(), at: Date.now() })); } catch { /* ignore */ } location.href = '/auth/login'; return; }
    if (err) { (opts.onError || alert)(err); }
  };
  d.querySelector('#buyAddon')?.addEventListener('change', (e) => { const t = d.querySelector('#buyTotal'); if (t) t.textContent = usd(offer.cents + (e.target.checked ? ADDON.cents : 0)); });
  d.querySelector('#buyOk')?.addEventListener('change', (e) => { if (e.target.checked) { e.target.closest('label').classList.remove('consent-missing'); d.querySelector('#buyMsg').textContent = ''; } });
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
  // The back button closes the dialog instead of leaving the page.
  try {
    history.pushState({ iaBuy: 1 }, '', location.href);
    const pop = () => { removeEventListener('popstate', pop); if (d.open && !d._leaving) d.close(); };
    addEventListener('popstate', pop);
    d.addEventListener('close', () => { removeEventListener('popstate', pop); if (!d._leaving && history.state && history.state.iaBuy) history.back(); d._leaving = false; }, { once: true });
  } catch { /* ignore */ }
}

// After sign-in: continue the remembered purchase (only with consent given, at most 30 minutes old).
export async function resumeIntent(onError) {
  const x = peekIntent();
  if (!x || !token()) return false;
  const cfg = await config();
  if (!cfg.enabled) { takeIntent(); return false; }
  takeIntent();
  const err = await goCheckout(x.plan, x.addon || null, Boolean(x.reviewOk));
  if (err && err !== 'login') (onError || alert)(err);
  return !err;
}
