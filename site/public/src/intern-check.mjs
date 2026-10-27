// Headquarters: "Check & fix" – the only check point in the Web-Admin (security, email, tech, operations).
// Checks automatically when opened. Auto-fixable findings: one button per finding plus "Fix all".
// Everything else with a short how-to. Details and logs stay collapsed below.
import { api, esc } from './sess.mjs?v=892f3666';

const SEV = { critical: ['bad', 'Critical'], warning: ['warn', 'Warning'], info: ['info', 'Note'] };
const stamp = (t) => new Date(t).toLocaleString('en-US', { timeZone: 'Europe/Berlin', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function checkPanel(host, { goTab, msg }) {
  host.innerHTML = `<section class="ck-panel" aria-labelledby="ckT"><div class="ck-head"><div><h2 id="ckT">Check &amp; fix</h2><p class="ck-sub" id="ckSub">Checking …</p></div>
    <div class="ck-btns"><button type="button" class="btn btn-outline" id="ckRun">Check now</button><button type="button" class="btn btn-dark" id="ckAll" hidden>Fix all</button></div></div>
    <div id="ckRes" aria-live="polite"><div class="ck-sk"></div></div><div id="ckDone" aria-live="polite"></div></section>`;
  const $ = (s) => host.querySelector(s);
  // Per item only: what's wrong (one sentence) + Do it / Dismiss. What only the owner can do outside is one sentence.
  const item = (x) => { const [c, l] = SEV[x.sev] || SEV.info; return `<li class="ck-it s-${c}">
      <div class="ck-top"><span class="hq-st ${c}">${l}</span><span class="ck-area">${esc(x.area)}</span></div>
      <strong>${esc(x.title)}</strong>
      ${!x.auto && x.how ? `<p class="ck-how">${esc(x.how)}</p>` : ''}
      <div class="ck-act">${x.auto ? `<button type="button" class="btn btn-dark btn-sm" data-fix="${esc(x.id)}">Do it</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-dis="${esc(x.id)}">${x.auto ? 'Dismiss' : 'Hide'}</button></div></li>`; };
  const paint = (d) => {
    const f = d.findings || [], auto = f.filter((x) => x.auto);
    // Important items open, plain notes collapsed – the page stays short.
    const main = f.filter((x) => x.sev !== 'info' || x.auto);
    $('#ckSub').textContent = `As of today, ${stamp(d.checkedAt || Date.now())} · ${main.length ? `${main.length} ${main.length === 1 ? 'item is' : 'items are'} waiting for you` : 'nothing to decide'}`;
    const all = $('#ckAll'); all.hidden = auto.length < 2; all.textContent = `Fix all (${auto.length})`;
    $('#ckRes').innerHTML = main.length ? `<ul class="ck-list">${main.map(item).join('')}</ul>` : '<p class="ck-ok">✓ All good – nothing to decide.</p>';
    $('#ckRes').querySelectorAll('[data-fix]').forEach((b) => b.onclick = () => fix({ ids: [b.dataset.fix] }, b));
    $('#ckRes').querySelectorAll('[data-dis]').forEach((b) => b.onclick = () => fix({ dismiss: b.dataset.dis }, b));
  };
  const run = async (fresh = false) => {
    $('#ckRun').disabled = true; $('#ckRun').textContent = 'Checking …'; $('#ckRes').innerHTML = '<div class="ck-sk"></div>';
    const r = await api('/api/admin/fix' + (fresh ? '?fresh=1' : ''));
    $('#ckRun').disabled = false; $('#ckRun').textContent = 'Check now';
    if (!host.isConnected) return;
    if (!r.ok) { $('#ckRes').innerHTML = `<p class="form-note">${esc(r.data?.error || 'Check not possible.')}</p>`; $('#ckSub').textContent = 'Check failed – please tap "Check now" again.'; return; }
    paint(r.data);
  };
  const fix = async (body, btn) => {
    const buttons = host.querySelectorAll('button'); buttons.forEach((b) => { b.disabled = true; });
    if (btn) btn.textContent = body.dismiss ? 'Hiding …' : 'Working on it …';
    const r = await api('/api/admin/fix', { method: 'POST', body: JSON.stringify(body) });
    buttons.forEach((b) => { b.disabled = false; });
    if (!r.ok) { msg(r.data?.error || "Couldn't be done.", true); run(); return; }
    const res = r.data.results || [];
    paint(r.data);
    const bad = res.filter((x) => !x.ok);
    msg(body.dismiss ? 'Hidden (7 days).' : bad.length ? bad.map((x) => x.text).join(' · ') : 'Done.', bad.length > 0);
    host.dispatchEvent(new CustomEvent('ck-fixed', { bubbles: true }));
  };
  $('#ckRun').onclick = () => run(true);
  $('#ckAll').onclick = () => fix({ all: true }, $('#ckAll'));
  run();
  return { run };
}
