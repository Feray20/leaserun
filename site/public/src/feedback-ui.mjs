// Improvement suggestions for consumers and businesses (Business Portal).
// Suggestions go to the Web-Admin of the respective area; the customer sees status and answer.
import { api, dt, esc } from './sess.mjs?v=892f3666';

const TOPICS = { bedienung: 'Ease of use & navigation', rechner: 'Calculators & metrics', kreditmappe: 'Lender Package & documents', inhalte: 'Content & explanations', neue_funktion: 'New feature', fehler: 'Found a bug', sonstiges: 'Other' };
const STATUS = { neu: 'Received', in_pruefung: 'Under review', geplant: 'Planned', umgesetzt: 'Done', abgelehnt: 'Not planned for now' };
const IMP = ['', 'Minor', 'Nice to have', 'Important', 'Very important', 'Essential'];

export async function mountFeedback(box, { area }) {
  let imp = 3;
  box.innerHTML = `<p class="form-note">What should we improve? Your suggestion goes straight to the LeaseRun team. Please don't include personal financial data.</p>
    <form class="fb-form" id="fbF" novalidate>
      <label>Topic<select name="topic" required>${Object.entries(TOPICS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
      <label class="fb-wide">Your suggestion<textarea name="text" rows="4" minlength="10" maxlength="4000" required placeholder="What exactly should change or get better – and why?"></textarea></label>
      <div class="fb-wide"><span class="fb-l">How important is this to you?</span><span class="fb-stars" role="radiogroup" aria-label="Importance">${[1, 2, 3, 4, 5].map((k) => `<button type="button" role="radio" data-imp="${k}" aria-label="${k} of 5 – ${IMP[k]}" aria-checked="${k === imp}" class="${k <= imp ? 'on' : ''}">★</button>`).join('')}</span> <small class="fb-imp" id="fbImp">${IMP[imp]}</small></div>
      <div class="fb-wide fb-act"><button class="btn btn-dark" type="submit">Send suggestion</button><span class="form-note" id="fbMsg" role="status" aria-live="polite"></span></div>
    </form>
    <h4 class="fb-h">Your suggestions</h4><div id="fbMine" class="fb-mine"><p class="lr-ld" role="status">Loading …</p></div>`;
  const f = box.querySelector('#fbF');
  const paintImp = () => { f.querySelectorAll('[data-imp]').forEach((b) => { const k = Number(b.dataset.imp); b.classList.toggle('on', k <= imp); b.setAttribute('aria-checked', String(k === imp)); }); box.querySelector('#fbImp').textContent = IMP[imp]; };
  f.querySelectorAll('[data-imp]').forEach((b) => b.onclick = () => { imp = Number(b.dataset.imp); paintImp(); });
  const mine = async () => {
    const r = await api(`/api/feedback?area=${area}`);
    const el = box.querySelector('#fbMine'); if (!el) return;
    const items = r.ok ? r.data.items || [] : [];
    el.innerHTML = items.length ? `<ul>${items.map((x) => `<li><div><strong>${esc(TOPICS[x.topic] || x.topic)}</strong><small>${dt(x.created_at)} · ${STATUS[x.status] || x.status}</small></div><p>${esc(x.text.length > 220 ? x.text.slice(0, 220) + ' …' : x.text)}</p>${x.answer ? `<p class="fb-ans"><b>Answer from the LeaseRun team:</b> ${esc(x.answer)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="form-note">No suggestions sent yet.</p>';
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    const m = box.querySelector('#fbMsg'), btn = f.querySelector('[type=submit]');
    const text = f.text.value.trim();
    if (text.length < 10) { m.textContent = 'Please describe your suggestion in at least 10 characters.'; f.text.focus(); return; }
    btn.disabled = true; m.textContent = 'Sending …';
    const r = await api('/api/feedback', { method: 'POST', body: JSON.stringify({ area, topic: f.topic.value, text, importance: imp, page: location.pathname + location.hash }) });
    btn.disabled = false;
    if (!r.ok) { m.textContent = r.data?.error || 'Sending failed.'; return; }
    f.reset(); imp = 3; paintImp(); m.textContent = 'Thank you! Your suggestion has arrived.'; mine();
  };
  mine();
}
