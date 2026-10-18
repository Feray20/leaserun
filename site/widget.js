/* LeaseRun embeddable cash-flow calculator.
 * <div data-leaserun-widget data-color="#0C1A35" data-ref="your-company" data-state="TX"></div>
 * <script src="https://leaserun.com/widget.js" async></script>
 * Renders inside a Shadow DOM; reads nothing from the host page and sends nothing anywhere.
 */
(function () {
  'use strict';
  var TAX = { AL: .39, AK: 1.04, AZ: .56, AR: .57, CA: .71, CO: .49, CT: 1.79, DE: .53, DC: .56, FL: .8, GA: .83, HI: .27, ID: .56, IL: 2.08, IN: .77, IA: 1.43, KS: 1.34, KY: .79, LA: .51, ME: 1.09, MD: .99, MA: 1.12, MI: 1.38, MN: 1.05, MS: .67, MO: .91, MT: .68, NE: 1.54, NV: .53, NH: 1.93, NJ: 2.23, NM: .67, NY: 1.4, NC: .7, ND: .92, OH: 1.41, OK: .82, OR: .87, PA: 1.36, RI: 1.32, SC: .51, SD: 1.08, TN: .55, TX: 1.58, UT: .52, VT: 1.83, VA: .75, WA: .87, WV: .55, WI: 1.51, WY: .56 };
  function pmt(p, r, y) { r = r / 1200; var n = y * 12; return p <= 0 ? 0 : r ? p * r / (1 - Math.pow(1 + r, -n)) : p / n; }
  function usd(n) { return (n < 0 ? '−' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US'); }
  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#0C1A35'; }
  function mount(host) {
    if (host.getAttribute('data-lr-mounted')) return;
    host.setAttribute('data-lr-mounted', '1');
    var color = safeColor(host.getAttribute('data-color'));
    var ref = (host.getAttribute('data-ref') || '').replace(/[^\w\-]/g, '').slice(0, 60);
    var st = (host.getAttribute('data-state') || 'TX').toUpperCase(); if (!TAX[st]) st = 'TX';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>:host{all:initial}*{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
      '.w{max-width:440px;border:1px solid #E1E5EE;border-radius:14px;background:#fff;color:#0C1A35;overflow:hidden}' +
      '.h{background:' + color + ';color:#fff;padding:12px 16px;font-weight:700;font-size:15px}' +
      '.b{padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}' +
      'label{font-size:12px;font-weight:600;color:#3A4664;display:flex;flex-direction:column;gap:4px}' +
      'input,select{padding:8px 10px;border:1px solid #D5DBE7;border-radius:8px;font-size:14px;width:100%}' +
      '.o{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:4px}' +
      '.k{background:#F7F9FC;border-radius:10px;padding:8px}.k s{display:block;text-decoration:none;font-size:11px;color:#5A6782}.k b{font-size:16px}' +
      '.f{padding:10px 16px;border-top:1px solid #EEF1F6;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:11px;color:#5A6782}' +
      'a{background:' + color + ';color:#fff;text-decoration:none;font-weight:700;font-size:13px;padding:8px 12px;border-radius:8px;white-space:nowrap}.neg{color:#C4373C}.pos{color:#0E7A53}</style>' +
      '<div class="w"><div class="h">Will this rental cash flow?</div><div class="b">' +
      '<label>Price<input data-k="price" type="number" min="0" value="250000"></label><label>Monthly rent<input data-k="rent" type="number" min="0" value="2100"></label>' +
      '<label>Down payment %<input data-k="down" type="number" min="0" max="100" value="25"></label><label>Interest rate %<input data-k="rate" type="number" min="0" step="0.125" value="7"></label>' +
      '<div class="o"><div class="k"><s>Cash flow / mo</s><b data-o="cf"></b></div><div class="k"><s>Cap rate</s><b data-o="cap"></b></div><div class="k"><s>DSCR</s><b data-o="dscr"></b></div></div></div>' +
      '<div class="f"><span>Estimate: 6% vacancy, 8% management, 10% repairs & CapEx, state-average taxes.</span><a target="_blank" rel="noopener" data-o="link">Full analysis</a></div></div>';
    function q(s) { return root.querySelector(s); }
    function run() {
      var v = {}; Array.prototype.forEach.call(root.querySelectorAll('input'), function (i) { v[i.getAttribute('data-k')] = Math.max(0, +i.value || 0); });
      var loan = v.price * (1 - Math.min(100, v.down) / 100), gsi = v.rent * 12;
      var noi = gsi * 0.94 - gsi * 0.94 * 0.08 - gsi * 0.10 - v.price * TAX[st] / 100 - Math.max(900, v.price * 0.006);
      var ds = pmt(loan, v.rate, 30) * 12, cf = (noi - ds) / 12;
      var e = q('[data-o="cf"]'); e.textContent = usd(cf); e.className = cf < 0 ? 'neg' : 'pos';
      q('[data-o="cap"]').textContent = v.price ? (noi / v.price * 100).toFixed(1) + '%' : '–';
      q('[data-o="dscr"]').textContent = ds ? (noi / ds).toFixed(2) : 'n/a';
      q('[data-o="link"]').href = 'https://leaserun.com/analyzer?price=' + v.price + '&rent=' + v.rent + '&downPct=' + v.down + '&rate=' + v.rate + '&state=' + st + (ref ? '&ref=' + encodeURIComponent(ref) : '');
    }
    root.addEventListener('input', run); run();
  }
  function init() { Array.prototype.forEach.call(document.querySelectorAll('[data-leaserun-widget]'), mount); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
