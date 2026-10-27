// Echte Google-Bewertungen anzeigen (nur wenn vorhanden) und um Bewertungen bitten – ohne Anreize, an alle Kunden gleich.
// Hinweis nach § 5b Abs. 3 UWG: LeaseRun prüft nicht, ob Bewertungen von tatsächlichen Kunden stammen.
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let P = null;
export const reviews = () => (P ||= fetch('/api/reviews').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
const stars = (v) => `<span class="rv-stars" style="--rv:${Math.max(0, Math.min(5, v)) / 5 * 100}%" aria-hidden="true">★★★★★</span>`;

// Badge mit Durchschnitt und Anzahl – erscheint nur, wenn Google echte Werte liefert.
export async function mountBadges(root = document) {
  const els = root.querySelectorAll('[data-reviews]');
  if (!els.length) return;
  const r = await reviews();
  if (!(r.rating > 0) || !(r.count > 0)) return;
  const n = r.rating.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  els.forEach((el) => {
    el.innerHTML = `<a class="rv-badge" href="${esc(r.mapsUrl || r.url || '#')}" target="_blank" rel="noopener">${stars(r.rating)}<b>${n}</b><span>aus ${r.count.toLocaleString('de-DE')} Google-Bewertung${r.count === 1 ? '' : 'en'}</span></a>
      <small class="rv-note">Bewertungen stammen von Google. LeaseRun prüft nicht, ob sie von tatsächlichen Kundinnen und Kunden stammen.</small>`;
    el.hidden = false;
  });
}

// Bitte um eine Bewertung (Konto, Unternehmensportal) – nur wenn der Bewertungslink eingetragen ist.
export async function askHtml(area = 'b2c') {
  const r = await reviews();
  if (!r.url) return '';
  return `<div class="rv-ask"><div><strong>Wie gefällt Ihnen LeaseRun?</strong><span>${area === 'b2b' ? 'Ihre ehrliche Bewertung hilft anderen Beratern und Banken bei der Auswahl.' : 'Ihre ehrliche Bewertung hilft anderen Käufern – und uns, besser zu werden.'}</span></div><a class="btn btn-outline" href="${esc(r.url)}" target="_blank" rel="noopener">Bei Google bewerten</a></div>`;
}

mountBadges();
addEventListener("load", () => mountBadges());
