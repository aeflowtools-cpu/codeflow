// CodeFlow motion vocabulary. Every behaviour only writes ordinary keyframes / animators into the spec,
// so the result stays editable in After Effects (drag keys, change eases) and identical in the player.
import { Ease } from './index.mjs';

const at = (l, p) => { const v = l.get(p); return Ease.isAnim(v) ? v.k[v.k.length - 1].v : v; };
const mulv = (v, s) => v.map(x => x * s);

export function fadeIn(l, t, d = 0.3, ease = 'outCubic') { l.key('transform.opacity', [[t, 0, ease], [t + d, 100]]); return l; }
export function fadeOut(l, t, d = 0.3, ease = 'outCubic') { l.key('transform.opacity', [[t, at(l, 'transform.opacity'), ease], [t + d, 0]]); return l; }

// scale pop with overshoot (outBack as ONE bezier segment: exact in AE and the player)
export function pop(l, t, d = 0.45, { from = [0, 0], to, overshoot = 0.56 } = {}) {
  to = to || at(l, 'transform.scale');
  l.keyLocal('transform.scale', [[t, from, Ease.back(overshoot)], [t + d, to]]);
  return l;
}

// move from an offset to the layer's resting position
export function slideIn(l, t, d = 0.5, offset = [0, 60], ease = 'outCubic') {
  const p = at(l, 'transform.position');
  l.keyLocal('transform.position', [[t, [p[0] + offset[0], p[1] + offset[1]], ease], [t + d, p]]);
  return l;
}

function blurIndex(l) {
  let i = l.def.effects.findIndex(e => e.type === 'blur');
  if (i < 0) i = l.effect('blur', { amount: 0 });
  return i;
}

// zoom-whip out: scale up + blur + fade (0.28s, x1.6). blur is in AE Blurriness units: CSS blur(Npx) = cssBlur(N).amount (~3.6xN)
export function whipOut(l, t, { d = 0.28, scale = 1.6, blur = 22 } = {}) {
  const s = at(l, 'transform.scale');
  l.keyLocal('transform.scale', [[t, s, 'inQuad'], [t + d, mulv(s, scale)]]);
  const bi = blurIndex(l);
  l.key(`effects.${bi}.amount`, [[t, 0, 'inQuad'], [t + d, blur]]);
  l.key('transform.opacity', [[t + d * 0.45, 100, 'outCubic'], [t + d, 0]]);
  return l;
}

// zoom-whip in: lands from bigger + blurred, settles with outExpo
export function whipIn(l, t, { d = 0.6, from = 1.45, blur = 20, fade = 0.2 } = {}) {
  const s = at(l, 'transform.scale');
  l.keyLocal('transform.scale', [[t, mulv(s, from), 'outExpo'], [t + d, s]]);
  const bi = blurIndex(l);
  l.key(`effects.${bi}.amount`, [[t, blur, 'outExpo'], [t + d, 0]]);
  l.key('transform.opacity', [[t, 0, 'outCubic'], [t + fade, 100]]);
  return l;
}

// NOTE blur values are AE units (hidden.blur [12,12] ~ CSS blur(3.4px)); converting CSS blur(12px)? use cssBlur(12).amount.
// Word-by-word reveal on ONE text layer: one animator holding the hidden state, one Range Selector per word
// (Index/Words, [i, i+1)). Each word's Amount goes 100 -> 0 at its own time = a draggable key in AE.
export function wordReveal(l, times, { dur = 0.38, ease = 'outCubic', hidden = { opacity: 0, position: [0, 26], blur: [12, 12] }, name = 'Word Reveal' } = {}) {
  const words = l.def.text.text.trim().split(/\s+/);
  if (times.length !== words.length) throw new Error(`wordReveal "${l.def.name}": ${words.length} words but ${times.length} times`);
  const an = { name, props: hidden, selectors: [] };
  l.def.text.animators.push(an);
  const ai = l.def.text.animators.length - 1;
  words.forEach((w, i) => {
    an.selectors.push({ name: `${i + 1} ${w}`, start: i, end: i + 1, amount: 100 });
    l.key(`text.animators.${ai}.selectors.${i}.amount`, [[times[i], 100, ease], [times[i] + dur, 0]]);
  });
  return l;
}

// Keeps a centre-justified line centred on the words visible so far (reference style).
// m = kit measure() result for this exact text/font/size.
export function recenterOnReveal(l, times, m, { dur = 0.3, ease = 'outCubic' } = {}) {
  const base = at(l, 'transform.position');
  const W = m.width, x0 = m.words[0].x;
  const posFor = i => base[0] + W / 2 - (x0 + m.words[i].x + m.words[i].width) / 2;
  const overlap = times.some((t, i) => i > 1 && t < times[i - 1] + dur);
  if (!overlap) {
    const keys = [[times[0], [posFor(0), base[1]], ease]];
    for (let i = 1; i < times.length; i++) {
      if (times[i] - keys[keys.length - 1][0] > 0.02) keys.push([times[i], [posFor(i - 1), base[1]], ease]);
      keys.push([times[i] + dur, [posFor(i), base[1]], ease]);
    }
    l.keyLocal('transform.position', keys);
    return l;
  }
  // overlapping reveals: the line follows the newest word (like a per-frame script would) -> sample it exactly
  const bz = Ease.resolve(ease);
  const xAt = t => {
    let x = posFor(0);
    for (let i = 1; i < times.length; i++) {
      if (t < times[i]) break;
      const u = Math.min(1, (t - times[i]) / dur);
      x = posFor(i - 1) + (posFor(i) - posFor(i - 1)) * (bz === 'linear' ? u : Ease.bezier(bz, u));
    }
    return x;
  };
  const t0 = times[0], t1 = times[times.length - 1] + dur, n = Math.max(2, Math.round((t1 - t0) * 30));
  const keys = [];
  for (let i = 0; i <= n; i++) { const t = t0 + (t1 - t0) * i / n; keys.push([+t.toFixed(4), [xAt(t), base[1]], 'linear']); }
  l.keyLocal('transform.position', keys);
  return l;
}

// draw a path stroke on (trim end 0 -> 100)
export function drawOn(l, shapeIndex, t, d = 0.25, ease = 'outCubic') {
  l.key(`shapes.${shapeIndex}.trim.end`, [[t, 0, ease], [t + d, 100]]);
  return l;
}

// slow sine drift of a 2D property between base-amp and base+amp (keys at the extremes, inOutSine)
export function drift(l, prop, amp, period, t0, t1) {
  const base = at(l, prop);
  const keys = [];
  let s = 1;
  for (let t = t0; t <= t1 + 1e-6; t += period / 2) { keys.push([t, base.map((b, i) => b + amp[i] * s), 'inOutSine']); s = -s; }
  l.keyLocal(prop, keys);
  return l;
}
