// Schwebendes Kontaktformular (unten rechts) auf den öffentlichen Seiten.
// Privatkunden → /api/kontakt, Unternehmen → /api/b2b/contact (erscheint im Web-Admin unter Anfragen).
// Kein Tracking, keine Cookies; das Formular lädt erst beim ersten Öffnen.
const SKIP = /^\/(app|b2b-portal|intern|auth|partner|datenraum|p|verify|pruefen|kuendigen|widerrufen|b2b)(\/|$)/;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function mount() {
  if (SKIP.test(location.pathname) || document.body.classList.contains('is-app') || document.querySelector('.cw-fab')) return;
  const b2bPage = /^\/b2b(\/|$)/.test(location.pathname);
  const fab = document.createElement('button');
  fab.type = 'button'; fab.className = 'cw-fab'; fab.setAttribute('aria-haspopup', 'dialog'); fab.setAttribute('aria-expanded', 'false');
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z"/></svg><span>Fragen?</span>';
  document.body.appendChild(fab);
  // Über der Fußzeile ausblenden, damit nichts verdeckt wird (Panel bleibt offen, falls schon geöffnet).
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
  p.innerHTML = `<div class="cw-head"><strong id="cwT">Wie können wir helfen?</strong><button type="button" class="cw-x" aria-label="Schließen">×</button></div>
  <div class="cw-seg" role="radiogroup" aria-label="Ich schreibe als">
    <button type="button" role="radio" data-seg="b2c">Privatperson</button><button type="button" role="radio" data-seg="b2b">Unternehmen</button>
  </div>
  <form class="cw-form" novalidate>
    <label>Name<input name="name" autocomplete="name" required minlength="2" maxlength="120"></label>
    <label data-b2b>Unternehmen<input name="company" autocomplete="organization" minlength="2" maxlength="160"></label>
    <label>E-Mail<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
    <label data-b2c>Thema<select name="topic"><option value="frage">Allgemeine Frage</option><option value="kreditmappe">Kreditmappe</option><option value="konto">Konto &amp; Anmeldung</option><option value="zahlung">Zahlung &amp; Rechnung</option><option value="sonstiges">Sonstiges</option></select></label>
    <label>Nachricht<textarea name="message" rows="4" required minlength="10" maxlength="2000"></textarea></label>
    <input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="cw-hp">
    <label class="cw-check"><input type="checkbox" name="privacy" required> <span>Ich habe die <a href="/privacy" target="_blank" rel="noopener">Datenschutzhinweise</a> gelesen. Meine Angaben werden nur zur Beantwortung verwendet.</span></label>
    <p class="cw-msg" role="status" aria-live="polite"></p>
    <button class="btn btn-dark cw-send" type="submit">Nachricht senden</button>
    <p class="cw-note">Antwort in der Regel innerhalb von zwei Werktagen. Keine Finanzierungs-, Steuer- oder Rechtsberatung.</p>
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
    const btn = f.querySelector('.cw-send'); btn.disabled = true; btn.textContent = 'Wird gesendet …';
    const body = seg === 'b2b'
      ? { kind: 'demo', name: d.name, company: d.company, email: d.email, message: `[Kontakt-Widget] ${d.message}`, privacy: true, website: d.website, ts }
      : { name: d.name, email: d.email, topic: d.topic, message: d.message, page: location.pathname.slice(0, 200), privacy: true, website: d.website, ts };
    let r = null, j = {};
    try { r = await fetch(seg === 'b2b' ? '/api/b2b/contact' : '/api/kontakt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); j = await r.json().catch(() => ({})); } catch { /* Netzwerk */ }
    btn.disabled = false; btn.textContent = 'Nachricht senden';
    if (r && r.ok) {
      f.innerHTML = `<div class="cw-done"><strong>Danke, ${esc(String(d.name).split(' ')[0])}!</strong><p>Ihre Nachricht ist angekommen. Wir antworten an ${esc(d.email)}.</p></div>`;
      return;
    }
    msg.className = 'cw-msg cw-err';
    msg.textContent = (j && j.error) || 'Die Nachricht konnte gerade nicht gesendet werden. Bitte schreiben Sie an support@leaserun.com.';
    if (j && j.field && f[j.field]) f[j.field].focus();
  });
  return p;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
