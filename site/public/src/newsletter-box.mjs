// Newsletter signup box "Home-buying checklist PDF + monthly mortgage rate update" on the home page, /software, Learn/Guides,
// /checklist, /deadlines, /learning-path and /sample-loan-package. Loaded by menu.js.
// Double opt-in via /api/newsletter (box: true): subscribed only after clicking the confirmation link, the checklist then
// comes by email. Required checkbox, never pre-checked. No cookie, no local storage.
// Counting: event "newsletter_signup" in visitor analytics (only after consent; page = path).
const PAGES = /^\/($|software$|learn(\/|$)|guides(\/|$)|checklist$|deadlines$|learning-path$|sample-loan-package$)/;
const PDF = '/api/newsletter/checkliste';
const here = () => location.pathname.replace(/\/+$/, '') || '/';

const CSS = `.nlb-wrap{padding:28px 0}.nlb{max-width:720px;margin:0 auto;padding:22px 20px;border:1px solid var(--lr-line,#e2e8f0);border-radius:var(--lr-radius,18px);background:var(--lr-soft,#f8fafc)}
.nlb h2{margin:0 0 6px;font-size:1.25rem;line-height:1.3}.nlb>p{margin:0 0 14px;color:var(--lr-muted,#64748b)}
.nlb-row{display:flex;flex-direction:column;gap:10px}.nlb-row input[type=email]{width:100%;min-height:48px;padding:10px 14px;font-size:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:inherit;box-sizing:border-box}
.nlb-row .btn{width:100%;min-height:48px;font-size:16px;justify-content:center}
.nlb-ok{display:flex;gap:10px;align-items:flex-start;margin:14px 0 0;font-size:.95rem;line-height:1.45;cursor:pointer}.nlb-ok input{flex:none;width:22px;height:22px;margin:1px 0 0}
.nlb-msg{margin:10px 0 0;font-size:.95rem;min-height:1em}.nlb-msg.err{color:#b91c1c}.nlb-hp,.nlb-sr{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.nlb-in{padding:8px 0 24px}
.nlb input:focus-visible,.nlb .btn:focus-visible{outline:3px solid var(--lr-link,#0369a1);outline-offset:2px}
@media (min-width:640px){.nlb{padding:26px 28px}.nlb-row{flex-direction:row}.nlb-row input[type=email]{flex:1}.nlb-row .btn{width:auto;flex:none}}
.nlb-banner{position:fixed;left:12px;right:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:60;max-width:560px;margin:0 auto;padding:14px 16px;border-radius:14px;background:#0F2C59;color:#fff;box-shadow:0 12px 40px rgba(15,23,42,.25);font-size:16px}
.nlb-banner a{color:#fff;font-weight:700}.nlb-banner button{float:right;margin:-4px -6px 0 8px;min-width:44px;min-height:44px;border:0;background:none;color:#fff;font-size:22px;cursor:pointer}`;

function style() {
  if (document.getElementById('nlb-css')) return;
  const s = document.createElement('style'); s.id = 'nlb-css'; s.textContent = CSS; document.head.appendChild(s);
}

const HTML = (n) => `<div class="container"><form class="nlb" novalidate aria-labelledby="nlbH${n}">
<h2 id="nlbH${n}">Home-buying checklist PDF + monthly mortgage rate update</h2>
<p>Every document lenders typically ask for – ready to check off. Plus a short monthly explainer on where mortgage rates are heading.</p>
<div class="nlb-row"><label class="nlb-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
<label for="nlbE${n}" class="nlb-sr">Email address</label><input id="nlbE${n}" name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email" placeholder="Your email address">
<button class="btn btn-dark" type="submit">Get the checklist</button></div>
<label class="nlb-ok"><input type="checkbox" name="consent" required> <span>I want to receive the LeaseRun newsletter. Unsubscribe any time via the link in every email. Learn more in our <a href="/privacy">Privacy Policy</a>.</span></label>
<p class="nlb-msg" role="status" aria-live="polite"></p></form></div>`;

function bind(form) {
  if (form.dataset.nlb) return;
  form.dataset.nlb = '1';
  const ts = Date.now();
  const msg = form.querySelector('.nlb-msg');
  const say = (t, err) => { msg.textContent = t; msg.classList.toggle('err', Boolean(err)); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('Please enter a valid email address.', true); form.email.focus(); return; }
    // No signup without the checkbox (the server checks this too).
    if (!form.consent.checked) { say('Please check the box so we may send you the checklist and the newsletter.', true); form.consent.focus(); return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; say('Sending …');
    try {
      const r = await fetch('/api/newsletter', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, segment: 'b2c', box: true, source: here().slice(0, 56), consent: true, website: form.website.value, ts }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { say(d.error || "That didn't work. Please try again later.", true); btn.disabled = false; return; }
      if (d.already) { msg.innerHTML = `You're already subscribed. Here is your <a href="${PDF}" target="_blank" rel="noopener">home-buying checklist PDF</a>.`; msg.classList.remove('err'); return; }
      say('Almost done: please confirm your subscription with the link in the email we just sent you (check your spam folder too). You will get the checklist right after.');
      form.email.value = ''; form.consent.checked = false;
      try { window.iaTrack?.('newsletter_signup'); } catch { /* analytics must never interfere */ }
    } catch { say('No connection. Please try again later.', true); btn.disabled = false; }
  });
}

// Placement per page.
function place(main) {
  const sec = document.createElement('section');
  sec.className = 'nlb-wrap'; sec.setAttribute('data-noklapp', ''); sec.innerHTML = HTML(1);
  // Always at the very bottom, right above the footer (owner's wish, Oct 27, 2026) – on every page, home page included.
  main.appendChild(sec);
  return sec.querySelector('form');
}

// Feedback after clicking the confirmation or unsubscribe link (?newsletter=…).
function banner() {
  const k = new URLSearchParams(location.search).get('newsletter');
  const t = { bestaetigt: `Thanks – your subscription is confirmed. Here is your <a href="${PDF}" target="_blank" rel="noopener">home-buying checklist PDF</a> (the link is also on its way by email).`, abgemeldet: "You're unsubscribed and won't receive the newsletter anymore.", ungueltig: 'This link is invalid or has expired.' }[k];
  if (!t || document.querySelector('.nlb-banner')) return;
  const m = document.createElement('div');
  m.className = 'nlb-banner'; m.setAttribute('role', 'status');
  m.innerHTML = `<button type="button" aria-label="Close notice">×</button>${t}`;
  m.querySelector('button').onclick = () => m.remove();
  document.body.appendChild(m);
  if (k !== 'bestaetigt') setTimeout(() => m.remove(), 8000);
}

function mount() {
  if (!PAGES.test(here()) || document.body.classList.contains('is-app')) return;
  const main = document.querySelector('main#inhalt') || document.querySelector('main');
  if (!main) return;
  style();
  banner();
  // Already prerendered (prerender captures the page content) → only bind, don't insert twice.
  bind(main.querySelector('form.nlb') || place(main));
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', mount); else mount();
