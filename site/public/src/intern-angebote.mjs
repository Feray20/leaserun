// Web-Admin → Steuersoftware → Dropshipping → eBay-Angebote: Angebote prüfen und Verbesserungen per Klick übernehmen.
// Geprüft werden Titel, Fotos, Artikelmerkmale, Beschreibung, Preis/Nachfrage und Versand. Es wird nichts erfunden;
// Änderungen gehen erst nach „Übernehmen“ an eBay.
import { api, esc, eur } from './sess.mjs?v=892f3666';

const L = '/api/admin/tax/listings';
// Werbegebühr (Basic Ads), je Gerät gemerkt; Standard 3 %.
const adsPct = () => { try { const x = Number(localStorage.getItem('lr-ag-ads')); return Number.isFinite(x) && localStorage.getItem('lr-ag-ads') !== null ? x : 3; } catch { return 3; } };
const $ = (s, el = document) => el.querySelector(s);
const LV = { fehler: 'Fehler', warnung: 'Verbessern', tipp: 'Tipp' };
const AREA = { titel: 'Titel', bilder: 'Fotos', merkmale: 'Merkmale', beschreibung: 'Beschreibung', preis: 'Preis', versand: 'Versand' };

const card = (it) => `<article class="ag-item" data-item="${it.itemId}">
      <div class="ag-head">${it.image ? `<img src="${esc(it.image)}" alt="" width="64" height="64" loading="lazy">` : '<span class="ag-noimg"></span>'}
        <div class="ag-t"><a href="${esc(it.url || '#')}" target="_blank" rel="noopener">${esc(it.title)}</a><small>${it.price ? eur(Math.round(it.price * 100)) : ''} · ${it.sold} verkauft · ${it.watchers} beobachtet · Nr. ${esc(it.itemId)}</small></div>
        <span class="ag-score" data-score>–</span></div><div class="ag-body" data-body></div></article>`;
export async function stAngebote(v, { msg }, st = {}) {
  const r = await api(L);
  if (!r.ok) { v.innerHTML = `<div class="wa-state err"><strong>Nicht verfügbar.</strong><span>${esc(r.data?.error || '')}</span></div>`; return; }
  const accts = r.data.accounts;
  if (!accts.length) { v.innerHTML = '<div class="stx"><section class="pt-card"><h2>eBay-Angebote</h2><p>Zuerst unter <a href="#st_konten">Konten &amp; Belege</a> ein eBay-Konto verbinden.</p></section></div>'; return; }
  const acc = st.account && accts.some((a) => a.id === st.account) ? st.account : accts[0].id;
  const page = st.page || 1;
  v.innerHTML = `<div class="stx"><section class="pt-card"><h2>eBay-Angebote prüfen &amp; verbessern</h2>
    <p class="form-note">Die Prüfung bewertet jedes Angebot (0–100) und schlägt einen besseren Titel vor – nur aus deinen eigenen Angaben. Die Beschreibung (mit deiner „Last product“-Einbindung) wird nie verändert. Nichts wird ohne deinen Klick geändert – außer den eindeutigen Korrekturen der Angebots-Wache unten.</p>
    <div class="pt-row">${accts.length > 1 ? `<div class="st-seg">${accts.map((a) => `<button type="button" data-acc="${a.id}" aria-pressed="${a.id === acc}">${esc(a.label)}</button>`).join('')}</div>` : `<strong>${esc(accts[0].label)}</strong>`}
      <label class="ag-ads" title="Werbegebühr deiner eBay-Werbung (z. B. Basic Ads) – fließt in Mindestpreis und Gewinn ein">Werbung <input id="agAds" type="number" min="0" max="20" step="0.5" inputmode="decimal" style="width:70px" value="${adsPct()}"> %</label>
      <button class="btn btn-dark" type="button" id="agCheck">Diese Seite analysieren</button><button class="btn btn-outline" type="button" id="agAll">Alle Angebote analysieren</button></div>
    <div id="agBulk"></div></section>
    <section class="pt-card" id="agWatch" data-noklapp><div class="wa-state">Angebots-Wache wird geladen …</div></section>
    <section class="pt-card" id="agPrice" hidden></section>
    <div id="agList"><div class="wa-skel" aria-busy="true"><div class="wa-skel-card"><i class="w40"></i><i></i><i></i></div></div></div></div>`;
  v.querySelectorAll('[data-acc]').forEach((b) => b.onclick = () => stAngebote(v, { msg }, { account: b.dataset.acc }));
  drawWatch($('#agWatch', v), msg);
  const l = await api(`${L}?account=${acc}&page=${page}`);
  const box = $('#agList', v);
  if (!l.ok) { box.innerHTML = `<section class="pt-card"><p class="st-warn">${esc(l.data?.error || 'Fehler')}</p></section>`; return; }
  const items = l.data.items;
  box.innerHTML = `<section class="pt-card"><p class="form-note">${l.data.total} aktive Angebote · Seite ${page} von ${l.data.pages}</p>
    <div class="ag-list">${items.map(card).join('')}</div>
    <div class="pt-row">${page > 1 ? '<button class="btn btn-outline" data-pg="-1">Zurück</button>' : ''}${page < l.data.pages ? '<button class="btn btn-outline" data-pg="1">Weiter</button>' : ''}</div></section>`;
  box.querySelectorAll('[data-pg]').forEach((b) => b.onclick = () => stAngebote(v, { msg }, { account: acc, page: page + +b.dataset.pg }));
  // Sammelt je Angebot nur die Vorschläge, die wirklich etwas verbessern (siehe sensible()).
  const plan = new Map();
  const results = new Map();
  $('#agAds', v).onchange = (e) => { const x = Math.min(20, Math.max(0, Number(e.target.value) || 0)); e.target.value = x; try { localStorage.setItem('lr-ag-ads', String(x)); } catch { /* */ } msg(`Werbung ${x} % – bitte neu analysieren.`); };
  const bulk = $('#agBulk', v);
  const runChecks = async (ids, label, onEach) => {
    for (let i = 0; i < ids.length; i += 20) {
      label(Math.min(i + 20, ids.length), ids.length);
      const c = await api(`${L}?account=${acc}&ads=${adsPct()}&check=${ids.slice(i, i + 20).join(',')}`);
      if (!c.ok) { msg(c.data?.error || 'Fehler', true); return false; }
      for (const ch of c.data.checks) { onEach(ch); if (!ch.error) results.set(ch.itemId, ch); const p = sensible(ch); if (p) plan.set(ch.itemId, p); else plan.delete(ch.itemId); }
    }
    return true;
  };
  $('#agCheck', v).onclick = async (e) => {
    e.target.disabled = true;
    let done = 0;
    await runChecks(items.map((i) => i.itemId), (n, t) => { e.target.textContent = `Analysiere ${n} von ${t} …`; }, (ch) => { render(box, acc, ch, msg); done++; });
    e.target.textContent = `${done} Angebote analysiert`;
    // Schwächste zuerst
    const list = $('.ag-list', box);
    [...list.children].sort((a, b) => (+a.dataset.sc || 101) - (+b.dataset.sc || 101)).forEach((n) => list.append(n));
    drawBulk(bulk, acc, plan, msg, box);
    drawPrices($('#agPrice', v), acc, results, msg, runChecks);
  };
  // Alle Seiten: Angebotsnummern seitenweise holen, alle prüfen; die aktuelle Seite wird zusätzlich angezeigt.
  $('#agAll', v).onclick = async (e) => {
    e.target.disabled = true; $('#agCheck', v).disabled = true;
    // Alle Seiten laden und ALLE Angebote in der Liste zeigen (vorher wurden nur die 100 der aktuellen Seite angezeigt).
    const all = [];
    for (let pg = 1; pg <= l.data.pages; pg++) {
      e.target.textContent = `Lade Seite ${pg} von ${l.data.pages} …`;
      const x = pg === page ? l : await api(`${L}?account=${acc}&page=${pg}`);
      if (!x.ok) { msg(x.data?.error || 'Fehler', true); break; }
      all.push(...x.data.items);
    }
    const seen = new Set(); const list = all.filter((i) => !seen.has(i.itemId) && seen.add(i.itemId));
    const lst = box.querySelector('.ag-list'); if (lst) lst.innerHTML = list.map(card).join('');
    box.querySelector('.form-note').textContent = `${l.data.total} aktive Angebote · alle ${list.length} werden analysiert`;
    box.querySelectorAll('[data-pg]').forEach((b) => b.remove());
    const ids = list.map((i) => i.itemId);
    const ok = await runChecks(ids, (n, t) => { e.target.textContent = `Analysiere ${n} von ${t} …`; }, (ch) => render(box, acc, ch, msg));
    e.target.textContent = ok ? `${ids.length} Angebote analysiert` : 'Abgebrochen';
    drawBulk(bulk, acc, plan, msg, box);
    drawPrices($('#agPrice', v), acc, results, msg, runChecks);
  };
}

// „Sinnvoll“ heißt: nur das Schlimmste, und nur dort, wo es dem Angebot nicht schadet.
// – Angebot hat schon Verkäufe: Es läuft – nur echte Fehler beheben (anderer Shop wie Amazon genannt, Links/Kontaktdaten,
//   Skripte). Titel und Beschreibung werden sonst nicht angefasst, damit Suchplatzierung und Verkaufsverlauf bleiben.
// – Angebot ohne Verkäufe: zusätzlich deutliche Schwächen beheben (Titel viel zu kurz, Marke fehlt, Werbewörter,
//   Beschreibung fast leer). Reine Umformatierungen und Tipps nie.
function sensible(ch) {
  if (ch.error) return null;
  const selling = Number(ch.sold || 0) > 0;
  const hit = (area, levels) => ch.findings.some((f) => f.area === area && levels.includes(f.level));
  const levels = selling ? ['fehler'] : ['fehler', 'warnung'];
  const p = { listingType: ch.listingType, _old: { title: ch.title, price: ch.price } };
  // Titel nie in der Sammel-Übernahme: Titel prüfst du einzeln von Hand (Wunsch Feray).
  // Beschreibung nie ändern (eigene „Last product“-Einbindung).
  // Preis: Verlust/zu wenig Gewinn immer korrigieren; Senken nur bei Angeboten ohne Verkäufe (nie unter den Mindestpreis).
  const ps = ch.priceSuggestion;
  if (ps && (ps.level === 'fehler' || !selling)) p.price = ps.newPrice;
  return p.title || p.descriptionHtml || p.price != null ? p : null;
}

function drawBulk(el, acc, plan, msg, box) {
  const all = [...plan.entries()];
  const nt = all.filter(([, p]) => p.title).length, np = all.filter(([, p]) => p.price != null).length;
  if (!all.length) { el.innerHTML = '<p class="form-note">Keine Verbesserungen nötig, die sich automatisch übernehmen lassen.</p>'; return; }
  // Genau zeigen, was geändert wird: je Angebot alt → neu (Titel, Preis). Beschreibung, Fotos, Bestand bleiben immer.
  const diff = all.map(([id, p]) => `<tr><td><a class="text-btn" href="https://www.ebay.de/itm/${esc(id)}" target="_blank" rel="noopener noreferrer">${esc(id)}</a></td><td>${p.title ? `<b>Titel</b><br><s class="st-mut">${esc(p._old?.title || '')}</s><br>→ ${esc(p.title)}` : ''}${p.title && p.price != null ? '<br>' : ''}${p.price != null ? `<b>Preis</b> ${p._old?.price != null ? fmt(p._old.price) : '–'} → <b>${fmt(p.price)}</b>` : ''}</td></tr>`).join('');
  el.innerHTML = `<div class="pt-row"><button class="btn btn-dark" type="button" id="agBulkGo">Alle Preis-Korrekturen übernehmen</button><span class="form-note">${all.length} Angebote · ${nt} neue Titel · ${np} neue Preise. Nur echte Fehler und deutliche Schwächen – Angebote mit Verkäufen werden nur bei Fehlern angefasst. Preise nur mit bekanntem Einkaufspreis, nie unter dem Mindestgewinn. Beschreibung, Fotos und Bestand bleiben unverändert.</span></div>
    <details class="ag-diff" open><summary>Genau diese Änderungen werden übernommen</summary><div class="wa-wrap"><table class="wa-table"><thead><tr><th>Angebot</th><th>Änderung (vorher → nachher)</th></tr></thead><tbody>${diff}</tbody></table></div></details>`;
  $('#agBulkGo', el).onclick = async (e) => {
    if (!confirm(`${all.length} Angebote jetzt bei eBay ändern?\n${nt} neue Titel, ${np} neue Preise – genau wie in der Liste darunter.`)) return;
    const b = e.target; b.disabled = true;
    let ok = 0, fail = 0;
    for (const [itemId, p] of all) {
      b.textContent = `Übernehme ${ok + fail + 1} von ${all.length} …`;
      const { _old, ...send } = p; const x = await api(L, { method: 'POST', body: JSON.stringify({ account: acc, itemId, ...send }) });
      if (x.ok) { ok++; plan.delete(itemId); box.querySelectorAll(`[data-item="${itemId}"] [data-apply]`).forEach((y) => { y.textContent = '✓ übernommen'; y.disabled = true; }); } else fail++;
    }
    b.textContent = `${ok} übernommen${fail ? ` · ${fail} fehlgeschlagen` : ''}`;
    msg(fail ? `${ok} Angebote verbessert, ${fail} nicht möglich – diese einzeln prüfen.` : `${ok} Angebote bei eBay verbessert.`, fail > 0);
  };
}

function render(box, acc, ch, msg) {
  const el = box.querySelector(`[data-item="${ch.itemId}"]`); if (!el) return;
  const body = el.querySelector('[data-body]'), sc = el.querySelector('[data-score]');
  if (ch.error) { body.innerHTML = `<p class="st-warn">${esc(ch.error)}</p>`; return; }
  el.dataset.sc = ch.score;
  sc.textContent = ch.score; sc.className = 'ag-score ' + (ch.score >= 80 ? 'ok' : ch.score >= 60 ? 'mid' : 'low');
  body.innerHTML = `${ch.findings.length ? `<ul class="ag-f">${ch.findings.map((f) => `<li class="${f.level}"><b>${LV[f.level]} · ${AREA[f.area]}</b> ${esc(f.text)}</li>`).join('')}</ul>` : '<p>Keine Auffälligkeiten.</p>'}
    ${ch.priceSuggestion ? `<div class="ag-sug"><label>Vorschlag Preis <small>jetzt ${eur(Math.round(ch.price * 100))}${ch.cost != null ? ` · Einkauf ${eur(Math.round(ch.cost * 100))} · Mindestpreis ${eur(Math.round(ch.priceSuggestion.minPrice * 100))}` : ''}${ch.priceSuggestion.gewinnNeu != null ? ` · Gewinn danach ca. ${eur(Math.round(ch.priceSuggestion.gewinnNeu * 100))}` : ''}</small><input data-price inputmode="decimal" value="${ch.priceSuggestion.newPrice.toFixed(2).replace('.', ',')}"></label><button class="btn btn-dark" type="button" data-apply="price">Preis übernehmen</button></div>` : ''}
    ${ch.newTitle ? `<div class="ag-sug"><label>Vorschlag Titel <small data-len>${ch.newTitle.length}/80</small><input data-title value="${esc(ch.newTitle)}" maxlength="80"></label><button class="btn btn-dark" type="button" data-apply="title">Titel übernehmen</button></div>` : ''}
    ${ch.newDescription ? `<details class="ag-sug"><summary>Vorschlag Beschreibung ansehen</summary><iframe sandbox="" title="Vorschau Beschreibung" class="ag-prev"></iframe><button class="btn btn-dark" type="button" data-apply="desc">Beschreibung übernehmen</button></details>` : ''}`;
  const fr = body.querySelector('iframe'); if (fr) fr.srcdoc = ch.newDescription;
  const ti = body.querySelector('[data-title]'); if (ti) ti.oninput = () => { body.querySelector('[data-len]').textContent = `${ti.value.length}/80`; };
  body.querySelectorAll('[data-apply]').forEach((b) => b.onclick = async () => {
    const what = b.dataset.apply === 'title' ? 'den neuen Titel' : b.dataset.apply === 'price' ? 'den neuen Preis' : 'die neue Beschreibung';
    const pin = body.querySelector('[data-price]'); const newPrice = pin ? Number(String(pin.value).replace(/\./g, '').replace(',', '.')) : null;
    if (b.dataset.apply === 'price' && !(newPrice >= 1)) return msg('Preis ungültig.', true);
    const detail = b.dataset.apply === 'title' ? `Titel vorher:\n${ch.title}\n\nTitel nachher:\n${ti.value}` : b.dataset.apply === 'price' ? `Preis: ${fmt(ch.price)} → ${fmt(newPrice)}` : '';
    if (!confirm(`${what} jetzt bei eBay übernehmen?\n\n${detail}\n\nSonst wird nichts geändert (Beschreibung, Fotos, Bestand bleiben).`)) return;
    b.disabled = true;
    const x = await api(L, { method: 'POST', body: JSON.stringify({ account: acc, itemId: ch.itemId, listingType: ch.listingType, ...(b.dataset.apply === 'title' ? { title: ti.value } : b.dataset.apply === 'price' ? { price: newPrice } : { descriptionHtml: ch.newDescription }) }) });
    b.disabled = false;
    if (x.ok) { b.textContent = '✓ übernommen'; b.disabled = true; msg('Bei eBay geändert.'); } else msg(x.data?.error || 'Fehler', true);
  });
}

// ---------- Preis-Optimierung ----------
// Eigener Bereich: je Angebot Einkauf, Mindestpreis (Einkauf + eBay-Gebühren + Werbung + Mindestgewinn), Gewinn jetzt und
// ein Vorschlag. Nichts wird ohne deinen Klick geändert. Fehlt der Einkaufspreis, kannst du ihn hier eintragen.
const fmt = (x) => (x == null ? '–' : `${Number(x).toFixed(2).replace('.', ',')} €`);
const num = (s) => { const x = Number(String(s || '').replace(/\s|€/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(x) ? x : NaN; };
function drawPrices(el, acc, results, msg, runChecks) {
  const all = [...results.values()].filter((c) => !c.variations && c.price);
  if (!all.length) { el.hidden = true; return; }
  const sug = all.filter((c) => c.priceSuggestion);
  const loss = all.filter((c) => c.priceInfo && c.priceInfo.gewinn < 0);
  const noCost = all.filter((c) => c.cost == null);
  const rows = [...sug, ...all.filter((c) => !c.priceSuggestion && c.cost != null).sort((a, b) => (a.priceInfo?.gewinn ?? 0) - (b.priceInfo?.gewinn ?? 0)), ...noCost];
  el.hidden = false;
  el.innerHTML = `<h3>Preis-Optimierung</h3>
    <p class="form-note">Preise immer inklusive Versand gerechnet: zahlt der Käufer Versand, zählt er zum Erlös (eBay nimmt die Provision auf die Gesamtsumme). Mindestpreis = Einkauf + eBay-Gebühren (je Konto aus deinen echten Abrechnungen) + Werbung (${esc(String(adsPct()))} % Basic Ads, wird nach dem Verkauf abgezogen) + mindestens 2,50 € (bei teuren Artikeln 10 %) Gewinn. Gewinn netto nach Steuer-Abzug. Häkchen setzen, prüfen, dann übernehmen – nichts geht ohne deinen Klick an eBay.</p>
    <div class="wa-tiles"><div class="wa-tile${loss.length ? ' warn' : ''}"><span class="wa-tile-l">Mit Verlust</span><strong>${loss.length}</strong></div><div class="wa-tile"><span class="wa-tile-l">Vorschläge</span><strong>${sug.length}</strong></div><div class="wa-tile${noCost.length ? ' warn' : ''}"><span class="wa-tile-l">Einkauf unbekannt</span><strong>${noCost.length}</strong></div></div>
    <div class="wa-wrap"><table class="wa-table st-num"><thead><tr><th></th><th>Angebot</th><th>Verkauft</th><th>Preis</th><th>Einkauf</th><th>Mindestpreis</th><th>Gewinn jetzt</th><th>Neuer Preis</th><th>Hinweis</th></tr></thead><tbody>
    ${rows.slice(0, 500).map((c) => `<tr data-pr="${esc(c.itemId)}"${c.priceInfo && c.priceInfo.gewinn < 0 ? ' class="st-warnrow"' : ''}>
      <td>${c.priceSuggestion ? `<input type="checkbox" data-sel ${c.priceSuggestion.level === 'fehler' ? 'checked' : ''} aria-label="Preis übernehmen">` : ''}</td>
      <td><a href="${esc(c.url || '#')}" target="_blank" rel="noopener noreferrer">${esc((c.title || '').slice(0, 60))}</a></td>
      <td>${c.sold}</td><td>${fmt(c.price)}</td>
      <td><input data-cost inputmode="decimal" style="width:80px" value="${c.cost == null ? '' : String(c.cost).replace('.', ',')}" placeholder="€"> <button type="button" class="text-btn" data-savecost>speichern</button>${c.priceInfo?.manual ? '<br><small class="st-mut">von Hand</small>' : c.cost != null ? '<br><small class="st-mut">aus Abgleich</small>' : ''}</td>
      <td>${fmt(c.priceInfo?.minPrice)}${c.priceInfo?.versand ? `<br><small class="st-mut">+ ${fmt(c.priceInfo.versand)} Versand</small>` : ''}</td><td>${c.priceInfo ? fmt(c.priceInfo.gewinn) : '–'}</td>
      <td>${c.priceSuggestion ? `<input data-np inputmode="decimal" style="width:80px" value="${c.priceSuggestion.newPrice.toFixed(2).replace('.', ',')}">` : '–'}</td>
      <td><small>${esc(c.priceSuggestion ? c.priceSuggestion.reason : c.cost == null ? 'Einkaufspreis eintragen oder Einkauf im Abgleich zuordnen' : 'Preis passt')}</small></td></tr>`).join('')}
    </tbody></table></div>
    <div class="pt-row"><button class="btn btn-dark" type="button" id="agPrGo"${sug.length ? '' : ' disabled'}>Ausgewählte Preise übernehmen</button></div>`;
  el.querySelectorAll('[data-savecost]').forEach((b) => b.onclick = async () => {
    const tr = b.closest('tr'), id = tr.dataset.pr, raw = tr.querySelector('[data-cost]').value.trim(), cost = raw ? num(raw) : null;
    if (raw && !(cost > 0)) return msg('Betrag ungültig.', true);
    b.disabled = true;
    const x = await api(L, { method: 'POST', body: JSON.stringify({ action: 'cost', itemId: id, cost }) });
    if (!x.ok) { b.disabled = false; return msg(x.data?.error || 'Fehler', true); }
    await runChecks([id], () => {}, () => {});
    msg('Einkauf gespeichert – neu berechnet.');
    drawPrices(el, acc, results, msg, runChecks);
  });
  $('#agPrGo', el).onclick = async (e) => {
    const sel = [...el.querySelectorAll('tr[data-pr]')].filter((tr) => tr.querySelector('[data-sel]')?.checked);
    if (!sel.length) return msg('Keine Preise ausgewählt.', true);
    const lines = sel.map((tr) => { const c = results.get(tr.dataset.pr); return `• ${String(c.title || '').slice(0, 40)}: ${fmt(c.price)} → ${fmt(num(tr.querySelector('[data-np]').value))}`; });
    if (!confirm(`${sel.length} Preise jetzt bei eBay ändern?\n\n${lines.slice(0, 15).join('\n')}${lines.length > 15 ? `\n… und ${lines.length - 15} weitere` : ''}\n\nNur der Preis wird geändert.`)) return;
    const b = e.target; b.disabled = true; let ok = 0, fail = 0;
    for (const tr of sel) {
      const c = results.get(tr.dataset.pr), p = num(tr.querySelector('[data-np]').value);
      if (!(p >= 1)) { fail++; continue; }
      if (c.priceInfo && p < c.priceInfo.minPrice && !confirm(`${c.title.slice(0, 40)}: ${fmt(p)} liegt unter dem Mindestpreis ${fmt(c.priceInfo.minPrice)} – trotzdem?`)) continue;
      b.textContent = `Übernehme ${ok + fail + 1} von ${sel.length} …`;
      const x = await api(L, { method: 'POST', body: JSON.stringify({ account: acc, itemId: c.itemId, listingType: c.listingType, price: p }) });
      if (x.ok) { ok++; tr.querySelector('[data-sel]').checked = false; tr.querySelector('[data-sel]').disabled = true; tr.lastElementChild.innerHTML = '<small>✓ übernommen</small>'; } else { fail++; tr.lastElementChild.innerHTML = `<small class="st-warn">${esc(x.data?.error || 'Fehler')}</small>`; }
    }
    b.disabled = false; b.textContent = 'Ausgewählte Preise übernehmen';
    msg(fail ? `${ok} Preise geändert, ${fail} nicht möglich.` : `${ok} Preise bei eBay geändert.`, fail > 0);
  };
}

// ---------- Angebots-Wache ----------
// Prüft täglich alle Angebote (wie die HQ-Agenten), erkennt Änderungen durch eBay und korrigiert Eindeutiges selbst.
const FIELD = { bearbeitungszeit: 'Bearbeitungszeit', titel: 'Titel', preis: 'Preis', score: 'Bewertung', richtlinie: 'Richtlinie', umsatzsteuer: 'Umsatzsteuer', ruecknahme: 'Rücknahme', lieferzeit: 'Lieferzeit', versand: 'Versand' };
async function drawWatch(el, msg) {
  if (!el) return;
  const r = await api(`${L}?watch=1`);
  if (!el.isConnected) return;
  if (!r.ok) { el.innerHTML = `<p class="st-warn">${esc(r.data?.error || 'Angebots-Wache nicht verfügbar.')}</p>`; return; }
  const d = r.data, c = d.cfg, ch = d.changes || [];
  const when = (x) => (x ? new Date(x).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
  el.innerHTML = `<h3>Angebots-Wache &amp; Änderungsprotokoll <small class="st-mut">jede Änderung mit vorher → nachher</small></h3>
    <p class="form-note">Prüft jeden Tag alle Angebote. Ändert eBay etwas von selbst (z. B. Bearbeitungszeit zurück auf 30 Tage), siehst du es hier. Titel und Beschreibungen ändert sie nie – die prüfst du von Hand. Deine Standards hält sie automatisch ein: <b>Bearbeitungszeit</b>, <b>Umsatzsteuer</b>, <b>30 Tage Rücknahme – Rückversand zahlt der Verkäufer</b>; nicht kostenloser Versand wird gemeldet; fremde Shops im Titel (z. B. „Amazon“) meldet sie nur. Eine <b>Lieferzeit</b> über deinem Wert meldet sie (hängt an der Versandart). <b>Nie</b> automatisch: Preise (gibst du frei), Beschreibung (deine Einbindung), Bestand, Fotos.</p>
    <div class="pt-row" style="flex-wrap:wrap;gap:10px;align-items:center">
      <label class="pt-check"><input type="checkbox" id="agWAuto"${c.auto ? ' checked' : ''}> Automatisch korrigieren</label>
      <label>Bearbeitungszeit <input id="agWH" type="number" min="0" max="30" inputmode="numeric" style="width:64px" value="${c.handlingDays ?? ''}" placeholder="–"> Tag(e)</label>
      <label>Lieferzeit höchstens <input id="agWD" type="number" min="1" max="30" inputmode="numeric" style="width:64px" value="${c.deliveryDays ?? ''}" placeholder="–"> Tage</label>
      <label>Umsatzsteuer <input id="agWV" type="number" min="0" max="25" inputmode="decimal" style="width:64px" value="${c.vat ?? ''}" placeholder="–"> %</label>
      <label class="pt-check"><input type="checkbox" id="agWR"${c.returns30 ? ' checked' : ''}> 30 Tage Rücknahme, Verkäufer zahlt</label>
      <button class="btn btn-outline btn-sm" type="button" id="agWSave">Speichern</button>
      <button class="btn btn-dark btn-sm" type="button" id="agWRun">Jetzt alle prüfen</button>
      <span class="form-note" id="agWState">Zuletzt komplett: ${when(d.at)} · ${d.known} Angebote bekannt${d.running ? ' · Durchlauf läuft noch' : ''}${d.paused ? ` · eBay-Tageslimit erreicht, weiter ab ${when(d.paused)}` : ''}${d.last ? ` · letzter Lauf ${when(d.last.at)}: ${d.last.checked} geprüft, ${d.last.fixed} korrigiert` : ''}</span>
    </div>
    ${ch.length ? `<div class="wa-wrap"><table class="wa-table"><thead><tr><th>Zeit</th><th>Angebot</th><th>Was</th><th>Vorher → Jetzt</th><th>Status</th></tr></thead><tbody>
      ${ch.slice(0, 60).map((x) => `<tr><td>${when(x.at)}</td><td><a class="text-btn" href="https://www.ebay.de/itm/${esc(x.itemId)}" target="_blank" rel="noopener noreferrer">${esc((x.title || x.itemId).slice(0, 60))}</a></td><td>${FIELD[x.field] || esc(x.field)}</td><td>${esc(String(x.from).slice(0, 90))} → <b>${esc(String(x.to).slice(0, 90))}</b>${x.note && x.note !== 'von dir übernommen' ? `<br><small class="st-mut">${esc(/Nutzungslimit|call limit/i.test(x.note) ? 'eBay-Tageslimit für Änderungen erreicht – wird automatisch nachgeholt.' : x.note)}</small>` : ''}</td><td>${x.fixed ? `<span class="st ok">${x.note === 'von dir übernommen' ? 'von dir übernommen' : 'automatisch korrigiert'}</span>` : x.field === 'richtlinie' ? '<span class="st warn">bitte in Richtlinie ändern</span>' : x.field === 'lieferzeit' || x.field === 'versand' ? '<span class="st warn">bei eBay ändern</span>' : /Nutzungslimit|call limit/i.test(x.note || '') ? '<span class="st info">wartet auf morgen</span>' : '<span class="st info">gemeldet</span>'}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="form-note">Noch keine Änderungen erkannt. Beim ersten Durchlauf merkt sich die Wache den Stand aller Angebote.</p>'}`;
  $('#agWSave', el).onclick = async () => {
    const val = (id) => { const t = $(id, el).value.trim().replace(',', '.'); return t ? Number(t) : null; };
    const h = val('#agWH'), dd = val('#agWD'), vat = val('#agWV');
    if (h != null && !(Number.isInteger(h) && h >= 0 && h <= 30)) return msg('Bearbeitungszeit: ganze Tage von 0 bis 30.', true);
    if (dd != null && !(Number.isInteger(dd) && dd >= 1 && dd <= 30)) return msg('Lieferzeit: ganze Tage von 1 bis 30.', true);
    if (vat != null && !(vat >= 0 && vat <= 25)) return msg('Umsatzsteuer: 0 bis 25 %.', true);
    const x = await api(L, { method: 'POST', body: JSON.stringify({ action: 'watch_cfg', auto: $('#agWAuto', el).checked, handlingDays: h, deliveryDays: dd, vat, returns30: $('#agWR', el).checked }) });
    msg(x.ok ? 'Angebots-Wache gespeichert.' : x.data?.error || 'Fehler', !x.ok);
  };
  $('#agWRun', el).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; let total = 0, fixed = 0;
    try {
      for (let i = 0; i < 30; i++) {
        $('#agWState', el).textContent = `Prüfe … ${total} Angebote geprüft, ${fixed} korrigiert`;
        const x = await api(L, { method: 'POST', body: JSON.stringify({ action: 'watch_run' }) });
        if (!x.ok) { msg(x.data?.error || 'Fehler', true); break; }
        total += x.data.checked; fixed += x.data.fixed;
        if (x.data.paused) { msg(`eBay-Tageslimit für Änderungen erreicht – die Wache macht ab ${new Date(x.data.paused).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} automatisch weiter.`); break; }
        if (x.data.done || !el.isConnected) break;
      }
      if (total) msg(`Wache: ${total} Angebote geprüft, ${fixed} korrigiert.`);
    } finally { b.disabled = false; if (el.isConnected) drawWatch(el, msg); }
  };
}
