// LeaseRun Card – Kartenkonto. Echte Daten nur vom Server (/api/karten); Aktionen werden serverseitig geprüft.
// Demo nur mit ?demo=1 – deutlich gekennzeichnet, rein im Browser, ohne Serverzugriff.
import { api, session } from './sess.mjs?v=892f3666';
import { eur, tilt } from './karten.mjs?v=892f3666';

const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DEMO = new URLSearchParams(location.search).get('demo') === '1';
const dt = (s) => new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const DESIGN = { 'classic-black': 'Classic Black', platinum: 'Platinum Metallic', 'minimal-white': 'Minimalist White' };
const ST = { ACTIVE: ['ok', 'Aktiv'], PENDING: ['warn', 'In Prüfung'], FROZEN: ['bad', 'Gesperrt'], BLOCKED: ['bad', 'Dauerhaft gesperrt'] };
const TX = { AUTHORIZED: ['warn', 'Vorgemerkt'], SETTLED: ['ok', 'Abgeschlossen'], RELEASED: ['', 'Verfallen'], REFUNDED: ['ok', 'Erstattet'], DECLINED_LIMIT_EXCEEDED: ['bad', 'Abgelehnt · Limit'], DECLINED_CARD_FROZEN: ['bad', 'Abgelehnt · gesperrt'], DECLINED_CARD_INACTIVE: ['bad', 'Abgelehnt'] };
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  uebersicht: I('<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  karte: I('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19"/>'),
  zahlungen: I('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  limit: I('<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>'),
  abrechnung: I('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  dokumente: I('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>'),
  vorteile: I('<path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z"/>'),
  einstellungen: I('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'),
  mehr: I('<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'),
};
const SIDE = [['uebersicht', 'Übersicht'], ['karte', 'Karten'], ['zahlungen', 'Zahlungen'], ['limit', 'Limits'], ['abrechnung', 'Abrechnung'], ['dokumente', 'Dokumente'], ['vorteile', 'Vorteile'], ['einstellungen', 'Einstellungen']];
const BOTTOM = [['uebersicht', 'Übersicht'], ['karte', 'Karte'], ['zahlungen', 'Zahlungen'], ['limit', 'Limit'], ['mehr', 'Mehr']];

// Gleiche Regeln wie lib/cards/limits.ts (Anzeige; maßgeblich ist der Server).
const avail = (l) => Math.max(0, l.monthly - l.settled - l.reserved + (l.refundsRelease !== false ? l.refunded : 0));
function nextResetIso() { const now = new Date(), p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit' }).formatToParts(now); const y = +p.find((x) => x.type === 'year').value, m = +p.find((x) => x.type === 'month').value; return new Date(Date.UTC(m === 12 ? y + 1 : y, m % 12, 1, 12)).toISOString(); }

let S = { mode: 'loading', program: 'COMING_SOON', cards: [], tx: [], benefit: null, cur: 0 };

function demoState() {
  const d = (n) => new Date(Date.now() - n * 864e5).toISOString();
  const limit = { monthly: 75000, settled: 39800, reserved: 2200, refunded: 0, deposit: 100000, resetAt: nextResetIso() };
  return {
    mode: 'demo', program: 'DEMO', cur: 0, benefit: { eligible: false, discount_percent: 20, reason: 'In der Demo wird kein Vorteil angewendet.' },
    cards: [{ id: 'demo-1', type: 'charge', design: 'classic-black', status: 'ACTIVE', last4: '4821', isDemo: true, limit: { ...limit, available: avail(limit) } }],
    tx: [
      { id: 't1', merchant: 'Lebensmittelmarkt', category: 'Lebensmittel', amount_cents: 2200, status: 'AUTHORIZED', created_at: d(0), available_before_cents: 35200, available_after_cents: 33000 },
      { id: 't2', merchant: 'Online-Händler', category: 'Einkauf', amount_cents: 8420, status: 'SETTLED', created_at: d(1), available_before_cents: 43620, available_after_cents: 35200 },
      { id: 't3', merchant: 'Tankstelle', category: 'Mobilität', amount_cents: 6100, status: 'SETTLED', created_at: d(3), available_before_cents: 49720, available_after_cents: 43620 },
      { id: 't4', merchant: 'Elektronikmarkt', category: 'Einkauf', amount_cents: 52000, status: 'DECLINED_LIMIT_EXCEEDED', created_at: d(4), available_before_cents: 49720, available_after_cents: 49720 },
      { id: 't5', merchant: 'Baumarkt', category: 'Haus & Garten', amount_cents: 25280, status: 'SETTLED', created_at: d(6), available_before_cents: 75000, available_after_cents: 49720 },
    ],
  };
}

const card = () => S.cards[S.cur] || null;
const isDemo = () => S.mode === 'demo';
function cardVisual(c) {
  const label = c.type === 'charge' ? 'Charge' : c.type === 'business' ? 'Business' : 'Debit';
  return `<div class="k-stage"><div class="k-card ${esc(c.design)}${c.status === 'FROZEN' ? ' frozen' : ''}" data-tilt role="img" aria-label="LeaseRun ${label} Card, ${DESIGN[c.design] || ''}, endet auf ${esc(c.last4 || '––––')}"><div class="k-c-top"><span class="k-c-brand">LeaseRun <b>Card</b></span><span class="k-c-type">${label}</span></div>${c.isDemo ? '<span class="k-c-demo">DEMO</span>' : ''}<span class="k-chipcard" aria-hidden="true"></span><div><div class="k-c-num">•••• •••• •••• ${esc(c.last4 || '––––')}</div><div class="k-c-foot"><span>${c.status === 'FROZEN' ? 'Gesperrt' : 'Karteninhaber'}</span><span>${DESIGN[c.design] || ''}</span></div></div></div></div>`;
}
const chip = ([k, l]) => `<span class="k-chip ${k}">${l}</span>`;
function limitPanel(c, withCta = true) {
  const l = c.limit;
  if (!l) return '<div class="k-panel"><h3>Monatliches Limit</h3><p>Für diese Karte ist noch kein Limit eingerichtet.</p></div>';
  const used = l.monthly - l.available, share = l.monthly ? Math.min(100, Math.round((used / l.monthly) * 100)) : 100;
  return `<div class="k-panel"><div class="k-kv"><small>Monatliches Limit</small><strong>${eur(l.monthly)}</strong></div>
    <div class="k-limit-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${share}" aria-label="Limit zu ${share} % verbraucht"><span style="width:${share}%"></span></div>
    <div class="k-limit-rows"><div><small>Verbraucht</small><b>${eur(used)}</b></div><div><small>Verfügbar</small><b>${eur(l.available)}</b></div><div><small>Reset</small><b>${dt(l.resetAt)}</b></div></div>
    ${l.reserved ? `<p class="k-note">Davon vorgemerkt: ${eur(l.reserved)}</p>` : ''}
    ${withCta ? '<p style="margin:14px 0 0"><a class="k-btn ghost" href="#limit">Limit ändern</a></p>' : ''}</div>`;
}
function txList(list, limit = 99) {
  if (!list.length) return '<div class="k-empty"><strong>Noch keine Zahlungen</strong><span>Sobald Ihre Karte verwendet wird, werden Ihre Transaktionen hier angezeigt.</span></div>';
  return `<ul class="k-tx">${list.slice(0, limit).map((t) => { const s = TX[t.status] || ['', t.status], neg = t.kind !== 'refund' && !String(t.status).startsWith('DECLINED'); return `<li><span class="ic" aria-hidden="true">${esc((t.merchant || '?').slice(0, 1))}</span><button type="button" data-tx="${esc(t.id)}" style="all:unset;cursor:pointer;min-width:0"><strong>${esc(t.merchant || 'Zahlung')}</strong><small>${dt(t.created_at)} · ${esc(t.category || '–')}</small></button><span class="amt">${t.kind === 'refund' ? '+' : neg ? '−' : ''}${eur(t.amount_cents)}<small>${chip(s)}</small></span></li>`; }).join('')}</ul>`;
}

function emptyAccount() {
  return `<div class="k-page-h"><h1>Mein Kartenkonto</h1></div>
  <div class="k-dash"><div class="c8"><div class="k-empty"><strong>Noch keine LeaseRun Card</strong><span>Die LeaseRun Card ist in Vorbereitung. Sobald ein zugelassener Kartenpartner angeschlossen ist, können Sie hier Ihre Karte beantragen und verwalten.</span><a class="k-btn ghost" href="/card">Mehr zur LeaseRun Card</a></div></div>
  <div class="c4"><div class="k-panel"><h3>Status</h3><div class="k-rows"><div><span>Kartenausgabe</span>${chip(['warn', 'In Vorbereitung'])}</div><div><span>Identitätsprüfung</span>${chip(['', 'Nicht eingerichtet'])}</div><div><span>SEPA</span>${chip(['', 'Nicht eingerichtet'])}</div></div><p class="k-note"><a href="?demo=1">Demo-Ansicht ansehen</a> – mit Beispieldaten, klar gekennzeichnet.</p></div></div></div>`;
}

const VIEWS = {
  uebersicht() {
    const c = card(); if (!c) return emptyAccount();
    const l = c.limit, st = ST[c.status] || ['', c.status];
    return `<div class="k-page-h"><h1>Übersicht</h1>${chip(st)}</div>
    <div class="k-dash">
      <div class="c4"><div class="k-panel"><div class="k-kv"><small>${c.type === 'charge' ? 'Verfügbar diesen Monat' : 'Verfügbares Guthaben'}</small><strong>${l ? eur(l.available) : '–'}</strong><span>${l ? `von ${eur(l.monthly)} · Reset ${dt(l.resetAt)}` : 'Kein Limit eingerichtet'}</span></div></div></div>
      <div class="c4"><div class="k-panel"><div class="k-kv"><small>Ausgegeben diesen Monat</small><strong>${l ? eur(l.settled + l.reserved) : '–'}</strong><span>${l && l.reserved ? `davon vorgemerkt ${eur(l.reserved)}` : 'alle Zahlungen abgeschlossen'}</span></div></div></div>
      <div class="c4"><div class="k-panel"><div class="k-kv"><small>Karte</small><strong style="font-size:22px">•••• ${esc(c.last4 || '––––')}</strong><span>${st[1]} · ${c.type === 'charge' ? 'Charge' : c.type === 'business' ? 'Firmenkarte' : 'Debit'}</span></div><p style="margin:12px 0 0"><a class="k-btn ghost" href="#karte">Karte verwalten</a></p></div></div>
      <div class="c8"><div class="k-panel"><h3>Letzte Zahlungen</h3>${txList(S.tx, 5)}<p style="margin:10px 0 0"><a href="#zahlungen">Alle Zahlungen</a></p></div></div>
      <div class="c4" style="display:grid;gap:16px">${limitPanel(c)}${stmtPanel(c, true)}${benefitPanel(true)}</div>
    </div>`;
  },
  karte() {
    const c = card(); if (!c) return emptyAccount();
    const frozen = c.status === 'FROZEN';
    return `<div class="k-page-h"><h1>Meine Karten</h1>${chip(ST[c.status] || ['', c.status])}</div>
    <div class="k-dash"><div class="c6">${cardVisual(c)}</div>
    <div class="c6"><div class="k-panel"><h3>Kartendetails</h3><div class="k-rows"><div><span>Kartennummer</span><b class="k-mask">•••• ${esc(c.last4 || '––––')}</b></div><div><span>Typ</span><b>${c.type === 'charge' ? 'Charge' : c.type === 'business' ? 'Firmenkarte' : 'Debit'}</b></div><div><span>Design</span><b>${DESIGN[c.design] || '–'}</b></div></div>
      <button class="k-btn ghost" type="button" id="kDetails" style="margin-top:12px">Details anzeigen</button><p class="k-msg" id="kDetMsg" role="status"></p>
      <div class="k-toggle"><span><strong>Karte sperren</strong><br><small style="color:var(--k-text2)">${frozen ? 'Die Karte ist gesperrt. Neue Zahlungen werden abgelehnt.' : 'Vorübergehend sperren, z. B. wenn Sie die Karte verlegt haben.'}</small></span><button type="button" class="k-switch" role="switch" aria-checked="${frozen}" aria-label="Karte sperren" id="kFreeze"${c.status === 'BLOCKED' ? ' disabled' : ''}></button></div>
      <p class="k-msg" id="kFrMsg" role="status" aria-live="polite"></p></div></div></div>`;
  },
  zahlungen() {
    const c = card(); if (!c) return emptyAccount();
    return `<div class="k-page-h"><h1>Zahlungen</h1></div><div class="k-panel">
      <div class="k-filters"><label class="k-field">Status<select id="fSt"><option value="">Alle</option><option value="AUTHORIZED">Vorgemerkt</option><option value="SETTLED">Abgeschlossen</option><option value="REFUNDED">Erstattet</option><option value="DECLINED">Abgelehnt</option></select></label>
      <label class="k-field">Zeitraum<select id="fZr"><option value="">Alle</option><option value="7">Letzte 7 Tage</option><option value="30">Letzte 30 Tage</option></select></label>
      <label class="k-field">Kategorie<select id="fKat"><option value="">Alle</option>${[...new Set(S.tx.map((t) => t.category).filter(Boolean))].map((k) => `<option>${esc(k)}</option>`).join('')}</select></label>
      <label class="k-field">Ab Betrag (€)<input id="fMin" inputmode="decimal" placeholder="0"></label></div>
      <div id="txOut">${txList(S.tx)}</div></div>`;
  },
  limit() {
    const c = card(); if (!c) return emptyAccount();
    if (c.type === 'business') return `<div class="k-page-h"><h1>Limit</h1></div><div class="k-dash"><div class="c6">${limitPanel(c, false)}</div><div class="c6"><div class="k-panel"><h3>Limit ändern</h3><p>Das Monatslimit Ihrer Firmenkarte legt Ihr Unternehmen fest.</p></div></div></div>`;
    const l = c.limit;
    const steps = [50000, 75000, 100000];
    return `<div class="k-page-h"><h1>Limit</h1></div><div class="k-dash"><div class="c6">${limitPanel(c, false)}</div>
    <div class="c6"><div class="k-panel"><h3>Limit ändern</h3>
      <div class="k-rows"><div><span>Aktuelles Limit</span><b>${l ? eur(l.monthly) : '–'}</b></div>${c.type === 'charge' ? `<div><span>Sicherheitskaution</span><b>${l ? eur(l.deposit) : '–'}</b></div><div><span>Maximal zulässig</span><b>${l ? eur(l.deposit) : '–'}</b></div>` : ''}</div>
      <div class="k-steps-row" role="group" aria-label="Neues Limit">${steps.map((s) => `<button type="button" data-lim="${s}" aria-pressed="${l && l.monthly === s}"${c.type === 'charge' && l && s > l.deposit ? ' disabled' : ''}>${eur(s).replace(',00', '')}</button>`).join('')}</div>
      <label class="k-field">Benutzerdefiniert (€)<input id="limCustom" inputmode="decimal" placeholder="z. B. 600"></label>
      <button class="k-btn" type="button" id="limSave" style="margin-top:12px">Änderung bestätigen</button>
      <p class="k-msg" id="limMsg" role="status" aria-live="polite"></p>
      <p class="k-note">Das Limit wird auf dem Server erneut geprüft. ${c.type === 'charge' ? 'Bei der Charge Card ist es höchstens so hoch wie die Sicherheitskaution.' : ''}</p></div></div></div>`;
  },
  abrechnung() {
    const c = card(); if (!c) return emptyAccount();
    return `<div class="k-page-h"><h1>Abrechnung</h1></div><div class="k-dash"><div class="c6">${stmtPanel(c, false)}</div>
      <div class="c6"><div class="k-panel"><h3>Abrechnung als PDF</h3><p>Die monatliche Abrechnung mit allen Zahlungen, Erstattungen, Entgelten, Abbuchungsdatum, Dokument-ID und Version wird als PDF bereitgestellt, sobald das Kartenkonto aktiv ist.</p><p style="margin-top:12px">${chip(['', 'Bereit zur Anbindung'])}</p></div></div></div>`;
  },
  dokumente() {
    return `<div class="k-page-h"><h1>Dokumente</h1></div><div class="k-panel"><div class="k-rows">
      <div><span>Preis- und Leistungsverzeichnis (PDF)</span><a href="/card/preise.pdf" download>Herunterladen</a></div>
      <div><span>Preis- und Leistungsverzeichnis (Webseite)</span><a href="/card/pricing">Öffnen</a></div>
      <div><span>Datenschutzerklärung</span><a href="/privacy">Öffnen</a></div>
      <div><span>Nutzungsbedingungen</span><a href="/terms">Öffnen</a></div>
      <div><span>Kartenbedingungen des Herausgebers</span>${chip(['', 'Mit dem Start'])}</div></div></div>`;
  },
  vorteile() { return `<div class="k-page-h"><h1>Vorteile</h1></div><div class="k-dash"><div class="c6">${benefitPanel(false)}</div></div>`; },
  einstellungen() {
    return `<div class="k-page-h"><h1>Einstellungen</h1></div><div class="k-panel"><div class="k-rows">
      <div><span>Darstellung</span><span><select id="kTheme" class="k-field" style="min-height:40px;border-radius:10px;border:1px solid var(--k-border);background:var(--k-surface);color:var(--k-text);padding:0 10px"><option value="">Wie Gerät</option><option value="light">Hell</option><option value="dark">Dunkel</option></select></span></div>
      <div><span>Konto und Profil</span><a href="/app/dashboard#konto">Im LeaseRun-Konto</a></div>
      <div><span>Beschwerde oder Frage</span><a href="mailto:support@leaserun.com">support@leaserun.com</a></div></div></div>`;
  },
  mehr() {
    return `<div class="k-page-h"><h1>Mehr</h1></div><div class="k-panel"><nav class="k-rows" aria-label="Weitere Bereiche">${[['abrechnung', 'Abrechnung'], ['dokumente', 'Dokumente'], ['vorteile', 'Vorteile'], ['einstellungen', 'Einstellungen']].map(([k, l]) => `<div><a href="#${k}" style="display:flex;gap:10px;align-items:center;min-height:32px;color:var(--k-text);text-decoration:none">${IC[k].replace('<svg', '<svg width="20" height="20"')} ${l}</a><span aria-hidden="true">›</span></div>`).join('')}</nav></div>`;
  },
};

function stmtPanel(c, compact) {
  if (c.type === 'business') return compact ? '' : '<div class="k-panel"><h3>Monatsübersicht</h3><p>Firmenkarten zahlen aus dem Kartenguthaben Ihres Unternehmens. Die Abrechnung erhält Ihr Unternehmen.</p></div>';
  if (c.type !== 'charge') return compact ? '' : '<div class="k-panel"><h3>Monatsübersicht</h3><p>Bei der Debit Card werden Zahlungen direkt vom Guthaben abgezogen; eine gesammelte Abbuchung gibt es nicht.</p></div>';
  const settled = S.tx.filter((t) => t.status === 'SETTLED' && t.kind !== 'refund').reduce((s, t) => s + t.amount_cents, 0);
  const refunds = S.tx.filter((t) => t.kind === 'refund').reduce((s, t) => s + t.amount_cents, 0);
  const fees = 0, total = settled - refunds + fees;
  return `<div class="k-panel"><h3>Nächste Abrechnung</h3><div class="k-rows"><div><span>Abrechnungstag</span><b>${c.limit ? dt(c.limit.resetAt) : '–'}</b></div>${compact ? '' : `<div><span>Ausgaben</span><b>${eur(settled)}</b></div><div><span>Erstattungen</span><b>${eur(-refunds)}</b></div><div><span>Entgelte</span><b>${eur(fees)}</b></div>`}<div><span>Abbuchungsbetrag (bisher)</span><b>${eur(total)}</b></div></div>${compact ? '<p style="margin:10px 0 0"><a href="#abrechnung">Details</a></p>' : '<p class="k-note">Vorgemerkte Zahlungen sind erst nach Abschluss enthalten.</p>'}</div>`;
}
function benefitPanel(compact) {
  const b = S.benefit || { eligible: false, discount_percent: 20 };
  return `<div class="k-panel"><small class="k-kicker" style="font-size:11.5px">Ihr LeaseRun-Vorteil</small><div class="k-kv" style="margin-top:6px"><strong>${b.discount_percent} %</strong><span>auf qualifizierte digitale LeaseRun-Produkte</span></div><div class="k-rows" style="margin-top:8px"><div><span>Status</span>${b.eligible ? chip(['ok', 'Aktiv']) : chip(['', 'Nicht aktiv'])}</div></div>${!b.eligible && b.reason ? `<p class="k-note">${esc(b.reason)}</p>` : ''}${compact ? '<p style="margin:10px 0 0"><a href="#vorteile">Vorteile ansehen</a></p>' : '<p class="k-note">Gilt für Kreditmappe, Käufer-Pass und Investor Pro; nicht für Tarife für Unternehmen.</p>'}</div>`;
}

function nav(view) {
  $('#kSide').innerHTML = SIDE.map(([k, l]) => `<a href="#${k}"${k === view ? ' aria-current="page"' : ''}>${IC[k]}${l}</a>`).join('') + '<a href="/card" style="margin-top:14px">← LeaseRun Card</a>';
  const inMehr = ['abrechnung', 'dokumente', 'vorteile', 'einstellungen', 'mehr'].includes(view);
  $('#kBnav').innerHTML = BOTTOM.map(([k, l]) => `<a href="#${k}"${k === view || (k === 'mehr' && inMehr) ? ' aria-current="page"' : ''}>${IC[k]}<span>${l}</span></a>`).join('');
}

function render() {
  if (S.mode === 'login') {
    $('#kView').innerHTML = `<div class="k-empty" style="max-width:520px;margin:40px auto"><strong>Bitte melden Sie sich an</strong><span>Ihr Kartenkonto ist Teil Ihres LeaseRun-Kontos.</span><a class="k-btn" href="/auth/login">Anmelden</a><a href="?demo=1">Oder Demo-Ansicht ansehen</a></div>`;
    $('#kSide').innerHTML = ''; $('#kBnav').innerHTML = ''; return;
  }
  if (S.mode === 'error') {
    $('#kView').innerHTML = '<div class="k-empty"><strong>Die Daten konnten nicht geladen werden.</strong><span>Bitte prüfen Sie Ihre Verbindung.</span><button class="k-btn ghost" type="button" id="kRetry">Erneut versuchen</button></div>';
    $('#kRetry').onclick = () => load(); return;
  }
  let view = location.hash.slice(1) || 'uebersicht';
  if (!VIEWS[view]) view = 'uebersicht';
  nav(view);
  $('#kView').innerHTML = VIEWS[view]();
  bind(view);
  tilt($('#kView'));
}

const msgTo = (el, t, ok = false) => { if (el) { el.className = 'k-msg ' + (ok ? 'ok' : 'err'); el.textContent = t; } };
function bind(view) {
  const c = card();
  $('#kView').querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => txDetail(b.dataset.tx)));
  if (view === 'karte' && c) {
    $('#kDetails').onclick = () => msgTo($('#kDetMsg'), isDemo() ? 'Demo: Vollständige Kartendaten gibt es hier nicht.' : 'Vollständige Kartendaten zeigt nur der Kartenpartner nach erneuter Anmeldung an. LeaseRun speichert keine Kartennummern.');
    $('#kFreeze').onclick = async (e) => {
      const on = e.currentTarget.getAttribute('aria-checked') !== 'true';
      if (isDemo()) { c.status = on ? 'FROZEN' : 'ACTIVE'; render(); msgTo($('#kFrMsg'), `Demo: Karte ${on ? 'gesperrt' : 'entsperrt'} – keine echte Änderung.`, true); return; }
      e.currentTarget.disabled = true;
      const r = await api('/api/karten/sperre', { method: 'POST', body: JSON.stringify({ cardId: c.id, on }) });
      if (r.ok) { c.status = r.data.status || (on ? 'FROZEN' : 'ACTIVE'); render(); msgTo($('#kFrMsg'), on ? 'Ihre Karte ist gesperrt.' : 'Ihre Karte ist wieder aktiv.', true); }
      else { e.currentTarget.disabled = false; msgTo($('#kFrMsg'), r.data?.error || 'Die Änderung konnte momentan nicht übernommen werden. Bitte versuchen Sie es erneut.'); }
    };
  }
  if (view === 'zahlungen') {
    const apply = () => {
      const st = $('#fSt').value, zr = Number($('#fZr').value || 0), kat = $('#fKat').value, min = Math.round(Number(($('#fMin').value || '0').replace(/\./g, '').replace(',', '.')) * 100) || 0;
      const list = S.tx.filter((t) => (!st || (st === 'DECLINED' ? String(t.status).startsWith('DECLINED') : t.status === st)) && (!zr || Date.now() - new Date(t.created_at).getTime() <= zr * 864e5) && (!kat || t.category === kat) && t.amount_cents >= min);
      $('#txOut').innerHTML = list.length ? txList(list) : '<div class="k-empty"><strong>Keine Zahlungen in dieser Auswahl</strong><span>Passen Sie die Filter an.</span></div>';
      $('#txOut').querySelectorAll('[data-tx]').forEach((b) => b.addEventListener('click', () => txDetail(b.dataset.tx)));
    };
    ['#fSt', '#fZr', '#fKat', '#fMin'].forEach((s) => $(s).addEventListener('input', apply));
  }
  if (view === 'limit' && c) {
    let pick = null;
    $('#kView').querySelectorAll('[data-lim]').forEach((b) => b.addEventListener('click', () => { pick = Number(b.dataset.lim); $('#limCustom').value = ''; $('#kView').querySelectorAll('[data-lim]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }));
    $('#limCustom').addEventListener('input', () => { pick = null; $('#kView').querySelectorAll('[data-lim]').forEach((x) => x.setAttribute('aria-pressed', 'false')); });
    $('#limSave').onclick = async (e) => {
      const raw = $('#limCustom').value.trim();
      const val = raw ? Math.round(Number(raw.replace(/\./g, '').replace(',', '.')) * 100) : pick;
      if (!Number.isInteger(val) || val < 0) { msgTo($('#limMsg'), 'Bitte ein neues Limit wählen oder einen gültigen Betrag eingeben.'); return; }
      if (c.type === 'charge' && c.limit && val > c.limit.deposit) { msgTo($('#limMsg'), 'Das Monatslimit darf die hinterlegte Sicherheitskaution nicht übersteigen.'); return; }
      if (isDemo()) { c.limit.monthly = val; c.limit.available = avail(c.limit); render(); msgTo($('#limMsg'), `Demo: Limit auf ${eur(val)} gesetzt – keine echte Änderung.`, true); return; }
      e.currentTarget.disabled = true; e.currentTarget.textContent = 'Wird geprüft …';
      const r = await api('/api/karten/limit', { method: 'POST', body: JSON.stringify({ cardId: c.id, limitCents: val }) });
      e.currentTarget.disabled = false; e.currentTarget.textContent = 'Änderung bestätigen';
      if (r.ok) { await load(true); msgTo($('#limMsg'), `Ihr Limit beträgt jetzt ${eur(val)}.`, true); } else msgTo($('#limMsg'), r.data?.error || 'Die Änderung konnte momentan nicht übernommen werden. Bitte versuchen Sie es erneut.');
    };
  }
  if (view === 'einstellungen') {
    const sel = $('#kTheme'); try { sel.value = localStorage.getItem('lr-karten-theme') || ''; } catch { /* ohne Speicher */ }
    sel.onchange = () => { try { localStorage.setItem('lr-karten-theme', sel.value); } catch { /* ohne Speicher */ } applyTheme(); };
  }
}

function txDetail(id) {
  const t = S.tx.find((x) => x.id === id); if (!t) return;
  let d = document.getElementById('kTxDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'kTxDlg'; d.style.cssText = 'border:1px solid var(--k-border);border-radius:16px;background:var(--k-surface);color:var(--k-text);padding:0;width:min(440px,calc(100% - 24px))'; document.body.append(d); }
  const s = TX[t.status] || ['', t.status];
  d.innerHTML = `<div style="padding:20px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:start"><div><strong style="font-size:18px">${esc(t.merchant || 'Zahlung')}</strong><br><small style="color:var(--k-text2)">${dt(t.created_at)}</small></div><button type="button" class="k-btn ghost" data-x aria-label="Schließen" style="min-height:40px;padding:0 12px">Schließen</button></div>
    <p style="font-size:30px;font-weight:800;margin:14px 0">${t.kind === 'refund' ? '+' : String(t.status).startsWith('DECLINED') ? '' : '−'}${eur(t.amount_cents)}</p>
    <div class="k-rows"><div><span>Status</span>${chip(s)}</div><div><span>Kategorie</span><b>${esc(t.category || '–')}</b></div><div><span>Verfügbares Limit vorher</span><b>${eur(t.available_before_cents)}</b></div><div><span>Verfügbares Limit danach</span><b>${eur(t.available_after_cents)}</b></div><div><span>Autorisierungsreferenz</span><b class="k-mask">••••••••</b></div></div>
    ${isDemo() ? '<p class="k-note">Demo – keine echte Zahlung.</p>' : ''}</div>`;
  d.querySelector('[data-x]').onclick = () => d.close();
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); }, { once: true });
  d.showModal ? d.showModal() : d.setAttribute('open', '');
}

function applyTheme() { let v = ''; try { v = localStorage.getItem('lr-karten-theme') || ''; } catch { /* ohne Speicher */ } if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme; }

async function load(quiet = false) {
  if (DEMO) { S = demoState(); $('#kDemoBand').innerHTML = '<div class="k-demo-band" role="note">DEMO – Beispieldaten, keine echte Karte und keine echten Zahlungen. <a href="/card/account" style="color:inherit">Demo verlassen</a></div>'; render(); return; }
  if (!session()?.access_token) { S.mode = 'login'; render(); return; }
  if (!quiet) $('#kView').innerHTML = '<div class="k-dash"><div class="c4 k-skel"></div><div class="c4 k-skel"></div><div class="c4 k-skel"></div><div class="c12 k-skel" style="height:220px"></div></div>';
  const r = await api('/api/karten').catch(() => null);
  if (!r || !r.ok) { S.mode = r?.status === 401 ? 'login' : 'error'; render(); return; }
  S = { mode: 'live', program: r.data.program, cards: r.data.cards || [], tx: r.data.transactions || [], benefit: r.data.benefit, cur: 0 };
  render();
}

applyTheme();
addEventListener('hashchange', () => { render(); scrollTo({ top: 0, behavior: 'instant' }); });
load();
