// Web-Admin "Technical problems": reports with screenshots from consumer accounts (B2C) or the Business Portal (B2B).
// Goal: an answer within 12 hours – overdue reports are on top and marked red.
import { api, dtt, esc } from './sess.mjs?v=892f3666';

const CATS = { anmeldung: 'Sign-in & account', zahlung: 'Payment & plan', anzeige: 'Display & usability', werkzeug: 'Calculators & tools', dokument: 'PDF, Lender Package & documents', langsam: "Slow / won't load", sonstiges: 'Other' };
const SEV = { blockiert: ['Blocked', 'bad'], stoert: ['Annoying', 'warn'], klein: ['Minor', ''] };
const STATUS = { neu: 'New', in_arbeit: 'In progress', rueckfrage: 'Waiting for customer', geloest: 'Resolved', geschlossen: 'Closed' };
const OPEN = ['neu', 'in_arbeit', 'rueckfrage'];
const CSS = `.tk-list{display:grid;gap:12px}.tk{border:1px solid #E2E8F0;border-radius:14px;background:#fff;padding:14px 16px;display:grid;gap:10px}
.tk.late{border-color:#FCA5A5;box-shadow:inset 4px 0 0 #DC2626}.tk-h{display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px 12px;align-items:baseline}
.tk-h strong{color:#0F2C59;font-size:15px;overflow-wrap:anywhere}.tk-m{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12.5px;color:#64748B;align-items:center}
.tk-t{white-space:pre-wrap;font-size:14px;line-height:1.5;margin:0;color:#0F172A;overflow-wrap:anywhere}.tk-x{font-size:13px;color:#334155;background:#F8FAFC;border-radius:10px;padding:8px 10px;margin:0;white-space:pre-wrap}
.tk-shots{display:flex;flex-wrap:wrap;gap:8px}.tk-shots a{display:block;width:120px;height:84px;border-radius:8px;overflow:hidden;border:1px solid #E2E8F0}.tk-shots img{width:100%;height:100%;object-fit:cover}
.tk-f{display:grid;gap:8px;border-top:1px solid #EEF2F7;padding-top:10px}.tk-f textarea{width:100%;box-sizing:border-box;border:1px solid #CBD5E1;border-radius:10px;padding:8px 10px;font:inherit;font-size:15px;min-height:70px}
.tk-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.tk-row select{min-height:42px;border:1px solid #CBD5E1;border-radius:8px;padding:0 10px;font:inherit;background:#fff}
.tk-dev summary{cursor:pointer;font-size:12.5px;color:#64748B}.tk-dev pre{font-size:11.5px;white-space:pre-wrap;overflow-wrap:anywhere;background:#F8FAFC;padding:8px;border-radius:8px;margin:6px 0 0}
.tk-filter{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.tk-filter button[aria-pressed=true]{background:#0F2C59;color:#fff;border-color:#0F2C59}`;

export async function probleme(v, seg, msg = () => {}, filter = 'open') {
  if (!document.getElementById('tkCss')) { const s = document.createElement('style'); s.id = 'tkCss'; s.textContent = CSS; document.head.append(s); }
  const r = await api(`/api/admin/tickets?area=${seg === 'b2b' ? 'b2b' : 'b2c'}`);
  if (!r.ok) { v.innerHTML = `<p class="auth-message error">${esc(r.data?.error || 'Reports could not be loaded.')}</p>`; return; }
  const now = Date.now();
  const all = (r.data.items || []).sort((a, b) => (OPEN.includes(b.status) - OPEN.includes(a.status)) || (Date.parse(a.due_at) - Date.parse(b.due_at)));
  const items = filter === 'open' ? all.filter((t) => OPEN.includes(t.status)) : all;
  const late = all.filter((t) => OPEN.includes(t.status) && Date.parse(t.due_at) < now).length;
  v.innerHTML = `<section class="wa-card"><h2>Technical problems · ${seg === 'b2b' ? 'Business' : 'Consumers'}</h2>
    <p class="form-note">Reports from ${seg === 'b2b' ? 'the Business Portal ("Technical support")' : 'customer accounts ("Technical support")'} including screenshots and device details. Goal: answer within 12 hours. New reports arrive instantly as a notification in the LeaseRun app.</p>
    <div class="tk-filter"><button type="button" class="btn btn-outline" data-tf="open" aria-pressed="${filter === 'open'}">Open (${r.data.open || 0})</button><button type="button" class="btn btn-outline" data-tf="all" aria-pressed="${filter !== 'open'}">All (${all.length})</button>${late ? `<span class="st bad">${late} over 12 hrs</span>` : ''}</div>
    <div class="tk-list">${items.map((t) => { const isLate = OPEN.includes(t.status) && Date.parse(t.due_at) < now; const [sl, sc] = SEV[t.severity] || [t.severity, '']; const dev = t.device || {};
      return `<article class="tk${isLate ? ' late' : ''}" data-id="${esc(t.id)}"><div class="tk-h"><strong>${esc(t.ref)} · ${esc(t.title)}</strong><span class="st ${sc}">${sl}</span></div>
      <div class="tk-m"><span>${esc(t.company ? `${t.company} · ` : '')}${esc(t.user_email || '')}</span><span>${esc(CATS[t.category] || t.category)}</span><span>reported ${dtt(t.created_at)}</span><span${isLate ? ' style="color:#B91C1C;font-weight:700"' : ''}>${OPEN.includes(t.status) ? `due ${dtt(t.due_at)}` : `Status: ${STATUS[t.status]}`}</span>${t.page ? `<span>Page: ${esc(t.page)}</span>` : ''}</div>
      <p class="tk-t">${esc(t.text)}</p>${t.expected ? `<p class="tk-x"><b>Expected:</b> ${esc(t.expected)}</p>` : ''}
      ${(t.shotUrls || []).length ? `<div class="tk-shots">${t.shotUrls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener" title="Open screenshot ${i + 1}"><img src="${esc(u)}" alt="Screenshot ${i + 1}" loading="lazy"></a>`).join('')}</div>` : ''}
      <details class="tk-dev"><summary>Device & browser${(dev.errors || []).length ? ` · ${dev.errors.length} script error(s)` : ''}</summary><pre>${esc([dev.ua, dev.vw ? `Window ${dev.vw}×${dev.vh} @${dev.dpr}x` : '', dev.standalone ? 'as app (home screen)' : '', dev.online === false ? 'offline' : '', dev.tz, ...(dev.errors || []).map((e) => 'Error: ' + e)].filter(Boolean).join('\n'))}</pre></details>
      <form class="tk-f"><textarea name="answer" maxlength="4000" placeholder="Answer to the customer (shown in their account, optionally also by email)">${esc(t.answer || '')}</textarea>
        <textarea name="note" maxlength="2000" placeholder="Internal note (not visible to the customer)" style="min-height:44px">${esc(t.admin_note || '')}</textarea>
        <div class="tk-row"><select name="status" aria-label="Status">${Object.entries(STATUS).map(([k, l]) => `<option value="${k}"${t.status === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
          <label class="chk"><input type="checkbox" name="notify" checked> Also send answer by email</label>
          <button class="btn btn-dark" type="submit">Save</button><span class="form-note" data-tm role="status"></span></div></form></article>`; }).join('') || '<div class="wa-state"><strong>No open reports</strong><span>All done – new reports appear here and as a notification in the app.</span></div>'}</div></section>`;
  v.querySelectorAll('[data-tf]').forEach((b) => b.onclick = () => probleme(v, seg, msg, b.dataset.tf));
  v.querySelectorAll('.tk-f').forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const id = f.closest('.tk').dataset.id, out = f.querySelector('[data-tm]'), btn = f.querySelector('[type=submit]');
    const answer = f.answer.value.trim();
    let status = f.status.value;
    // Answer without a status change: set "New" to "In progress" automatically.
    if (answer && status === 'neu') status = 'in_arbeit';
    btn.disabled = true; out.textContent = 'Saving …';
    const x = await api('/api/admin/tickets', { method: 'POST', body: JSON.stringify({ id, status, answer: answer || null, adminNote: f.note.value.trim() || null, notify: f.notify.checked && Boolean(answer) }) });
    btn.disabled = false;
    if (!x.ok) { out.textContent = x.data?.error || 'Error'; msg(x.data?.error || 'Saving failed.', true); return; }
    msg(x.data.mailed ? 'Saved – answer sent by email.' : 'Saved.');
    probleme(v, seg, msg, filter);
  });
}
