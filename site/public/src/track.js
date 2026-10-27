// Audience measurement without cookies and without local storage (see the privacy policy, section "Audience measurement").
// Only sent: page (without parameters), referring domain, campaign parameters (utm_*), event name.
// With "Do Not Track" or Global Privacy Control enabled, nothing is sent.
(function () {
  if (window.iaTrack) return;
  var off = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true || /^(localhost|127\.)/.test(location.hostname) || navigator.webdriver;
  var p = location.pathname, seg = /^\/(business|business-portal|p\/|partners)/.test(p) || /^partner\./.test(location.hostname) ? 'b2b' : 'b2c';
  var q = new URLSearchParams(location.search);
  function send(ev, extra) {
    if (off) return;
    try {
      var b = { ev: ev, seg: (extra && extra.seg) || seg, path: (location.hostname.indexOf('partner.') === 0 ? '/business-portal' : '') + p, plan: extra && extra.plan || null };
      if (ev === 'pv') { b.ref = document.referrer || null; b.src = q.get('utm_source') || (q.get('ref') ? 'partner:' + q.get('ref') : null); b.med = q.get('utm_medium'); b.camp = q.get('utm_campaign'); }
      var s = JSON.stringify(b);
      if (navigator.sendBeacon) navigator.sendBeacon('/api/a', new Blob([s], { type: 'text/plain' }));
      else fetch('/api/a', { method: 'POST', body: s, keepalive: true }).catch(function () {});
    } catch (e) { /* never interfere */ }
  }
  window.iaTrack = send;
  // Remember the referral code (?ref=) for this session so it reaches sign-up (sessionStorage only,
  // ends when the tab closes; not with Do Not Track/GPC).
  try {
    var rf = q.get('ref');
    if (!off && rf && /^[a-z0-9-]{3,40}$/.test(rf)) {
      sessionStorage.setItem('lr-ref', rf);
      var cp = (q.get('utm_campaign') || '').toLowerCase();
      if (/^[a-z0-9-]{3,40}$/.test(cp)) sessionStorage.setItem('lr-camp', cp); else sessionStorage.removeItem('lr-camp');
    }
  } catch (e) { /* no storage */ }
  if (/^\/(intern|internal)\b/.test(p)) { off = true; return; }
  send('pv');
  if (/^\/pricing/.test(p)) send('offer_view');
  if (q.get('checkout') === 'success') send('purchase_return');
})();
