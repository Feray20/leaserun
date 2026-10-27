// Reply page for buttons in personal outreach emails (/request?art=…&w=…&t=…):
// check what you want and send – arrives as an email in the inbox. Alongside: book a Microsoft Teams meeting and "Not interested".
// The token t comes from the email (like the unsubscribe link) and links the reply; it contains no email address.
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ICON = {
  ok: '<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="currentColor" d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.1 8.4 18.7 7z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2Zm12 8H5v9h14v-9Z"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M6 2h8l6 6v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm7 1.5V9h5.5L13 3.5ZM8 13h8v1.6H8V13Zm0 4h8v1.6H8V17Z"/></svg>',
};

// Content per type. du = casual tone for creators (English has no formal/informal split; kept for the copy variants).
const ART = {
  unterlagen: {
    h: 'Request materials', sub: 'Check what you need – we’ll email it to you within one business day.',
    org: 'Publication / company', btn: 'Request materials',
    opts: [['keyfacts', 'Company profile & key facts about LeaseRun'], ['zahlen', 'Numbers & a worked example on the topic'], ['muster', 'Sample documents (Lender Package, property analysis)'], ['beitrag', 'Topic pitch, outline or guest article'], ['interview', 'Interview or expert source']],
  },
  kooperation: {
    h: 'Partner with LeaseRun', sub: 'The quickest way is a short Teams call. Or tell us here how you’d like to proceed. We work with lenders, mortgage brokers and property managers.',
    org: 'Company', btn: 'Send reply',
    opts: [['unterlagen', 'Please send materials and terms'], ['testzugang', 'Set up a free trial account'], ['rueckruf', 'Please call me back']],
  },
  creator: {
    du: true, h: 'Your creator access', sub: 'Quick sign-up – we’ll send you personal access with Investor Pro to try out, plus your own discount code.',
    org: 'Channel / community', btn: 'Request access',
    opts: [['zugang', 'Personal access (try Investor Pro)'], ['code', 'Own discount code for your community'], ['provision', 'Commission & payout info']],
    more: ['/creators', 'More about the creator program'],
  },
  zugang: {
    h: 'Request a trial account', sub: 'We’ll set up a free trial account for you and email you the login details.',
    org: 'Company / academy', btn: 'Request trial account',
    opts: [['zugang', 'Investor Pro trial'], ['demo', 'Short product demo via Teams'], ['community', 'Offer for our members / community']],
  },
};

async function post(body) {
  try {
    const r = await fetch('/api/anfrage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, data: { error: 'No connection. Please check your internet connection.' } }; }
}

function start() {
  const root = document.getElementById('anfrageApp');
  if (!root) return;
  const q = new URLSearchParams(location.search);
  const art = ART[q.get('art')] ? q.get('art') : 'unterlagen';
  const a = ART[art], du = !!a.du;
  const pre = new Set((q.get('w') || '').split(',').filter(Boolean));
  if (!pre.size) pre.add(a.opts[0][0]);
  const t = /^[A-Za-z0-9_-]{16,64}$/.test(q.get('t') || '') ? q.get('t') : '';
  const termin = `/book?topic=${encodeURIComponent(art === 'zugang' ? 'Product demo' : art === 'kooperation' ? 'Business partnership' : art === 'unterlagen' ? 'Press' : 'Business partnership')}${t ? `&t=${t}` : ''}`;
  const t0 = Date.now();
  document.title = `${a.h} | LeaseRun`;
  const hero = document.querySelector('.route-hero');
  if (hero) { const h = hero.querySelector('h1'), p = hero.querySelector('p'); if (h) h.textContent = a.h; if (p) p.textContent = 'Reply to our email – takes one minute.'; }

  root.innerHTML = `<div class="tm-grid">
    <form class="tm-card tm-form" id="afForm" novalidate>
      <div class="tm-step"><span>1</span>What do you need?</div>
      <p class="tm-intro">${esc(a.sub)}</p>
      <fieldset class="af-opts"><legend class="af-sr">Options</legend>${a.opts.map(([k, l]) => `<label class="af-opt"><input type="checkbox" name="opt" value="${k}"${pre.has(k) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</fieldset>
      <div class="tm-step af-step2"><span>2</span>Your details</div>
      <div class="tm-two"><label>Name *<input name="name" autocomplete="name" required maxlength="120"></label><label>Email *<input name="email" type="email" autocomplete="email" required maxlength="200"></label></div>
      <label>${esc(a.org)}<input name="org" autocomplete="organization" maxlength="160"></label>
      <label>${du ? 'Anything else we should know?' : 'Message'} (optional)<textarea name="message" rows="3" maxlength="2000"></textarea></label>
      <label class="tm-hp" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="tm-consent"><input type="checkbox" name="consent" required><span>I agree that LeaseRun may use my details to handle this request (<a href="/privacy" target="_blank">Privacy Policy</a>).</span></label>
      <button class="btn btn-dark tm-submit" type="submit">${esc(a.btn)}</button><p class="tm-msg" role="status"></p>
    </form>
    <aside class="af-side">
      <a class="tm-card af-link" href="${esc(termin)}"><span class="af-ic">${ICON.cal}</span><span><strong>Rather talk directly?</strong><span class="af-d">Pick an open time – 30 minutes via Microsoft Teams, free.</span></span></a>
      ${pre.has('muster') || art === 'unterlagen' ? `<a class="tm-card af-link" href="/sample-loan-package"><span class="af-ic">${ICON.doc}</span><span><strong>See examples right away</strong><span class="af-d">Sample Lender Package and property analysis as PDF.</span></span></a>` : ''}
      ${a.more ? `<a class="tm-card af-link" href="${a.more[0]}"><span class="af-ic">${ICON.doc}</span><span><strong>${esc(a.more[1])}</strong><span class="af-d">Your own link, materials and monthly payouts.</span></span></a>` : ''}
      ${t ? `<p class="af-no">Not interested? <a href="/api/abmelden?t=${t}">Unsubscribe here</a> – we won’t contact you again.</p>` : ''}
    </aside></div>`;

  const form = $('#afForm', root), submit = $('.tm-submit', form), msg = $('.tm-msg', form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form), opts = fd.getAll('opt');
    if (!opts.length) { msg.textContent = 'Please check at least one item.'; return; }
    if (!form.checkValidity()) { form.reportValidity(); return; }
    submit.disabled = true; submit.classList.add('busy'); submit.textContent = 'Sending …'; msg.textContent = '';
    const rr = await post({ art, opts, name: fd.get('name'), email: fd.get('email'), org: fd.get('org') || '', message: fd.get('message') || '', t, website: fd.get('website') || '', ts: t0, privacy: true });
    if (rr.ok) {
      const first = String(fd.get('name')).split(' ')[0];
      root.innerHTML = `<div class="tm-card tm-center tm-done"><span class="tm-ok">${ICON.ok}</span><h2>Thanks, ${esc(first)}!</h2>
        <p>${du ? 'Got it! We’ll get back to you within one business day at' : 'We’ve received your request and will get back to you within one business day at'} <strong>${esc(fd.get('email'))}</strong>.</p>
        <a class="btn btn-ghost" href="${esc(termin)}">Book a meeting now</a></div>`;
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    submit.disabled = false; submit.classList.remove('busy'); submit.textContent = a.btn;
    msg.textContent = rr.data.error || 'Sending failed. Please try again.';
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
