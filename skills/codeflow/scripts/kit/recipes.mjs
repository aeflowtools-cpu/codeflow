// Ready-made layer recipes for looks CSS/SVG gives in one line but After Effects builds from parts.
// Everything is native (shape/solid layers + calibrated effects), so it stays editable and matches the player.
import { ellipse } from './index.mjs';

// SVG/CSS radial-gradient with LINEAR falloff (alpha A at the centre -> 0 at the edge):
// N concentric ellipses whose stacked alpha reproduces A*(1-r), plus a light blur to hide the steps.
//   radialGlow(c, 'Glow', { center: [0, 1076], radius: [1056, 648], color: '#9AD6FA', alpha: 0.95 })
export function radialGlow(c, name, { center, radius, color, alpha = 1, steps = 16, blur, parent } = {}) {
  const [rx, ry] = Array.isArray(radius) ? radius : [radius, radius];
  const T = i => (i > steps ? 0 : alpha * (1 - (i - 0.5) / steps));     // target alpha in ring band i (1 = innermost)
  const shapes = [];
  for (let i = steps; i >= 1; i--) {                                   // outermost first = bottom
    const a = 1 - (1 - T(i)) / (1 - T(i + 1));
    shapes.push(ellipse({ name: `Ring ${i}`, size: [2 * rx * i / steps, 2 * ry * i / steps], fill: { color, opacity: +(a * 100).toFixed(3) } }));
  }
  const l = c.shape(name, { position: center, parent, shapes });
  l.effect('blur', { amount: blur != null ? blur : +(Math.min(rx, ry) / steps / 0.28 * 0.6).toFixed(1) });
  return l;
}

// Linear gradient with ANY number of stops (CSS linear-gradient), as stacked full-frame solids with a
// 2-colour Gradient Ramp each; every extra solid is masked to start where its segment starts. Exact.
//   linearGradient(c, 'BG', { from: [960, 0], to: [960, 1080], stops: ['#021A30', '#064583', '#0A6CC4'] })
//   stops may be ['#hex', …] (evenly spaced) or [[offset 0..1, '#hex'], …]
export function linearGradient(c, name, { from, to, stops, w = c.def.w, h = c.def.h } = {}) {
  const st = stops.map((s, i) => (Array.isArray(s) ? s : [i / (stops.length - 1), s]));
  const P = u => [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u];
  const dx = to[0] - from[0], dy = to[1] - from[1], len = Math.hypot(dx, dy) || 1;
  const nx = dx / len, ny = dy / len, px = -ny, py = nx, BIG = 4 * (w + h);
  const layers = [];
  for (let i = 0; i < st.length - 1; i++) {
    const [u0, c0] = st[i], [u1, c1] = st[i + 1];
    const s = c.solid(st.length > 2 ? `${name} ${i + 1}` : name, { color: c0, w, h });
    s.effect('ramp', { start: P(u0), end: P(u1), from: c0, to: c1 });
    if (i > 0) {   // keep only the half-plane from this segment's start onwards (layer space = comp space for a full-frame solid)
      const [sx, sy] = P(u0);
      const v = [[sx + px * BIG, sy + py * BIG], [sx + px * BIG + nx * BIG, sy + py * BIG + ny * BIG], [sx - px * BIG + nx * BIG, sy - py * BIG + ny * BIG], [sx - px * BIG, sy - py * BIG]];
      s.mask({ v, i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), c: true });
    }
    layers.push(s);
  }
  return layers;
}
