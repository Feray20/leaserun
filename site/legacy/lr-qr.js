/* Minimal QR code generator (byte mode, error correction level M, versions 1-10).
 * window.LRQR.svg(text, sizePx) -> SVG string; window.LRQR.matrix(text) -> boolean[][]
 */
(function (root) {
  'use strict';
  // [total codewords, ec per block, [blocks, data per block], [blocks, data per block]]
  var SPEC = [null,
    [26, 10, [1, 16]], [44, 16, [1, 28]], [70, 26, [1, 44]], [100, 18, [2, 32]], [134, 24, [2, 43]],
    [172, 16, [4, 27]], [196, 18, [4, 31]], [242, 22, [2, 38], [2, 39]], [292, 22, [3, 36], [2, 37]], [346, 26, [4, 43], [1, 44]]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  var EXP = new Array(512), LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsGen(n) { var g = [1]; for (var i = 0; i < n; i++) { var ng = new Array(g.length + 1).fill(0); for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= gmul(g[j], EXP[i]); } g = ng; } return g; }
  function rsEc(data, n) {
    var g = rsGen(n), res = data.concat(new Array(n).fill(0));
    for (var i = 0; i < data.length; i++) { var c = res[i]; if (c) for (var j = 0; j < g.length; j++) res[i + j] ^= gmul(g[j], c); }
    return res.slice(data.length);
  }
  function utf8(s) { return Array.prototype.slice.call(new TextEncoder().encode(s)); }
  function dataCap(v) { var s = SPEC[v], n = s[2][0] * s[2][1]; if (s[3]) n += s[3][0] * s[3][1]; return n; }

  function encode(text) {
    var bytes = utf8(text), v;
    for (v = 1; v <= 10; v++) { var cc = v < 10 ? 8 : 16; if (Math.ceil((4 + cc + bytes.length * 8) / 8) <= dataCap(v)) break; }
    if (v > 10) throw new Error('QR payload too long');
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCap(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; data.push(b); }
    for (var p = 0; data.length < dataCap(v); p++) data.push(p % 2 ? 0x11 : 0xEC);
    // blocks
    var s = SPEC[v], blocks = [], ecs = [], off = 0;
    [s[2], s[3]].forEach(function (g) { if (!g) return; for (var bi = 0; bi < g[0]; bi++) { var blk = data.slice(off, off + g[1]); off += g[1]; blocks.push(blk); ecs.push(rsEc(blk, s[1])); } });
    var out = [], mx = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (i = 0; i < mx; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (i = 0; i < s[1]; i++) ecs.forEach(function (e) { out.push(e[i]); });
    return { v: v, cw: out };
  }

  function bch(val, poly, polyLen) { var x = val << (polyLen - 1); for (var i = 31; i >= polyLen - 1; i--) if ((x >>> i) & 1) x ^= poly << (i - polyLen + 1); return x; }

  function build(text) {
    var e = encode(text), v = e.v, N = 17 + 4 * v;
    var m = [], fn = [];
    for (var r = 0; r < N; r++) { m.push(new Array(N).fill(false)); fn.push(new Array(N).fill(false)); }
    function set(r, c, val) { m[r][c] = val; fn[r][c] = true; }
    function finder(r0, c0) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        var on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, on);
      }
    }
    finder(0, 0); finder(0, N - 7); finder(N - 7, 0);
    for (var i = 8; i < N - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var al = ALIGN[v];
    var last = al.length - 1;
    al.forEach(function (ar, ai) { al.forEach(function (ac, aj) {
      if ((ai === 0 && aj === 0) || (ai === 0 && aj === last) || (ai === last && aj === 0)) return;
      for (var r = -2; r <= 2; r++) for (var c = -2; c <= 2; c++) set(ar + r, ac + c, Math.max(Math.abs(r), Math.abs(c)) !== 1);
    }); });
    set(N - 8, 8, true); // dark module
    // reserve format + version areas
    for (i = 0; i < 9; i++) { if (!fn[8][i]) set(8, i, false); if (!fn[i][8]) set(i, 8, false); }
    for (i = 0; i < 8; i++) { set(8, N - 1 - i, false); set(N - 1 - i, 8, false); }
    set(N - 8, 8, true);
    if (v >= 7) { for (i = 0; i < 6; i++) for (var j = 0; j < 3; j++) { set(N - 11 + j, i, false); set(i, N - 11 + j, false); } }
    // place data
    var bits = []; e.cw.forEach(function (b) { for (var k = 7; k >= 0; k--) bits.push((b >>> k) & 1); });
    var idx = 0, up = true;
    for (var col = N - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (var t = 0; t < N; t++) {
        var row = up ? N - 1 - t : t;
        for (var dc = 0; dc < 2; dc++) { var cc2 = col - dc; if (fn[row][cc2]) continue; m[row][cc2] = idx < bits.length ? !!bits[idx] : false; idx++; }
      }
      up = !up;
    }
    var MASKS = [function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; }, function (r, c) { return (r + c) % 3 === 0; },
      function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; }, function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; },
      function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; }, function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }];
    function withMask(k) {
      var g = m.map(function (row) { return row.slice(); });
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (!fn[r][c] && MASKS[k](r, c)) g[r][c] = !g[r][c];
      var fmt = ((0 << 3) | k) << 10; fmt = (fmt | bch((0 << 3) | k, 0x537, 11)) ^ 0x5412; // level M = 00
      for (var i = 0; i < 15; i++) {
        var bit = ((fmt >>> i) & 1) === 1;
        if (i < 6) g[i][8] = bit; else if (i < 8) g[i + 1][8] = bit; else if (i === 8) g[8][7] = bit; else g[8][14 - i] = bit;
        if (i < 8) g[8][N - 1 - i] = bit; else g[N - 15 + i][8] = bit;
      }
      g[N - 8][8] = true;
      if (v >= 7) {
        var vi = (v << 12) | bch(v, 0x1F25, 13);
        for (i = 0; i < 18; i++) { var b2 = ((vi >>> i) & 1) === 1, a = Math.floor(i / 3), bb = i % 3 + N - 11; g[a][bb] = b2; g[bb][a] = b2; }
      }
      return g;
    }
    function penalty(g) {
      var p = 0, r, c, run;
      for (r = 0; r < N; r++) { run = 1; for (c = 1; c < N; c++) { if (g[r][c] === g[r][c - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (c = 0; c < N; c++) { run = 1; for (r = 1; r < N; r++) { if (g[r][c] === g[r - 1][c]) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; } }
      for (r = 0; r < N - 1; r++) for (c = 0; c < N - 1; c++) if (g[r][c] === g[r][c + 1] && g[r][c] === g[r + 1][c] && g[r][c] === g[r + 1][c + 1]) p += 3;
      var dark = 0; for (r = 0; r < N; r++) for (c = 0; c < N; c++) if (g[r][c]) dark++;
      p += Math.floor(Math.abs(dark * 20 - N * N * 10) / (N * N)) * 10;
      return p;
    }
    var best = null, bestP = Infinity;
    for (var k = 0; k < 8; k++) { var g = withMask(k), pp = penalty(g); if (pp < bestP) { bestP = pp; best = g; } }
    return best;
  }

  function svg(text, px) {
    var g = build(text), N = g.length, q = 4, S = N + q * 2, d = '';
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) if (g[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" width="' + (px || 120) + '" height="' + (px || 120) + '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="' + S + '" height="' + S + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }
  var api = { matrix: build, svg: svg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LRQR = api;
})(typeof window !== 'undefined' ? window : this);
