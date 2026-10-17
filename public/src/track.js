// Reichweitenmessung ohne Cookies und ohne lokale Speicherung (siehe Datenschutzhinweise, Abschnitt Reichweitenmessung).
// Gesendet werden nur: Seite (ohne Parameter), Herkunftsseite (Domain), Kampagnen-Parameter (utm_*), Ereignisname.
// Bei aktivem „Do Not Track“ oder Global Privacy Control wird nichts gesendet.
(function () {
  if (window.iaTrack) return;
  var off = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true || /^(localhost|127\.)/.test(location.hostname) || navigator.webdriver;
  var p = location.pathname, seg = /^\/(b2b|b2b-portal|p\/|partner)/.test(p) || /^partner\./.test(location.hostname) ? 'b2b' : 'b2c';
  var q = new URLSearchParams(location.search);
  function send(ev, extra) {
    if (off) return;
    try {
      var b = { ev: ev, seg: (extra && extra.seg) || seg, path: (location.hostname.indexOf('partner.') === 0 ? '/b2b-portal' : '') + p, plan: extra && extra.plan || null };
      if (ev === 'pv') { b.ref = document.referrer || null; b.src = q.get('utm_source') || (q.get('ref') ? 'partner:' + q.get('ref') : null); b.med = q.get('utm_medium'); b.camp = q.get('utm_campaign'); }
      var s = JSON.stringify(b);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/a', new Blob([s], { type: 'text/plain' }));
      else fetch('/api/a', { method: 'POST', body: s, keepalive: true }).catch(function () {});
    } catch (e) { /* nie stören */ }
  }
  window.iaTrack = send;
  if (/^\/intern\b/.test(p)) { off = true; return; }
  send('pv');
  if (/^\/angebote/.test(p)) send('offer_view');
  if (q.get('checkout') === 'success') send('purchase_return');
})();
