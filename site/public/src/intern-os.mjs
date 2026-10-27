// Web-Admin → LeaseRun OS: Schreibtisch mit Apps (alle Bereiche an einem Ort), Statusleiste mit Ampeln und
// „LeaseRun Intelligence“ – prüft regelbasiert (ohne KI-Kosten) Postfach, Belege & Rechnungen, Website & Technik sowie
// eBay & Dropshipping und korrigiert Eindeutiges selbst. Jede Korrektur steht im Protokoll.
import { api, esc } from './sess.mjs?v=892f3666';

const I = (p) => `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const P = {
  hq: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/>',
  mail: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<path d="M16 11a4 4 0 1 0-8 0"/><circle cx="12" cy="7" r="3"/><path d="M4 21v-2a6 6 0 0 1 16 0v2"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  euro: '<path d="M17 6.5A6 6 0 1 0 17 17.5"/><path d="M4 10h9M4 14h9"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/>',
  log: '<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h6M10 16h6"/>',
  api: '<path d="M8 9l-4 3 4 3M16 9l4 3-4 3M13.5 6l-3 12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  truck: '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.6"/><circle cx="18" cy="18" r="1.6"/>',
  tag: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  rocket: '<path d="M5 15c-1 1-2 4-2 6 2 0 5-1 6-2"/><path d="M9 15l-3-3c2-6 7-9 14-9 0 7-3 12-9 14z"/><circle cx="14.5" cy="9.5" r="1.5"/>',
  book: '<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M8 8h8M8 12h6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z"/>',
  bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v9M19 10v9M9.5 10v9M14.5 10v9M3 21h18"/>',
  brain: '<path d="M9 3a3 3 0 0 0-3 3v1a3 3 0 0 0-2 5 3 3 0 0 0 2 5v1a3 3 0 0 0 6 0V3z"/><path d="M15 3a3 3 0 0 1 3 3v1a3 3 0 0 1 2 5 3 3 0 0 1-2 5v1a3 3 0 0 1-6 0"/>',
};
// [Reiter, Name, Symbol, Bereich, Farbe]
const APPS = [
  ['System', [['hq', 'Leitstand', 'hq', 'system', '#0F2C59'], ['postfach', 'Postfach', 'mail', 'system', '#0284C7'], ['termine', 'Termine', 'cal', 'system', '#7C3AED'], ['nutzer', 'Nutzer', 'users', 'system', '#0891B2'], ['sicherheit', 'Sicherheit', 'shield', 'system', '#B91C1C'], ['protokoll', 'Protokoll', 'log', 'system', '#475569'], ['api', 'API', 'api', 'system', '#334155'], ['einrichtung', 'Einrichtung', 'gear', 'system', '#64748B']]],
  ['Privatkunden (B2C)', [['uebersicht', 'B2C Übersicht', 'chart', 'b2c', '#0EA5E9'], ['cockpit', 'Finanz-Cockpit', 'euro', 'b2c', '#059669'], ['analyse', 'Analyse', 'chart', 'b2c', '#2563EB'], ['probleme', 'Kundenprobleme', 'shield', 'b2c', '#DC2626']]],
  ['Unternehmen (B2B)', [['uebersicht', 'B2B Übersicht', 'chart', 'b2b', '#0F2C59'], ['anfragen', 'Anfragen', 'mail', 'b2b', '#0369A1'], ['partner', 'Partner', 'users', 'b2b', '#7C3AED'], ['akquise', 'Akquise', 'rocket', 'b2b', '#EA580C']]],
  ['Dropshipping & Steuern', [['st_start', 'Dropshipping', 'truck', 'steuer', '#0F766E'], ['st_verkaeufe', 'Verkäufe', 'euro', 'steuer', '#059669'], ['st_angebote', 'eBay-Angebote', 'tag', 'steuer', '#CA8A04'], ['st_skalierung', 'Skalierung', 'rocket', 'steuer', '#EA580C'], ['st_abgleich', 'Abgleich', 'receipt', 'steuer', '#0891B2'], ['st_buchhaltung', 'Buchhaltung', 'book', 'steuer', '#1D4ED8'], ['st_belege', 'Belege', 'receipt', 'steuer', '#9333EA'], ['rechnungen', 'Rechnungen', 'bank', 'steuer', '#0F2C59'], ['st_ablage', 'Meine Cloud', 'cloud', 'steuer', '#0284C7']]],
];
const DOCK_KEY = 'lr-os-dock';
const DOCK_DEF = ['hq', 'postfach', 'st_verkaeufe', 'st_angebote', 'st_belege', 'st_skalierung'];
const dockIds = () => { try { const x = JSON.parse(localStorage.getItem(DOCK_KEY) || 'null'); return Array.isArray(x) && x.length ? x : DOCK_DEF; } catch { return DOCK_DEF; } };
const allApps = APPS.flatMap(([, a]) => a);
const LV = { bad: ['#FEF2F2', '#B91C1C', 'Fehler'], warn: ['#FFFBEB', '#B45309', 'Achtung'], info: ['#EFF6FF', '#1D4ED8', 'Hinweis'], ok: ['#F0FDF4', '#15803D', 'OK'] };
const AREA = { postfach: 'Postfach', belege: 'Belege & Rechnungen', website: 'Website & Technik', ebay: 'eBay & Dropshipping', steuer: 'Steuer' };
const LIGHT = { ok: '#16A34A', warn: '#F59E0B', bad: '#DC2626' };

function css() {
  if (document.getElementById('iaOsCss')) return;
  const s = document.createElement('style'); s.id = 'iaOsCss';
  s.textContent = `.os{display:grid;gap:14px}.os-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;background:linear-gradient(135deg,#0F2C59,#1E4E8C);color:#fff;border-radius:16px;padding:12px 16px}
.os-bar b{font-size:16px;letter-spacing:.02em}.os-lights{display:flex;flex-wrap:wrap;gap:8px}.os-light{display:inline-flex;gap:6px;align-items:center;background:rgba(255,255,255,.12);border:0;color:#fff;border-radius:999px;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer;min-height:36px}
.os-light i{width:10px;height:10px;border-radius:50%;display:inline-block}.os-clock{font-variant-numeric:tabular-nums;opacity:.9;font-size:13px}
.os-sec h3{margin:6px 2px 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748B}.os-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:10px}
.os-app{position:relative;display:grid;justify-items:center;gap:8px;padding:14px 6px 12px;border-radius:16px;background:#fff;border:1px solid #E2E8F0;cursor:pointer;font:inherit;color:#0F172A;min-height:44px;transition:transform .15s,box-shadow .15s}
.os-app:hover,.os-app:focus-visible{transform:translateY(-2px);box-shadow:0 10px 24px -14px rgba(15,23,42,.5);outline:none}.os-ic{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;color:#fff}
.os-app span{font-size:13px;font-weight:600;text-align:center;line-height:1.25}.os-badge{position:absolute;top:6px;right:8px;min-width:20px;height:20px;border-radius:10px;background:#DC2626;color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center;padding:0 5px}
.os-win{background:#fff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden}.os-win-h{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 14px;background:#F8FAFC;border-bottom:1px solid #E2E8F0;flex-wrap:wrap}
.os-win-h b{display:flex;gap:8px;align-items:center}.os-dots{display:flex;gap:5px}.os-dots i{width:10px;height:10px;border-radius:50%;background:#CBD5E1}.os-win-b{padding:12px 14px;display:grid;gap:8px}
.os-chk{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-radius:10px;padding:9px 12px;border-left:4px solid}.os-chk small{color:#475569}
.os-dock{position:sticky;bottom:10px;z-index:5;display:flex;gap:8px;justify-content:center;margin:0 auto;padding:8px 10px;background:rgba(255,255,255,.92);border:1px solid #E2E8F0;border-radius:18px;box-shadow:0 12px 30px -16px rgba(15,23,42,.55);width:max-content;max-width:100%;overflow-x:auto}
.os-dock button{width:48px;height:48px;border-radius:12px;border:0;display:grid;place-items:center;color:#fff;cursor:pointer;position:relative;flex:0 0 auto}.os-dock button .os-badge{top:-4px;right:-4px}
@media (max-width:600px){.os-grid{grid-template-columns:repeat(4,1fr);gap:6px}.os-app{padding:10px 2px 8px;border:0;background:transparent}.os-ic{width:46px;height:46px}.os-app span{font-size:11px}.os-dock{bottom:calc(76px + env(safe-area-inset-bottom))}}
@media (prefers-reduced-motion:reduce){.os-app{transition:none}}`;
  document.head.append(s);
}

export async function osDesk(v, { goTab, msg }) {
  css();
  v.innerHTML = `<div class="os" data-noklapp>
    <div class="os-bar"><div><b>LeaseRun OS</b><br><small style="opacity:.85">LeaseRun Intelligence · prüft &amp; korrigiert nach festen Regeln · ohne KI-Kosten</small></div>
      <div class="os-lights" id="osLights"><span class="os-light">Prüfe …</span></div><span class="os-clock" id="osClock"></span></div>
    <section class="os-win" id="osIntel"><div class="os-win-h"><b><span class="os-dots"><i></i><i></i><i></i></span> LeaseRun Intelligence</b><span><button type="button" class="btn btn-dark btn-sm" id="osRun">Jetzt prüfen &amp; korrigieren</button></span></div><div class="os-win-b"><p class="form-note">Wird geprüft …</p></div></section>
    ${APPS.map(([t, apps]) => `<section class="os-sec"><h3>${esc(t)}</h3><div class="os-grid">${apps.map(([id, label, ic, seg, col]) => `<button type="button" class="os-app" data-app="${id}" data-seg="${seg}" aria-label="${esc(label)} öffnen"><span class="os-ic" style="background:${col}">${I(P[ic])}</span><span>${esc(label)}</span></button>`).join('')}</div></section>`).join('')}
    <nav class="os-dock" id="osDock" aria-label="Dock">${dockIds().map((id) => { const a = allApps.find((x) => x[0] === id); return a ? `<button type="button" data-app="${a[0]}" data-seg="${a[3]}" title="${esc(a[1])}" aria-label="${esc(a[1])}" style="background:${a[4]}">${I(P[a[2]])}</button>` : ''; }).join('')}</nav>
  </div>`;
  v.querySelectorAll('[data-app]').forEach((b) => b.onclick = () => goTab(b.dataset.app, b.dataset.seg));
  const clock = () => { const c = v.querySelector('#osClock'); if (!c || !c.isConnected) return false; c.textContent = new Date().toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); return true; };
  clock(); const ti = setInterval(() => { if (!clock()) clearInterval(ti); }, 30_000);
  const paint = (r) => {
    if (!v.isConnected) return;
    const L = v.querySelector('#osLights');
    L.innerHTML = Object.entries(r.lights).map(([a, s]) => `<button type="button" class="os-light" data-area="${a}"><i style="background:${LIGHT[s]}"></i>${esc(AREA[a])}</button>`).join('');
    L.querySelectorAll('[data-area]').forEach((b) => b.onclick = () => v.querySelector(`[data-chk-area="${b.dataset.area}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    v.querySelectorAll('.os-badge').forEach((x) => x.remove());
    for (const [tab, n] of Object.entries(r.badges || {})) v.querySelectorAll(`[data-app="${tab}"]`).forEach((b) => { const s = document.createElement('span'); s.className = 'os-badge'; s.textContent = n > 99 ? '99+' : String(n); b.append(s); });
    const fixesNow = (r.fixes || []).filter((f) => f.at === r.at);
    const body = v.querySelector('#osIntel .os-win-b');
    body.innerHTML = `${fixesNow.length ? `<p class="form-note" style="color:#15803D"><b>✓ ${fixesNow.length} Korrektur(en) gerade durchgeführt.</b></p>` : ''}
      ${r.checks.map((c) => `<div class="os-chk" data-chk-area="${c.area}" style="background:${LV[c.level][0]};border-color:${LV[c.level][1]}"><div style="flex:1 1 260px;min-width:0"><small style="color:${LV[c.level][1]};font-weight:700;text-transform:uppercase;letter-spacing:.04em">${LV[c.level][2]} · ${esc(AREA[c.area])}</small><br><b>${esc(c.text)}</b>${c.detail ? `<br><small>${esc(c.detail)}</small>` : ''}</div>${c.tab ? `<button type="button" class="btn btn-outline btn-sm" data-go="${c.tab}" data-seg="${c.seg || ''}" style="min-height:44px">Öffnen</button>` : ''}</div>`).join('') || '<p>Alles in Ordnung.</p>'}
      <details><summary>Korrektur-Protokoll (${(r.fixes || []).length})</summary><div style="display:grid;gap:4px;margin-top:6px">${(r.fixes || []).map((f) => `<small>${new Date(f.at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${esc(AREA[f.area] || f.area)} · ${esc(f.text)}${f.from ? ` (${esc(f.from)} → ${esc(f.to || '')})` : ''}</small>`).join('') || '<small>Noch keine automatischen Korrekturen.</small>'}</div></details>
      <p class="form-note">Stand ${new Date(r.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · läuft zusätzlich automatisch alle 10 Minuten.</p>`;
    body.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => goTab(b.dataset.go, b.dataset.seg || undefined));
  };
  const load = async (fix) => {
    const b = v.querySelector('#osRun'); if (b) { b.disabled = true; b.textContent = fix ? 'Prüft & korrigiert …' : 'Prüft …'; }
    const r = await api('/api/admin/os/checks', fix ? { method: 'POST', body: '{}' } : undefined);
    if (b) { b.disabled = false; b.textContent = 'Jetzt prüfen & korrigieren'; }
    if (!r.ok) { const body = v.querySelector('#osIntel .os-win-b'); if (body) body.innerHTML = `<p class="st-warn">${esc(r.data?.error || 'Prüfung nicht möglich.')}</p>`; return; }
    paint(r.data);
    if (fix) msg('Geprüft und korrigiert.');
  };
  v.querySelector('#osRun').onclick = () => load(true);
  load(false);
}
