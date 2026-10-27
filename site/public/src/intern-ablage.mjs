// System → Archive: the owner's own storage for important documents and images (OneDrive folder "LeaseRun Archive").
// Open folders, create folders, upload files (also by drag & drop), view and download. Nothing is deleted.
import { api, esc } from './sess.mjs?v=892f3666';
import { sendFile, size } from './onedrive-up.mjs?v=892f3666';

const ago = (s) => (s ? new Date(s).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '');
const isImg = (it) => /^image\//.test(it.mime || '');
const ico = (it) => (it.folder ? '📁' : isImg(it) ? '🖼️' : /pdf/.test(it.mime || '') ? '📄' : /sheet|excel|csv/.test(it.mime || '') ? '📊' : /word|document/.test(it.mime || '') ? '📝' : '📎');

export function ablageCard(host, { goTab, msg }) {
  let st = { path: '', items: [], web: null }, err = null, busy = true, q = '', kind = 'alle';
  const KINDS = { alle: 'All', dok: 'Documents', pdf: 'PDF', bild: 'Images' };
  const kindOk = (it) => kind === 'alle' || it.folder || (kind === 'bild' ? isImg(it) : kind === 'pdf' ? /pdf/.test(it.mime || '') : !isImg(it));
  const call = (body) => api('/api/admin/cloud', { method: 'POST', body: JSON.stringify(body) });
  const crumbs = () => {
    const parts = st.path ? st.path.split('/') : [];
    return `<nav class="ab-cr" aria-label="Folders"><button type="button" data-go="">Archive</button>${parts.map((p, i) => `<span>›</span><button type="button" data-go="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`).join('')}</nav>`;
  };
  const paint = () => {
    const list = st.items.filter((it) => (!q || it.name.toLowerCase().includes(q)) && kindOk(it));
    host.innerHTML = `<section class="hq-card hq-files ab" aria-labelledby="abT"><div class="hq-dec-h"><h3 id="abT">Archive</h3><div class="hq-sh-a">
        <label class="hq-btn hq-btn-p">+ Upload<input type="file" multiple hidden data-up></label><button type="button" class="hq-btn" data-nf>+ Folder</button>${st.web ? `<a class="hq-btn" href="${esc(st.web)}" target="_blank" rel="noopener">Open in OneDrive</a>` : ''}</div></div>
      ${err ? `<div class="ck-it s-warn hq-fl-off"><strong>${esc(err)}</strong><div class="ck-act"><button type="button" class="hq-btn hq-btn-p" data-ms>Connect Microsoft</button></div></div>` : `
      ${crumbs()}
      <div class="ab-bar"><input class="ab-q" type="search" placeholder="Search this folder" aria-label="Search" value="${esc(q)}"><div class="ab-k" role="group" aria-label="Filter">${Object.entries(KINDS).map(([k, n]) => `<button type="button" data-k="${k}" class="${kind === k ? 'on' : ''}" aria-pressed="${kind === k}">${n}</button>`).join('')}</div></div>
      <div class="ab-drop" data-drop>Drag files here – they go into “${esc(st.path.split('/').pop() || 'Archive')}”.</div>
      <ul class="ab-up" data-prog></ul>
      ${busy ? '<div class="hq-kpi hq-sk"></div>' : list.length ? `<ul class="ab-grid">${list.map((it) => `<li class="${it.virus ? 'vir' : ''}"><button type="button" class="ab-it" ${it.folder ? `data-dir="${esc(it.name)}"` : `data-open="${esc(it.id)}"`} title="${esc(it.name)}">
          ${it.thumb && !it.folder ? `<img src="${esc(it.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ab-ic" aria-hidden="true">${ico(it)}</span>`}
          <b>${esc(it.name)}</b><small>${it.folder ? `${it.count} ${it.count === 1 ? 'item' : 'items'}` : it.virus ? '⚠ Malware – blocked' : `${size(it.size)} · ${ago(it.at)}`}</small></button>
          <div class="ab-act">${it.virus ? '' : `${!it.folder && it.web ? `<a class="hq-btn" href="${esc(it.web)}" target="_blank" rel="noopener" title="Edit in Word, Excel or the OneDrive viewer">Edit</a>` : ''}<button type="button" class="hq-btn" data-ren="${esc(it.id)}" title="Rename">Rename</button>${it.folder ? '' : `<button type="button" class="hq-btn" data-dl="${esc(it.id)}" aria-label="Download ${esc(it.name)}">↓</button>`}`}</div></li>`).join('')}</ul>` : `<p class="hq-empty">${q ? 'Nothing found.' : 'This folder is empty.'}</p>`}`}
    </section>`;
    const $ = (s) => host.querySelector(s), $$ = (s) => host.querySelectorAll(s);
    $('[data-ms]')?.addEventListener('click', () => goTab('termine'));
    $$('[data-go]').forEach((b) => b.onclick = () => go(b.dataset.go));
    $$('[data-dir]').forEach((b) => b.onclick = () => go(st.path ? `${st.path}/${b.dataset.dir}` : b.dataset.dir));
    $$('[data-open]').forEach((b) => b.onclick = () => open(b.dataset.open, false));
    $$('[data-dl]').forEach((b) => b.onclick = () => open(b.dataset.dl, true));
    $$('[data-k]').forEach((b) => b.onclick = () => { kind = b.dataset.k; paint(); });
    $$('[data-ren]').forEach((b) => b.onclick = async () => {
      const it = st.items.find((x) => x.id === b.dataset.ren); if (!it) return;
      const name = prompt('New name:', it.name); if (!name || !name.trim() || name.trim() === it.name) return;
      const r = await call({ action: 'ablage-rename', path: st.path, item: it.id, name: name.trim(), old: it.name });
      if (r.ok) { st = r.data; paint(); msg('Renamed.'); } else msg(r.data?.error || 'Not possible.', true);
    });
    const qi = $('.ab-q'); if (qi) qi.oninput = () => { q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; paint(); const n = host.querySelector('.ab-q'); n.focus(); n.setSelectionRange(pos, pos); };
    $('[data-nf]').onclick = async () => {
      const name = prompt('Name of the new folder:'); if (!name || !name.trim()) return;
      const r = await call({ action: 'ablage-folder', path: st.path, name: name.trim() });
      if (r.ok) { st = r.data; paint(); msg('Folder created.'); } else msg(r.data?.error || 'Not possible.', true);
    };
    $('[data-up]').onchange = (e) => { upload([...e.target.files]); e.target.value = ''; };
    const dz = $('[data-drop]');
    if (dz) {
      ['dragenter', 'dragover'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add('on'); }));
      ['dragleave', 'drop'].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove('on'); }));
      dz.addEventListener('drop', (e) => upload([...(e.dataTransfer?.files || [])]));
    }
  };
  const open = async (id, download) => {
    const r = await call({ action: 'ablage-open', item: id });
    if (!r.ok || !r.data.url) { msg(r.data?.error || 'Can’t open this file.', true); return; }
    if (download) location.href = r.data.url; else window.open(r.data.url, '_blank', 'noopener');
  };
  const upload = async (files) => {
    if (!files.length) return;
    const box = host.querySelector('[data-prog]'); const path = st.path; let ok = 0;
    for (const file of files) {
      const li = document.createElement('li'); li.innerHTML = `<span>${esc(file.name)}</span><small>0%</small>`; box?.append(li);
      const s = li.querySelector('small');
      try {
        const r = await call({ action: 'ablage-upload', path, name: file.name, size: file.size });
        if (!r.ok) throw new Error(r.data?.error || 'Not possible.');
        await sendFile(file, r.data.uploadUrl, (p) => { s.textContent = `${Math.round(p * 100)}%`; });
        s.textContent = '✓'; ok++;
      } catch (e) { s.textContent = e.message || 'Failed.'; }
    }
    if (ok) { msg(`${ok} ${ok === 1 ? 'file' : 'files'} saved.`); if (st.path === path) go(path); }
  };
  const go = async (path) => {
    busy = true; q = ''; st = { ...st, path }; paint();
    const r = await call({ action: 'ablage', path });
    if (!host.isConnected) return;
    busy = false;
    if (!r.ok) { err = r.status === 409 ? 'OneDrive access not granted yet' : r.data?.error || 'Archive not reachable'; paint(); return; }
    err = null; st = r.data; paint();
  };
  go('');
  return { load: () => go(st.path) };
}
