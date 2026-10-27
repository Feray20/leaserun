// LeaseRun HEADQUARTERS · Command Center (Web-Admin, "System" area).
// Builds on the existing admin center (no parallel structure): status, metrics, alerts, systems and activity come
// from /api/admin/app/overview (same source as the admin app), today's revenue from the Finance Cockpit.
// Real data only: if a source is missing, "–" is shown with a note – nothing is estimated or made up.
import { api, download, dtt, esc, eur } from './sess.mjs?v=892f3666';

// "Check & fix" already shows these alerts with a button – not duplicated in the decisions block.
const IN_CHECK = new Set(['sys-panic', 'sys-mfa', 'sys-mail', 'sys-mailerr', 'sec-noise', 'web-errors']);

// Targets of the overview API → tab (and data area) of the admin center.
const TARGET = {
  jetzt: ['jetzt'],
  zahlungen: ['rechnungen', 'b2b'], postfach: ['postfach'], termine: ['termine'], anfragen: ['anfragen', 'b2b'],
  unternehmen: ['partner', 'b2b'], sicherheit: ['sicherheit'], system: ['system'], statistik: ['kennzahlen', 'b2c'], audit: ['protokoll'],
};
// Priority by severity first (command center rule), then recency.
const SEV = { critical: 0, warning: 1, info: 2 };
const SEV_L = { critical: ['bad', 'Critical'], warning: ['warn', 'Warning'], info: ['info', 'Info'] };
const SYS_L = { ok: ['ok', 'OK'], warn: ['warn', 'Note'], fail: ['bad', 'Outage'], off: ['off', 'Off'] };

const ic = (d, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I_REF = '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>';
const I_GO = '<path d="M9 6l6 6-6 6"/>';
// Owner's timezone; formatting en-US.
const TZ = 'Europe/Berlin';
const today = () => {
  const d = new Date();
  return `${d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })}`;
};
const ago = (s) => {
  if (!s) return '';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return dtt(s);
};

// Digital staff (lib/admin/hq-agents.ts is the source; this list is the initial view until the server answers).
// Each one takes tasks in the input field. Internal work is done right away; anything external only after the owner approves.
let AGENTS = [
  { id: 'postfach', name: 'Emily', last: 'Carter', role: 'Email', color: '#DB2777', vibe: 'Calm and thorough. Keeps an eye on every email.', job: 'Fetches email, sorts it by urgency and prepares replies as drafts.' },
  { id: 'sicherheit', name: 'Jake', last: 'Morrison', role: 'Security', color: '#7C3AED', vibe: 'Watchful, never sleeps. Blocks attackers before you notice.', job: 'Blocks attacking sources, cleans up and reports what only you can solve.' },
  { id: 'technik', name: 'Olivia', last: 'Brooks', role: 'Product & Tech', color: '#0D9488', vibe: 'Precise. Would rather check once more.', job: 'Checks Stripe, the payment webhook, email domain, database and new releases live.' },
  { id: 'finanzen', name: 'Ryan', last: 'Mitchell', role: 'Finance', color: '#16A34A', vibe: 'Numbers person. Nothing goes out without your okay.', job: 'Revenue, open and overdue invoices; prepares payment reminders.' },
  { id: 'vertrieb', name: 'Madison', last: 'Hayes', role: 'Sales & Partners', color: '#F59E0B', vibe: 'Fast and friendly. No request gets left behind.', job: 'Keeps track of business requests, demo requests and partner accounts.' },
  { id: 'neukunden', name: 'Hannah', last: 'Walsh', role: 'New customers', color: '#0EA5E9', vibe: 'Thinks from the first visit to the purchase.', job: 'Watches the path from visitor to purchase, finds drop-offs and suggests how more visitors become customers.' },
  { id: 'bestandskunden', name: 'Liam', last: 'Foster', role: 'Customer success', color: '#2563EB', vibe: 'Steps in before anyone leaves.', job: 'Keeps track of active subscriptions, expiring access, quiet accounts and refunds.' },
  { id: 'akquise', name: 'Zoe', last: 'Campbell', role: 'Acquisition (B2B)', color: '#D97706', vibe: 'Persistent and polite. Never misses a follow-up.', job: 'Keeps contacts with lenders, brokers, property managers and agents moving and prepares win-win outreach as drafts.' },
  { id: 'support', name: 'Tyler', last: 'Reed', role: 'Support', color: '#2F7FC1', vibe: 'Spots every customer stumble – right away.', job: 'Sees immediately when a customer hits an error or abandons checkout, finds the cause and fixes harmless issues himself.' },
  { id: 'freigaben', name: 'Ava', last: 'Bennett', role: 'Approvals', color: '#0F2C59', vibe: 'Your right hand. Collects everything that needs your okay.', job: 'Shows everything that would go out – only after your approval.' },
  { id: 'creator', name: 'Chloe', last: 'Parker', role: 'Creators', color: '#E11D48', vibe: 'Knows every community. Keeps applications moving.', job: 'Keeps track of creator applications and questions.' },
  { id: 'recht', name: 'Daniel', last: 'Hughes', role: 'Legal & Compliance', color: '#475569', vibe: 'Better too careful than sorry.', job: 'Checks legal pages, consents, unsubscribe links and deadlines – would rather remove a risk than keep it.' },
  { id: 'briefing', name: 'Ethan', last: 'Collins', role: 'Daily briefing', color: '#0369A1', vibe: 'Connects the dots between all departments.', job: 'Reviews all agents together, spots shared causes and names the three most important steps for today.' },
  { id: 'optimierung', name: 'Noah', last: 'Sullivan', role: 'SEO & Optimization', color: '#9333EA', vibe: 'Finds improvements before you look for them.', job: 'Checks website and system on his own, fixes internal things right away and proposes the rest.' },
  { id: 'marketing', name: 'Sophie', last: 'Turner', role: 'Marketing', color: '#EA580C', vibe: 'Thinks in reach. Every idea comes with a number and a reason.', job: 'Reads visitors, sources, checkout and newsletter, makes suggestions and drafts copy. Publishes nothing – you approve.' },
];
const SHIFT_MS = 3 * 60_000;
// Departments in the orbit. In the center: LeaseRun. Plus the owner as Head of Operations.
const I = {
  mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>', euro: '<path d="M17 7a6 6 0 1 0 0 10"/><path d="M5 10h8M5 14h8"/>',
  handshake: '<path d="M3 12l4-4 4 3 3-3 4 1 3 3-6 6-4-3-2 2z"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  check: '<path d="M4 12l5 5L20 6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>', mega: '<path d="M3 10v4h3l6 4V6l-6 4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>', crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
};
const ORBIT = [
  { k: 'founder', n: 'Head of Operations', founder: true, icon: I.crown, c: '#0F2C59' },
  { k: 'freigaben', n: 'Approvals', agent: 'freigaben', icon: I.check, c: '#0F2C59' },
  { k: 'postfach', n: 'Email', agent: 'postfach', icon: I.mail, c: '#DB2777' },
  { k: 'finanzen', n: 'Finance', agent: 'finanzen', icon: I.euro, c: '#16A34A' },
  { k: 'vertrieb', n: 'Sales', agent: 'vertrieb', icon: I.handshake, c: '#F59E0B' },
  { k: 'neukunden', n: 'New customers', agent: 'neukunden', icon: I.star, c: '#0EA5E9' },
  { k: 'bestandskunden', n: 'Customer success', agent: 'bestandskunden', icon: I.help, c: '#2563EB' },
  { k: 'akquise', n: 'Acquisition', agent: 'akquise', icon: I.mega, c: '#D97706' },
  { k: 'creator', n: 'Creators', agent: 'creator', icon: I.star, c: '#E11D48' },
  { k: 'support', n: 'Support', agent: 'support', icon: I.help, c: '#2F7FC1' },
  { k: 'technik', n: 'Product', agent: 'technik', icon: I.cpu, c: '#0D9488' },
  { k: 'sicherheit', n: 'Security', agent: 'sicherheit', icon: I.shield, c: '#7C3AED' },
  { k: 'recht', n: 'Legal', agent: 'recht', icon: I.check, c: '#475569' },
  { k: 'briefing', n: 'Briefing', agent: 'briefing', icon: I.sun, c: '#0369A1' },
  { k: 'optimierung', n: 'SEO', agent: 'optimierung', icon: I.gauge, c: '#9333EA' },
  { k: 'marketing', n: 'Marketing', agent: 'marketing', icon: I.mega, c: '#EA580C' },
];
// LeaseRun mark (arrow house from the logo) for the center.
const MARK = '<svg viewBox="-2 -2 104 88" width="34" height="30" aria-hidden="true"><defs><linearGradient id="hqMk" gradientUnits="userSpaceOnUse" x1="0" y1="84" x2="100" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#7DD3FC"/></linearGradient></defs><g fill="url(#hqMk)"><polygon points="50,8.3 63.1,19.4 62.6,22.5 49,34 45.2,31.1 5.3,68.9 2.5,70 3.1,51.7"/><polygon points="98.8,0.7 93.4,37.3 83.6,29.8 50.8,62.3 43.7,57.9 17.2,82.6 0.2,82.6 42.2,38.4 50.3,40.1 69.6,19.5 64.6,8.1"/><polygon points="82.3,37.6 99.5,53.6 99.6,84 88.6,83.6 62.5,57"/></g></svg>';
// Agent replies: bold (**…**), line breaks and https links (new tab) – escape first, then link only safe https URLs.
const rich = (t) => esc(t).replace(/\*\*([^*\n]{1,200})\*\*/g, '<b>$1</b>').replace(/https:\/\/[A-Za-z0-9.\-]+(?:\/[A-Za-z0-9\-._~%/?=&;#]*)?/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, '<br>');
const initials = (a) => (a.name[0] + a.last[0]).toUpperCase();

let seq = 0;
export async function hq(v, { goTab, msg }) {
  const my = ++seq;
  v.innerHTML = `<section class="hq" aria-labelledby="hqT">
    <header class="hq-hero" data-level="load">
      <div class="hq-hero-top"><small class="hq-kick">LeaseRun Headquarters · Command Center</small><button type="button" class="hq-ref" id="hqRef">${ic(I_REF, 16)}<span>Refresh</span></button></div>
      <h2 id="hqT" class="hq-title"><span class="hq-dot" aria-hidden="true"></span><span id="hqStat">Checking status …</span></h2>
      <p class="hq-detail" id="hqDet"></p>
      <p class="hq-bar" id="hqBar"></p>
      <p class="hq-asof"><span id="hqAsof">${esc(today())}</span> <span class="hq-aist" id="hqAi"></span></p>
      <p class="hq-since" id="hqSince" hidden></p>
      <form class="hq-q" id="hqQ" role="search"><input name="q" autocomplete="off" maxlength="300" placeholder="Search or give a task …" aria-label="Search or give a task to LeaseRun Intelligence" aria-controls="hqOS" aria-expanded="false"><button type="submit" class="hq-btn hq-btn-p">Go</button><div class="hq-os" id="hqOS" role="listbox" hidden></div></form>
      <div class="hq-qa" id="hqQA" aria-live="polite" hidden></div>
      <section class="hq-orbit" id="hqOrbit" aria-labelledby="hqOrbitT">
        <h3 class="sr-only" id="hqOrbitT">Departments and digital staff</h3>
        <div class="hq-feed" id="hqFeed" aria-live="polite"></div>
        <div class="hq-ring" id="hqRing">
          <div class="hq-core"><div class="hq-orb" aria-hidden="true"><span></span><span></span><span class="hq-orb-logo"><img src="/logo-icon.svg" alt="" width="54" height="46"></span></div>
            <button type="button" class="hq-pill" id="hqAll"><span class="hq-mk">${MARK}</span><b>LeaseRun</b><small>Intelligence · everyone to work</small></button></div>
          ${ORBIT.map((d, i) => { const a = AGENTS.find((x) => x.id === d.agent); return `<button type="button" class="hq-dep${d.founder ? ' founder' : ''}" data-dep="${d.k}" style="--i:${i};--n:${ORBIT.length}">${d.founder ? '<span class="hq-dep-ic hq-face"><img src="/img/gruender-240.webp" alt="Head of Operations" width="40" height="40" loading="lazy"></span>' : `<span class="hq-dep-ic" style="--c:${a?.color || d.c}">${a ? `<span class="hq-ini">${initials(a)}</span>` : ic(d.icon, 20)}</span>`}<span class="hq-dep-t"><b>${esc(d.founder ? 'Head of Operations' : `${a.name} ${a.last}`)}</b><small data-dl>${d.founder ? 'Owner' : `<i class="dot"></i>${esc(d.n)}`}</small></span><em class="hq-dep-b" data-db hidden></em></button>`; }).join('')}
        </div>
        <div class="hq-sheet" id="hqSheet" aria-live="polite"></div>
        <div class="hq-orbit-foot"><span id="hqShift">Shift starting …</span></div>
      </section>
    </header>
    <section class="hq-card hq-prio hq-dec" aria-labelledby="hqDecT"><div class="hq-dec-h"><h3 id="hqDecT">Now important <span class="hq-dec-n" id="hqDecN"></span></h3><div class="hq-sh-a"><button type="button" class="hq-btn" id="hqDecRun">Check now</button><button type="button" class="hq-btn hq-btn-p" id="hqDecAll" hidden>Fix all</button></div></div><div id="hqDec" aria-live="polite"><div class="hq-kpi hq-sk"></div></div></section>
    <section class="hq-card hq-met" aria-labelledby="hqMetT"><h3 id="hqMetT">Today · Metrics</h3>
      <div class="hq-chips hq-chips-l" id="hqRev" aria-live="polite"></div>
      <div class="hq-kpis" id="hqKpi" aria-live="polite">${'<div class="hq-kpi hq-sk"></div>'.repeat(4)}</div></section>
    <details class="hq-card hq-fold"><summary><h3>Systems</h3><span id="hqSysSum">…</span></summary><div id="hqSys"></div></details>
    <details class="hq-card hq-fold"><summary><h3>Activity</h3><span id="hqActSum"></span></summary><div id="hqAct"></div></details>
  </section>`;
  const $ = (s) => v.querySelector(s);
  // Order: status → Now important (incl. approvals, active) → metrics → departments (phone: compact grid) → systems/activity.
  const phone = matchMedia('(max-width: 600px)');
  // Desktop too: decisions before the department ring – the most important things are on the first screen.
  const arrange = () => { const o = $('#hqOrbit'), m = v.querySelector('.hq-met'); if (!o || !m) return; v.classList.toggle('hq-phone', phone.matches); m.after(o); };
  arrange(); phone.addEventListener?.('change', arrange);
  // Tapping beside the sheet closes it (phone).
  $('#hqSheet').addEventListener('click', (e) => { if (e.target === e.currentTarget && openDep) { openDep = null; paintAll(); } });
  // Rotate the ring with mouse (or pen); a short click still opens the agent.
  const ring = { dragged: false, rot: 0 };
  { const el = $('#hqRing'); let st = null;
    el.addEventListener('pointerdown', (e) => { if (innerWidth < 900 || e.button !== 0) return; const r = el.getBoundingClientRect(); st = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: e.clientX, y: e.clientY, rot: ring.rot }; st.a = Math.atan2(e.clientY - st.cy, e.clientX - st.cx); ring.dragged = false; });
    el.addEventListener('pointermove', (e) => { if (!st) return; if (!ring.dragged && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 6) { ring.dragged = true; try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } el.classList.add('drag'); } if (!ring.dragged) return; ring.rot = st.rot + (Math.atan2(e.clientY - st.cy, e.clientX - st.cx) - st.a) * 180 / Math.PI; el.style.setProperty('--rot', `${ring.rot}deg`); });
    const end = () => { if (!st) return; st = null; el.classList.remove('drag'); setTimeout(() => { ring.dragged = false; }, 0); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { if (innerWidth < 900 || !e.shiftKey) return; e.preventDefault(); ring.rot += e.deltaY > 0 ? 12 : -12; el.style.setProperty('--rot', `${ring.rot}deg`); }, { passive: false });
  }
  // ---------- Shift: all staff in parallel ----------
  let shift = {}; const busy = new Set(); let queued = false;
  const ST = { ok: ['ok', 'Done'], todo: ['warn', 'Needs you'], error: ['bad', 'Problem'] };
  const agoS = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const FOUNDER = 'you';
  let openDep = null, feedIx = 0;
  const depState = (d) => { if (d.founder) { return AGENTS.some((a) => shift[a.id] && shift[a.id].status !== 'ok') ? 'todo' : 'ok'; } if (!d.agent) return 'plan'; if (busy.has(d.agent)) return 'busy'; return shift[d.agent]?.status || 'idle'; };
  let findings = [], alerts = [], decReady = false;
  let cmds = {}; const chat = {}; let autoAsk = null; let ai = null; let proposals = []; let umsetzungSofort = false; let uBlock = null;
  const usd = (x) => (Number(x) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const paintAi = () => {
    const el = $('#hqAi'); if (!el) return;
    if (!ai) { el.textContent = ''; return; }
    if (!ai.configured) { el.innerHTML = `· <a href="#einrichtung">Claude not connected yet</a>`; return; }
    el.innerHTML = ai.blocked ? `· <b>${esc(ai.blocked)}</b>` : '· LeaseRun Intelligence active';
  };
  // Model analysis (cause · done · what you need to do) in an agent's sheet.
  const GRUND = { analyse: 'Analysis & solution', tag: 'Daily round · proposals', auftrag: 'Reply' };
  const aiBox = (r) => {
    if (!r?.ai) return '';
    const a = r.ai;
    return `<details class="hq-ai"><summary><small>${esc(GRUND[a.grund] || 'Result')} · ${esc(agoS(a.at))}</small></summary><p>${rich(a.text)}</p></details>`;
  };
  // Solutions (proposals): only "Do it" / "Dismiss". "Do it" is carried out by the implementation agent; documents are accepted right away.
  const KIND = { code: 'Website change', text: 'Copy', marketing: 'Marketing', einstellung: 'Setting', dokument: 'Document', sonstiges: 'Solution' };
  const propHtml = (p) => { const a = AGENTS.find((x) => x.id === p.agent); const st = p.status;
    return `<li class="hq-p-${esc(st)}"><div><b>${esc(p.title)}</b><small>${esc(a ? `${a.name} · ${a.role}` : p.agent)} · ${esc(KIND[p.kind] || 'Solution')} · ${esc(agoS(p.at))}</small>
      ${st === 'erledigt' ? `<p class="hq-res">${esc(p.result || 'Done.')}</p>` : st === 'auftrag' || st === 'in_arbeit' ? `<p class="hq-res run">${st === 'in_arbeit' ? 'Being implemented …' : (uBlock ? (uBlock.reason === 'guthaben' ? 'Approved – waiting for Anthropic credit, then runs automatically.' : 'Approved – waiting, then runs automatically.') : umsetzungSofort ? 'Starting soon – will be implemented in the next few minutes.' : 'Waiting for the implementation agent – it starts with the next website update. To start right away: Setup → "Implement solutions immediately".')}</p>` : `<details class="hq-more"><summary>Details</summary><p>${esc(p.detail).replace(/\n/g, '<br>')}</p>${p.why ? `<p class="hq-why">${esc(p.why)}</p>` : ''}</details>${p.result ? `<p class="hq-res bad">${esc(p.result)}</p>` : ''}`}</div>
      ${st === 'offen' ? `<div class="hq-sh-a">${p.doc ? `<button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="pdf">PDF</button><button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="word">Word</button>` : ''}<button type="button" class="hq-btn hq-btn-p" data-dec="erledigen" data-pid="${esc(p.id)}">Do it</button><button type="button" class="hq-btn" data-dec="verworfen" data-pid="${esc(p.id)}">Dismiss</button></div>` : st === 'erledigt' && p.doc ? `<div class="hq-sh-a"><button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="pdf">PDF</button><button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="word">Word</button></div>` : ''}</li>`; };
  const bindProps = (box) => {
    box.querySelectorAll('[data-dec]').forEach((b) => b.onclick = async () => {
      // "Do it" works with a single tap (owner's wish). A second tap used to be needed – it got lost when the view
      // re-rendered in between (e.g. after an analysis), and it looked like nothing happened.
      b.disabled = true; b.textContent = b.dataset.dec === 'erledigen' ? 'Handing over …' : '…';
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'proposal', proposalId: b.dataset.pid, decision: b.dataset.dec }) });
      if (!r.ok) { b.disabled = false; msg(r.data?.error || 'Not possible.', true); return; }
      proposals = r.data.proposals || []; msg(r.data.status === 'auftrag' ? (r.data.started ? 'Implementation started – the result appears here and as a notification.' : 'Approved. The implementation agent starts with the next website update (for right away: Setup).') : r.data.status === 'erledigt' ? 'Accepted.' : 'Dismissed.'); paintAll();
    });
    box.querySelectorAll('[data-doc]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await download(`/api/admin/hq/doc?id=${encodeURIComponent(b.dataset.doc)}&f=${b.dataset.f}`, {}, `document.${b.dataset.f === 'word' ? 'docx' : 'pdf'}`); } catch (e) { msg(e.message || 'Download not possible.', true); } b.disabled = false; });
  };
  // Ava · Approvals: review drafts as packages (source + day created). Open the selection in the Inbox or move it to
  // "Archive" (nothing is deleted). No bulk sending – emails are only sent one by one from the Inbox.
  let pk = null, pkBusy = false; const pkSel = new Set(), pkOpen = new Set();
  const loadPk = async () => {
    if (pkBusy) return; pkBusy = true;
    const r = await api('/api/admin/hq?entwuerfe=1'); pkBusy = false;
    pk = r.ok ? r.data : { error: r.data?.error || 'Drafts not available right now.' };
    paintPk($('#hqSheet [data-pk]'));
  };
  const deDay = (t) => { const [y, m, d] = String(t).split('-'); return `${m}/${d}/${y}`; };
  const paintPk = (el) => {
    if (!el) return;
    if (!pk) { el.innerHTML = '<p class="hq-sh-l">Loading drafts …</p>'; loadPk(); return; }
    if (pk.error) { el.innerHTML = `<p class="hq-sh-l">${esc(pk.error)}</p>`; return; }
    const ids = new Set(pk.pakete.flatMap((g) => g.entwuerfe.map((e) => e.id)));
    for (const id of [...pkSel]) if (!ids.has(id)) pkSel.delete(id);
    const n = pkSel.size;
    el.innerHTML = `<h4 class="hq-h4">Drafts as packages (${pk.anzahl})</h4>
      ${pk.anzahl ? `<div class="hq-sh-a"><button type="button" class="hq-btn hq-btn-p" data-pk-open ${n ? '' : 'disabled'}>Open selected in Inbox${n ? ` (${n})` : ''}</button><button type="button" class="hq-btn" data-pk-arch ${n ? '' : 'disabled'}>Archive selected${n ? ` (${n})` : ''}</button><button type="button" class="hq-btn" data-pk-re>Reload</button></div>
      <p class="hq-pk-n">Emails are only sent one by one from the Inbox. Marketing without a legal basis (no opt-in, opted out, missing unsubscribe link or postal address) is blocked and can't be sent. Archiving moves to the "Archive" folder – nothing is deleted, everything can be restored.</p>
      ${pk.pakete.map((g, gi) => { const k = `${g.herkunft}|${g.tag}`, dup = g.entwuerfe.filter((e) => e.doppel).length, all = g.entwuerfe.every((e) => pkSel.has(e.id));
        return `<details class="hq-pk-g" data-pkg="${esc(k)}"${pkOpen.has(k) ? ' open' : ''}><summary><b>${esc(g.herkunft)}, ${deDay(g.tag)}, ${g.entwuerfe.length} items</b>${dup ? `<small>${dup} duplicates</small>` : ''}</summary>
          <label class="hq-chk hq-pk-all"><input type="checkbox" data-pg="${gi}"${all ? ' checked' : ''}> Select whole package</label>
          <ul class="hq-pk-l">${g.entwuerfe.map((e) => `<li><label><input type="checkbox" data-pe="${esc(e.id)}"${pkSel.has(e.id) ? ' checked' : ''}><span><b>${esc(e.an)}</b><small>${esc(e.betreff || '(no subject)')}${e.doppel ? ' · <em>Duplicate</em>' : ''}</small><small class="hq-pk-r"><span class="st${e.art === 'Werbung' ? ' warn' : ''}">${esc(e.art === 'Werbung' || !e.art ? 'Marketing' : e.art)}</span> <span class="st ${e.sendbar ? 'ok' : 'bad'}">Legal basis: ${esc(e.grundlage || 'missing')}</span>${!e.sendbar && e.grund ? ` · ${esc(e.grund)}` : ''}</small>${e.vorschau ? `<small class="hq-pk-v">${esc(e.vorschau)}</small>` : ''}</span></label></li>`).join('')}</ul></details>`; }).join('')}` : '<p class="hq-sh-l">✓ No drafts in the Inbox.</p>'}`;
    el.querySelectorAll('[data-pkg]').forEach((d) => d.ontoggle = () => { d.open ? pkOpen.add(d.dataset.pkg) : pkOpen.delete(d.dataset.pkg); });
    el.querySelectorAll('[data-pe]').forEach((x) => x.onchange = () => { x.checked ? pkSel.add(x.dataset.pe) : pkSel.delete(x.dataset.pe); paintPk(el); });
    el.querySelectorAll('[data-pg]').forEach((x) => x.onchange = () => { for (const e of pk.pakete[Number(x.dataset.pg)].entwuerfe) x.checked ? pkSel.add(e.id) : pkSel.delete(e.id); paintPk(el); });
    const re = el.querySelector('[data-pk-re]'); if (re) re.onclick = () => { pk = null; paintPk(el); };
    const op = el.querySelector('[data-pk-open]');
    // Hand-off to the Inbox: "Drafts" folder, selection remembered, first draft opened.
    if (op) op.onclick = () => { try { sessionStorage.setItem('lr-pf-pick', JSON.stringify([...pkSel].slice(0, 200))); } catch { /* convenience only */ } goTab('postfach'); };
    const ar = el.querySelector('[data-pk-arch]');
    if (ar) ar.onclick = async () => {
      const list = [...pkSel].slice(0, 200);
      if (!list.length || !confirm(`Move ${list.length} ${list.length === 1 ? 'draft' : 'drafts'} to the "Archive" folder? Nothing is sent or deleted.`)) return;
      ar.disabled = true; ar.textContent = 'Archiving …';
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'entwuerfe_archivieren', ids: list }) });
      if (!r.ok) { msg(r.data?.error || 'Archiving not possible.', true); paintPk(el); return; }
      pk = r.data; pkSel.clear(); msg(`${r.data.archiviert} ${r.data.archiviert === 1 ? 'draft' : 'drafts'} moved to Archive (restorable in the Inbox under "Archive").`);
      paintPk(el); work(['freigaben'], true);
    };
  };
  const paintSheet = () => {
    const box = $('#hqSheet'), d = ORBIT.find((x) => x.k === openDep);
    if (!d) { box.innerHTML = ''; return; }
    if (d.founder) {
      const wait = AGENTS.filter((a) => shift[a.id] && shift[a.id].status !== 'ok');
      box.innerHTML = `<div class="hq-sh"><div class="hq-sh-h"><span class="hq-dep-ic hq-face"><img src="/img/gruender-240.webp" alt="Head of Operations" width="44" height="44" loading="lazy"></span><div><b>Head of Operations</b><small>Owner</small></div><button type="button" class="hq-rc-x" data-x aria-label="Close">×</button></div>
        ${wait.length ? `<ul class="hq-fl">${wait.map((a) => `<li><button type="button" data-open="${a.id}"><span class="hq-ini sm" style="background:${a.color}">${initials(a)}</span><span><b>${esc(a.name)} · ${esc(a.role)}</b><small>${esc(shift[a.id].line)}</small></span></button></li>`).join('')}</ul>` : '<p class="hq-sh-l">✓ All done.</p>'}
        ${proposals.length ? `<h4 class="hq-h4">Solutions for approval (${proposals.filter((p) => p.status === 'offen').length})</h4><ul class="hq-prop">${proposals.map(propHtml).join('')}</ul>` : ''}
        ${ai?.configured ? `<details class="hq-set"><summary>LeaseRun Intelligence · Settings</summary>
          <form class="hq-setf" data-set>
            <label>Command center &amp; daily briefing<select name="top">${ai.models.map((m) => `<option value="${m.id}" ${m.id === ai.settings.top ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label>All other departments (chat with you)<select name="rest">${ai.models.map((m) => `<option value="${m.id}" ${m.id === ai.settings.rest ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label>Background (watch, daily round, drafts – most calls)<select name="bg">${ai.models.map((m) => `<option value="${m.id}" ${m.id === ai.settings.bg ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label class="hq-chk"><input name="off" type="checkbox" ${ai.settings.off ? 'checked' : ''}> AI off (no Anthropic cost – agents work rule-based)</label>
            <label class="hq-chk"><input name="auto" type="checkbox" ${ai.settings.auto ? 'checked' : ''}> Automatically analyze and fix new findings</label>
            <label class="hq-chk"><input name="daily" type="checkbox" ${ai.settings.daily ? 'checked' : ''}> Daily round from 6 a.m. (solutions per department)</label>
            <div class="hq-sh-a"><button type="submit" class="hq-btn hq-btn-p">Save</button><button type="button" class="hq-btn" data-daily>Run daily round now</button></div>
          </form>
        </details>` : ''}</div>`;
      box.querySelector('[data-x]').onclick = () => { openDep = null; paintAll(); };
      box.querySelectorAll('[data-open]').forEach((x) => x.onclick = () => { openDep = ORBIT.find((o) => o.agent === x.dataset.open).k; paintAll(); });
      bindProps(box);
      const f = box.querySelector('[data-set]');
      if (f) {
        f.onsubmit = async (e) => {
          e.preventDefault(); const fd = new FormData(f);
          const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'settings', settings: { top: fd.get('top'), rest: fd.get('rest'), bg: fd.get('bg'), auto: fd.get('auto') === 'on', daily: fd.get('daily') === 'on', off: fd.get('off') === 'on' } }) });
          if (!r.ok) { msg(r.data?.error || 'Not saved.', true); return; }
          ai = r.data.ai; msg('Saved.'); paintAi(); paintAll();
        };
        f.querySelector('[data-daily]').onclick = async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Running … (up to a minute)';
          const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'tagesrunde' }) });
          if (r.ok) { shift = r.data.agents || shift; msg(r.data.done?.length ? `Daily round: ${r.data.done.map((id) => AGENTS.find((x) => x.id === id)?.name || id).join(', ')} made proposals.` : r.data.skipped || "Today's daily round is already complete."); } else msg(r.data?.error || 'Not possible.', true);
          refreshAi(); paintAll();
        };
      }
      return;
    }
    const a = AGENTS.find((x) => x.id === d.agent), r = shift[a.id], b = busy.has(a.id);
    const [c, l] = b ? ['info', 'Working …'] : r ? ST[r.status] || ST.ok : ['off', 'Waiting'];
    const acts = (r?.actions || []).filter((x) => x.id !== 'open' || r.status !== 'ok');
    const h = chat[a.id] || [];
    box.innerHTML = `<div class="hq-sh"><div class="hq-sh-h"><span class="hq-dep-ic" style="--c:${a.color}"><span class="hq-ini">${initials(a)}</span></span><div><b>${esc(a.name)} ${esc(a.last)}</b><small>${esc(a.role)}</small></div><span class="hq-st ${c}">${l}</span><button type="button" class="hq-rc-x" data-x aria-label="Close">×</button></div>
      <p class="hq-sh-l">${r ? `${esc(r.line)} <span>· ${agoS(r.at)}</span>` : "Hasn't worked yet."}</p>
      ${aiBox(r)}
      ${a.id === 'freigaben' ? '<div class="hq-pk" data-pk></div>' : ''}
      ${(() => { const mine = proposals.filter((p) => p.agent === a.id); return mine.length ? `<h4 class="hq-h4">Solutions</h4><ul class="hq-prop">${mine.map(propHtml).join('')}</ul>` : ''; })()}
      <div class="hq-sh-a">${acts.map((x, i) => `<button type="button" class="hq-btn ${x.id === 'remind' ? 'hq-btn-p' : ''}" data-ai="${i}">${esc(x.label)}</button>`).join('')}<button type="button" class="hq-btn hq-btn-p" data-run ${b ? 'disabled' : ''}>${b ? 'Working …' : 'Do it now'}</button></div>
      <div class="hq-chat"${ai?.settings?.off && !h.length ? ' hidden' : ''}>${h.map((m) => `<p class="hq-msg ${m.me ? 'me' : ''}${m.wait ? ' wait' : ''}">${rich(m.t)}</p>`).join('')}</div>
      ${ai?.settings?.off ? '<p class="form-note">AI off: this agent checks and fixes automatically by fixed rules (no chat, no cost). The buttons below run fixed tasks right away.</p>' : `<form class="hq-ask" data-ask><input name="q" autocomplete="off" maxlength="1500" placeholder="Task for ${esc(a.name)} …" aria-label="Task for ${esc(a.name)}"><button type="submit" class="hq-btn hq-btn-p">Go</button></form>`}
      <div class="hq-chips2">${(cmds[a.id] || []).map((t) => `<button type="button" data-cmd="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
    box.querySelector('[data-x]').onclick = () => { openDep = null; paintAll(); };
    bindProps(box);
    box.querySelector('[data-run]').onclick = () => doNow(a.id);
    if (a.id === 'freigaben') paintPk(box.querySelector('[data-pk]'));
    const th = box.querySelector('[data-think]');
    if (th) th.onclick = async () => { th.disabled = true; th.textContent = 'Claude is working …'; const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'analyse', agents: [a.id] }) }); if (r.ok) { shift = r.data.agents || shift; if (r.data.skipped) msg(r.data.skipped, true); } else msg(r.data?.error || 'Analysis not possible.', true); refreshAi(); paintAll(); };
    box.querySelectorAll('[data-ai]').forEach((btn) => btn.onclick = () => act(a.id, acts[Number(btn.dataset.ai)], btn));
    const send = async (text) => {
      if (!text.trim()) return;
      (chat[a.id] ||= []).push({ me: true, t: text });
      const hist = chat[a.id].slice(0, -1).filter((m) => !m.wait).slice(-8).map((m) => ({ me: Boolean(m.me), t: m.t }));
      const wait = { t: `${a.name} is working …`, wait: true };
      chat[a.id].push(wait); paintSheet();
      const f = box.querySelector('[data-ask]'); if (f) f.querySelector('input').disabled = true;
      const x = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ agent: a.id, command: text, history: hist }) });
      chat[a.id] = chat[a.id].filter((m) => m !== wait);
      chat[a.id].push({ t: x.ok ? x.data.reply : (x.status === 504 ? 'That was a lot at once – I finished part of it. Write "continue" and I will keep going.' : x.data?.error || "That didn't work – please send it again."), claude: Boolean(x.ok && x.data.ai) });
      if (x.ok && x.data.actions?.length && shift[a.id]) shift[a.id] = { ...shift[a.id], actions: x.data.actions };
      if (x.ok && x.data.ai) refreshAi();
      paintSheet(); box.querySelector('[data-ask] input')?.focus();
    };
    const askF = box.querySelector('[data-ask]'); if (askF) askF.onsubmit = (e) => { e.preventDefault(); send(e.target.q.value); };
    if (autoAsk) { const q = autoAsk; autoAsk = null; send(q); }
    box.querySelectorAll('[data-cmd]').forEach((x) => x.onclick = () => send(x.dataset.cmd));
  };
  // Live feed: what the agents recently finished or handed to you – real results only.
  const feedItems = () => AGENTS.filter((a) => shift[a.id]).map((a) => ({ a, r: shift[a.id], d: ORBIT.find((x) => x.agent === a.id) }))
    .sort((x, y) => (x.r.status === 'ok') - (y.r.status === 'ok') || String(y.r.at).localeCompare(String(x.r.at)));
  const paintFeed = () => {
    const it = feedItems(), box = $('#hqFeed');
    if (busy.size) { box.innerHTML = `<div class="hq-fd busy"><i></i><div><small>${busy.size} working</small><p>${[...busy].map((id) => AGENTS.find((a) => a.id === id)?.name).join(', ')} …</p></div></div>`; return; }
    if (!it.length) { box.innerHTML = ''; return; }
    const show = it.slice(feedIx % it.length).concat(it.slice(0, feedIx % it.length)).slice(0, 2);
    box.innerHTML = show.map(({ a, r, d }) => `<button type="button" class="hq-fd s-${r.status}" data-fd="${d.k}"><i></i><div><small>${esc(a.name)} · ${r.status === 'ok' ? 'done' : `→ ${FOUNDER}`}</small><p>${esc(String(r.line || '').slice(0, 110))}</p></div></button>`).join('');
    box.querySelectorAll('[data-fd]').forEach((b) => b.onclick = () => { openDep = b.dataset.fd; paintAll(); });
  };
  const paintAll = () => {
    for (const d of ORBIT) {
      const el = v.querySelector(`[data-dep="${d.k}"]`); if (!el) continue;
      const st = depState(d); el.dataset.state = st; el.setAttribute('aria-pressed', String(openDep === d.k));
      const badge = el.querySelector('[data-db]');
      if (d.agent) {
        el.querySelector('[data-dl]').innerHTML = `<i class="dot"></i>${esc(d.n)} · ${st === 'busy' ? 'working …' : st === 'ok' ? 'done' : st === 'todo' ? 'needs you' : st === 'error' ? 'problem' : 'waiting'}`;
      }
      if (d.agent || d.founder) { badge.hidden = st !== 'todo' && st !== 'error'; badge.textContent = '!'; }
      el.onclick = () => { if (ring.dragged) return; openDep = openDep === d.k ? null : d.k; paintAll(); if (openDep && d.agent) autoThink(d.agent); if (openDep && innerWidth < 900) $('#hqSheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    }
    paintSheet(); paintFeed(); paintDec();
    const todo = AGENTS.filter((a) => shift[a.id] && shift[a.id].status !== 'ok').length;
    const last = Object.values(shift).map((x) => x.at).sort().pop();
    $('#hqShift').textContent = busy.size ? `${busy.size} of ${AGENTS.length} working …` : `${AGENTS.length} agents · ${last ? agoS(last) : '–'} · ${todo ? `${todo} need you` : 'all done'}`;
    const pill = $('#hqAll'); pill.classList.toggle('busy', busy.size > 0); pill.querySelector('small').textContent = busy.size ? `Intelligence · ${busy.size} working …` : 'Intelligence · everyone to work';
    $('#hqOrbit').dataset.busy = busy.size ? '1' : '';
  };
  const paintCrew = paintAll;
  const refreshAi = async () => { const r = await api('/api/admin/hq'); if (r.ok && v.isConnected) { ai = r.data.ai || ai; proposals = r.data.proposals || proposals; umsetzungSofort = Boolean(r.data.umsetzung); uBlock = r.data.blocked || null; paintAi(); } };
  // Each group of three agents is its own request: results appear step by step, no request runs longer than needed,
  // and a tap during a running round is never swallowed (feedback or next round).
  const work = async (ids = AGENTS.map((a) => a.id), force = false) => {
    const open = ids.filter((x) => !busy.has(x));
    if (!open.length) { if (force) { queued = true; msg(`${busy.size} agents are working – the next round starts right after.`); paintCrew(); } return; }
    open.forEach((x) => busy.add(x)); paintCrew();
    const groups = []; for (let i = 0; i < open.length; i += 3) groups.push(open.slice(i, i + 3));
    let failed = 0;
    await Promise.all(groups.map(async (g) => {
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ agents: g, force }) });
      g.forEach((x) => busy.delete(x));
      if (!v.isConnected) return;
      if (r.ok) { for (const id of g) if (r.data.agents?.[id]) shift[id] = r.data.agents[id]; } else failed += g.length;
      paintCrew();
    }));
    if (!v.isConnected) return;
    if (failed) msg(`${failed} agents couldn't work this round – I'll try again next round.`, true);
    else if (force) { const todo = AGENTS.filter((a) => shift[a.id] && shift[a.id].status !== 'ok').length; msg(todo ? `Round finished – ${todo} ${todo === 1 ? 'item needs' : 'items need'} you.` : 'Round finished – all done.'); }
    if (force) loadOverview();
    if (queued && !busy.size) { queued = false; work(AGENTS.map((a) => a.id), true); return; }
    // New important findings: Claude analyzes and fixes right away (at most two per round, not again within 6 hours).
    if (ai?.configured && ai.settings?.auto && !ai.blocked && Object.values(shift).some((r) => r.aiQueue?.length)) {
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'analyse' }) });
      if (r.ok && v.isConnected) { shift = r.data.agents || shift; refreshAi(); paintCrew(); if (r.data.done?.length) msg(`Claude helped ${r.data.done.map((id) => AGENTS.find((x) => x.id === id)?.name || id).join(' and ')} – the solution is in the card.`); }
    }
  };
  // "Do it now": agent works, Claude fixes and creates solutions, then it is re-checked (up to ~1 minute).
  // fromDec: triggered by the owner via "Do it" → item counts as handled and stays hidden for 24 h,
  // unless the situation really changes (different content or worse status). Automatic runs hide nothing.
  const doNow = async (id, fromDec = false) => {
    if (busy.has(id)) return;
    const before = shift[id] ? aKey(id, shift[id]) : null;
    // Remember on the server right away – not only after the run (up to ~1 min). Otherwise anyone leaving HQ meanwhile
    // (e.g. to the Inbox) would find the item again when coming back.
    if (fromDec && before) hide(before);
    busy.add(id); paintCrew();
    const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'erledigen', agents: [id] }) });
    busy.delete(id);
    // Also remember the run's result, even if the page changed in the meantime.
    if (r.ok && fromDec) { const now = r.data.agents?.[id]; if (now && now.status !== 'ok') hide(aKey(id, now)); }
    if (!v.isConnected) return;
    if (r.ok) {
      shift = r.data.agents || shift; proposals = r.data.proposals || proposals;
      msg(r.data.text || 'Done.');
    } else msg(r.data?.error || 'Not done.', true);
    paintCrew(); paintDec(); loadOverview();
  };
  // Card opened, item open, no fresh analysis yet: work out solutions once automatically.
  const autoDone = new Set();
  const autoThink = (id) => {
    const r = shift[id];
    if (!ai?.configured || ai.blocked || !r || r.status === 'ok' || busy.has(id) || autoDone.has(id) || id === 'freigaben') return;
    if (r.ai && Date.now() - new Date(r.ai.at) < 6 * 3600_000 && !/keine antwort/i.test(r.ai.text || '')) return;
    autoDone.add(id); doNow(id);
  };
  const act = async (agentId, x, btn) => {
    if (x.tab) { goTab(x.tab, x.sg); return; }
    if (x.id === 'opt') { openDep = 'optimierung'; autoAsk = 'Show proposals'; paintAll(); return; }
    if (x.id === 'ask' && x.q) { openDep = agentId; autoAsk = x.q; paintAll(); return; }
    if (x.id === 'remind') {
      if (!confirm(x.confirm || 'Send now?')) return;
      btn.disabled = true; btn.textContent = 'Sending …';
      let ok = 0, bad = 0;
      for (const id of x.ids || []) { const y = await api('/api/admin/invoices', { method: 'POST', headers: { 'x-admin-scope': 'b2b' }, body: JSON.stringify({ action: 'remind', invoiceId: id }) }); if (y.ok) ok++; else bad++; }
      msg(`${ok} reminder${ok === 1 ? '' : 's'} sent${bad ? ` · ${bad} not possible` : ''}.`, bad > 0);
      work([agentId], true);
    }
  };
  // ---------- Now important: one queue for everything, grouped by priority ----------
  // NOW (critical or needed today) · APPROVALS (waiting for your okay) · TODAY (can wait) · ACTIVE (running).
  // At most two buttons per item ("Do it" / "Dismiss"); details (and "Open agent") collapsed. Done/dismissed stays hidden 24 h –
  // applies to Web-Admin AND admin app (server) – unless the situation really changes (different item or worse status).
  const LV = { hoch: 0, mittel: 1, niedrig: 2 };
  // An agent's most important open item. Its ID stays the same across rounds, even if numbers in the text change.
  function topIssue(r) { return [...(r.issues || [])].sort((x, y) => (LV[x.level] ?? 3) - (LV[y.level] ?? 3))[0] || null; }
  // Same key in the admin app (admin-app/app/(tabs)/hq.js).
  function aKey(id, r) { const t = topIssue(r); return `a|${id}|${r.status}|${t?.id || String(r.line || '').replace(/\d+(?:[.,]\d+)*/g, '#')}`; }
  // Show the same situation from different sources only once (case, numbers and punctuation don't count).
  const topic = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\d+(?:[.,]\d+)*/g, '#').replace(/[^a-z#]+/g, ' ').trim();
  let dismissed = {};
  const hidden = () => { const now = Date.now(), m = {}; for (const k in dismissed) if (dismissed[k] > now) m[k] = 1; return m; };
  // Save sequentially: concurrent requests (e.g. "Fix all") would overwrite each other on the server.
  let hideQ = Promise.resolve();
  const hide = (k) => {
    dismissed[k] = Date.now() + 86400_000;
    hideQ = hideQ.then(() => api('/api/admin/os/dismiss', { method: 'POST', body: JSON.stringify({ key: k }) })).then((r) => { if (r?.ok) dismissed = { ...(r.data.dismissed || {}), ...dismissed }; }, () => {});
  };
  // Only paint once we know what was already done/dismissed – otherwise done items flash up briefly.
  let disReady = false;
  api('/api/admin/os/dismiss').then((r) => { if (r.ok) dismissed = { ...(r.data.dismissed || {}), ...dismissed }; }, () => {}).finally(() => { disReady = true; if (v.isConnected) paintDec(); });
  const FSEV = { critical: 'bad', warning: 'warn', info: 'info' }, SL = { bad: 'Critical', warn: 'Important', dec: 'Approval', info: 'Note' };
  const fixF = async (body) => {
    const r = await api('/api/admin/fix', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) { msg(r.data?.error || 'Not possible.', true); return loadFix(); }
    findings = (r.data.findings || []); const bad = (r.data.results || []).filter((x) => !x.ok);
    msg(body.dismiss ? 'Dismissed.' : bad.length ? bad.map((x) => x.text).join(' · ') : 'Done.', bad.length > 0);
    paintDec(); work(['sicherheit', 'postfach', 'technik'], true); loadOverview();
  };
  const decide = async (id, decision) => {
    const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'proposal', proposalId: id, decision }) });
    if (!r.ok) { msg(r.data?.error || 'Not possible.', true); paintDec(); return; }
    proposals = r.data.proposals || []; msg(decision === 'verworfen' ? 'Dismissed.' : r.data.warn ? `New attempt started – but: ${r.data.warn}` : r.data.started ? 'Being implemented.' : 'Approved.', Boolean(r.data.warn)); paintAll();
  };
  const decItems = () => {
    const H = hidden(), out = [];
    for (const f of findings) {
      const sev = FSEV[f.sev] || 'info';
      out.push({ k: `f|${f.id}`, grp: sev === 'info' ? 'today' : 'now', sev, area: f.area, title: f.title, detail: f.auto ? '' : f.how,
        yes: f.auto ? ['Do it', () => fixF({ ids: [f.id] })] : ['Done', () => fixF({ dismiss: f.id })],
        no: f.auto ? ['Dismiss', () => fixF({ dismiss: f.id })] : null });
    }
    // Agent solutions change something (website, copy, settings) → approval with confirmation (second tap).
    for (const p of proposals.filter((x) => x.status === 'offen')) {
      const a = AGENTS.find((x) => x.id === p.agent), kind = KIND[p.kind] || 'Solution';
      out.push({ k: `p|${p.id}`, grp: 'approve', sev: 'dec', area: a ? a.name : p.agent, color: a?.color, kind, title: p.title,
        detail: [p.detail, p.why].filter(Boolean).join('\n\n'), doc: p.doc ? p.id : null,
        confirm: p.kind === 'dokument' ? null : `${kind} will be implemented`,
        yes: ['Do it', () => decide(p.id, 'erledigen')], no: ['Dismiss', () => decide(p.id, 'verworfen')] });
    }
    for (const a of AGENTS) {
      // Ethan (daily briefing) only summarizes the others – his items are already listed with the respective agents.
      const r = shift[a.id]; if (!r || r.status === 'ok' || a.id === 'briefing') continue;
      const k = aKey(a.id, r); if (H[k]) continue;
      const t = topIssue(r), more = (r.issues || []).filter((i) => i !== t && i.level !== 'niedrig').length;
      const detail = [r.line, r.ai?.text].filter(Boolean).join('\n\n');
      if (a.id === 'freigaben') {
        // Ava: everything that would go out – opens the area for review, never sends herself.
        const go = (r.actions || []).find((x) => x.tab);
        out.push({ k, grp: 'approve', sev: 'dec', area: a.name, color: a.color, title: t?.title || r.line, detail, open: d0(a.id),
          yes: go ? ['Do it', () => goTab(go.tab, go.sg)] : null, no: ['Dismiss', () => { hide(k); paintDec(); }] });
        continue;
      }
      const extra = (r.actions || []).find((x) => x.id === 'remind');
      const urgent = r.status === 'error' || t?.level === 'hoch';
      out.push({ k, grp: urgent ? 'now' : 'today', sev: r.status === 'error' ? 'bad' : urgent ? 'warn' : 'info', area: a.name, color: a.color,
        title: `${t?.title || r.line}${more ? ` · +${more} more` : ''}`, detail, busy: busy.has(a.id), open: d0(a.id),
        yes: extra ? [extra.label, (btn) => act(a.id, extra, btn)] : ['Do it', () => doNow(a.id, true)], no: ['Dismiss', () => { hide(k); paintDec(); }] });
    }
    for (const al of alerts) {
      const k = `l|${al.id}|${al.at || ''}`; if (H[k]) continue;
      const g = TARGET[al.target] || null, [cls] = SEV_L[al.severity] || SEV_L.info;
      const yes = al.action?.kind === 'ack_security' && al.action.kindKey
        ? ['Do it', async () => { const x = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack', kind: al.action.kindKey }) }); if (!x.ok) { msg(x.data?.error || 'Not possible.', true); paintDec(); return; } msg('Done.'); loadOverview(); work(['sicherheit'], true); }]
        : g ? ['Do it', () => goTab(g[0], g[1] || 'system')] : null;
      out.push({ k, grp: cls === 'info' ? 'today' : 'now', sev: cls, area: 'Status', title: al.title, detail: al.detail, yes, no: ['Dismiss', () => { hide(k); paintDec(); }] });
    }
    // Most important first; the same situation from several sources becomes one item (sources are named together).
    const G = { now: 0, approve: 1, today: 2 }, R = { bad: 0, warn: 1, dec: 2, info: 3 };
    out.sort((x, y) => G[x.grp] - G[y.grp] || R[x.sev] - R[y.sev]);
    const seen = new Map(), res = [];
    for (const x of out) {
      const t = topic(x.title), first = seen.get(t);
      if (first) { if (x.area && !String(first.area || '').includes(x.area)) first.area = first.area ? `${first.area} & ${x.area}` : x.area; continue; }
      seen.set(t, x); res.push(x);
    }
    return res;
  };
  // Running now: working agents and approved solutions being implemented (display only, no buttons).
  const activeItems = () => [
    ...[...busy].map((id) => AGENTS.find((x) => x.id === id)).filter(Boolean).map((a) => ({ t: `${a.name} is working …`, s: a.role })),
    ...proposals.filter((p) => p.status === 'auftrag' || p.status === 'in_arbeit').map((p) => ({ wait: p.status === 'auftrag', t: p.title, s: p.status === 'in_arbeit' ? 'Being implemented' : uBlock ? (uBlock.reason === 'guthaben' ? 'Approved · waiting for Anthropic credit' : 'Approved · waiting') : 'Approved · waiting for implementation' })),
  ];
  const d0 = (agentId) => ORBIT.find((o) => o.agent === agentId)?.k;
  let decFns = [];
  function paintDec() {
    const box = $('#hqDec'); if (!box || !decReady || !disReady) return;
    const it = decItems(); decFns = it;
    const nNow = it.filter((x) => x.grp === 'now').length, nAp = it.filter((x) => x.grp === 'approve').length, nDay = it.filter((x) => x.grp === 'today').length;
    $('#hqDecN').textContent = nNow + nAp ? String(nNow + nAp) : '';
    const autoN = findings.filter((f) => f.auto).length;
    $('#hqDecAll').hidden = !autoN && !it.some((x) => x.grp === 'now' && x.k.startsWith('a|'));
    const card = (x, i) => `<li class="ck-it s-${x.sev}"><div class="ck-top"><span class="hq-st ${x.sev}">${SL[x.sev]}</span>${x.color ? `<span class="hq-ini sm" style="background:${esc(x.color)}" aria-hidden="true">${esc((x.area || '')[0] || '')}</span>` : ''}<span class="ck-area">${esc(x.area || '')}${x.kind ? ` · ${esc(x.kind)}` : ''}</span></div>
      <strong>${esc(x.title)}</strong>${x.detail || x.open || x.doc ? `<details class="hq-more"><summary>Details</summary>${x.detail ? `<p>${rich(x.detail)}</p>` : ''}${x.open || x.doc ? `<div class="hq-more-a">${x.doc ? `<button type="button" class="hq-btn" data-doc="${esc(x.doc)}" data-f="pdf">View PDF</button>` : ''}${x.open ? `<button type="button" class="hq-btn" data-o="${esc(x.open)}">Open ${esc(String(x.area || 'agent').split(' & ')[0])}</button>` : ''}</div>` : ''}</details>` : ''}
      <div class="ck-act">${x.yes ? `<button type="button" class="hq-btn hq-btn-p" data-y="${i}" ${x.busy ? 'disabled' : ''}>${x.busy ? 'Working …' : esc(x.yes[0])}</button>` : ''}${x.no ? `<button type="button" class="hq-btn" data-n="${i}">${esc(x.no[0])}</button>` : ''}</div></li>`;
    const list = (g) => `<ul class="ck-list">${it.map((x, i) => [x, i]).filter(([x]) => x.grp === g).map(([x, i]) => card(x, i)).join('')}</ul>`;
    const run = activeItems();
    // Implementation paused (e.g. credit empty): say clearly why approved tasks wait – they run on their own afterward.
    const nWait = proposals.filter((p) => p.status === 'auftrag' || p.status === 'in_arbeit').length;
    const blockHtml = uBlock && nWait ? `<div class="hq-block" role="alert"><strong>Implementation paused</strong><p>${uBlock.reason === 'guthaben' ? `The Anthropic credit balance is empty. ${nWait} approved ${nWait === 1 ? 'task is' : 'tasks are'} waiting and will continue automatically once credit is available (new attempt every 30 minutes).` : esc(uBlock.text || 'Implementation is not possible right now.')}</p>${uBlock.reason === 'guthaben' ? '<a class="hq-btn hq-btn-p" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Add credit</a>' : ''}</div>` : '';
    box.innerHTML = blockHtml + (nNow ? `<h4 class="hq-g hq-g-now">Now <span>${nNow}</span></h4>${list('now')}` : `<p class="hq-empty hq-ok">✓ No action needed.</p>`)
      + (nAp ? `<h4 class="hq-g hq-g-dec">Approvals <span>${nAp}</span></h4>${list('approve')}` : '')
      + (nDay ? `<details class="hq-g-fold"${nNow || nAp ? '' : ' open'}><summary><h4 class="hq-g">Today <span>${nDay}</span></h4><small>can wait</small></summary>${list('today')}</details>` : '')
      + (run.length ? (() => {
        // Waiting tasks as one expandable line instead of a long list (the reason is in the note above).
        const li = (a) => `<li><i class="dot" aria-hidden="true"></i><b>${esc(a.t)}</b><small>${esc(a.s)}</small></li>`;
        const work = run.filter((a) => !a.wait), wait = run.filter((a) => a.wait);
        return `<h4 class="hq-g hq-g-run">Active <span>${run.length}</span></h4>${work.length ? `<ul class="hq-actv">${work.map(li).join('')}</ul>` : ''}${wait.length ? `<details class="hq-g-fold hq-wait"><summary><b>${wait.length} approved ${wait.length === 1 ? 'task waiting' : 'tasks waiting'}</b><small>${esc(wait[0].s)}</small></summary><ul class="hq-actv">${wait.map(li).join('')}</ul></details>` : ''}`;
      })() : '');
    // Confirmation without a pop-up: the first tap shows what will happen; only the second tap (within 5 s) runs it.
    box.querySelectorAll('[data-y]').forEach((b) => b.onclick = () => {
      const x = decFns[+b.dataset.y]; if (!x) return;
      if (x.confirm && !b.dataset.armed) {
        b.dataset.armed = '1'; b.classList.add('hq-arm'); b.textContent = 'Confirm'; b.setAttribute('aria-label', `${x.confirm}: ${x.title}. Tap again to run.`);
        msg(`${x.confirm}: "${x.title}" – tap again to confirm.`);
        setTimeout(() => { if (b.isConnected && b.dataset.armed) { delete b.dataset.armed; b.classList.remove('hq-arm'); b.textContent = x.yes[0]; b.removeAttribute('aria-label'); } }, 5000);
        return;
      }
      b.disabled = true; b.textContent = '…'; x.yes[1](b);
    });
    box.querySelectorAll('[data-n]').forEach((b) => b.onclick = () => { b.disabled = true; decFns[+b.dataset.n].no[1](b); });
    box.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => { openDep = b.dataset.o; paintAll(); $('#hqSheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
    bindProps(box);
    paintStatus(); paintSince();
  }
  // ---------- Status at the top: real data only; anything that couldn't be checked never counts as "stable" ----------
  let ov = null, ovFail = false, ovAt = 0, pullFail = 0;
  function paintStatus() {
    const hero = $('.hq-hero'); if (!hero) return;
    const it = decReady ? decFns : [], now = it.filter((x) => x.grp === 'now'), ap = it.filter((x) => x.grp === 'approve').length;
    const sy = ov?.systems || [], sysOk = sy.filter((s) => s.state === 'ok').length, sysBad = sy.some((s) => s.state === 'fail');
    let lvl, title, det;
    if (!ov) { lvl = ovFail ? 'unknown' : 'load'; title = ovFail ? 'Status not available right now' : 'Checking status …'; det = ovFail ? 'The system check did not respond – "Refresh" tries again.' : ''; }
    else if (ov.status?.level === 'critical' || sysBad || now.some((x) => x.sev === 'bad')) { lvl = 'critical'; title = 'Critical issue'; det = now.find((x) => x.sev === 'bad')?.title || ov.status?.detail || 'Immediate attention needed.'; }
    else if (now.length || ov.status?.level === 'warn') { lvl = 'warn'; title = 'Attention needed'; det = now.length ? `${now.length} ${now.length === 1 ? 'item needs' : 'items need'} your review.` : ov.status?.detail || ''; }
    else { lvl = 'ok'; title = 'All stable'; det = ap ? `Nothing urgent · ${ap} ${ap === 1 ? 'approval is' : 'approvals are'} waiting for you.` : 'No decision needed.'; }
    hero.dataset.level = lvl; $('#hqStat').textContent = title; $('#hqDet').textContent = det;
    const bits = [];
    if (sy.length) bits.push(sysOk === sy.length ? `${sy.length} systems without findings` : `${sysOk} of ${sy.length} systems without findings`);
    if (decReady) { bits.push(now.length ? `${now.length} ${now.length === 1 ? 'needs' : 'need'} you` : 'nothing urgent'); if (ap) bits.push(`${ap} ${ap === 1 ? 'approval' : 'approvals'}`); }
    $('#hqBar').textContent = bits.join(' · ');
    paintAsof();
  }
  // "Live" only while the data is fresh; otherwise say honestly when it was last updated.
  function paintAsof() {
    const el = $('#hqAsof'); if (!el) return;
    if (!ovAt) { el.textContent = ovFail ? 'No data loaded yet' : 'Loading …'; return; }
    const s = Math.round((Date.now() - ovAt) / 1000), stale = ovFail || pullFail > 1 || s > 300;
    el.parentElement.classList.toggle('stale', stale);
    el.textContent = stale
      ? `Last updated ${new Date(ovAt).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })} · data may be out of date`
      : `Live · ${s < 10 ? 'just updated' : s < 60 ? `updated ${s} s ago` : `updated ${Math.round(s / 60)} min ago`}`;
  }
  // "Since your last visit": remembered only in this browser (time + open items), nothing on the server.
  const VISIT = 'leaserun_hq_visit';
  let sinceDone = false;
  function paintSince() {
    if (sinceDone || !ov || !decReady) return; sinceDone = true;
    let prev = null; try { prev = JSON.parse(localStorage.getItem(VISIT) || 'null'); } catch { prev = null; }
    const keys = decFns.filter((x) => x.grp !== 'today').map((x) => x.k), at = Date.now();
    if (prev?.at && Array.isArray(prev.keys)) {
      const ev = (ov.activity || []).filter((a) => Date.parse(a.at) > prev.at).length;
      const neu = keys.filter((k) => !prev.keys.includes(k)).length, weg = prev.keys.filter((k) => !keys.includes(k)).length;
      const parts = [ev && `+${ev} ${ev === 1 ? 'event' : 'events'}`, neu && `+${neu} ${neu === 1 ? 'new item' : 'new items'}`, weg && `${weg} done`].filter(Boolean);
      const el = $('#hqSince'); el.hidden = false;
      el.textContent = `Since your last visit (${ago(new Date(prev.at).toISOString())}): ${parts.length ? parts.join(' · ') : 'no change'}`;
    }
    // Count as a new visit only after 10 minutes – a quick "Refresh" doesn't reset the comparison.
    if (!prev?.at || at - prev.at > 10 * 60_000) { try { localStorage.setItem(VISIT, JSON.stringify({ at, keys })); } catch { /* private mode: continue without comparison */ } }
  }
  const loadFix = async (fresh = false) => {
    const r = await api('/api/admin/fix' + (fresh ? '?fresh=1' : ''));
    if (!v.isConnected) return;
    findings = r.ok ? (r.data.findings || []).filter((x) => x.sev !== 'info' || x.auto) : findings;
    if (!r.ok) msg(r.data?.error || 'Check not possible.', true);
    decReady = true; paintDec();
  };
  $('#hqDecRun').onclick = async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Checking …'; await loadFix(true); b.disabled = false; b.textContent = 'Check now'; };
  // "Fix all": all auto-fixable findings + one round of all agents. Solutions (code) stay your individual decision.
  $('#hqDecAll').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Working on it …';
    if (findings.some((f) => f.auto)) await fixF({ all: true });
    for (const a of AGENTS) { const r = shift[a.id]; if (r && r.status !== 'ok' && a.id !== 'freigaben' && !(r.actions || []).some((x) => x.id === 'remind')) await doNow(a.id, true); }
    b.disabled = false; b.textContent = 'Fix all';
  };
  loadFix();

  $('#hqAll').onclick = () => work(AGENTS.map((a) => a.id), true);
  // ---------- Company OS: one bar for everything – apps, agents (with chat & documents), data; Enter without a selection = task ----------
  const APPS = [['postfach', 'Inbox'], ['termine', 'Appointments'], ['cockpit', 'Finance', 'b2b'], ['rechnungen', 'Invoices', 'b2b'], ['nutzer', 'Customers'], ['partner', 'Businesses', 'b2b'], ['anfragen', 'Requests', 'b2b'], ['creator', 'Creators', 'b2b'], ['kennzahlen', 'Metrics'], ['analyse', 'Analytics'], ['sicherheit', 'Security'], ['system', 'System & files'], ['einrichtung', 'Setup'], ['steuer', 'CPA export', 'b2b'], ['protokoll', 'Audit log'], ['vorschlaege', 'Suggestions'], ['probleme', 'Technical issues'], ['api', 'API']];
  const osBox = $('#hqOS'), osIn = $('#hqQ').q;
  let osItems = [], osSel = -1, osT = null, osSeq = 0;
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const osPaint = () => {
    osBox.hidden = !osItems.length; osIn.setAttribute('aria-expanded', String(!osBox.hidden));
    osBox.innerHTML = osItems.map((x, i) => `<button type="button" role="option" aria-selected="${i === osSel}" data-os="${i}"><i class="hq-os-k">${esc(x.kind)}</i><b>${esc(x.title)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</button>`).join('');
    osBox.querySelectorAll('[data-os]').forEach((b) => b.onmousedown = (e) => { e.preventDefault(); osGo(osItems[+b.dataset.os]); });
  };
  const osClose = () => { osItems = []; osSel = -1; osPaint(); };
  const osGo = (x) => {
    osClose(); osIn.value = '';
    if (x.agent) { openDep = ORBIT.find((o) => o.agent === x.agent)?.k || null; paintAll(); $('#hqSheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
    if (x.dec) { $('#hqDec').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (x.tab) goTab(x.tab, x.sg);
  };
  osIn.addEventListener('input', () => {
    const q = norm(osIn.value.trim()); clearTimeout(osT); const my = ++osSeq;
    if (q.length < 2) { osClose(); return; }
    const local = [
      ...AGENTS.filter((a) => norm(`${a.name} ${a.last} ${a.role}`).includes(q)).slice(0, 4).map((a) => ({ kind: 'Agent', title: `${a.name} · ${a.role}`, sub: 'Chat, solutions, documents', agent: a.id })),
      ...APPS.filter((a) => norm(a[1]).includes(q)).slice(0, 4).map((a) => ({ kind: 'App', title: a[1], tab: a[0], sg: a[2] })),
      ...(/^(deci|open|appr|entsch|offen|freig)/.test(q) ? [{ kind: 'Start', title: 'Decisions', dec: true }] : []),
    ];
    osItems = local; osSel = -1; osPaint();
    osT = setTimeout(async () => {
      const r = await api(`/api/admin/os/search?q=${encodeURIComponent(osIn.value.trim())}`);
      if (my !== osSeq || !r.ok) return;
      osItems = [...local, ...(r.data.hits || [])].slice(0, 12); osPaint();
    }, 220);
  });
  osIn.addEventListener('keydown', (e) => {
    if (!osItems.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); osSel = (osSel + (e.key === 'ArrowDown' ? 1 : -1) + osItems.length) % osItems.length; osPaint(); }
    else if (e.key === 'Escape') osClose();
    else if (e.key === 'Enter' && osSel >= 0) { e.preventDefault(); osGo(osItems[osSel]); }
  });
  osIn.addEventListener('blur', () => setTimeout(osClose, 150));
  // Keyboard shortcut like an OS: Ctrl/⌘ + K jumps to the bar.
  if (!window.__hqKey) { window.__hqKey = true; document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { const i = document.querySelector('#hqQ input'); if (i) { e.preventDefault(); i.focus(); i.select(); } } }); }
  // Central question to LeaseRun Intelligence: routed automatically to the right agent.
  $('#hqQ').onsubmit = async (e) => {
    e.preventDefault(); const q = e.target.q.value.trim(); if (!q) return; osClose(); clearTimeout(osT); osSeq++;
    const box = $('#hqQA'), b = e.target.querySelector('button'); box.hidden = false; box.innerHTML = '<p class="hq-msg">One moment …</p>'; b.disabled = true;
    const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ agent: 'zentrale', command: q }) });
    b.disabled = false; if (r.ok && r.data.ai) refreshAi();
    const acts = r.ok ? (r.data.actions || []).filter((x) => x.tab) : [];
    box.innerHTML = `<p class="hq-msg">${rich(r.ok ? r.data.reply : r.data?.error || "That didn't work.")}</p>${acts.length ? `<div class="hq-sh-a">${acts.map((x, i) => `<button type="button" class="hq-btn" data-qa="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}`;
    box.querySelectorAll('[data-qa]').forEach((el) => el.onclick = () => goTab(acts[+el.dataset.qa].tab, acts[+el.dataset.qa].sg));
  };
  // Instant: the watch (server, around the clock) keeps the state current – opening only reads, it doesn't work.
  // Only if the watch hasn't run for more than 15 minutes (e.g. not set up yet) does the browser work once itself.
  const STALE_MS = 15 * 60_000;
  const lastAt = () => Math.max(0, ...Object.values(shift).map((x) => new Date(x.at).getTime() || 0));
  const pull = () => api('/api/admin/hq').then((r) => {
    if (!v.isConnected) return;
    if (!r.ok) { pullFail++; paintAsof(); return; }
    pullFail = 0;
    if (!busy.size) shift = r.data.agents || {};
    cmds = r.data.commands || {}; ai = r.data.ai || null; proposals = r.data.proposals || []; umsetzungSofort = Boolean(r.data.umsetzung); uBlock = r.data.blocked || null;
    if (Array.isArray(r.data.staff) && r.data.staff.length) AGENTS = r.data.staff.map((x) => ({ ...(AGENTS.find((y) => y.id === x.id) || {}), ...x }));
    paintAi(); paintCrew();
  });
  pull().then(() => { if (v.isConnected && Date.now() - lastAt() > STALE_MS) work(); });
  if (v.__hqTimer) clearInterval(v.__hqTimer);
  const feedT = setInterval(() => { if (!v.isConnected || my !== seq) { clearInterval(feedT); return; } feedIx++; paintFeed(); paintAsof(); }, 6000);
  // Read the state every minute (costs nothing); work itself only if the watch fails.
  // Status (systems, alerts, activity) every 2 minutes, only while visible; after an error skip one round.
  let tick = 0, ovSkip = false;
  const timer = v.__hqTimer = setInterval(() => {
    if (!v.isConnected || my !== seq) { clearInterval(timer); return; } if (document.hidden) return;
    pull().then(() => { if (!busy.size && Date.now() - lastAt() > STALE_MS) work(); });
    if (++tick % 2 === 0) { if (ovSkip) ovSkip = false; else loadOverview().then(() => { ovSkip = ovFail; }); }
  }, 60_000);
  // Back on the page after a longer pause: reload right away instead of showing old values as "Live".
  const onVis = () => { if (!v.isConnected || my !== seq) { document.removeEventListener('visibilitychange', onVis); return; } if (!document.hidden && Date.now() - ovAt > 120_000) { pull(); loadOverview(); } };
  document.addEventListener('visibilitychange', onVis);

  $('#hqRef').onclick = () => hq(v, { goTab, msg });

  // Revenue today: queried and labeled separately per area (no mixed total).
  const rev = (scope) => api('/api/admin/finance?zeitraum=heute&von=&bis=', { headers: { 'x-admin-scope': scope } });
  Promise.all([rev('b2c'), rev('b2b')]).then(([c, b]) => {
    if (my !== seq) return;
    const chip = (l, r, f, sg) => `<button type="button" class="hq-chip" data-go="cockpit" data-sg="${sg}"><small>${l}</small><strong>${r.ok ? eur(f(r.data)) : '–'}</strong>${r.ok ? `<span>${f === gross ? `${r.data.revenue?.count ?? 0} payments` : `${r.data.revenue?.count ?? 0} invoices`}</span>` : `<span>${esc(r.data?.error || 'not available')}</span>`}</button>`;
    const gross = (d) => d.revenue?.gross ?? null, net = (d) => d.revenue?.net ?? null;
    $('#hqRev').innerHTML = chip('Revenue today · consumers (gross)', c, gross, 'b2c') + chip('Revenue today · businesses (net)', b, net, 'b2b');
    $('#hqRev').querySelectorAll('[data-go]').forEach((x) => x.onclick = () => goTab(x.dataset.go, x.dataset.sg));
  });

  // Status, metrics, decisions, systems and activity – reloaded right after every "Do it".
  const loadOverview = async () => {
  const r = await api('/api/admin/app/overview');
  if (my !== seq || !v.isConnected) return;
  if (!r.ok) {
    // Old data stays, marked as "may be out of date"; without data: "not available" – never "stable".
    ovFail = true; paintStatus();
    if (!ov) {
      const err = `<p class="hq-empty">System status couldn't be loaded right now. <button type="button" class="hq-btn" data-retry>Try again</button></p>`;
      ['#hqSys', '#hqAct'].forEach((s) => { $(s).innerHTML = err; });
      $('#hqKpi').innerHTML = ''; $('#hqSysSum').textContent = 'not available';
      v.querySelectorAll('[data-retry]').forEach((b) => b.onclick = () => { b.disabled = true; loadOverview(); });
    }
    return;
  }
  const d = r.data;
  ov = d; ovFail = false; ovAt = Date.parse(d.generatedAt) || Date.now();
  paintStatus(); paintSince();
  const goT = (t) => TARGET[t] || null;


  $('#hqKpi').innerHTML = (d.metrics || []).map((m) => {
    const g = goT(m.target);
    const inner = `<small>${esc(m.label)}</small><strong>${Number(m.value).toLocaleString('en-US')}</strong>`;
    return g ? `<button type="button" class="hq-kpi t-${esc(m.tone)}" data-go="${g[0]}" data-sg="${g[1] || 'system'}">${inner}<i>${ic(I_GO, 14)}</i></button>` : `<div class="hq-kpi t-${esc(m.tone)}">${inner}</div>`;
  }).join('') || '<p class="hq-empty">No metrics for your role.</p>';

  alerts = (d.alerts || []).filter((x) => x.attention && !IN_CHECK.has(x.id)); paintDec();

  { const sy = d.systems || [], bad = sy.filter((x) => x.state !== 'ok').length; $('#hqSysSum').textContent = sy.length ? (bad ? `${bad} of ${sy.length} with a note` : `all ${sy.length} OK`) : 'no data'; if (bad) $('#hqSys').closest('details').open = true; }
  $('#hqSys').innerHTML = (d.systems || []).length ? `<ul class="hq-sys">${d.systems.map((s) => { const [cls, lab] = SYS_L[s.state] || SYS_L.off; return `<li><span class="hq-st ${cls}">${lab}</span><strong>${esc(s.label)}</strong><span>${esc(s.info)}${s.ms != null ? ` · ${s.ms} ms` : ''}</span></li>`; }).join('')}</ul>${d.deploy ? `<p class="hq-sub">Environment ${esc(d.deploy.env)}${d.deploy.commit ? ` · Version ${esc(String(d.deploy.commit).slice(0, 7))}` : ''}${d.deploy.region ? ` · ${esc(d.deploy.region)}` : ''}</p>` : ''}` : '<p class="hq-empty">No system data for your role.</p>';

  $('#hqAct').innerHTML = (d.activity || []).length ? `<ul class="hq-act">${d.activity.slice(0, 12).map((a) => { const g = goT(a.target); return `<li>${g ? `<button type="button" data-go="${g[0]}" data-sg="${g[1] || 'system'}">` : '<div>'}<strong>${esc(a.title)}</strong>${a.detail ? `<span>${esc(a.detail)}</span>` : ''}<time datetime="${esc(a.at)}" title="${esc(dtt(a.at))}">${esc(ago(a.at))}</time>${g ? '</button>' : '</div>'}</li>`; }).join('')}</ul>` : '<p class="hq-empty">No activity yet.</p>';

  { const n = (d.activity || []).length, last = d.activity?.[0]?.at; $('#hqActSum').textContent = n ? `${n} events · latest ${ago(last)}` : 'nothing yet'; }
  // Every tile opens the matching area right away; "Errors / warnings" jumps to "Now important" in this view.
  v.querySelectorAll('#hqKpi [data-go], #hqAct [data-go]').forEach((b) => b.onclick = () => (b.dataset.go === 'jetzt' ? $('#hqDec').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' }) : goTab(b.dataset.go, b.dataset.sg)));
  };
  await loadOverview();
}
