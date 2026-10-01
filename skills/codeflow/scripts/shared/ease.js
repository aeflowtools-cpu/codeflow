/* CodeFlow shared easing + value interpolation.
 * One file, used by the Node kit (require) and the browser player (<script>), so both sides
 * evaluate keyframes with identical math. The AE builder never sees preset names: the kit
 * resolves them to [x1,y1,x2,y2] beziers before the spec is written.
 *
 * Keyframe model (spec):  { t: seconds, v: value, e: ease }   e = "linear" | "hold" | [x1,y1,x2,y2]
 * `e` belongs to the segment that STARTS at this key (like CSS). The last key's `e` is unused.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CodeFlowEase = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Named eases. Quad / Cubic / Back are the EXACT Penner polynomials (a cubic polynomial of time is exactly
  // a bezier with x1 = 1/3, x2 = 2/3), so they match hand-written JS eases 1:1. The rest are the usual
  // easings.net cubic-bezier approximations (see kit/easefit.mjs exactEase() for exact fits).
  var PRESETS = {
    linear: 'linear',
    hold: 'hold',
    easyEase: [0.333, 0, 0.667, 1],       // After Effects "Easy Ease" (33% influence, flat)
    easyEaseOut: [0.333, 0, 0.667, 1],
    outSine: [0.61, 1, 0.88, 1],
    inSine: [0.12, 0, 0.39, 0],
    inOutSine: [0.37, 0, 0.63, 1],
    outQuad: [1 / 3, 2 / 3, 2 / 3, 1],
    inQuad: [1 / 3, 0, 2 / 3, 1 / 3],
    inOutQuad: [0.45, 0, 0.55, 1],
    outCubic: [1 / 3, 1, 2 / 3, 1],
    inCubic: [1 / 3, 0, 2 / 3, 0],
    inOutCubic: [0.65, 0, 0.35, 1],
    outQuart: [0.25, 1, 0.5, 1],
    outQuint: [0.22, 1, 0.36, 1],
    inOutQuint: [0.83, 0, 0.17, 1],
    outExpo: [0.16, 1, 0.3, 1],
    inExpo: [0.7, 0, 0.84, 0],
    inOutExpo: [0.87, 0, 0.13, 1],
    outBack: [1 / 3, (1.70158 + 3) / 3, 2 / 3, 1],   // Penner outBack, s = 1.70158
    inBack: [0.36, 0, 0.66, -0.56],
  };

  // outBack with a chosen overshoot handle (0.567 = standard Penner outBack, 1.0 = strong pop).
  // Exact Penner outBack(s) is back((s + 3) / 3 - 1).
  function back(amount) { return [1 / 3, 1 + (amount == null ? 0.567 : amount), 2 / 3, 1]; }

  // per-axis ease: a list of eases (names or beziers), one per dimension, e.g. ['outCubic', [0.65,0,0.35,1]]
  function isPerDim(e) { return Array.isArray(e) && e.length > 0 && typeof e[0] !== 'number'; }
  function resolve(e) {
    if (e == null) return PRESETS.outCubic;
    if (isPerDim(e)) return e.map(function (x) { var r = resolve(x); if (!Array.isArray(r)) throw new Error('CodeFlow: per-axis eases must be beziers'); return r; });
    if (typeof e === 'string') {
      if (!(e in PRESETS)) throw new Error('CodeFlow: unknown ease "' + e + '"');
      return PRESETS[e];
    }
    if (Array.isArray(e) && e.length === 4) {
      if (!(e[0] >= 0 && e[0] <= 1 && e[2] >= 0 && e[2] <= 1)) throw new Error('CodeFlow: bezier x values must be within 0..1 (like CSS cubic-bezier): ' + e);
      return e;
    }
    throw new Error('CodeFlow: bad ease ' + JSON.stringify(e));
  }

  // cubic-bezier(x1,y1,x2,y2) evaluated at progress x (0..1): solve B_x(u)=x, return B_y(u)
  function bezier(b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var x1 = b[0], y1 = b[1], x2 = b[2], y2 = b[3];
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(u) { return ((ax * u + bx) * u + cx) * u; }
    function dsx(u) { return (3 * ax * u + 2 * bx) * u + cx; }
    var u = x, i, d;
    for (i = 0; i < 8; i++) {           // Newton
      var err = sx(u) - x;
      if (Math.abs(err) < 1e-7) break;
      d = dsx(u);
      if (Math.abs(d) < 1e-6) break;
      u -= err / d;
    }
    if (!(u >= 0 && u <= 1) || Math.abs(sx(u) - x) > 1e-6) { // bisection fallback
      var lo = 0, hi = 1; u = x;
      for (i = 0; i < 60; i++) {
        var v = sx(u);
        if (Math.abs(v - x) < 1e-7) break;
        if (v < x) lo = u; else hi = u;
        u = (lo + hi) / 2;
      }
    }
    return ((ay * u + by) * u + cy) * u;
  }

  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
  }
  function rgbToHex(c) {
    function p(x) { var s = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + p(c[0]) + p(c[1]) + p(c[2]);
  }
  function isColor(v) { return typeof v === 'string' && v.charAt(0) === '#'; }

  function lerp(a, b, f) {
    if (typeof a === 'number') return a + (b - a) * f;
    if (isColor(a)) { var ca = hexToRgb(a), cb = hexToRgb(b); return rgbToHex([ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]); }
    if (Array.isArray(a)) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] + (b[i] - a[i]) * f); return o; }
    return f < 1 ? a : b;   // strings etc. behave like hold
  }

  function isAnim(x) { return x != null && typeof x === 'object' && !Array.isArray(x) && Array.isArray(x.k); }

  // value of an animatable at time t (AE semantics: before first key = first value, after last = last)
  function valueAt(x, t) {
    if (!isAnim(x)) return x;
    var k = x.k, n = k.length;
    if (n === 0) return undefined;
    if (t <= k[0].t || n === 1) return k[0].v;
    if (t >= k[n - 1].t) return k[n - 1].v;
    var i = 0;
    while (i < n - 2 && t >= k[i + 1].t) i++;
    var a = k[i], b = k[i + 1];
    if (a.e === 'hold') return a.v;
    var u = (t - a.t) / (b.t - a.t);
    if (isPerDim(a.e) && Array.isArray(a.v)) {             // one ease per axis
      var o = [];
      for (var d = 0; d < a.v.length; d++) o.push(a.v[d] + (b.v[d] - a.v[d]) * bezier(a.e[d] || a.e[0], u));
      return o;
    }
    var f = a.e === 'linear' ? u : bezier(isPerDim(a.e) ? a.e[0] : a.e, u);
    return lerp(a.v, b.v, f);
  }

  return { PRESETS: PRESETS, back: back, resolve: resolve, isPerDim: isPerDim, bezier: bezier, valueAt: valueAt, isAnim: isAnim, lerp: lerp, hexToRgb: hexToRgb, rgbToHex: rgbToHex, isColor: isColor };
});
