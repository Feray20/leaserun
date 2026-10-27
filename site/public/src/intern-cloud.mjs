// System → Files ("My cloud", OneDrive in the background): links to receive or send, download/upload right here.
import { api, esc } from './sess.mjs?v=892f3666';
import { sendFile, size } from './onedrive-up.mjs?v=892f3666';

const pub = () => (/leaserun\.com$/.test(location.hostname) ? 'https://leaserun.com' : location.origin);
const url = (l) => `${pub()}/files#${l.id}`;
const ago = (s) => (s ? new Date(s).toLocaleString('en-US', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function cloudCard(host, { goTab, msg }) {
  let st = { links: [], files: [] }, form = null;
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); msg('Link copied.'); } catch { prompt('Copy link:', t); } };
  const paint = () => {
    const off = !st.connected || st.consent;
    host.innerHTML = `<section class="hq-card hq-files" aria-labelledby="hqFT"><div class="hq-dec-h"><h3 id="hqFT">Files</h3><div class="hq-sh-a">
        <button type="button" class="hq-btn" data-new="in">+ Receive</button><button type="button" class="hq-btn hq-btn-p" data-new="out">+ Send</button>${st.folder ? `<a class="hq-btn" href="${esc(st.folder)}" target="_blank" rel="noopener">OneDrive</a>` : ''}</div></div>
      ${off ? `<div class="ck-it s-warn hq-fl-off"><strong>${st.connected ? 'Grant OneDrive access' : 'Connect Microsoft'}</strong><div class="ck-act"><button type="button" class="hq-btn hq-btn-p" data-ms>Connect</button></div></div>` : ''}
      ${form ? `<form class="hq-fnew" data-form><input name="label" maxlength="60" required placeholder="${form === 'in' ? 'From whom? (e.g. Title company Smith)' : 'For whom? (e.g. Lender – client X)'}" aria-label="Name"><div class="hq-sh-a"><button class="hq-btn hq-btn-p">Create link</button><button type="button" class="hq-btn" data-cancel>Cancel</button></div></form>` : ''}
      ${st.links.length ? `<ul class="hq-fl2">${st.links.map((l) => { const fs = st.files.filter((f) => f.link === l.id); return `<li class="${l.active ? '' : 'off'}">
        <div class="hq-fl2-h"><span class="hq-st ${l.mode === 'out' ? 'info' : 'ok'}">${l.mode === 'out' ? '↑ Send' : '↓ Receive'}</span><b>${esc(l.label)}</b><small>LeaseRun</small></div>
        <div class="hq-sh-a"><button type="button" class="hq-btn hq-btn-p" data-copy="${esc(l.id)}">Copy link</button>${l.mode === 'out' && l.active ? `<label class="hq-btn">Upload file<input type="file" multiple hidden data-up="${esc(l.id)}"></label>` : ''}<button type="button" class="hq-btn" data-tog="${esc(l.id)}">${l.active ? 'Pause' : 'Activate'}</button><button type="button" class="hq-btn" data-rm="${esc(l.id)}" aria-label="Remove link">✕</button></div>
        <ul class="hq-fl3" data-files="${esc(l.id)}">${fs.map((f) => `<li class="${f.virus ? 'vir' : ''}"><span>${f.cat ? `<i class="hq-cat">${esc(f.cat)}</i>` : ''}${esc(f.name)}</span><small>${f.virus ? '⚠ Malware – blocked' : `${size(f.size)} · ${ago(f.at)}`}</small>${f.virus ? '<span></span>' : `<button type="button" class="hq-btn" data-dl="${esc(f.id)}">Download</button>`}</li>`).join('')}</ul></li>`; }).join('')}</ul>` : form ? '' : '<p class="hq-empty">No links yet.</p>'}
    </section>`;
    const $ = (s) => host.querySelector(s), $$ = (s) => host.querySelectorAll(s);
    $$('[data-new]').forEach((b) => b.onclick = () => { form = b.dataset.new; paint(); host.querySelector('[name=label]')?.focus(); });
    $('[data-ms]')?.addEventListener('click', () => goTab('termine'));
    $('[data-cancel]')?.addEventListener('click', () => { form = null; paint(); });
    const f = $('[data-form]');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(f), b = f.querySelector('button'); b.disabled = true;
      const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'create', label: fd.get('label'), style: 'leaserun', mode: form }) });
      if (!r.ok) { b.disabled = false; msg(r.data?.error || 'Not possible.', true); return; }
      form = null; st.links = r.data.links; paint(); copy(url(r.data.link));
    };
    $$('[data-copy]').forEach((b) => b.onclick = () => copy(url(st.links.find((l) => l.id === b.dataset.copy))));
    $$('[data-tog]').forEach((b) => b.onclick = async () => { const l = st.links.find((x) => x.id === b.dataset.tog); const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'toggle', id: l.id, active: !l.active }) }); if (r.ok) { st.links = r.data.links; paint(); } else msg(r.data?.error || 'Not possible.', true); });
    $$('[data-rm]').forEach((b) => b.onclick = async () => { if (!confirm('Remove link? The files stay in OneDrive.')) return; const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'remove', id: b.dataset.rm }) }); if (r.ok) { st.links = r.data.links; paint(); } else msg(r.data?.error || 'Not possible.', true); });
    $$('[data-dl]').forEach((b) => b.onclick = async () => { b.disabled = true; const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'download', item: b.dataset.dl }) }); b.disabled = false; if (r.ok && r.data.url) location.href = r.data.url; else msg(r.data?.error || 'Download not possible.', true); });
    $$('[data-up]').forEach((inp) => inp.onchange = () => upload(inp.dataset.up, [...inp.files]));
  };
  const upload = async (id, files) => {
    const box = host.querySelector(`[data-files="${id}"]`);
    let ok = 0;
    for (const file of files) {
      const li = document.createElement('li'); li.innerHTML = `<span>${esc(file.name)}</span><small>0%</small>`; box.prepend(li);
      const s = li.querySelector('small');
      try {
        const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'upload', id, name: file.name, size: file.size }) });
        if (!r.ok) throw new Error(r.data?.error || 'Not possible.');
        await sendFile(file, r.data.uploadUrl, (p) => { s.textContent = `${Math.round(p * 100)}%`; });
        s.textContent = '✓'; ok++;
      } catch (e) { s.textContent = e.message || 'Failed.'; }
    }
    if (ok) { msg(`${ok} ${ok === 1 ? 'file' : 'files'} ready for download.`); load(); }
  };
  const load = async () => {
    const r = await api('/api/admin/cloud');
    if (!host.isConnected) return;
    if (!r.ok) { host.innerHTML = ''; return; }
    st = r.data; paint();
  };
  host.innerHTML = '<section class="hq-card hq-files"><h3>Files</h3><div class="hq-kpi hq-sk"></div></section>';
  load();
  return { load };
}
