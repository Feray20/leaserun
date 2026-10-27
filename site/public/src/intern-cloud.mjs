// System → Dateien (OneDrive im Hintergrund): Links zum Empfangen oder Senden, Download/Upload direkt hier.
import { api, esc } from './sess.mjs?v=892f3666';
import { sendFile, size } from './onedrive-up.mjs?v=892f3666';

const pub = () => (/leaserun\.de$/.test(location.hostname) ? 'https://leaserun.com' : location.origin);
let personal = null;
const url = (l) => (l.style === 'feray' && personal ? `https://${personal}/${l.id}` : `${pub()}/datei#${l.id}`);
const STYLE = { leaserun: 'LeaseRun', feray: 'Feray Korkmaz' };
const ago = (s) => (s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

export function cloudCard(host, { goTab, msg }) {
  let st = { links: [], files: [] }, form = null;
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); msg('Link kopiert.'); } catch { prompt('Link kopieren:', t); } };
  const paint = () => {
    const off = !st.connected || st.consent;
    host.innerHTML = `<section class="hq-card hq-files" aria-labelledby="hqFT"><div class="hq-dec-h"><h3 id="hqFT">Dateien</h3><div class="hq-sh-a">
        <button type="button" class="hq-btn" data-new="in">+ Empfangen</button><button type="button" class="hq-btn hq-btn-p" data-new="out">+ Senden</button>${st.folder ? `<a class="hq-btn" href="${esc(st.folder)}" target="_blank" rel="noopener">OneDrive</a>` : ''}</div></div>
      ${off ? `<div class="ck-it s-warn hq-fl-off"><strong>${st.connected ? 'OneDrive freigeben' : 'Microsoft verbinden'}</strong><div class="ck-act"><button type="button" class="hq-btn hq-btn-p" data-ms>Verbinden</button></div></div>` : ''}
      ${form ? `<form class="hq-fnew" data-form><input name="label" maxlength="60" required placeholder="${form === 'in' ? 'Von wem? (z. B. Notar Müller)' : 'Für wen? (z. B. Bank Kunde X)'}" aria-label="Name"><div class="hq-seg2" role="radiogroup" aria-label="Auftritt">${Object.entries(STYLE).map(([k, n], i) => `<label><input type="radio" name="style" value="${k}" ${i ? '' : 'checked'}><span>${n}</span></label>`).join('')}</div><div class="hq-sh-a"><button class="hq-btn hq-btn-p">Link erstellen</button><button type="button" class="hq-btn" data-cancel>Abbrechen</button></div></form>` : ''}
      ${st.links.length ? `<ul class="hq-fl2">${st.links.map((l) => { const fs = st.files.filter((f) => f.link === l.id); return `<li class="${l.active ? '' : 'off'}">
        <div class="hq-fl2-h"><span class="hq-st ${l.mode === 'out' ? 'info' : 'ok'}">${l.mode === 'out' ? '↑ Senden' : '↓ Empfangen'}</span><b>${esc(l.label)}</b><small>${STYLE[l.style]}</small></div>
        <div class="hq-sh-a"><button type="button" class="hq-btn hq-btn-p" data-copy="${esc(l.id)}">Link kopieren</button>${l.mode === 'out' && l.active ? `<label class="hq-btn">Datei hochladen<input type="file" multiple hidden data-up="${esc(l.id)}"></label>` : ''}<button type="button" class="hq-btn" data-tog="${esc(l.id)}">${l.active ? 'Pausieren' : 'Aktivieren'}</button><button type="button" class="hq-btn" data-rm="${esc(l.id)}" aria-label="Link entfernen">✕</button></div>
        <ul class="hq-fl3" data-files="${esc(l.id)}">${fs.map((f) => `<li class="${f.virus ? 'vir' : ''}"><span>${f.cat ? `<i class="hq-cat">${esc(f.cat)}</i>` : ''}${esc(f.name)}</span><small>${f.virus ? '⚠ Virus – gesperrt' : `${size(f.size)} · ${ago(f.at)}`}</small>${f.virus ? '<span></span>' : `<button type="button" class="hq-btn" data-dl="${esc(f.id)}">Herunterladen</button>`}</li>`).join('')}</ul></li>`; }).join('')}</ul>` : form ? '' : '<p class="hq-empty">Noch keine Links.</p>'}
    </section>`;
    const $ = (s) => host.querySelector(s), $$ = (s) => host.querySelectorAll(s);
    $$('[data-new]').forEach((b) => b.onclick = () => { form = b.dataset.new; paint(); host.querySelector('[name=label]')?.focus(); });
    $('[data-ms]')?.addEventListener('click', () => goTab('termine'));
    $('[data-cancel]')?.addEventListener('click', () => { form = null; paint(); });
    const f = $('[data-form]');
    if (f) f.onsubmit = async (e) => {
      e.preventDefault(); const fd = new FormData(f), b = f.querySelector('button'); b.disabled = true;
      const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'create', label: fd.get('label'), style: fd.get('style'), mode: form }) });
      if (!r.ok) { b.disabled = false; msg(r.data?.error || 'Nicht möglich.', true); return; }
      form = null; st.links = r.data.links; paint(); copy(url(r.data.link));
    };
    $$('[data-copy]').forEach((b) => b.onclick = () => copy(url(st.links.find((l) => l.id === b.dataset.copy))));
    $$('[data-tog]').forEach((b) => b.onclick = async () => { const l = st.links.find((x) => x.id === b.dataset.tog); const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'toggle', id: l.id, active: !l.active }) }); if (r.ok) { st.links = r.data.links; paint(); } else msg(r.data?.error || 'Nicht möglich.', true); });
    $$('[data-rm]').forEach((b) => b.onclick = async () => { if (!confirm('Link entfernen? Die Dateien bleiben in OneDrive.')) return; const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'remove', id: b.dataset.rm }) }); if (r.ok) { st.links = r.data.links; paint(); } else msg(r.data?.error || 'Nicht möglich.', true); });
    $$('[data-dl]').forEach((b) => b.onclick = async () => { b.disabled = true; const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'download', item: b.dataset.dl }) }); b.disabled = false; if (r.ok && r.data.url) location.href = r.data.url; else msg(r.data?.error || 'Download nicht möglich.', true); });
    $$('[data-up]').forEach((inp) => inp.onchange = () => upload(inp.dataset.up, [...inp.files]));
  };
  const upload = async (id, files) => {
    const box = host.querySelector(`[data-files="${id}"]`);
    let ok = 0;
    for (const file of files) {
      const li = document.createElement('li'); li.innerHTML = `<span>${esc(file.name)}</span><small>0 %</small>`; box.prepend(li);
      const s = li.querySelector('small');
      try {
        const r = await api('/api/admin/cloud', { method: 'POST', body: JSON.stringify({ action: 'upload', id, name: file.name, size: file.size }) });
        if (!r.ok) throw new Error(r.data?.error || 'Nicht möglich.');
        await sendFile(file, r.data.uploadUrl, (p) => { s.textContent = `${Math.round(p * 100)} %`; });
        s.textContent = '✓'; ok++;
      } catch (e) { s.textContent = e.message || 'Fehlgeschlagen.'; }
    }
    if (ok) { msg(`${ok} ${ok === 1 ? 'Datei' : 'Dateien'} bereit zum Abholen.`); load(); }
  };
  const load = async () => {
    const r = await api('/api/admin/cloud');
    if (!host.isConnected) return;
    if (!r.ok) { host.innerHTML = ''; return; }
    st = r.data; personal = r.data.personal || null; paint();
  };
  host.innerHTML = '<section class="hq-card hq-files"><h3>Dateien</h3><div class="hq-kpi hq-sk"></div></section>';
  load();
  return { load };
}
