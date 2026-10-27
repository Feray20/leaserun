// Branded loader with work steps for longer tasks (read listing, calculate, create PDF, send).
// Shows only steps that actually run; each step stays visible briefly so it can be read.
const LOGO = '<svg viewBox="-2 -2 104 88" width="54" height="46" aria-hidden="true"><defs><linearGradient id="ldg" gradientUnits="userSpaceOnUse" x1="0" y1="84" x2="100" y2="0"><stop offset="0" stop-color="#0F2C59"/><stop offset=".55" stop-color="#0284C7"/><stop offset="1" stop-color="#38BDF8"/></linearGradient></defs><g fill="url(#ldg)"><polygon points="50,8.3 63.1,19.4 62.6,22.5 49,34 45.2,31.1 5.3,68.9 2.5,70 3.1,51.7"/><polygon points="98.8,0.7 93.4,37.3 83.6,29.8 50.8,62.3 43.7,57.9 17.2,82.6 0.2,82.6 42.2,38.4 50.3,40.1 69.6,19.5 64.6,8.1"/><polygon points="82.3,37.6 99.5,53.6 99.6,84 88.6,83.6 62.5,57"/></g></svg>';
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const STEP_MIN = 450;

export function work(title, steps = []) {
  document.querySelector('.lr-work')?.remove();
  const el = document.createElement('div');
  el.className = 'lr-work';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="lr-work-box"><div class="lr-ll" aria-hidden="true">${LOGO}</div><strong>${esc(title)}</strong>
    <ol class="lr-work-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
  document.body.appendChild(el);
  document.body.classList.add('lr-working');
  // Safety net: the loader must never lock the page for good (scrolling/buttons would stop working).
  // After 20 s it can be tapped closed, after 90 s it disappears by itself.
  const t1 = setTimeout(() => { if (!el.isConnected) return; el.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-outline lr-work-x">Continue in the background – close</button>'); el.querySelector('.lr-work-x').onclick = () => api.close(); }, 20000);
  const t2 = setTimeout(() => api.close(), 90000);
  let cur = -1, since = Date.now();
  const lis = () => [...el.querySelectorAll('.lr-work-steps li')];
  const api = {
    // Mark the next step active (waits briefly if the previous one was too fast).
    async step(i) {
      const left = STEP_MIN - (Date.now() - since);
      if (cur >= 0 && left > 0) await wait(left);
      lis().forEach((li, k) => { li.classList.toggle('done', k < i); li.classList.toggle('on', k === i); });
      cur = i; since = Date.now();
    },
    async done(text = 'Done') {
      const left = STEP_MIN - (Date.now() - since);
      if (left > 0) await wait(left);
      lis().forEach((li) => { li.classList.add('done'); li.classList.remove('on'); });
      el.classList.add('ok');
      const s = el.querySelector('strong'); if (s) s.textContent = text;
      await wait(500);
      api.close();
    },
    close() { clearTimeout(t1); clearTimeout(t2); el.remove(); if (!document.querySelector('.lr-work')) document.body.classList.remove('lr-working'); },
  };
  return api;
}

// For classic scripts (without module import).
window.iaWork = work;

// Small branded loading icon for placeholders ("Loading …"): logo fixed, ring spinning.
export const logoLoader = (text = 'Loading …') => `<div class="lr-ll-wrap" role="status"><div class="lr-ll lr-ll-s" aria-hidden="true">${LOGO}</div><span>${esc(text)}</span></div>`;
window.iaLogoLoader = logoLoader;
