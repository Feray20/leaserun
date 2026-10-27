// "Help & Support" – one place for everything (consumer area and Business Portal separated by area):
// report a technical problem · suggest an improvement · email support.
const CSS = `.hf{display:grid;gap:14px}.hf-tabs{display:inline-grid;grid-auto-flow:column;gap:4px;background:#F1F5F9;border-radius:12px;padding:4px;max-width:100%;overflow-x:auto}
.hf-tabs button{border:0;background:transparent;border-radius:9px;min-height:40px;padding:0 14px;font:inherit;font-size:14px;font-weight:700;color:#475569;cursor:pointer;white-space:nowrap}
.hf-tabs button[aria-selected=true]{background:#fff;color:#0F2C59;box-shadow:0 1px 4px rgba(15,44,89,.18)}
.hf-mail{display:grid;gap:8px;padding:14px;border:1px solid #E2E8F0;border-radius:12px;background:#fff}.hf-mail a.btn{justify-self:start}
@media (max-width:640px){.hf-tabs{display:grid;grid-auto-flow:row;width:100%}.hf-tabs button{width:100%}}`;

export function mountHilfe(box, { area, start = 'problem' }) {
  if (!document.getElementById('hfCss')) { const st = document.createElement('style'); st.id = 'hfCss'; st.textContent = CSS; document.head.append(st); }
  const T = [['problem', 'Technical problem'], ['vorschlag', 'Suggest an improvement'], ['mail', 'Email']];
  box.innerHTML = `<div class="hf"><div><h2 style="margin:0 0 4px">Help &amp; Support</h2><p class="form-note" style="margin:0">Report a problem, suggest an idea or write to us directly – we usually answer within 12 hours.</p></div>
    <div class="hf-tabs" role="tablist">${T.map(([k, l]) => `<button type="button" role="tab" data-hf="${k}" aria-selected="${k === start}">${l}</button>`).join('')}</div><div id="hfBody"></div></div>`;
  const body = box.querySelector('#hfBody');
  const show = (k) => {
    box.querySelectorAll('[data-hf]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.hf === k)));
    body.innerHTML = '<p class="lr-ld" role="status">Loading …</p>';
    if (k === 'problem') import('./support-ui.mjs?v=892f3666').then((m) => m.mountSupport(body, { area })).catch(() => { body.innerHTML = '<p class="form-note">Could not be loaded. Please email support@leaserun.com.</p>'; });
    else if (k === 'vorschlag') import('./feedback-ui.mjs?v=892f3666').then((m) => m.mountFeedback(body, { area })).catch(() => { body.innerHTML = '<p class="form-note">Could not be loaded.</p>'; });
    else body.innerHTML = `<div class="hf-mail"><strong>Email support</strong><p class="form-note" style="margin:0">For anything that doesn't fit a form. Please include ${area === 'b2b' ? 'your company name and customer ID' : 'your account email'}.</p><a class="btn btn-dark" href="mailto:support@leaserun.com?subject=${encodeURIComponent(area === 'b2b' ? 'Business Portal – request' : 'Consumer account – request')}">Email support@leaserun.com</a></div>`;
  };
  box.querySelectorAll('[data-hf]').forEach((b) => b.onclick = () => show(b.dataset.hf));
  show(start);
}
