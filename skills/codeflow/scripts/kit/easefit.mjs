// Exact / best-fit bezier eases from the JS easing math Claude-made videos use.
//  - Any cubic POLYNOMIAL of time (quad, cubic, back(s), Hermite spline segments, sub-ranges of those)
//    is EXACTLY a cubic-bezier with x1 = 1/3, x2 = 2/3.
//  - Anything else (expo, sine, circ, quart, quint, custom) is fitted (minimax, Nelder-Mead), error reported.
// Usage:
//   exactEase(EASE_FN.outCubic)                 -> [1/3, 1, 2/3, 1]            (exact)
//   exactEase(EASE_FN.outExpo)                  -> fitted bezier (max error in exactEase.lastError)
//   exactEase(f, 0.2, 0.7)                      -> ease of the part of f between u=0.2 and u=0.7
//   splineKeys([{t, v:[x,y]}, …])               -> keys with PER-AXIS eases reproducing a Catmull/Hermite camera
//   sineKeys(t0, t1, A, w, p, B)                -> value(t) = A*sin(w t + p) + B as keys at its extremes
import { Ease } from './index.mjs';

// Robert Penner / easings.net functions (what hand-written seek(t) timelines usually contain)
export const EASE_FN = {
  linear: u => u,
  inQuad: u => u * u, outQuad: u => 1 - (1 - u) * (1 - u), inOutQuad: u => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  inCubic: u => u * u * u, outCubic: u => 1 - Math.pow(1 - u, 3), inOutCubic: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  inQuart: u => u ** 4, outQuart: u => 1 - Math.pow(1 - u, 4), inOutQuart: u => (u < 0.5 ? 8 * u ** 4 : 1 - Math.pow(-2 * u + 2, 4) / 2),
  inQuint: u => u ** 5, outQuint: u => 1 - Math.pow(1 - u, 5), inOutQuint: u => (u < 0.5 ? 16 * u ** 5 : 1 - Math.pow(-2 * u + 2, 5) / 2),
  inSine: u => 1 - Math.cos(u * Math.PI / 2), outSine: u => Math.sin(u * Math.PI / 2), inOutSine: u => -(Math.cos(Math.PI * u) - 1) / 2,
  inExpo: u => (u <= 0 ? 0 : Math.pow(2, 10 * u - 10)), outExpo: u => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  inOutExpo: u => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2),
  inCirc: u => 1 - Math.sqrt(1 - u * u), outCirc: u => Math.sqrt(1 - Math.pow(u - 1, 2)),
  outBack: (u, s = 1.70158) => 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2),
  inBack: (u, s = 1.70158) => (s + 1) * u * u * u - s * u * u,
};
export const backFn = s => u => EASE_FN.outBack(u, s);

const clampX = b => [Math.min(1, Math.max(0, b[0])), b[1], Math.min(1, Math.max(0, b[2])), b[3]];
function norm(f, u0, u1) { const a = f(u0), b = f(u1); return v => (f(u0 + v * (u1 - u0)) - a) / (b - a); }
function maxErr(bz, g) { let e = 0; for (let i = 1; i < 100; i++) { const v = i / 100; e = Math.max(e, Math.abs(Ease.bezier(bz, v) - g(v))); } return e; }
function nelderMead(fn, x0, iters = 1500) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += 0.08; pts.push(p); }
  let vals = pts.map(fn);
  for (let it = 0; it < iters; it++) {
    const idx = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
    pts = idx.map(i => pts[i]); vals = idx.map(i => vals[i]);
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const w = pts[n], xr = c.map((cj, j) => cj + (cj - w[j])), fr = fn(xr);
    if (fr < vals[0]) { const xe = c.map((cj, j) => cj + 2 * (cj - w[j])), fe = fn(xe); if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; } }
    else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((cj, j) => cj + 0.5 * (w[j] - cj)), fc = fn(xc);
      if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
      else for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((x, j) => pts[0][j] + 0.5 * (x - pts[0][j])); vals[i] = fn(pts[i]); }
    }
  }
  return pts[0];
}

// ease (bezier) of a key segment whose value follows f(u) for u in [u0,u1]; exact for cubic polynomials
export function exactEase(f, u0 = 0, u1 = 1) {
  const g = norm(f, u0, u1), h = 1e-5;
  const d0 = (g(h) - g(0)) / h, d1 = (g(1) - g(1 - h)) / h;
  let bz = clampX([1 / 3, d0 / 3, 2 / 3, 1 - d1 / 3]);
  let e = maxErr(bz, g);
  if (e > 2e-3) {
    const obj = p => maxErr(clampX(p), g) + (p[0] < 0 || p[0] > 1 || p[2] < 0 || p[2] > 1 ? 1 : 0);
    let best = bz, be = e;
    for (const c of [bz, [0.25, 0.1, 0.25, 1], [0.42, 0, 0.58, 1], [0.16, 1, 0.3, 1], [0.5, 0, 0.75, 0]]) {
      const r = clampX(nelderMead(obj, c)), er = maxErr(r, g);
      if (er < be) { best = r; be = er; }
    }
    bz = best; e = be;
  }
  exactEase.lastError = e;
  return bz.map(x => +x.toFixed(5));
}
exactEase.lastError = 0;

// Hermite / Catmull-Rom path through points (what camAt()-style helpers do): tangents from neighbours,
// zero speed at both ends. Returns keys with PER-AXIS eases -> exact in the player and in AE (separated X/Y).
//   points: [{ t, v: [x, y] }, …]
export function splineKeys(points, { zeroEnds = true } = {}) {
  const n = points.length, dims = points[0].v.length;
  const tan = (i, d) => {
    if (zeroEnds && (i === 0 || i === n - 1)) return 0;
    const a = points[Math.max(0, i - 1)], b = points[Math.min(n - 1, i + 1)];
    return (b.v[d] - a.v[d]) / (b.t - a.t);
  };
  return points.map((p, i) => {
    if (i === n - 1) return [p.t, p.v];
    const q = points[i + 1], dt = q.t - p.t;
    const eases = [];
    for (let d = 0; d < dims; d++) {
      const dv = q.v[d] - p.v[d];
      if (Math.abs(dv) < 1e-9) { eases.push([1 / 3, 0, 2 / 3, 1]); continue; }
      eases.push([1 / 3, +(tan(i, d) * dt / (3 * dv)).toFixed(6), 2 / 3, +(1 - tan(i + 1, d) * dt / (3 * dv)).toFixed(6)]);
    }
    return [p.t, p.v, dims === 1 ? eases[0] : eases];
  });
}

// value(t) = A*sin(w t + p) + B over [t0,t1] as keys at its extremes with fitted eases
export function sineKeys(t0, t1, A, w, p = 0, B = 0) {
  const f = t => A * Math.sin(w * t + p) + B;
  const knots = [t0];
  for (let k = Math.ceil(((w * t0 + p) - Math.PI / 2) / Math.PI); ; k++) {
    const t = (Math.PI / 2 + k * Math.PI - p) / w;
    if (t >= t1 - 1e-6) break;
    if (t > t0 + 1e-6) knots.push(t);
  }
  knots.push(t1);
  return knots.map((a, i) => (i === knots.length - 1 ? [a, f(a)] : [a, f(a), exactEase(u => f(a + u * (knots[i + 1] - a)))]));
}

// time u in [0,1] where m*f(u) first reaches 1 (for "clamp(k * m)" style fades)
export function reach(f, m) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (m * f(mid) >= 1) hi = mid; else lo = mid; }
  return hi;
}
