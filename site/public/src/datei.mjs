// Page /files#<link>: only "Add files" (receive) or "Download" (pickup). Everything else runs in the background.
import { sendFile, size } from './onedrive-up.mjs?v=892f3666';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The key is in the # part (leaserun.com/files#…), so it never reaches server logs.
const k = decodeURIComponent(location.hash.slice(1)).trim();
const root = document.getElementById('dt');
// Same block list as on the server (lib/cloud/inbox.ts) – only for quick feedback.
const BLOCK = /\.(exe|com|scr|pif|bat|cmd|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|gadget|application|appref-ms|scf|inf|docm|xlsm|pptm|dotm|xltm|iso|img|vhd|vhdx)$/i;
const I_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

const brand = () => '<div class="dt-brand"><img src="/logo-icon.svg" alt="" width="44" height="38"><b>LeaseRun</b></div>';
const card = (html) => { root.innerHTML = `<div class="dt-card">${html}</div>`; };
const gone = (t = 'This link is invalid or has expired.') => { document.body.dataset.style = 'leaserun'; card(`<h1>Invalid link</h1><p class="dt-msg">${esc(t)}</p>`); };

async function start() {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(k)) return gone();
  const r = await fetch(`/api/datei?k=${encodeURIComponent(k)}`, { cache: 'no-store' }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) return gone(d.error);
  document.body.dataset.style = 'leaserun';
  document.title = `${d.mode === 'out' ? 'Download files' : 'Send files'} · ${d.owner || 'LeaseRun'}`;
  return d.mode === 'out' ? pickup(d) : receive(d);
}

// Pickup: list with a download button per file (served directly by Microsoft).
function pickup(d) {
  card(`${brand()}<h1>Files for you</h1>${d.files.length ? `<ul class="dt-list">${d.files.map((f) => `<li class="dt-it"><b title="${esc(f.name)}">${esc(f.name)}</b><a class="dt-btn" href="/api/datei?k=${encodeURIComponent(k)}&amp;f=${encodeURIComponent(f.id)}" rel="noopener" download>Download</a><small>${size(f.size)}</small></li>`).join('')}</ul>` : '<p class="dt-msg">No files ready yet.</p>'}`);
}

// Receive: one button, drag & drop, progress per file.
function receive(d) {
  card(`${brand()}<h1>Send files</h1>
    <p class="dt-q" id="catT">What are you sending?</p>
    <div class="dt-cats" role="radiogroup" aria-labelledby="catT">${d.cats.map((c) => `<button type="button" role="radio" aria-checked="false" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="dt-drop" id="drop" tabindex="0" aria-disabled="true">${I_UP}<span>Add files</span><input type="file" id="pick" multiple hidden></label>
    <ul class="dt-list" id="list"></ul><div id="done"></div>
    <p class="dt-legal">Every file is checked for malware. By sending, you agree to our <a href="/privacy#files">Privacy Policy</a>.</p>`);
  const drop = document.getElementById('drop'), pick = document.getElementById('pick'), list = document.getElementById('list');
  let running = 0, cat = null; const sent = [], sentCats = new Set();
  // Choose the category first, then the files – so we know right away what they are.
  root.querySelectorAll('[data-cat]').forEach((b) => b.onclick = () => {
    cat = b.dataset.cat; root.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    drop.setAttribute('aria-disabled', 'false'); root.querySelector('.dt-cats').classList.remove('need');
  });
  const needCat = (e) => { if (cat) return false; e?.preventDefault(); const c = root.querySelector('.dt-cats'); c.classList.remove('need'); void c.offsetWidth; c.classList.add('need'); return true; };
  drop.addEventListener('click', (e) => { needCat(e); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!needCat()) pick.click(); } });
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (!needCat()) add([...e.dataTransfer.files]); });
  pick.onchange = () => { add([...pick.files]); pick.value = ''; };
  window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = ''; } });

  function add(files) {
    for (const f of files) {
      const li = document.createElement('li'); li.className = 'dt-it';
      li.innerHTML = `<b title="${esc(f.name)}">${esc(f.name)}</b><small>${size(f.size)}</small><div class="dt-bar"><i></i></div>`;
      list.append(li); queue.push({ f, li, cat });
    }
    document.getElementById('done').innerHTML = '';
    pump();
  }
  const queue = [];
  // At most two files at once – easier on weak connections.
  function pump() { while (running < 2 && queue.length) one(queue.shift()); }
  async function one({ f, li, cat: c }) {
    running++;
    const bar = li.querySelector('i'), st = li.querySelector('small');
    try {
      if (f.size > d.max) throw new Error('Too large (20 GB max).');
      if (!f.size) throw new Error('Empty file.');
      if (BLOCK.test(f.name)) throw new Error('File type not allowed for security reasons.');
      const r = await fetch('/api/datei', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, name: f.name, size: f.size, cat: c }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.uploadUrl) throw new Error(j.error || 'Not possible right now.');
      await sendFile(f, j.uploadUrl, (p) => { bar.style.width = `${Math.round(p * 100)}%`; st.textContent = `${Math.round(p * 100)}%`; });
      li.classList.add('ok'); st.textContent = '✓ Sent'; sent.push(f.name); sentCats.add(c);
    } catch (e) { li.classList.add('bad'); st.textContent = e.message || 'Failed.'; bar.parentElement.remove(); }
    running--;
    if (!running && !queue.length && sent.length) {
      document.getElementById('done').innerHTML = `<p class="dt-done">✓ ${sent.length} ${sent.length === 1 ? 'file' : 'files'} sent.</p>`;
      const names = sent.splice(0);
      fetch('/api/datei', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, done: names, cats: [...sentCats] }), keepalive: true })
        .then((r) => r.json()).then((j) => {
          // Malware check: mark rejected files in the list.
          for (const n of j.removed || []) for (const li of list.querySelectorAll('.dt-it.ok')) if (li.querySelector('b')?.textContent === n) { li.classList.replace('ok', 'bad'); li.querySelector('small').textContent = 'Suspected malware – rejected'; }
          if ((j.removed || []).length) document.getElementById('done').innerHTML = `<p class="dt-done dt-warn">${j.removed.length} ${j.removed.length === 1 ? 'file was' : 'files were'} rejected for security reasons.</p>`;
        }).catch(() => {});
    }
    pump();
  }
}

start();
window.addEventListener('hashchange', () => location.reload());
