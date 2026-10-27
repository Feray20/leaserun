// Show real Google reviews (only if there are any) and ask for reviews – no incentives, the same for every customer
// (FTC Consumer Review rules). Note: LeaseRun does not verify whether reviews come from actual customers.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let P = null;
export const reviews = () => (P ||= fetch('/api/reviews').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
const stars = (v) => `<span class="rv-stars" style="--rv:${Math.max(0, Math.min(5, v)) / 5 * 100}%" aria-hidden="true">★★★★★</span>`;

// Badge with average and count – only appears when Google returns real values.
export async function mountBadges(root = document) {
  const els = root.querySelectorAll('[data-reviews]');
  if (!els.length) return;
  const r = await reviews();
  if (!(r.rating > 0) || !(r.count > 0)) return;
  const n = r.rating.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  els.forEach((el) => {
    el.innerHTML = `<a class="rv-badge" href="${esc(r.mapsUrl || r.url || '#')}" target="_blank" rel="noopener">${stars(r.rating)}<b>${n}</b><span>from ${r.count.toLocaleString('en-US')} Google review${r.count === 1 ? '' : 's'}</span></a>
      <small class="rv-note">Reviews come from Google. LeaseRun does not verify whether they were written by actual customers.</small>`;
    el.hidden = false;
  });
}

// Ask for a review (account, Business Portal) – only when the review link is set.
export async function askHtml(area = 'b2c') {
  const r = await reviews();
  if (!r.url) return '';
  return `<div class="rv-ask"><div><strong>How do you like LeaseRun?</strong><span>${area === 'b2b' ? 'Your honest review helps other brokers and lenders choose.' : 'Your honest review helps other buyers – and helps us get better.'}</span></div><a class="btn btn-outline" href="${esc(r.url)}" target="_blank" rel="noopener">Review us on Google</a></div>`;
}

mountBadges();
addEventListener("load", () => mountBadges());
