// Markenlader mit Arbeitsschritten für längere Vorgänge (Exposé lesen, rechnen, PDF erstellen, senden).
// Zeigt nur Schritte, die tatsächlich laufen; jeder Schritt bleibt kurz sichtbar, damit er lesbar ist.
const LOGO = '<svg viewBox="-2 -2 104 88" width="54" height="46" aria-hidden="true"><defs><linearGradient id="ldg" gradientUnits="userSpaceOnUse" x1="0" y1="84" x2="100" y2="0"><stop offset="0" stop-color="#0F2C59"/><stop offset=".55" stop-color="#0284C7"/><stop offset="1" stop-color="#38BDF8"/></linearGradient></defs><g fill="url(#ldg)"><polygon points="50,8.3 63.1,19.4 62.6,22.5 49,34 45.2,31.1 5.3,68.9 2.5,70 3.1,51.7"/><polygon points="98.8,0.7 93.4,37.3 83.6,29.8 50.8,62.3 43.7,57.9 17.2,82.6 0.2,82.6 42.2,38.4 50.3,40.1 69.6,19.5 64.6,8.1"/><polygon points="82.3,37.6 99.5,53.6 99.6,84 88.6,83.6 62.5,57"/></g></svg>';
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const STEP_MIN = 450;

export function work(title, steps = []) {
  document.querySelector('.ia-work')?.remove();
  const el = document.createElement('div');
  el.className = 'ia-work';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="ia-work-box">${LOGO}<div class="ia-work-spin" aria-hidden="true"></div><strong>${esc(title)}</strong>
    <ol class="ia-work-steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>`;
  document.body.appendChild(el);
  document.body.classList.add('ia-working');
  let cur = -1, since = Date.now();
  const lis = () => [...el.querySelectorAll('.ia-work-steps li')];
  const api = {
    // Nächsten Schritt aktiv setzen (wartet kurz, falls der vorige zu schnell war).
    async step(i) {
      const left = STEP_MIN - (Date.now() - since);
      if (cur >= 0 && left > 0) await wait(left);
      lis().forEach((li, k) => { li.classList.toggle('done', k < i); li.classList.toggle('on', k === i); });
      cur = i; since = Date.now();
    },
    async done(text = 'Fertig') {
      const left = STEP_MIN - (Date.now() - since);
      if (left > 0) await wait(left);
      lis().forEach((li) => { li.classList.add('done'); li.classList.remove('on'); });
      el.classList.add('ok');
      const s = el.querySelector('strong'); if (s) s.textContent = text;
      await wait(500);
      api.close();
    },
    close() { el.remove(); document.body.classList.remove('ia-working'); },
  };
  return api;
}

// Für klassische Skripte (ohne Modul-Import).
window.iaWork = work;
