// Häufige Fragen nach Themen ordnen: Über der Liste erscheint eine Themenleiste („faq-topics“); es ist immer nur ein
// Thema sichtbar. Fragen tragen data-topic, die Liste data-faq. Ohne JavaScript bleiben alle Fragen sichtbar.
(function () {
  function init(list) {
    if (list.dataset.faqReady) return; list.dataset.faqReady = '1';
    const items = [...list.querySelectorAll(':scope > details[data-topic]')];
    const topics = [...new Set(items.map((d) => d.dataset.topic))];
    if (topics.length < 2) return;
    const bar = document.createElement('div');
    bar.className = 'faq-topics'; bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Themen');
    const show = (t, focus) => {
      bar.querySelectorAll('button').forEach((b) => { const on = b.dataset.t === t; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      items.forEach((d) => { const on = d.dataset.topic === t; d.hidden = !on; if (!on) d.open = false; });
    };
    topics.forEach((t) => {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.t = t;
      const n = items.filter((d) => d.dataset.topic === t).length;
      b.innerHTML = `${t} <span class="faq-n">${n}</span>`;
      b.addEventListener('click', () => show(t));
      bar.appendChild(b);
    });
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const i = topics.indexOf(bar.querySelector('[aria-selected="true"]').dataset.t);
      show(topics[(i + (e.key === 'ArrowRight' ? 1 : topics.length - 1)) % topics.length], true); e.preventDefault();
    });
    list.classList.add('faq-org');
    list.parentNode.insertBefore(bar, list);
    show(topics[0]);
  }
  const run = () => document.querySelectorAll('[data-faq]').forEach(init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  new MutationObserver(run).observe(document.documentElement, { childList: true, subtree: true });
})();
