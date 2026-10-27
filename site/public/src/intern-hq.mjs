// LeaseRun HEADQUARTERS · Command Center (Web-Admin, Bereich „System“).
// Baut auf der bestehenden Admin-Zentrale auf (keine Parallelstruktur): Status, Kennzahlen, Hinweise, Systeme und
// Aktivität kommen aus /api/admin/app/overview (dieselbe Quelle wie die Admin-App), Umsatz heute aus dem Finanz-Cockpit.
// Nur echte Daten: Fehlt eine Quelle, steht „–“ mit Hinweis – nichts wird geschätzt oder erfunden.
import { api, download, dtt, esc, eur } from './sess.mjs?v=892f3666';

// Diese Hinweise zeigt „Prüfen & erledigen“ bereits mit Knopf – im Entscheidungs-Block nicht doppelt.
const IN_CHECK = new Set(['sys-panic', 'sys-mfa', 'sys-mail', 'sys-mailerr', 'sec-noise', 'web-errors']);

// Ziele der Overview-Schnittstelle → Reiter (und Datenbereich) der Admin-Zentrale.
const TARGET = {
  jetzt: ['jetzt'],
  zahlungen: ['rechnungen', 'b2b'], postfach: ['postfach'], termine: ['termine'], anfragen: ['anfragen', 'b2b'],
  unternehmen: ['partner', 'b2b'], sicherheit: ['sicherheit'], system: ['system'], statistik: ['kennzahlen', 'b2c'], audit: ['protokoll'],
};
// Priorität nach Gefahr zuerst (Command-Center-Regel), danach Aktualität.
const SEV = { critical: 0, warning: 1, info: 2 };
const SEV_L = { critical: ['bad', 'Kritisch'], warning: ['warn', 'Warnung'], info: ['info', 'Info'] };
const SYS_L = { ok: ['ok', 'OK'], warn: ['warn', 'Hinweis'], fail: ['bad', 'Störung'], off: ['off', 'Aus'] };

const ic = (d, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I_REF = '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 4v5h-5"/>';
const I_GO = '<path d="M9 6l6 6-6 6"/>';
const today = () => {
  const d = new Date();
  return `${d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })} · ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
};
const ago = (s) => {
  if (!s) return '';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'gerade eben'; if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60); if (h < 24) return `vor ${h} Std.`;
  return dtt(s);
};

// Digitale Mitarbeiter (lib/admin/hq-agents.ts ist die Quelle; diese Liste ist die Startansicht, bis der Server antwortet).
// Jeder nimmt Aufträge im Eingabefeld an. Intern wird sofort erledigt, alles nach außen nur nach Ferays Freigabe.
let AGENTS = [
  { id: 'postfach', name: 'Emily', last: 'Carter', role: 'E-Mail & Postfach', color: '#DB2777', vibe: 'Ruhig und gründlich. Hat jede Mail im Blick.', job: 'Holt E-Mails ab, ordnet sie nach Dringlichkeit und bereitet Antworten als Entwurf vor.' },
  { id: 'sicherheit', name: 'Jake', last: 'Morrison', role: 'Sicherheit', color: '#7C3AED', vibe: 'Wachsam, schläft nie. Sperrt Angreifer, bevor du es merkst.', job: 'Sperrt angreifende Quellen, räumt auf und meldet, was nur du lösen kannst.' },
  { id: 'technik', name: 'Olivia', last: 'Brooks', role: 'Technik', color: '#0D9488', vibe: 'Präzise. Prüft lieber einmal mehr.', job: 'Prüft Stripe, Zahlungs-Webhook, E-Mail-Domain, Datenbank und neue Versionen live.' },
  { id: 'finanzen', name: 'Ryan', last: 'Mitchell', role: 'Finanzen', color: '#16A34A', vibe: 'Zahlenmensch. Nichts geht raus ohne dein Okay.', job: 'Umsatz, offene und überfällige Rechnungen; bereitet Zahlungserinnerungen vor.' },
  { id: 'vertrieb', name: 'Madison', last: 'Hayes', role: 'Vertrieb & Partner', color: '#F59E0B', vibe: 'Schnell und freundlich. Keine Anfrage bleibt liegen.', job: 'Behält Unternehmensanfragen, Demo-Wünsche und Partnerkonten im Blick.' },
  { id: 'neukunden', name: 'Hannah', last: 'Walsh', role: 'Neukunden', color: '#0EA5E9', vibe: 'Denkt vom ersten Besuch bis zum Kauf.', job: 'Beobachtet den Weg vom Besucher zum Kauf, findet Abbrüche und macht Vorschläge, wie mehr Besucher Kunden werden.' },
  { id: 'bestandskunden', name: 'Liam', last: 'Foster', role: 'Bestandskunden', color: '#2563EB', vibe: 'Kümmert sich, bevor jemand geht.', job: 'Behält aktive Abos, auslaufende Zugänge, stille Konten und Erstattungen im Blick.' },
  { id: 'akquise', name: 'Zoe', last: 'Campbell', role: 'Akquise', color: '#D97706', vibe: 'Hartnäckig und höflich. Vergisst keine Wiedervorlage.', job: 'Hält Kontakte und Wiedervorlagen im Fluss, bereitet Anschreiben als Entwurf vor.' },
  { id: 'support', name: 'Tyler', last: 'Reed', role: 'Kundenreise & Support', color: '#2F7FC1', vibe: 'Sieht jeden Stolperstein eines Kunden – sofort.', job: 'Sieht sofort, wenn ein Kunde auf einen Fehler stößt oder an der Kasse abbricht, bestimmt die Ursache und erledigt Harmloses selbst.' },
  { id: 'freigaben', name: 'Ava', last: 'Bennett', role: 'Freigaben', color: '#0F2C59', vibe: 'Deine rechte Hand. Sammelt alles, was dein Okay braucht.', job: 'Zeigt alles, was nach außen gehen würde – erst nach deiner Freigabe.' },
  { id: 'creator', name: 'Chloe', last: 'Parker', role: 'Creator', color: '#E11D48', vibe: 'Kennt jede Community. Hält Bewerbungen im Fluss.', job: 'Behält Creator-Bewerbungen und Rückfragen im Blick.' },
  { id: 'recht', name: 'Daniel', last: 'Hughes', role: 'Recht & Compliance', color: '#475569', vibe: 'Lieber einmal zu vorsichtig.', job: 'Prüft Rechtstexte, Einwilligungen, Abmeldelinks und Fristen – Risiken lieber entfernen als behalten.' },
  { id: 'briefing', name: 'Ethan', last: 'Collins', role: 'Lagebild', color: '#0369A1', vibe: 'Verbindet die Punkte zwischen allen Abteilungen.', job: 'Wertet alle Agenten gemeinsam aus, erkennt gemeinsame Ursachen und nennt die drei wichtigsten Schritte für heute.' },
  { id: 'optimierung', name: 'Noah', last: 'Sullivan', role: 'Optimierung', color: '#9333EA', vibe: 'Findet Verbesserungen, bevor du sie suchst.', job: 'Prüft Website und System selbstständig, erledigt Internes sofort und schlägt den Rest vor.' },
  { id: 'marketing', name: 'Sophie', last: 'Turner', role: 'Marketing', color: '#EA580C', vibe: 'Denkt in Reichweite. Jede Idee kommt mit Zahl und Begründung.', job: 'Liest Besucher, Quellen, Kasse und Newsletter, macht Vorschläge und entwirft Texte. Veröffentlicht nichts – du gibst frei.' },
];
const SHIFT_MS = 3 * 60_000;
// Abteilungen im Orbit. In der Mitte: LeaseRun. Dazu Feray als Founder Head.
const I = {
  mail: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>', euro: '<path d="M17 7a6 6 0 1 0 0 10"/><path d="M5 10h8M5 14h8"/>',
  handshake: '<path d="M3 12l4-4 4 3 3-3 4 1 3 3-6 6-4-3-2 2z"/>', help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
  check: '<path d="M4 12l5 5L20 6"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>', mega: '<path d="M3 10v4h3l6 4V6l-6 4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>', crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
};
const ORBIT = [
  { k: 'founder', n: 'Founder Head', founder: true, icon: I.crown, c: '#0F2C59' },
  { k: 'freigaben', n: 'Freigaben', agent: 'freigaben', icon: I.check, c: '#0F2C59' },
  { k: 'postfach', n: 'Postfach', agent: 'postfach', icon: I.mail, c: '#DB2777' },
  { k: 'finanzen', n: 'Finanzen', agent: 'finanzen', icon: I.euro, c: '#16A34A' },
  { k: 'vertrieb', n: 'Vertrieb & Partner', agent: 'vertrieb', icon: I.handshake, c: '#F59E0B' },
  { k: 'neukunden', n: 'Neukunden', agent: 'neukunden', icon: I.star, c: '#0EA5E9' },
  { k: 'bestandskunden', n: 'Bestandskunden', agent: 'bestandskunden', icon: I.help, c: '#2563EB' },
  { k: 'akquise', n: 'Akquise', agent: 'akquise', icon: I.mega, c: '#D97706' },
  { k: 'creator', n: 'Creator', agent: 'creator', icon: I.star, c: '#E11D48' },
  { k: 'support', n: 'Kunden & Support', agent: 'support', icon: I.help, c: '#2F7FC1' },
  { k: 'technik', n: 'Technik', agent: 'technik', icon: I.cpu, c: '#0D9488' },
  { k: 'sicherheit', n: 'Sicherheit', agent: 'sicherheit', icon: I.shield, c: '#7C3AED' },
  { k: 'recht', n: 'Recht', agent: 'recht', icon: I.check, c: '#475569' },
  { k: 'briefing', n: 'Briefing', agent: 'briefing', icon: I.sun, c: '#0369A1' },
  { k: 'optimierung', n: 'Optimierung', agent: 'optimierung', icon: I.gauge, c: '#9333EA' },
  { k: 'marketing', n: 'Marketing', agent: 'marketing', icon: I.mega, c: '#EA580C' },
];
// LeaseRun-Zeichen (Pfeil-Haus aus dem Logo) für die Mitte.
const MARK = '<svg viewBox="-2 -2 104 88" width="34" height="30" aria-hidden="true"><defs><linearGradient id="hqMk" gradientUnits="userSpaceOnUse" x1="0" y1="84" x2="100" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#7DD3FC"/></linearGradient></defs><g fill="url(#hqMk)"><polygon points="50,8.3 63.1,19.4 62.6,22.5 49,34 45.2,31.1 5.3,68.9 2.5,70 3.1,51.7"/><polygon points="98.8,0.7 93.4,37.3 83.6,29.8 50.8,62.3 43.7,57.9 17.2,82.6 0.2,82.6 42.2,38.4 50.3,40.1 69.6,19.5 64.6,8.1"/><polygon points="82.3,37.6 99.5,53.6 99.6,84 88.6,83.6 62.5,57"/></g></svg>';
// Antworten der Agenten: **fett** und Zeilenumbrüche darstellen (Text ist vorher maskiert).
// Fett (**…**), Zeilenumbrüche und https-Links (in neuem Tab) – erst escapen, dann nur sichere https-Adressen verlinken.
const rich = (t) => esc(t).replace(/\*\*([^*\n]{1,200})\*\*/g, '<b>$1</b>').replace(/https:\/\/[A-Za-z0-9.\-]+(?:\/[A-Za-z0-9\-._~%/?=&;#]*)?/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`).replace(/\n/g, '<br>');
const initials = (a) => (a.name[0] + a.last[0]).toUpperCase();

let seq = 0;
export async function hq(v, { goTab, msg }) {
  const my = ++seq;
  v.innerHTML = `<section class="hq" aria-labelledby="hqT">
    <header class="hq-hero" data-level="load">
      <div class="hq-hero-top"><small class="hq-kick">LeaseRun Headquarters · Zentralsteuerung</small><button type="button" class="hq-ref" id="hqRef">${ic(I_REF, 16)}<span>Aktualisieren</span></button></div>
      <h2 id="hqT" class="hq-title"><span class="hq-dot" aria-hidden="true"></span><span id="hqStat">Lage wird geprüft …</span></h2>
      <p class="hq-detail" id="hqDet"></p>
      <p class="hq-bar" id="hqBar"></p>
      <p class="hq-asof"><span id="hqAsof">${esc(today())}</span> <span class="hq-aist" id="hqAi"></span></p>
      <p class="hq-since" id="hqSince" hidden></p>
      <form class="hq-q" id="hqQ" role="search"><input name="q" autocomplete="off" maxlength="300" placeholder="Suchen oder Auftrag geben …" aria-label="Suchen oder Auftrag an LeaseRun Intelligence" aria-controls="hqOS" aria-expanded="false"><button type="submit" class="hq-btn hq-btn-p">Los</button><div class="hq-os" id="hqOS" role="listbox" hidden></div></form>
      <div class="hq-qa" id="hqQA" aria-live="polite" hidden></div>
      <section class="hq-orbit" id="hqOrbit" aria-labelledby="hqOrbitT">
        <h3 class="sr-only" id="hqOrbitT">Abteilungen und digitale Mitarbeiter</h3>
        <div class="hq-feed" id="hqFeed" aria-live="polite"></div>
        <div class="hq-ring" id="hqRing">
          <div class="hq-core"><div class="hq-orb" aria-hidden="true"><span></span><span></span><span class="hq-orb-logo"><img src="/logo-icon.svg" alt="" width="54" height="46"></span></div>
            <button type="button" class="hq-pill" id="hqAll"><span class="hq-mk">${MARK}</span><b>LeaseRun</b><small>Intelligence · alle an die Arbeit</small></button></div>
          ${ORBIT.map((d, i) => { const a = AGENTS.find((x) => x.id === d.agent); return `<button type="button" class="hq-dep${d.founder ? ' founder' : ''}" data-dep="${d.k}" style="--i:${i};--n:${ORBIT.length}">${d.founder ? '<span class="hq-dep-ic hq-face"><img src="/img/gruender-240.webp" alt="Feray Korkmaz" width="40" height="40" loading="lazy"></span>' : `<span class="hq-dep-ic" style="--c:${a?.color || d.c}">${a ? `<span class="hq-ini">${initials(a)}</span>` : ic(d.icon, 20)}</span>`}<span class="hq-dep-t"><b>${esc(d.founder ? 'Feray Korkmaz' : `${a.name} ${a.last}`)}</b><small data-dl>${d.founder ? 'Head of Operations' : `<i class="dot"></i>${esc(d.n)}`}</small></span><em class="hq-dep-b" data-db hidden></em></button>`; }).join('')}
        </div>
        <div class="hq-sheet" id="hqSheet" aria-live="polite"></div>
        <div class="hq-orbit-foot"><span id="hqShift">Schicht startet …</span></div>
      </section>
    </header>
    <section class="hq-card hq-prio hq-dec" aria-labelledby="hqDecT"><div class="hq-dec-h"><h3 id="hqDecT">Jetzt wichtig <span class="hq-dec-n" id="hqDecN"></span></h3><div class="hq-sh-a"><button type="button" class="hq-btn" id="hqDecRun">Jetzt prüfen</button><button type="button" class="hq-btn hq-btn-p" id="hqDecAll" hidden>Alles erledigen</button></div></div><div id="hqDec" aria-live="polite"><div class="hq-kpi hq-sk"></div></div></section>
    <section class="hq-card hq-met" aria-labelledby="hqMetT"><h3 id="hqMetT">Heute · Kennzahlen</h3>
      <div class="hq-chips hq-chips-l" id="hqRev" aria-live="polite"></div>
      <div class="hq-kpis" id="hqKpi" aria-live="polite">${'<div class="hq-kpi hq-sk"></div>'.repeat(4)}</div></section>
    <details class="hq-card hq-fold"><summary><h3>Systeme</h3><span id="hqSysSum">…</span></summary><div id="hqSys"></div></details>
    <details class="hq-card hq-fold"><summary><h3>Verlauf</h3><span id="hqActSum"></span></summary><div id="hqAct"></div></details>
  </section>`;
  const $ = (s) => v.querySelector(s);
  // Reihenfolge: Status → Jetzt wichtig (inkl. Freigaben, Aktiv) → Kennzahlen → Abteilungen (Handy: kompaktes Raster) → Systeme/Verlauf.
  const phone = matchMedia('(max-width: 600px)');
  // Auch am Desktop: Entscheidungen vor dem Abteilungs-Ring – das Wichtigste steht im ersten Bildschirm.
  const arrange = () => { const o = $('#hqOrbit'), m = v.querySelector('.hq-met'); if (!o || !m) return; v.classList.toggle('hq-phone', phone.matches); m.after(o); };
  arrange(); phone.addEventListener?.('change', arrange);
  // Tippen neben das Blatt schließt es (Handy).
  $('#hqSheet').addEventListener('click', (e) => { if (e.target === e.currentTarget && openDep) { openDep = null; paintAll(); } });
  // Ring mit Maus (oder Stift) drehen; ein kurzer Klick öffnet weiterhin den Agenten.
  const ring = { dragged: false, rot: 0 };
  { const el = $('#hqRing'); let st = null;
    el.addEventListener('pointerdown', (e) => { if (innerWidth < 900 || e.button !== 0) return; const r = el.getBoundingClientRect(); st = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, x: e.clientX, y: e.clientY, rot: ring.rot }; st.a = Math.atan2(e.clientY - st.cy, e.clientX - st.cx); ring.dragged = false; });
    el.addEventListener('pointermove', (e) => { if (!st) return; if (!ring.dragged && Math.hypot(e.clientX - st.x, e.clientY - st.y) > 6) { ring.dragged = true; try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ } el.classList.add('drag'); } if (!ring.dragged) return; ring.rot = st.rot + (Math.atan2(e.clientY - st.cy, e.clientX - st.cx) - st.a) * 180 / Math.PI; el.style.setProperty('--rot', `${ring.rot}deg`); });
    const end = () => { if (!st) return; st = null; el.classList.remove('drag'); setTimeout(() => { ring.dragged = false; }, 0); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    el.addEventListener('wheel', (e) => { if (innerWidth < 900 || !e.shiftKey) return; e.preventDefault(); ring.rot += e.deltaY > 0 ? 12 : -12; el.style.setProperty('--rot', `${ring.rot}deg`); }, { passive: false });
  }
  // ---------- Schicht: alle Mitarbeiter parallel ----------
  let shift = {}; const busy = new Set(); let queued = false;
  const ST = { ok: ['ok', 'Erledigt'], todo: ['warn', 'Braucht dich'], error: ['bad', 'Problem'] };
  const agoS = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'gerade eben' : m < 60 ? `vor ${m} Min.` : `vor ${Math.round(m / 60)} Std.`; };
  const FOUNDER = 'Feray';
  let openDep = null, feedIx = 0;
  const depState = (d) => { if (d.founder) { return AGENTS.some((a) => shift[a.id] && shift[a.id].status !== 'ok') ? 'todo' : 'ok'; } if (!d.agent) return 'plan'; if (busy.has(d.agent)) return 'busy'; return shift[d.agent]?.status || 'idle'; };
  let findings = [], alerts = [], decReady = false;
  let cmds = {}; const chat = {}; let autoAsk = null; let ai = null; let proposals = []; let umsetzungSofort = false; let uBlock = null;
  const usd = (x) => `${(Number(x) || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
  const paintAi = () => {
    const el = $('#hqAi'); if (!el) return;
    if (!ai) { el.textContent = ''; return; }
    if (!ai.configured) { el.innerHTML = `· <a href="#einrichtung">Claude noch nicht angebunden</a>`; return; }
    el.innerHTML = ai.blocked ? `· <b>${esc(ai.blocked)}</b>` : '· LeaseRun Intelligence aktiv';
  };
  // Analyse des Modells (Ursache · erledigt · was du tun musst) im Blatt eines Agenten.
  const GRUND = { analyse: 'Analyse & Lösung', tag: 'Tagesrunde · Vorschläge', auftrag: 'Antwort' };
  const aiBox = (r) => {
    if (!r?.ai) return '';
    const a = r.ai;
    return `<details class="hq-ai"><summary><small>${esc(GRUND[a.grund] || 'Ergebnis')} · ${esc(agoS(a.at))}</small></summary><p>${rich(a.text)}</p></details>`;
  };
  // Lösungen (Vorschläge): nur „Erledigen“ / „Verwerfen“. Erledigen setzt der Umsetzungs-Agent um; Dokumente sind sofort angenommen.
  const KIND = { code: 'Änderung an der Website', text: 'Text', marketing: 'Marketing', einstellung: 'Einstellung', dokument: 'Dokument', sonstiges: 'Lösung' };
  const propHtml = (p) => { const a = AGENTS.find((x) => x.id === p.agent); const st = p.status;
    return `<li class="hq-p-${esc(st)}"><div><b>${esc(p.title)}</b><small>${esc(a ? `${a.name} · ${a.role}` : p.agent)} · ${esc(KIND[p.kind] || 'Lösung')} · ${esc(agoS(p.at))}</small>
      ${st === 'erledigt' ? `<p class="hq-res">${esc(p.result || 'Erledigt.')}</p>` : st === 'auftrag' || st === 'in_arbeit' ? `<p class="hq-res run">${st === 'in_arbeit' ? 'Wird gerade umgesetzt …' : (uBlock ? (uBlock.reason === 'guthaben' ? 'Freigegeben – wartet auf Anthropic-Guthaben und läuft danach automatisch.' : 'Freigegeben – wartet, läuft danach automatisch.') : umsetzungSofort ? 'Startet gleich – wird in den nächsten Minuten umgesetzt.' : 'Wartet auf den Umsetzungs-Agenten – er startet bei der nächsten Website-Aktualisierung. Für sofortigen Start: Einrichtung → „Lösungen sofort umsetzen lassen“.')}</p>` : `<details class="hq-more"><summary>Details</summary><p>${esc(p.detail).replace(/\n/g, '<br>')}</p>${p.why ? `<p class="hq-why">${esc(p.why)}</p>` : ''}</details>${p.result ? `<p class="hq-res bad">${esc(p.result)}</p>` : ''}`}</div>
      ${st === 'offen' ? `<div class="hq-sh-a">${p.doc ? `<button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="pdf">PDF</button><button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="word">Word</button>` : ''}<button type="button" class="hq-btn hq-btn-p" data-dec="erledigen" data-pid="${esc(p.id)}">Erledigen</button><button type="button" class="hq-btn" data-dec="verworfen" data-pid="${esc(p.id)}">Verwerfen</button></div>` : st === 'erledigt' && p.doc ? `<div class="hq-sh-a"><button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="pdf">PDF</button><button type="button" class="hq-btn" data-doc="${esc(p.id)}" data-f="word">Word</button></div>` : ''}</li>`; };
  const bindProps = (box) => {
    box.querySelectorAll('[data-dec]').forEach((b) => b.onclick = async () => {
      // „Erledigen“ wirkt sofort mit einem Tippen (Wunsch Feray). Früher war ein zweites Tippen nötig – das ging verloren,
      // wenn die Ansicht sich zwischendurch neu aufbaute (z. B. nach einer Analyse), und es sah aus, als passiere nichts.
      b.disabled = true; b.textContent = b.dataset.dec === 'erledigen' ? 'Wird übergeben …' : '…';
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'proposal', proposalId: b.dataset.pid, decision: b.dataset.dec }) });
      if (!r.ok) { b.disabled = false; msg(r.data?.error || 'Nicht möglich.', true); return; }
      proposals = r.data.proposals || []; msg(r.data.status === 'auftrag' ? (r.data.started ? 'Umsetzung gestartet – das Ergebnis erscheint hier und als Mitteilung.' : 'Freigegeben. Der Umsetzungs-Agent startet bei der nächsten Website-Aktualisierung (für sofort: Einrichtung).') : r.data.status === 'erledigt' ? 'Angenommen.' : 'Verworfen.'); paintAll();
    });
    box.querySelectorAll('[data-doc]').forEach((b) => b.onclick = async () => { b.disabled = true; try { await download(`/api/admin/hq/doc?id=${encodeURIComponent(b.dataset.doc)}&f=${b.dataset.f}`, {}, `dokument.${b.dataset.f === 'word' ? 'docx' : 'pdf'}`); } catch (e) { msg(e.message || 'Download nicht möglich.', true); } b.disabled = false; });
  };
  // Ava · Freigaben: Entwürfe als Pakete (Herkunft + Erstellungstag) prüfen. Auswahl im Postfach öffnen oder ins „Archiv“
  // verschieben (nichts wird gelöscht). Kein Sammel-Senden – gesendet wird nur einzeln im Postfach.
  let pk = null, pkBusy = false; const pkSel = new Set(), pkOpen = new Set();
  const loadPk = async () => {
    if (pkBusy) return; pkBusy = true;
    const r = await api('/api/admin/hq?entwuerfe=1'); pkBusy = false;
    pk = r.ok ? r.data : { error: r.data?.error || 'Entwürfe gerade nicht abrufbar.' };
    paintPk($('#hqSheet [data-pk]'));
  };
  const deDay = (t) => { const [y, m, d] = String(t).split('-'); return `${d}.${m}.${y}`; };
  const paintPk = (el) => {
    if (!el) return;
    if (!pk) { el.innerHTML = '<p class="hq-sh-l">Entwürfe werden geladen …</p>'; loadPk(); return; }
    if (pk.error) { el.innerHTML = `<p class="hq-sh-l">${esc(pk.error)}</p>`; return; }
    const ids = new Set(pk.pakete.flatMap((g) => g.entwuerfe.map((e) => e.id)));
    for (const id of [...pkSel]) if (!ids.has(id)) pkSel.delete(id);
    const n = pkSel.size;
    el.innerHTML = `<h4 class="hq-h4">Entwürfe als Pakete (${pk.anzahl})</h4>
      ${pk.anzahl ? `<div class="hq-sh-a"><button type="button" class="hq-btn hq-btn-p" data-pk-open ${n ? '' : 'disabled'}>Ausgewählte im Postfach öffnen${n ? ` (${n})` : ''}</button><button type="button" class="hq-btn" data-pk-arch ${n ? '' : 'disabled'}>Ausgewählte archivieren${n ? ` (${n})` : ''}</button><button type="button" class="hq-btn" data-pk-re>Neu laden</button></div>
      <p class="hq-pk-n">Gesendet wird nur einzeln im Postfach. Werbung ohne Rechtsgrundlage (keine Einwilligung, Widerspruch, Abmeldelink fehlt) ist gesperrt und kann nicht gesendet werden. Archivieren verschiebt in den Ordner „Archiv“ – nichts wird gelöscht, alles ist zurückholbar.</p>
      ${pk.pakete.map((g, gi) => { const k = `${g.herkunft}|${g.tag}`, dup = g.entwuerfe.filter((e) => e.doppel).length, all = g.entwuerfe.every((e) => pkSel.has(e.id));
        return `<details class="hq-pk-g" data-pkg="${esc(k)}"${pkOpen.has(k) ? ' open' : ''}><summary><b>${esc(g.herkunft)}, ${deDay(g.tag)}, ${g.entwuerfe.length} Stück</b>${dup ? `<small>${dup} Doppel</small>` : ''}</summary>
          <label class="hq-chk hq-pk-all"><input type="checkbox" data-pg="${gi}"${all ? ' checked' : ''}> Ganzes Paket auswählen</label>
          <ul class="hq-pk-l">${g.entwuerfe.map((e) => `<li><label><input type="checkbox" data-pe="${esc(e.id)}"${pkSel.has(e.id) ? ' checked' : ''}><span><b>${esc(e.an)}</b><small>${esc(e.betreff || '(ohne Betreff)')}${e.doppel ? ' · <em>Doppel</em>' : ''}</small><small class="hq-pk-r"><span class="st${e.art === 'Werbung' ? ' warn' : ''}">${esc(e.art || 'Werbung')}</span> <span class="st ${e.sendbar ? 'ok' : 'bad'}">Rechtsgrundlage: ${esc(e.grundlage || 'fehlt')}</span>${!e.sendbar && e.grund ? ` · ${esc(e.grund)}` : ''}</small>${e.vorschau ? `<small class="hq-pk-v">${esc(e.vorschau)}</small>` : ''}</span></label></li>`).join('')}</ul></details>`; }).join('')}` : '<p class="hq-sh-l">✓ Keine Entwürfe im Postfach.</p>'}`;
    el.querySelectorAll('[data-pkg]').forEach((d) => d.ontoggle = () => { d.open ? pkOpen.add(d.dataset.pkg) : pkOpen.delete(d.dataset.pkg); });
    el.querySelectorAll('[data-pe]').forEach((x) => x.onchange = () => { x.checked ? pkSel.add(x.dataset.pe) : pkSel.delete(x.dataset.pe); paintPk(el); });
    el.querySelectorAll('[data-pg]').forEach((x) => x.onchange = () => { for (const e of pk.pakete[Number(x.dataset.pg)].entwuerfe) x.checked ? pkSel.add(e.id) : pkSel.delete(e.id); paintPk(el); });
    const re = el.querySelector('[data-pk-re]'); if (re) re.onclick = () => { pk = null; paintPk(el); };
    const op = el.querySelector('[data-pk-open]');
    // Übergabe an das Postfach: Ordner „Entwürfe“, Auswahl vorgemerkt, erster Entwurf geöffnet.
    if (op) op.onclick = () => { try { sessionStorage.setItem('lr-pf-pick', JSON.stringify([...pkSel].slice(0, 200))); } catch { /* nur Komfort */ } goTab('postfach'); };
    const ar = el.querySelector('[data-pk-arch]');
    if (ar) ar.onclick = async () => {
      const list = [...pkSel].slice(0, 200);
      if (!list.length || !confirm(`${list.length} ${list.length === 1 ? 'Entwurf' : 'Entwürfe'} in den Ordner „Archiv“ verschieben? Nichts wird gesendet oder gelöscht.`)) return;
      ar.disabled = true; ar.textContent = 'Wird archiviert …';
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'entwuerfe_archivieren', ids: list }) });
      if (!r.ok) { msg(r.data?.error || 'Archivieren nicht möglich.', true); paintPk(el); return; }
      pk = r.data; pkSel.clear(); msg(`${r.data.archiviert} ${r.data.archiviert === 1 ? 'Entwurf' : 'Entwürfe'} ins Archiv verschoben (im Postfach unter „Archiv“ zurückholbar).`);
      paintPk(el); work(['freigaben'], true);
    };
  };
  const paintSheet = () => {
    const box = $('#hqSheet'), d = ORBIT.find((x) => x.k === openDep);
    if (!d) { box.innerHTML = ''; return; }
    if (d.founder) {
      const wait = AGENTS.filter((a) => shift[a.id] && shift[a.id].status !== 'ok');
      box.innerHTML = `<div class="hq-sh"><div class="hq-sh-h"><span class="hq-dep-ic hq-face"><img src="/img/gruender-240.webp" alt="Feray Korkmaz" width="44" height="44" loading="lazy"></span><div><b>Feray Korkmaz</b><small>Head of Operations</small></div><button type="button" class="hq-rc-x" data-x aria-label="Schließen">×</button></div>
        ${wait.length ? `<ul class="hq-fl">${wait.map((a) => `<li><button type="button" data-open="${a.id}"><span class="hq-ini sm" style="background:${a.color}">${initials(a)}</span><span><b>${esc(a.name)} · ${esc(a.role)}</b><small>${esc(shift[a.id].line)}</small></span></button></li>`).join('')}</ul>` : '<p class="hq-sh-l">✓ Alles erledigt.</p>'}
        ${proposals.length ? `<h4 class="hq-h4">Lösungen zur Freigabe (${proposals.filter((p) => p.status === 'offen').length})</h4><ul class="hq-prop">${proposals.map(propHtml).join('')}</ul>` : ''}
        ${ai?.configured ? `<details class="hq-set"><summary>LeaseRun Intelligence · Einstellungen</summary>
          <form class="hq-setf" data-set>
            <label>Zentrale &amp; Lagebild<select name="top">${ai.models.map((m) => `<option value="${m.id}" ${m.id === ai.settings.top ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label>Alle übrigen Abteilungen (Chat mit dir)<select name="rest">${ai.models.map((m) => `<option value="${m.id}" ${m.id === ai.settings.rest ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label>Hintergrund (Wache, Tagesrunde, Entwürfe – am meisten Aufrufe)<select name="bg">${ai.models.map((m) => `<option value="${m.id}" ${m.id === ai.settings.bg ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
            <label class="hq-chk"><input name="off" type="checkbox" ${ai.settings.off ? 'checked' : ''}> KI aus (keine Anthropic-Kosten – Agenten arbeiten regelbasiert)</label>
            <label class="hq-chk"><input name="auto" type="checkbox" ${ai.settings.auto ? 'checked' : ''}> Neue Funde automatisch analysieren und beheben</label>
            <label class="hq-chk"><input name="daily" type="checkbox" ${ai.settings.daily ? 'checked' : ''}> Tagesrunde ab 6 Uhr (Lösungen je Abteilung)</label>
            <div class="hq-sh-a"><button type="submit" class="hq-btn hq-btn-p">Speichern</button><button type="button" class="hq-btn" data-daily>Tagesrunde jetzt</button></div>
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
          if (!r.ok) { msg(r.data?.error || 'Nicht gespeichert.', true); return; }
          ai = r.data.ai; msg('Gespeichert.'); paintAi(); paintAll();
        };
        f.querySelector('[data-daily]').onclick = async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = 'Läuft … (bis zu einer Minute)';
          const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'tagesrunde' }) });
          if (r.ok) { shift = r.data.agents || shift; msg(r.data.done?.length ? `Tagesrunde: ${r.data.done.map((id) => AGENTS.find((x) => x.id === id)?.name || id).join(', ')} haben Vorschläge gemacht.` : r.data.skipped || 'Für heute ist die Tagesrunde schon komplett.'); } else msg(r.data?.error || 'Nicht möglich.', true);
          refreshAi(); paintAll();
        };
      }
      return;
    }
    const a = AGENTS.find((x) => x.id === d.agent), r = shift[a.id], b = busy.has(a.id);
    const [c, l] = b ? ['info', 'Arbeitet …'] : r ? ST[r.status] || ST.ok : ['off', 'Wartet'];
    const acts = (r?.actions || []).filter((x) => x.id !== 'open' || r.status !== 'ok');
    const h = chat[a.id] || [];
    box.innerHTML = `<div class="hq-sh"><div class="hq-sh-h"><span class="hq-dep-ic" style="--c:${a.color}"><span class="hq-ini">${initials(a)}</span></span><div><b>${esc(a.name)} ${esc(a.last)}</b><small>${esc(a.role)}</small></div><span class="hq-st ${c}">${l}</span><button type="button" class="hq-rc-x" data-x aria-label="Schließen">×</button></div>
      <p class="hq-sh-l">${r ? `${esc(r.line)} <span>· ${agoS(r.at)}</span>` : 'Hat noch nicht gearbeitet.'}</p>
      ${aiBox(r)}
      ${a.id === 'freigaben' ? '<div class="hq-pk" data-pk></div>' : ''}
      ${(() => { const mine = proposals.filter((p) => p.agent === a.id); return mine.length ? `<h4 class="hq-h4">Lösungen</h4><ul class="hq-prop">${mine.map(propHtml).join('')}</ul>` : ''; })()}
      <div class="hq-sh-a">${acts.map((x, i) => `<button type="button" class="hq-btn ${x.id === 'remind' ? 'hq-btn-p' : ''}" data-ai="${i}">${esc(x.label)}</button>`).join('')}<button type="button" class="hq-btn hq-btn-p" data-run ${b ? 'disabled' : ''}>${b ? 'Arbeitet …' : 'Jetzt erledigen'}</button></div>
      <div class="hq-chat"${ai?.settings?.off && !h.length ? ' hidden' : ''}>${h.map((m) => `<p class="hq-msg ${m.me ? 'me' : ''}${m.wait ? ' wait' : ''}">${rich(m.t)}</p>`).join('')}</div>
      ${ai?.settings?.off ? '<p class="form-note">KI aus: Dieser Agent prüft und korrigiert automatisch nach festen Regeln (kein Chat, keine Kosten). Die Knöpfe unten führen feste Aufgaben sofort aus.</p>' : `<form class="hq-ask" data-ask><input name="q" autocomplete="off" maxlength="1500" placeholder="Auftrag an ${esc(a.name)} …" aria-label="Auftrag an ${esc(a.name)}"><button type="submit" class="hq-btn hq-btn-p">Los</button></form>`}
      <div class="hq-chips2">${(cmds[a.id] || []).map((t) => `<button type="button" data-cmd="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
    box.querySelector('[data-x]').onclick = () => { openDep = null; paintAll(); };
    bindProps(box);
    box.querySelector('[data-run]').onclick = () => doNow(a.id);
    if (a.id === 'freigaben') paintPk(box.querySelector('[data-pk]'));
    const th = box.querySelector('[data-think]');
    if (th) th.onclick = async () => { th.disabled = true; th.textContent = 'Claude arbeitet …'; const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'analyse', agents: [a.id] }) }); if (r.ok) { shift = r.data.agents || shift; if (r.data.skipped) msg(r.data.skipped, true); } else msg(r.data?.error || 'Analyse nicht möglich.', true); refreshAi(); paintAll(); };
    box.querySelectorAll('[data-ai]').forEach((btn) => btn.onclick = () => act(a.id, acts[Number(btn.dataset.ai)], btn));
    const send = async (text) => {
      if (!text.trim()) return;
      (chat[a.id] ||= []).push({ me: true, t: text });
      const hist = chat[a.id].slice(0, -1).filter((m) => !m.wait).slice(-8).map((m) => ({ me: Boolean(m.me), t: m.t }));
      const wait = { t: `${a.name} arbeitet …`, wait: true };
      chat[a.id].push(wait); paintSheet();
      const f = box.querySelector('[data-ask]'); if (f) f.querySelector('input').disabled = true;
      const x = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ agent: a.id, command: text, history: hist }) });
      chat[a.id] = chat[a.id].filter((m) => m !== wait);
      chat[a.id].push({ t: x.ok ? x.data.reply : (x.status === 504 ? 'Das war zu viel auf einmal – ich habe einen Teil erledigt. Schreib „weiter“, dann mache ich weiter.' : x.data?.error || 'Das hat nicht geklappt – bitte noch einmal senden.'), claude: Boolean(x.ok && x.data.ai) });
      if (x.ok && x.data.actions?.length && shift[a.id]) shift[a.id] = { ...shift[a.id], actions: x.data.actions };
      if (x.ok && x.data.ai) refreshAi();
      paintSheet(); box.querySelector('[data-ask] input')?.focus();
    };
    const askF = box.querySelector('[data-ask]'); if (askF) askF.onsubmit = (e) => { e.preventDefault(); send(e.target.q.value); };
    if (autoAsk) { const q = autoAsk; autoAsk = null; send(q); }
    box.querySelectorAll('[data-cmd]').forEach((x) => x.onclick = () => send(x.dataset.cmd));
  };
  // Live-Feed: was die Agenten zuletzt erledigt haben bzw. an dich übergeben – nur echte Ergebnisse.
  const feedItems = () => AGENTS.filter((a) => shift[a.id]).map((a) => ({ a, r: shift[a.id], d: ORBIT.find((x) => x.agent === a.id) }))
    .sort((x, y) => (x.r.status === 'ok') - (y.r.status === 'ok') || String(y.r.at).localeCompare(String(x.r.at)));
  const paintFeed = () => {
    const it = feedItems(), box = $('#hqFeed');
    if (busy.size) { box.innerHTML = `<div class="hq-fd busy"><i></i><div><small>${busy.size} arbeiten</small><p>${[...busy].map((id) => AGENTS.find((a) => a.id === id)?.name).join(', ')} …</p></div></div>`; return; }
    if (!it.length) { box.innerHTML = ''; return; }
    const show = it.slice(feedIx % it.length).concat(it.slice(0, feedIx % it.length)).slice(0, 2);
    box.innerHTML = show.map(({ a, r, d }) => `<button type="button" class="hq-fd s-${r.status}" data-fd="${d.k}"><i></i><div><small>${esc(a.name)} · ${r.status === 'ok' ? 'erledigt' : `→ ${FOUNDER}`}</small><p>${esc(String(r.line || '').slice(0, 110))}</p></div></button>`).join('');
    box.querySelectorAll('[data-fd]').forEach((b) => b.onclick = () => { openDep = b.dataset.fd; paintAll(); });
  };
  const paintAll = () => {
    for (const d of ORBIT) {
      const el = v.querySelector(`[data-dep="${d.k}"]`); if (!el) continue;
      const st = depState(d); el.dataset.state = st; el.setAttribute('aria-pressed', String(openDep === d.k));
      const badge = el.querySelector('[data-db]');
      if (d.agent) {
        el.querySelector('[data-dl]').innerHTML = `<i class="dot"></i>${esc(d.n)} · ${st === 'busy' ? 'arbeitet …' : st === 'ok' ? 'erledigt' : st === 'todo' ? 'braucht dich' : st === 'error' ? 'Problem' : 'wartet'}`;
      }
      if (d.agent || d.founder) { badge.hidden = st !== 'todo' && st !== 'error'; badge.textContent = '!'; }
      el.onclick = () => { if (ring.dragged) return; openDep = openDep === d.k ? null : d.k; paintAll(); if (openDep && d.agent) autoThink(d.agent); if (openDep && innerWidth < 900) $('#hqSheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
    }
    paintSheet(); paintFeed(); paintDec();
    const todo = AGENTS.filter((a) => shift[a.id] && shift[a.id].status !== 'ok').length;
    const last = Object.values(shift).map((x) => x.at).sort().pop();
    $('#hqShift').textContent = busy.size ? `${busy.size} von ${AGENTS.length} arbeiten …` : `${AGENTS.length} Agenten · ${last ? agoS(last) : '–'} · ${todo ? `${todo} brauchen dich` : 'alles erledigt'}`;
    const pill = $('#hqAll'); pill.classList.toggle('busy', busy.size > 0); pill.querySelector('small').textContent = busy.size ? `Intelligence · ${busy.size} arbeiten …` : 'Intelligence · alle an die Arbeit';
    $('#hqOrbit').dataset.busy = busy.size ? '1' : '';
  };
  const paintCrew = paintAll;
  const refreshAi = async () => { const r = await api('/api/admin/hq'); if (r.ok && v.isConnected) { ai = r.data.ai || ai; proposals = r.data.proposals || proposals; umsetzungSofort = Boolean(r.data.umsetzung); uBlock = r.data.blocked || null; paintAi(); } };
  // Jede Gruppe von drei Agenten ist eine eigene Anfrage: Ergebnisse erscheinen nach und nach, keine Anfrage läuft länger
  // als nötig, und ein Tipp während einer laufenden Runde wird nie verschluckt (Rückmeldung oder nächste Runde).
  const work = async (ids = AGENTS.map((a) => a.id), force = false) => {
    const open = ids.filter((x) => !busy.has(x));
    if (!open.length) { if (force) { queued = true; msg(`${busy.size} Agenten arbeiten gerade – die nächste Runde startet direkt danach.`); paintCrew(); } return; }
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
    if (failed) msg(`${failed} Agenten konnten diese Runde nicht arbeiten – ich versuche es in der nächsten Runde erneut.`, true);
    else if (force) { const todo = AGENTS.filter((a) => shift[a.id] && shift[a.id].status !== 'ok').length; msg(todo ? `Runde fertig – ${todo} ${todo === 1 ? 'Punkt braucht' : 'Punkte brauchen'} dich.` : 'Runde fertig – alles erledigt.'); }
    if (force) loadOverview();
    if (queued && !busy.size) { queued = false; work(AGENTS.map((a) => a.id), true); return; }
    // Neue wichtige Funde: Claude analysiert und behebt sofort (höchstens zwei je Runde, 6 Stunden nicht doppelt).
    if (ai?.configured && ai.settings?.auto && !ai.blocked && Object.values(shift).some((r) => r.aiQueue?.length)) {
      const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'analyse' }) });
      if (r.ok && v.isConnected) { shift = r.data.agents || shift; refreshAi(); paintCrew(); if (r.data.done?.length) msg(`Claude hat ${r.data.done.map((id) => AGENTS.find((x) => x.id === id)?.name || id).join(' und ')} geholfen – Lösung steht in der Karte.`); }
    }
  };
  // „Jetzt erledigen“: Agent arbeitet, Claude behebt und legt Lösungen an, danach wird nachgeprüft (bis ~1 Minute).
  // fromDec: von Feray per „Erledigen“ ausgelöst → Punkt gilt als bearbeitet und bleibt 24 Std. weg,
  // außer die Lage ändert sich wirklich (anderer Inhalt oder schlechterer Status). Automatische Läufe blenden nichts aus.
  const doNow = async (id, fromDec = false) => {
    if (busy.has(id)) return;
    const before = shift[id] ? aKey(id, shift[id]) : null;
    // Sofort auf dem Server merken – nicht erst nach dem Lauf (bis ~1 Min.). Wer das HQ in der Zwischenzeit verlässt
    // (z. B. ins Postfach), findet den Punkt sonst beim Zurückkommen wieder.
    if (fromDec && before) hide(before);
    busy.add(id); paintCrew();
    const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'erledigen', agents: [id] }) });
    busy.delete(id);
    // Auch das Ergebnis des Laufs merken, selbst wenn die Seite inzwischen gewechselt wurde.
    if (r.ok && fromDec) { const now = r.data.agents?.[id]; if (now && now.status !== 'ok') hide(aKey(id, now)); }
    if (!v.isConnected) return;
    if (r.ok) {
      shift = r.data.agents || shift; proposals = r.data.proposals || proposals;
      msg(r.data.text || 'Erledigt.');
    } else msg(r.data?.error || 'Nicht erledigt.', true);
    paintCrew(); paintDec(); loadOverview();
  };
  // Karte geöffnet, Punkt offen, noch keine frische Analyse: einmal von selbst Lösungen erarbeiten lassen.
  const autoDone = new Set();
  const autoThink = (id) => {
    const r = shift[id];
    if (!ai?.configured || ai.blocked || !r || r.status === 'ok' || busy.has(id) || autoDone.has(id) || id === 'freigaben') return;
    if (r.ai && Date.now() - new Date(r.ai.at) < 6 * 3600_000 && !/keine antwort/i.test(r.ai.text || '')) return;
    autoDone.add(id); doNow(id);
  };
  const act = async (agentId, x, btn) => {
    if (x.tab) { goTab(x.tab, x.sg); return; }
    if (x.id === 'opt') { openDep = 'optimierung'; autoAsk = 'Vorschläge zeigen'; paintAll(); return; }
    if (x.id === 'ask' && x.q) { openDep = agentId; autoAsk = x.q; paintAll(); return; }
    if (x.id === 'remind') {
      if (!confirm(x.confirm || 'Jetzt senden?')) return;
      btn.disabled = true; btn.textContent = 'Wird gesendet …';
      let ok = 0, bad = 0;
      for (const id of x.ids || []) { const y = await api('/api/admin/invoices', { method: 'POST', headers: { 'x-admin-scope': 'b2b' }, body: JSON.stringify({ action: 'remind', invoiceId: id }) }); if (y.ok) ok++; else bad++; }
      msg(`${ok} Erinnerung${ok === 1 ? '' : 'en'} gesendet${bad ? ` · ${bad} nicht möglich` : ''}.`, bad > 0);
      work([agentId], true);
    }
  };
  // ---------- Jetzt wichtig: eine Warteschlange für alles, nach Priorität gruppiert ----------
  // JETZT (kritisch oder heute nötig) · FREIGABEN (wartet auf dein Okay) · HEUTE (kann warten) · AKTIV (läuft gerade).
  // Je Punkt höchstens zwei Knöpfe; Details (und „Agent öffnen“) eingeklappt. Erledigtes/Verworfenes bleibt 24 Std. weg –
  // gilt für Web-Admin UND Admin-App (Server) – außer die Lage ändert sich wirklich (anderer Punkt oder schlechterer Status).
  const LV = { hoch: 0, mittel: 1, niedrig: 2 };
  // Wichtigster offener Punkt eines Agenten. Seine ID bleibt über die Runden gleich, auch wenn sich Zahlen im Text ändern.
  function topIssue(r) { return [...(r.issues || [])].sort((x, y) => (LV[x.level] ?? 3) - (LV[y.level] ?? 3))[0] || null; }
  // Gleicher Schlüssel in der Admin-App (admin-app/app/(tabs)/hq.js).
  function aKey(id, r) { const t = topIssue(r); return `a|${id}|${r.status}|${t?.id || String(r.line || '').replace(/\d+(?:[.,]\d+)*/g, '#')}`; }
  // Gleiche Lage aus verschiedenen Quellen nur einmal zeigen (Groß-/Kleinschreibung, Zahlen und Satzzeichen zählen nicht).
  const topic = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\d+(?:[.,]\d+)*/g, '#').replace(/[^a-z#]+/g, ' ').trim();
  let dismissed = {};
  const hidden = () => { const now = Date.now(), m = {}; for (const k in dismissed) if (dismissed[k] > now) m[k] = 1; return m; };
  // Nacheinander speichern: Gleichzeitige Anfragen (z. B. „Alles erledigen“) würden sich auf dem Server gegenseitig überschreiben.
  let hideQ = Promise.resolve();
  const hide = (k) => {
    dismissed[k] = Date.now() + 86400_000;
    hideQ = hideQ.then(() => api('/api/admin/os/dismiss', { method: 'POST', body: JSON.stringify({ key: k }) })).then((r) => { if (r?.ok) dismissed = { ...(r.data.dismissed || {}), ...dismissed }; }, () => {});
  };
  // Erst zeichnen, wenn bekannt ist, was schon erledigt/verworfen wurde – sonst blitzen erledigte Punkte kurz wieder auf.
  let disReady = false;
  api('/api/admin/os/dismiss').then((r) => { if (r.ok) dismissed = { ...(r.data.dismissed || {}), ...dismissed }; }, () => {}).finally(() => { disReady = true; if (v.isConnected) paintDec(); });
  const FSEV = { critical: 'bad', warning: 'warn', info: 'info' }, SL = { bad: 'Kritisch', warn: 'Wichtig', dec: 'Freigabe', info: 'Hinweis' };
  const fixF = async (body) => {
    const r = await api('/api/admin/fix', { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) { msg(r.data?.error || 'Nicht möglich.', true); return loadFix(); }
    findings = (r.data.findings || []); const bad = (r.data.results || []).filter((x) => !x.ok);
    msg(body.dismiss ? 'Verworfen.' : bad.length ? bad.map((x) => x.text).join(' · ') : 'Erledigt.', bad.length > 0);
    paintDec(); work(['sicherheit', 'postfach', 'technik'], true); loadOverview();
  };
  const decide = async (id, decision) => {
    const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ action: 'proposal', proposalId: id, decision }) });
    if (!r.ok) { msg(r.data?.error || 'Nicht möglich.', true); paintDec(); return; }
    proposals = r.data.proposals || []; msg(decision === 'verworfen' ? 'Verworfen.' : r.data.warn ? `Neuer Versuch gestartet – aber: ${r.data.warn}` : r.data.started ? 'Wird umgesetzt.' : 'Freigegeben.', Boolean(r.data.warn)); paintAll();
  };
  const decItems = () => {
    const H = hidden(), out = [];
    for (const f of findings) {
      const sev = FSEV[f.sev] || 'info';
      out.push({ k: `f|${f.id}`, grp: sev === 'info' ? 'today' : 'now', sev, area: f.area, title: f.title, detail: f.auto ? '' : f.how,
        yes: f.auto ? ['Erledigen', () => fixF({ ids: [f.id] })] : ['Erledigt', () => fixF({ dismiss: f.id })],
        no: f.auto ? ['Verwerfen', () => fixF({ dismiss: f.id })] : null });
    }
    // Lösungen der Agenten verändern etwas (Website, Texte, Einstellungen) → Freigabe mit Bestätigung (zweites Tippen).
    for (const p of proposals.filter((x) => x.status === 'offen')) {
      const a = AGENTS.find((x) => x.id === p.agent), kind = KIND[p.kind] || 'Lösung';
      out.push({ k: `p|${p.id}`, grp: 'approve', sev: 'dec', area: a ? a.name : p.agent, color: a?.color, kind, title: p.title,
        detail: [p.detail, p.why].filter(Boolean).join('\n\n'), doc: p.doc ? p.id : null,
        confirm: p.kind === 'dokument' ? null : `${kind} wird umgesetzt`,
        yes: ['Erledigen', () => decide(p.id, 'erledigen')], no: ['Verwerfen', () => decide(p.id, 'verworfen')] });
    }
    for (const a of AGENTS) {
      // Ethan (Lagebild) fasst nur die anderen zusammen – seine Punkte stehen schon bei den jeweiligen Agenten.
      const r = shift[a.id]; if (!r || r.status === 'ok' || a.id === 'briefing') continue;
      const k = aKey(a.id, r); if (H[k]) continue;
      const t = topIssue(r), more = (r.issues || []).filter((i) => i !== t && i.level !== 'niedrig').length;
      const detail = [r.line, r.ai?.text].filter(Boolean).join('\n\n');
      if (a.id === 'freigaben') {
        // Ava: alles, was nach außen ginge – öffnet den Bereich zum Prüfen, sendet selbst nie.
        const go = (r.actions || []).find((x) => x.tab);
        out.push({ k, grp: 'approve', sev: 'dec', area: a.name, color: a.color, title: t?.title || r.line, detail, open: d0(a.id),
          yes: go ? ['Prüfen', () => goTab(go.tab, go.sg)] : null, no: ['Verwerfen', () => { hide(k); paintDec(); }] });
        continue;
      }
      const extra = (r.actions || []).find((x) => x.id === 'remind');
      const urgent = r.status === 'error' || t?.level === 'hoch';
      out.push({ k, grp: urgent ? 'now' : 'today', sev: r.status === 'error' ? 'bad' : urgent ? 'warn' : 'info', area: a.name, color: a.color,
        title: `${t?.title || r.line}${more ? ` · +${more} weitere` : ''}`, detail, busy: busy.has(a.id), open: d0(a.id),
        yes: extra ? [extra.label, (btn) => act(a.id, extra, btn)] : ['Erledigen', () => doNow(a.id, true)], no: ['Verwerfen', () => { hide(k); paintDec(); }] });
    }
    for (const al of alerts) {
      const k = `l|${al.id}|${al.at || ''}`; if (H[k]) continue;
      const g = TARGET[al.target] || null, [cls] = SEV_L[al.severity] || SEV_L.info;
      const yes = al.action?.kind === 'ack_security' && al.action.kindKey
        ? ['Erledigt', async () => { const x = await api('/api/admin/sec', { method: 'POST', body: JSON.stringify({ action: 'ack', kind: al.action.kindKey }) }); if (!x.ok) { msg(x.data?.error || 'Nicht möglich.', true); paintDec(); return; } msg('Erledigt.'); loadOverview(); work(['sicherheit'], true); }]
        : g ? ['Öffnen', () => goTab(g[0], g[1] || 'system')] : null;
      out.push({ k, grp: cls === 'info' ? 'today' : 'now', sev: cls, area: 'Lage', title: al.title, detail: al.detail, yes, no: ['Verwerfen', () => { hide(k); paintDec(); }] });
    }
    // Wichtigstes zuerst; dieselbe Lage aus mehreren Quellen wird zu einem Punkt (Quellen werden zusammen genannt).
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
  // Läuft gerade: arbeitende Agenten und freigegebene Lösungen in Umsetzung (nur Anzeige, keine Knöpfe).
  const activeItems = () => [
    ...[...busy].map((id) => AGENTS.find((x) => x.id === id)).filter(Boolean).map((a) => ({ t: `${a.name} arbeitet …`, s: a.role })),
    ...proposals.filter((p) => p.status === 'auftrag' || p.status === 'in_arbeit').map((p) => ({ wait: p.status === 'auftrag', t: p.title, s: p.status === 'in_arbeit' ? 'Wird gerade umgesetzt' : uBlock ? (uBlock.reason === 'guthaben' ? 'Freigegeben · wartet auf Anthropic-Guthaben' : 'Freigegeben · wartet') : 'Freigegeben · wartet auf Umsetzung' })),
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
      <strong>${esc(x.title)}</strong>${x.detail || x.open || x.doc ? `<details class="hq-more"><summary>Details</summary>${x.detail ? `<p>${rich(x.detail)}</p>` : ''}${x.open || x.doc ? `<div class="hq-more-a">${x.doc ? `<button type="button" class="hq-btn" data-doc="${esc(x.doc)}" data-f="pdf">PDF ansehen</button>` : ''}${x.open ? `<button type="button" class="hq-btn" data-o="${esc(x.open)}">${esc(String(x.area || 'Agent').split(' & ')[0])} öffnen</button>` : ''}</div>` : ''}</details>` : ''}
      <div class="ck-act">${x.yes ? `<button type="button" class="hq-btn hq-btn-p" data-y="${i}" ${x.busy ? 'disabled' : ''}>${x.busy ? 'Arbeitet …' : esc(x.yes[0])}</button>` : ''}${x.no ? `<button type="button" class="hq-btn" data-n="${i}">${esc(x.no[0])}</button>` : ''}</div></li>`;
    const list = (g) => `<ul class="ck-list">${it.map((x, i) => [x, i]).filter(([x]) => x.grp === g).map(([x, i]) => card(x, i)).join('')}</ul>`;
    const run = activeItems();
    // Umsetzung pausiert (z. B. Guthaben leer): klar sagen, warum freigegebene Aufträge warten – sie laufen danach von selbst.
    const nWait = proposals.filter((p) => p.status === 'auftrag' || p.status === 'in_arbeit').length;
    const blockHtml = uBlock && nWait ? `<div class="hq-block" role="alert"><strong>Umsetzung pausiert</strong><p>${uBlock.reason === 'guthaben' ? `Das Anthropic-Guthaben ist leer. ${nWait} freigegebene ${nWait === 1 ? 'Auftrag wartet' : 'Aufträge warten'} und ${nWait === 1 ? 'läuft' : 'laufen'} automatisch weiter, sobald Guthaben da ist (neuer Versuch alle 30 Minuten).` : esc(uBlock.text || 'Die Umsetzung ist gerade nicht möglich.')}</p>${uBlock.reason === 'guthaben' ? '<a class="hq-btn hq-btn-p" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Guthaben aufladen</a>' : ''}</div>` : '';
    box.innerHTML = blockHtml + (nNow ? `<h4 class="hq-g hq-g-now">Jetzt <span>${nNow}</span></h4>${list('now')}` : `<p class="hq-empty hq-ok">✓ Keine Aktion erforderlich.</p>`)
      + (nAp ? `<h4 class="hq-g hq-g-dec">Freigaben <span>${nAp}</span></h4>${list('approve')}` : '')
      + (nDay ? `<details class="hq-g-fold"${nNow || nAp ? '' : ' open'}><summary><h4 class="hq-g">Heute <span>${nDay}</span></h4><small>kann warten</small></summary>${list('today')}</details>` : '')
      + (run.length ? (() => {
        // Wartende Aufträge als eine Zeile zum Aufklappen statt langer Liste (der Grund steht im Hinweis oben).
        const li = (a) => `<li><i class="dot" aria-hidden="true"></i><b>${esc(a.t)}</b><small>${esc(a.s)}</small></li>`;
        const work = run.filter((a) => !a.wait), wait = run.filter((a) => a.wait);
        return `<h4 class="hq-g hq-g-run">Aktiv <span>${run.length}</span></h4>${work.length ? `<ul class="hq-actv">${work.map(li).join('')}</ul>` : ''}${wait.length ? `<details class="hq-g-fold hq-wait"><summary><b>${wait.length} freigegebene ${wait.length === 1 ? 'Auftrag wartet' : 'Aufträge warten'}</b><small>${esc(wait[0].s)}</small></summary><ul class="hq-actv">${wait.map(li).join('')}</ul></details>` : ''}`;
      })() : '');
    // Bestätigung ohne Pop-up: erstes Tippen zeigt, was passiert; erst das zweite Tippen (innerhalb von 5 Sek.) führt aus.
    box.querySelectorAll('[data-y]').forEach((b) => b.onclick = () => {
      const x = decFns[+b.dataset.y]; if (!x) return;
      if (x.confirm && !b.dataset.armed) {
        b.dataset.armed = '1'; b.classList.add('hq-arm'); b.textContent = 'Bestätigen'; b.setAttribute('aria-label', `${x.confirm}: ${x.title}. Zum Ausführen noch einmal tippen.`);
        msg(`${x.confirm}: „${x.title}“ – zum Bestätigen noch einmal tippen.`);
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
  // ---------- Lage oben: Status nur aus echten Daten; was nicht geprüft werden konnte, gilt nie als „stabil“ ----------
  let ov = null, ovFail = false, ovAt = 0, pullFail = 0;
  function paintStatus() {
    const hero = $('.hq-hero'); if (!hero) return;
    const it = decReady ? decFns : [], now = it.filter((x) => x.grp === 'now'), ap = it.filter((x) => x.grp === 'approve').length;
    const sy = ov?.systems || [], sysOk = sy.filter((s) => s.state === 'ok').length, sysBad = sy.some((s) => s.state === 'fail');
    let lvl, title, det;
    if (!ov) { lvl = ovFail ? 'unknown' : 'load'; title = ovFail ? 'Status momentan nicht verfügbar' : 'Lage wird geprüft …'; det = ovFail ? 'Die Systemprüfung hat nicht geantwortet – „Aktualisieren“ versucht es erneut.' : ''; }
    else if (ov.status?.level === 'critical' || sysBad || now.some((x) => x.sev === 'bad')) { lvl = 'critical'; title = 'Kritischer Vorgang'; det = now.find((x) => x.sev === 'bad')?.title || ov.status?.detail || 'Sofortige Aufmerksamkeit erforderlich.'; }
    else if (now.length || ov.status?.level === 'warn') { lvl = 'warn'; title = 'Aufmerksamkeit erforderlich'; det = now.length ? `${now.length} ${now.length === 1 ? 'Punkt braucht' : 'Punkte brauchen'} deine Prüfung.` : ov.status?.detail || ''; }
    else { lvl = 'ok'; title = 'Alles stabil'; det = ap ? `Nichts Dringendes · ${ap} ${ap === 1 ? 'Freigabe wartet' : 'Freigaben warten'} auf dich.` : 'Keine Entscheidung erforderlich.'; }
    hero.dataset.level = lvl; $('#hqStat').textContent = title; $('#hqDet').textContent = det;
    const bits = [];
    if (sy.length) bits.push(sysOk === sy.length ? `${sy.length} Systeme ohne Befund` : `${sysOk} von ${sy.length} Systemen ohne Befund`);
    if (decReady) { bits.push(now.length ? `${now.length} ${now.length === 1 ? 'braucht' : 'brauchen'} dich` : 'nichts Dringendes'); if (ap) bits.push(`${ap} ${ap === 1 ? 'Freigabe' : 'Freigaben'}`); }
    $('#hqBar').textContent = bits.join(' · ');
    paintAsof();
  }
  // „Live“ nur, solange die Daten frisch sind; sonst steht ehrlich da, wann zuletzt aktualisiert wurde.
  function paintAsof() {
    const el = $('#hqAsof'); if (!el) return;
    if (!ovAt) { el.textContent = ovFail ? 'Noch keine Daten geladen' : 'Wird geladen …'; return; }
    const s = Math.round((Date.now() - ovAt) / 1000), stale = ovFail || pullFail > 1 || s > 300;
    el.parentElement.classList.toggle('stale', stale);
    el.textContent = stale
      ? `Zuletzt aktualisiert ${new Date(ovAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr · Daten möglicherweise nicht aktuell`
      : `Live · ${s < 10 ? 'gerade aktualisiert' : s < 60 ? `vor ${s} Sek. aktualisiert` : `vor ${Math.round(s / 60)} Min. aktualisiert`}`;
  }
  // „Seit deinem letzten Besuch“: nur in diesem Browser gemerkt (Zeitpunkt + offene Punkte), nichts auf dem Server.
  const VISIT = 'leaserun_hq_visit';
  let sinceDone = false;
  function paintSince() {
    if (sinceDone || !ov || !decReady) return; sinceDone = true;
    let prev = null; try { prev = JSON.parse(localStorage.getItem(VISIT) || 'null'); } catch { prev = null; }
    const keys = decFns.filter((x) => x.grp !== 'today').map((x) => x.k), at = Date.now();
    if (prev?.at && Array.isArray(prev.keys)) {
      const ev = (ov.activity || []).filter((a) => Date.parse(a.at) > prev.at).length;
      const neu = keys.filter((k) => !prev.keys.includes(k)).length, weg = prev.keys.filter((k) => !keys.includes(k)).length;
      const parts = [ev && `+${ev} ${ev === 1 ? 'Ereignis' : 'Ereignisse'}`, neu && `+${neu} ${neu === 1 ? 'neuer Punkt' : 'neue Punkte'}`, weg && `${weg} erledigt`].filter(Boolean);
      const el = $('#hqSince'); el.hidden = false;
      el.textContent = `Seit deinem letzten Besuch (${ago(new Date(prev.at).toISOString())}): ${parts.length ? parts.join(' · ') : 'keine Veränderung'}`;
    }
    // Erst nach 10 Minuten als neuer Besuch zählen – ein schnelles „Aktualisieren“ löscht den Vergleich nicht.
    if (!prev?.at || at - prev.at > 10 * 60_000) { try { localStorage.setItem(VISIT, JSON.stringify({ at, keys })); } catch { /* privater Modus: ohne Vergleich weiter */ } }
  }
  const loadFix = async (fresh = false) => {
    const r = await api('/api/admin/fix' + (fresh ? '?fresh=1' : ''));
    if (!v.isConnected) return;
    findings = r.ok ? (r.data.findings || []).filter((x) => x.sev !== 'info' || x.auto) : findings;
    if (!r.ok) msg(r.data?.error || 'Prüfung nicht möglich.', true);
    decReady = true; paintDec();
  };
  $('#hqDecRun').onclick = async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = 'Prüft …'; await loadFix(true); b.disabled = false; b.textContent = 'Jetzt prüfen'; };
  // „Alles erledigen“: alle automatisch behebbaren Prüfpunkte + eine Runde aller Agenten. Lösungen (Code) bleiben deine Einzelentscheidung.
  $('#hqDecAll').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = 'Wird erledigt …';
    if (findings.some((f) => f.auto)) await fixF({ all: true });
    for (const a of AGENTS) { const r = shift[a.id]; if (r && r.status !== 'ok' && a.id !== 'freigaben' && !(r.actions || []).some((x) => x.id === 'remind')) await doNow(a.id, true); }
    b.disabled = false; b.textContent = 'Alles erledigen';
  };
  loadFix();

  $('#hqAll').onclick = () => work(AGENTS.map((a) => a.id), true);
  // ---------- Firmen-OS: eine Leiste für alles – Apps, Agenten (mit Chat & Dokumenten), Daten; Enter ohne Auswahl = Auftrag ----------
  const APPS = [['postfach', 'Postfach'], ['termine', 'Termine'], ['cockpit', 'Finanzen', 'b2b'], ['rechnungen', 'Rechnungen', 'b2b'], ['nutzer', 'Kunden'], ['partner', 'Unternehmen', 'b2b'], ['akquise', 'Akquise', 'b2b'], ['anfragen', 'Anfragen'], ['creator', 'Creator'], ['kennzahlen', 'Kennzahlen'], ['analyse', 'Analyse'], ['sicherheit', 'Sicherheit'], ['system', 'System & Dateien'], ['einrichtung', 'Einrichtung'], ['steuer', 'Steuer & Belege'], ['protokoll', 'Protokoll'], ['vorschlaege', 'Vorschläge'], ['probleme', 'Technische Probleme'], ['api', 'API']];
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
      ...AGENTS.filter((a) => norm(`${a.name} ${a.last} ${a.role}`).includes(q)).slice(0, 4).map((a) => ({ kind: 'Agent', title: `${a.name} · ${a.role}`, sub: 'Chat, Lösungen, Dokumente', agent: a.id })),
      ...APPS.filter((a) => norm(a[1]).includes(q)).slice(0, 4).map((a) => ({ kind: 'App', title: a[1], tab: a[0], sg: a[2] })),
      ...(/^(entsch|offen|freig)/.test(q) ? [{ kind: 'Start', title: 'Entscheidungen', dec: true }] : []),
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
  // Tastenkürzel wie im Betriebssystem: Strg/⌘ + K springt in die Leiste.
  if (!window.__hqKey) { window.__hqKey = true; document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { const i = document.querySelector('#hqQ input'); if (i) { e.preventDefault(); i.focus(); i.select(); } } }); }
  // Zentrale Frage an LeaseRun Intelligence: wird automatisch an den passenden Agenten gegeben.
  $('#hqQ').onsubmit = async (e) => {
    e.preventDefault(); const q = e.target.q.value.trim(); if (!q) return; osClose(); clearTimeout(osT); osSeq++;
    const box = $('#hqQA'), b = e.target.querySelector('button'); box.hidden = false; box.innerHTML = '<p class="hq-msg">Einen Moment …</p>'; b.disabled = true;
    const r = await api('/api/admin/hq', { method: 'POST', body: JSON.stringify({ agent: 'zentrale', command: q }) });
    b.disabled = false; if (r.ok && r.data.ai) refreshAi();
    const acts = r.ok ? (r.data.actions || []).filter((x) => x.tab) : [];
    box.innerHTML = `<p class="hq-msg">${rich(r.ok ? r.data.reply : r.data?.error || 'Das hat nicht geklappt.')}</p>${acts.length ? `<div class="hq-sh-a">${acts.map((x, i) => `<button type="button" class="hq-btn" data-qa="${i}">${esc(x.label)}</button>`).join('')}</div>` : ''}`;
    box.querySelectorAll('[data-qa]').forEach((el) => el.onclick = () => goTab(acts[+el.dataset.qa].tab, acts[+el.dataset.qa].sg));
  };
  // Sofort da: Die Wache (Server, rund um die Uhr) hält den Stand aktuell – beim Öffnen wird nur gelesen, nicht gearbeitet.
  // Nur wenn die Wache länger als 15 Minuten nicht lief (z. B. noch nicht eingerichtet), arbeitet der Browser einmal selbst.
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
  // Jede Minute nur den Stand lesen (kostet nichts); selbst arbeiten nur, wenn die Wache ausfällt.
  // Lagebild (Systeme, Hinweise, Verlauf) alle 2 Minuten, nur bei sichtbarer Seite; nach einem Fehler eine Runde Pause.
  let tick = 0, ovSkip = false;
  const timer = v.__hqTimer = setInterval(() => {
    if (!v.isConnected || my !== seq) { clearInterval(timer); return; } if (document.hidden) return;
    pull().then(() => { if (!busy.size && Date.now() - lastAt() > STALE_MS) work(); });
    if (++tick % 2 === 0) { if (ovSkip) ovSkip = false; else loadOverview().then(() => { ovSkip = ovFail; }); }
  }, 60_000);
  // Zurück auf die Seite nach längerer Pause: sofort frisch laden statt alte Werte als „Live“ zu zeigen.
  const onVis = () => { if (!v.isConnected || my !== seq) { document.removeEventListener('visibilitychange', onVis); return; } if (!document.hidden && Date.now() - ovAt > 120_000) { pull(); loadOverview(); } };
  document.addEventListener('visibilitychange', onVis);

  $('#hqRef').onclick = () => hq(v, { goTab, msg });

  // Umsatz heute: je Bereich getrennt abgefragt und getrennt beschriftet (keine gemischte Summe).
  const rev = (scope) => api('/api/admin/finance?zeitraum=heute&von=&bis=', { headers: { 'x-admin-scope': scope } });
  Promise.all([rev('b2c'), rev('b2b')]).then(([c, b]) => {
    if (my !== seq) return;
    const chip = (l, r, f, sg) => `<button type="button" class="hq-chip" data-go="cockpit" data-sg="${sg}"><small>${l}</small><strong>${r.ok ? eur(f(r.data)) : '–'}</strong>${r.ok ? `<span>${f === gross ? `${r.data.revenue?.count ?? 0} Zahlungen` : `${r.data.revenue?.count ?? 0} Rechnungen`}</span>` : `<span>${esc(r.data?.error || 'nicht verfügbar')}</span>`}</button>`;
    const gross = (d) => d.revenue?.gross ?? null, net = (d) => d.revenue?.net ?? null;
    $('#hqRev').innerHTML = chip('Umsatz heute · Privat (brutto)', c, gross, 'b2c') + chip('Umsatz heute · Unternehmen (netto)', b, net, 'b2b');
    $('#hqRev').querySelectorAll('[data-go]').forEach((x) => x.onclick = () => goTab(x.dataset.go, x.dataset.sg));
  });

  // Lagebild, Kennzahlen, Entscheidungen, Systeme und Aktivität – wird nach jedem „Erledigen“ sofort neu geladen.
  const loadOverview = async () => {
  const r = await api('/api/admin/app/overview');
  if (my !== seq || !v.isConnected) return;
  if (!r.ok) {
    // Alte Daten bleiben stehen, sind aber als „möglicherweise nicht aktuell“ markiert; ohne Daten: „nicht verfügbar“ – nie „stabil“.
    ovFail = true; paintStatus();
    if (!ov) {
      const err = `<p class="hq-empty">Systemstatus konnte momentan nicht geladen werden. <button type="button" class="hq-btn" data-retry>Erneut versuchen</button></p>`;
      ['#hqSys', '#hqAct'].forEach((s) => { $(s).innerHTML = err; });
      $('#hqKpi').innerHTML = ''; $('#hqSysSum').textContent = 'nicht verfügbar';
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
    const inner = `<small>${esc(m.label)}</small><strong>${Number(m.value).toLocaleString('de-DE')}</strong>`;
    return g ? `<button type="button" class="hq-kpi t-${esc(m.tone)}" data-go="${g[0]}" data-sg="${g[1] || 'system'}">${inner}<i>${ic(I_GO, 14)}</i></button>` : `<div class="hq-kpi t-${esc(m.tone)}">${inner}</div>`;
  }).join('') || '<p class="hq-empty">Keine Kennzahlen für Ihre Rolle.</p>';

  alerts = (d.alerts || []).filter((x) => x.attention && !IN_CHECK.has(x.id)); paintDec();

  { const sy = d.systems || [], bad = sy.filter((x) => x.state !== 'ok').length; $('#hqSysSum').textContent = sy.length ? (bad ? `${bad} von ${sy.length} mit Hinweis` : `alle ${sy.length} in Ordnung`) : 'keine Daten'; if (bad) $('#hqSys').closest('details').open = true; }
  $('#hqSys').innerHTML = (d.systems || []).length ? `<ul class="hq-sys">${d.systems.map((s) => { const [cls, lab] = SYS_L[s.state] || SYS_L.off; return `<li><span class="hq-st ${cls}">${lab}</span><strong>${esc(s.label)}</strong><span>${esc(s.info)}${s.ms != null ? ` · ${s.ms} ms` : ''}</span></li>`; }).join('')}</ul>${d.deploy ? `<p class="hq-sub">Umgebung ${esc(d.deploy.env)}${d.deploy.commit ? ` · Version ${esc(String(d.deploy.commit).slice(0, 7))}` : ''}${d.deploy.region ? ` · ${esc(d.deploy.region)}` : ''}</p>` : ''}` : '<p class="hq-empty">Keine Systemdaten für Ihre Rolle.</p>';

  $('#hqAct').innerHTML = (d.activity || []).length ? `<ul class="hq-act">${d.activity.slice(0, 12).map((a) => { const g = goT(a.target); return `<li>${g ? `<button type="button" data-go="${g[0]}" data-sg="${g[1] || 'system'}">` : '<div>'}<strong>${esc(a.title)}</strong>${a.detail ? `<span>${esc(a.detail)}</span>` : ''}<time datetime="${esc(a.at)}" title="${esc(dtt(a.at))}">${esc(ago(a.at))}</time>${g ? '</button>' : '</div>'}</li>`; }).join('')}</ul>` : '<p class="hq-empty">Noch keine Aktivität.</p>';

  { const n = (d.activity || []).length, last = d.activity?.[0]?.at; $('#hqActSum').textContent = n ? `${n} Ereignisse · zuletzt ${ago(last)}` : 'noch nichts'; }
  // Jede Kachel öffnet sofort den passenden Bereich; „Fehler / Warnungen“ springt zu „Jetzt wichtig“ in dieser Ansicht.
  v.querySelectorAll('#hqKpi [data-go], #hqAct [data-go]').forEach((b) => b.onclick = () => (b.dataset.go === 'jetzt' ? $('#hqDec').closest('section').scrollIntoView({ behavior: 'smooth', block: 'start' }) : goTab(b.dataset.go, b.dataset.sg)));
  };
  await loadOverview();
}
