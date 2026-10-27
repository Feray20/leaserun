// Seite /files#<Link>: nur „Anhang hinzufügen“ (Empfangen) oder „Herunterladen“ (Abholen). Alles andere läuft im Hintergrund.
import { sendFile, size } from './onedrive-up.mjs?v=892f3666';

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Persönliche Domain: Schlüssel steht im Pfad (feray.cloud/…), sonst im #-Teil (leaserun.com/datei#…).
const PERSONAL = /feray[.-]cloud/i.test(location.hostname);
if (PERSONAL) {
  document.documentElement.classList.add('personal');
  // Eigenes Tab-Symbol „FK“ statt LeaseRun-Logo
  const ico = document.querySelector('link[rel=icon]');
  if (ico) ico.href = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#1C1917"/><text x="32" y="41" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">FK</text></svg>');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', '#F5F5F4');
}
const k = (PERSONAL ? location.pathname.slice(1) : decodeURIComponent(location.hash.slice(1))).trim();
const root = document.getElementById('dt');
// Gleiche Sperrliste wie auf dem Server (lib/cloud/inbox.ts) – nur für eine schnelle Rückmeldung.
const BLOCK = /\.(exe|com|scr|pif|bat|cmd|msi|msp|msc|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|cpl|jar|lnk|reg|dll|sys|gadget|application|appref-ms|scf|inf|docm|xlsm|pptm|dotm|xltm|iso|img|vhd|vhdx)$/i;
const I_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>';

const brand = (d) => d.style === 'feray'
  ? '<div class="dt-brand"><span class="dt-mono" aria-hidden="true">FK</span><b>Feray Korkmaz</b></div>'
  : '<div class="dt-brand"><img src="/logo-icon.svg" alt="" width="44" height="38"><b>LeaseRun</b></div>';
const card = (html) => { root.innerHTML = `<div class="dt-card">${html}</div>`; };
const gone = (t = 'Dieser Link ist nicht (mehr) gültig.') => { document.body.dataset.style = PERSONAL ? 'feray' : 'leaserun'; card(`<h1>Link ungültig</h1><p class="dt-msg">${esc(t)}</p>`); };

async function start() {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(k)) return gone();
  const r = await fetch(`/api/datei?k=${encodeURIComponent(k)}`, { cache: 'no-store' }).catch(() => null);
  const d = r ? await r.json().catch(() => ({})) : {};
  if (!r || !r.ok) return gone(d.error);
  document.body.dataset.style = d.style;
  document.title = `${d.mode === 'out' ? 'Dateien abholen' : 'Dateien senden'} · ${d.owner}`;
  return d.mode === 'out' ? pickup(d) : receive(d);
}

// Abholen: Liste mit Download-Knopf je Datei (läuft direkt von Microsoft).
function pickup(d) {
  card(`${brand(d)}<h1>Dateien für Sie</h1>${d.files.length ? `<ul class="dt-list">${d.files.map((f) => `<li class="dt-it"><b title="${esc(f.name)}">${esc(f.name)}</b><a class="dt-btn" href="/api/datei?k=${encodeURIComponent(k)}&amp;f=${encodeURIComponent(f.id)}" rel="noopener" download>Herunterladen</a><small>${size(f.size)}</small></li>`).join('')}</ul>` : '<p class="dt-msg">Noch keine Dateien bereit.</p>'}`);
}

// Empfangen: ein Knopf, Ziehen & Ablegen, Fortschritt je Datei.
function receive(d) {
  card(`${brand(d)}<h1>Dateien senden</h1>
    <p class="dt-q" id="catT">Worum geht es?</p>
    <div class="dt-cats" role="radiogroup" aria-labelledby="catT">${d.cats.map((c) => `<button type="button" role="radio" aria-checked="false" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <label class="dt-drop" id="drop" tabindex="0" aria-disabled="true">${I_UP}<span>Anhang hinzufügen</span><input type="file" id="pick" multiple hidden></label>
    <ul class="dt-list" id="list"></ul><div id="done"></div>
    ${d.style === 'feray' ? '' : '<p class="dt-legal">Mit dem Senden gelten die <a href="/privacy#dateien">Datenschutzhinweise</a>.</p>'}`);
  const drop = document.getElementById('drop'), pick = document.getElementById('pick'), list = document.getElementById('list');
  let running = 0, cat = null; const sent = [], sentCats = new Set();
  // Erst Kategorie wählen, dann Anhang – so weiß Feray sofort, worum es geht.
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
  // Höchstens zwei Dateien gleichzeitig – schont schwache Verbindungen.
  function pump() { while (running < 2 && queue.length) one(queue.shift()); }
  async function one({ f, li, cat: c }) {
    running++;
    const bar = li.querySelector('i'), st = li.querySelector('small');
    try {
      if (f.size > d.max) throw new Error('Zu groß (höchstens 20 GB).');
      if (!f.size) throw new Error('Leere Datei.');
      if (BLOCK.test(f.name)) throw new Error('Dateityp aus Sicherheitsgründen nicht erlaubt.');
      const r = await fetch('/api/datei', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, name: f.name, size: f.size, cat: c }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.uploadUrl) throw new Error(j.error || 'Gerade nicht möglich.');
      await sendFile(f, j.uploadUrl, (p) => { bar.style.width = `${Math.round(p * 100)}%`; st.textContent = `${Math.round(p * 100)} %`; });
      li.classList.add('ok'); st.textContent = '✓ Gesendet'; sent.push(f.name); sentCats.add(c);
    } catch (e) { li.classList.add('bad'); st.textContent = e.message || 'Fehlgeschlagen.'; bar.parentElement.remove(); }
    running--;
    if (!running && !queue.length && sent.length) {
      document.getElementById('done').innerHTML = `<p class="dt-done">✓ ${sent.length} ${sent.length === 1 ? 'Datei' : 'Dateien'} gesendet.</p>`;
      const names = sent.splice(0);
      fetch('/api/datei', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ k, done: names, cats: [...sentCats] }), keepalive: true })
        .then((r) => r.json()).then((j) => {
          // Virenprüfung: abgelehnte Dateien in der Liste kennzeichnen.
          for (const n of j.removed || []) for (const li of list.querySelectorAll('.dt-it.ok')) if (li.querySelector('b')?.textContent === n) { li.classList.replace('ok', 'bad'); li.querySelector('small').textContent = 'Virenverdacht – abgelehnt'; }
          if ((j.removed || []).length) document.getElementById('done').innerHTML = `<p class="dt-done dt-warn">${j.removed.length} ${j.removed.length === 1 ? 'Datei wurde' : 'Dateien wurden'} aus Sicherheitsgründen abgelehnt.</p>`;
        }).catch(() => {});
    }
    pump();
  }
}

start();
if (!PERSONAL) window.addEventListener('hashchange', () => location.reload());
