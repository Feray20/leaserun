// Ratgeber und Bank-Chancen-Checker im Browser: rechnet bei jeder Eingabe neu (gleicher Rechenkern wie beim Build),
// koppelt Schieberegler und Zahlenfelder, setzt optional das Bundesland aus dem ungefähren Standort und übernimmt –
// nur für angemeldete Nutzer und nur im Browser – Werte aus dem LeaseRun-Finanzprofil. Die öffentliche Seite selbst
// (Text, Vorab-Ergebnis) bleibt dabei unverändert; Eingaben verlassen das Gerät nicht.
import { bankChance } from './calc.mjs';
import { renderResult, readForm } from './bcc-view.mjs';

const forms = [...document.querySelectorAll('form[data-bcc]')];
let profileNote = '';

function update(form) {
  const input = readForm(form);
  const res = bankChance(input);
  const out = form.querySelector('[data-bcc-out]');
  if (out) out.innerHTML = renderResult(res, input, { slug: form.dataset.slug, profileNote });
}

for (const form of forms) {
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.pair) { const n = form.elements[t.dataset.pair]; if (n && !(n instanceof RadioNodeList)) n.value = t.value; }
    else if (t.type === 'number') { const r = form.querySelector(`input[type=range][data-pair="${t.name}"]`); if (r && t.value !== '') r.value = t.value; }
    update(form);
  });
  update(form); // aktuelles Datum statt Build-Datum
}

// ---------- Ungefährer Standort → Bundesland (nur Komfort; blockiert nie den Seitenaufbau) ----------
const geo = () => {
  const targets = forms.filter((f) => f.elements.land && !f.dataset.geoDone);
  if (!targets.length) return;
  let manual = false;
  try { manual = sessionStorage.getItem('lr-land-manual') === '1'; } catch { /* privat */ }
  if (manual) return;
  const ctl = 'AbortController' in window ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 2500);
  fetch('/api/geo', { credentials: 'omit', cache: 'no-store', signal: ctl?.signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((g) => {
    clearTimeout(timer);
    if (!g || !g.land) return;
    for (const f of targets) {
      const s = f.elements.land;
      if (![...s.options].some((o) => o.value === g.land) || f.dataset.landTouched) continue;
      s.value = g.land; f.dataset.geoDone = '1';
      const p = f.querySelector('[data-geo]');
      if (p) {
        const name = s.options[s.selectedIndex].text;
        p.textContent = `Standort erkannt: ${g.city ? `${g.city} (${name})` : name}`;
        const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Ändern';
        b.onclick = () => { const d = s.closest('details'); if (d) d.open = true; s.focus(); };
        p.append(' ', b); p.hidden = false;
      }
      update(f);
    }
  });
};
for (const f of forms) f.elements.land?.addEventListener('change', () => { f.dataset.landTouched = '1'; try { sessionStorage.setItem('lr-land-manual', '1'); } catch { /* privat */ } });
if (forms.some((f) => f.elements.land)) (window.requestIdleCallback || ((cb) => setTimeout(cb, 1200)))(geo, { timeout: 3000 });

// ---------- Angemeldet: Werte aus dem Finanzprofil übernehmen (Vorrang: eigene Eingabe > Profil > Modellwert) ----------
(async () => {
  let s = null;
  try { s = JSON.parse(localStorage.getItem('leaserun-auth-session-v1') || 'null'); } catch { return; }
  const uid = s?.user?.id, tok = s?.access_token;
  if (!forms.length || !uid || !tok || (s.expires_at && s.expires_at * 1000 < Date.now())) return;
  try {
    const cfg = await fetch('/api/supabase-config').then((r) => (r.ok ? r.json() : null));
    if (!cfg?.url || !cfg?.key) return;
    const r = await fetch(`${cfg.url}/rest/v1/lr_user_data?select=profile&user_id=eq.${encodeURIComponent(uid)}&limit=1`, { headers: { apikey: cfg.key, Authorization: `Bearer ${tok}` } });
    if (!r.ok) return;
    const p = (await r.json())?.[0]?.profile || {};
    const used = [];
    for (const f of forms) {
      if (f.dataset.touched) continue;
      const set = (n, v) => { const el = f.elements[n]; if (el && v !== undefined && v !== null && v !== '' && Number(v) > 0) { el.value = v; const rg = f.querySelector(`input[type=range][data-pair="${n}"]`); if (rg) rg.value = v; return true; } return false; };
      if (set('netIncome', Math.round(Number(p.netIncome)))) used.push('Haushaltsnetto');
      if (set('equity', Math.round(Number(p.equity)))) used.push('Eigenkapital');
      const size = Number(p.householdSize);
      if (size >= 1) { const a = size >= 2 ? 2 : 1; f.elements.adults.value = String(a); f.elements.children.value = String(Math.min(5, Math.max(0, size - a))); used.push('Haushaltsgröße'); }
      const emp = String(p.employment || '').toLowerCase();
      const map = [['probezeit', 'probezeit'], ['befrist', 'befristet'], ['beamt', 'beamtet'], ['selbst', 'selbststaendig'], ['freiberuf', 'selbststaendig'], ['rent', 'rente'], ['pension', 'rente']];
      const m = map.find(([k]) => emp.includes(k));
      if (m && f.elements.employment) f.elements.employment.value = m[1];
    }
    if (used.length) { profileNote = `Aus Ihrem LeaseRun-Finanzprofil übernommen: ${[...new Set(used)].join(', ')}. Änderungen hier werden nicht gespeichert.`; forms.forEach(update); }
  } catch { /* ohne Profil weiter mit Modellwerten */ }
})();
for (const f of forms) f.addEventListener('input', () => { f.dataset.touched = '1'; }, { once: true });

// ---------- Ratgeber-Übersicht: Suche zuerst (Autovervollständigung, Tastatur) ----------
const box = document.querySelector('[data-rg-search]');
if (box) {
  let idx = [];
  try { idx = JSON.parse(document.getElementById('rg-index')?.textContent || '[]'); } catch { idx = []; }
  const input = box.querySelector('input'), list = box.querySelector('[role=listbox]');
  const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
  let items = [], active = -1;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const show = () => {
    const q = norm(input.value.trim());
    const terms = q.split(/\s+/).filter(Boolean);
    items = (terms.length ? idx.filter((x) => terms.every((t) => norm(`${x.t} ${x.k}`).includes(t))) : idx.filter((x) => x.p)).slice(0, 6);
    active = -1;
    list.innerHTML = items.map((x, i) => `<li role="option" id="rg-o${i}" aria-selected="false"><a href="${esc(x.u)}">${esc(x.t)}<small>${esc(x.c)}</small></a></li>`).join('') || (q ? '<li role="option" aria-disabled="true"><a href="/search">Kein Treffer – zur Volltextsuche</a></li>' : '');
    list.hidden = !list.innerHTML; input.setAttribute('aria-expanded', String(!list.hidden));
  };
  const mark = () => { [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active))); input.setAttribute('aria-activedescendant', active >= 0 ? `rg-o${active}` : ''); };
  input.addEventListener('focus', show);
  input.addEventListener('input', show);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); const x = items[active >= 0 ? active : 0]; if (x) location.href = x.u; else if (input.value.trim()) location.href = `/search?q=${encodeURIComponent(input.value.trim())}`; }
    else if (e.key === 'Escape') { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', (e) => { if (!box.contains(e.target)) { list.hidden = true; input.setAttribute('aria-expanded', 'false'); } });
}
