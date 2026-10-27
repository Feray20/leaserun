// Floating contact form (bottom right) on the public pages.
// Consumers → /api/kontakt, businesses → /api/b2b/contact (shows up in the Web-Admin under Requests).
// No tracking, no cookies; the form only loads when first opened.
const SKIP = /^\/(app|business-portal|b2b-portal|internal|intern|auth|partners|partner|data-room|datenraum|p|verify|review|pruefen|cancel|kuendigen|refund|widerrufen|business|b2b)(\/|$)/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mount() {
  if (SKIP.test(location.pathname) || document.body.classList.contains('is-app') || document.querySelector('.cw-fab')) return;
  const b2bPage = /^\/(business|b2b)(\/|$)/.test(location.pathname);
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'cw-fab'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z"/></svg><span>Questions?</span>';
  document.body.appendChild(fab);
  // Hide over the footer so nothing is covered (the panel stays open if already open).
  if ('IntersectionObserver' in window) {
    const seen = new Set();
    const io = new IntersectionObserver((es) => { es.forEach((e) => (e.isIntersecting ? seen.add(e.target) : seen.delete(e.target))); fab.classList.toggle('cw-away', seen.size > 0 && (!panel || panel.hidden)); });
    const watch = () => document.querySelectorAll('footer.footer').forEach((f) => { if (!f.dataset.cwIo) { f.dataset.cwIo = '1'; io.observe(f); } });
    watch(); new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
  }
  let panel = null;
  const close = () => { if (!panel) return; panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus(); };
  fab.addEventListener('click', () => {
    if (!panel) panel = build(b2bPage, close);
    const open = panel.hidden;
    panel.hidden = !open; fab.setAttribute('aria-expanded', String(open));
    if (open && matchMedia('(pointer:fine)').matches) panel.querySelector('input[name=name]')?.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel && !panel.hidden) close(); });
}

function build(b2b, close) {
  const ts = Date.now();
  const p = document.createElement('div');
  p.className = 'cw-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'false'); p.setAttribute('aria-labelledby', 'cwT'); p.hidden = true;
  p.innerHTML = `<div class="cw-head"><strong id="cwT">How can we help?</strong><button type="button" class="cw-x" aria-label="Close">×</button></div>
  <div class="cw-seg" role="radiogroup" aria-label="I'm writing as">
    <button type="button" role="radio" data-seg="b2c">Individual</button><button type="button" role="radio" data-seg="b2b">Business</button>
  </div>
  <form class="cw-form" novalidate>
    <label>Name<input name="name" autocomplete="name" required minlength="2" maxlength="120"></label>
    <label data-b2b>Company<input name="company" autocomplete="organization" minlength="2" maxlength="160"></label>
    <label>Email<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
    <label data-b2c>Topic<select name="topic"><option value="frage">General question</option><option value="kreditmappe">Lender Package</option><option value="konto">Account &amp; sign-in</option><option value="zahlung">Payment &amp; billing</option><option value="sonstiges">Other</option></select></label>
    <label>Message<textarea name="message" rows="4" required minlength="10" maxlength="2000"></textarea></label>
    <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="cw-hp">
    <label class="cw-check"><input type="checkbox" name="privacy" required> <span>I have read the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>. My details are only used to answer my request.</span></label>
    <p class="cw-msg" role="status" aria-live="polite"></p>
    <button class="btn btn-dark cw-send" type="submit">Send message</button>
    <p class="cw-note">We usually reply within two business days. No lending, tax or legal advice.</p>
  </form>`;
  document.body.appendChild(p);
  const f = p.querySelector('form'), msg = p.querySelector('.cw-msg');
  let seg = b2b ? 'b2b' : 'b2c';
  const sync = () => {
    p.querySelectorAll('[data-seg]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.seg === seg)));
    p.querySelectorAll('[data-b2b]').forEach((x) => { x.hidden = seg !== 'b2b'; x.querySelector('input').required = seg === 'b2b'; });
    p.querySelectorAll('[data-b2c]').forEach((x) => { x.hidden = seg !== 'b2c'; });
  };
  p.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => { seg = b.dataset.seg; sync(); }));
  p.querySelector('.cw-x').addEventListener('click', close);
  sync();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = ''; msg.className = 'cw-msg';
    if (!f.checkValidity()) { f.reportValidity(); return; }
    const d = Object.fromEntries(new FormData(f));
    const btn = f.querySelector('.cw-send'); btn.disabled = true; btn.textContent = 'Sending …';
    const body = seg === 'b2b'
      ? { kind: 'demo', name: d.name, company: d.company, email: d.email, message: `[Kontakt-Widget] ${d.message}`, privacy: true, website: d.website, ts }
      : { name: d.name, email: d.email, topic: d.topic, message: d.message, page: location.pathname.slice(0, 200), privacy: true, website: d.website, ts };
    let r = null, j = {};
    try { r = await fetch(seg === 'b2b' ? '/api/b2b/contact' : '/api/kontakt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); } catch { /* network */ }
    btn.disabled = false; btn.textContent = 'Send message';
    if (r && r.ok) {
      f.innerHTML = `<div class="cw-done"><strong>Thanks, ${esc(String(d.name).split(' ')[0])}!</strong><p>Your message has arrived. We'll reply to ${esc(d.email)}.</p></div>`;
      return;
    }
    msg.className = 'cw-msg cw-err';
    msg.textContent = (j && j.error) || "Your message couldn't be sent right now. Please email support@leaserun.com.";
    if (j && j.field && f[j.field]) f[j.field].focus();
  });
  return p;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
