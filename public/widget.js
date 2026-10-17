/* ImmoAdv-Widget: <script src="https://immoadv.de/widget.js" data-immoadv="ihr-name" async></script>
   Bettet den Finanzierungsrechner des Partners als iFrame ein. Setzt keine Cookies und lädt nichts weiter. */
(function () {
  var s = document.currentScript || document.querySelector('script[data-immoadv]');
  if (!s) return;
  var slug = (s.getAttribute('data-immoadv') || '').toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return;
  var origin = new URL(s.src).origin;
  var f = document.createElement('iframe');
  f.src = origin + '/p/' + slug + '?embed=1';
  f.title = 'Finanzierungsrechner';
  f.loading = 'lazy';
  f.style.cssText = 'width:100%;min-height:640px;border:0;border-radius:12px;display:block';
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || e.source !== f.contentWindow || !e.data || e.data.immoadv !== 'height') return;
    var h = Number(e.data.h);
    if (h > 200 && h < 6000) f.style.height = h + 'px';
  });
})();
