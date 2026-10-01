// Converters from web/CSS/GSAP values to CodeFlow (AE) values — uses the calibrated constants, so a
// converted blur/shadow LOOKS like the browser original in both the player and After Effects.
import { Ease } from './index.mjs';

// calibrated against AE 24.5 (tests/calibration): player sigma = K * AE value
const K_BLUR = 0.28, K_SOFT = 0.22;

// 'rgba(2, 26, 48, 0.38)' | '#0b1426' | 'rgb(1,2,3)' -> { hex: '#02..', alpha: 0..1 }
export function cssColor(s) {
  s = String(s).trim();
  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = h.split('').map(c => c + c).join('');
    return { hex: '#' + h.slice(0, 6).toLowerCase(), alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (m) {
    const p = x => Math.round(Math.max(0, Math.min(255, +x))).toString(16).padStart(2, '0');
    let a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
    return { hex: '#' + p(m[1]) + p(m[2]) + p(m[3]), alpha: a };
  }
  if (s === 'transparent') return { hex: '#000000', alpha: 0 };
  throw new Error('cssColor: unsupported colour ' + s);
}

// CSS filter: blur(Npx)  (N = standard deviation)  ->  effect { type:'blur', amount }
export const cssBlur = px => ({ type: 'blur', amount: +(px / K_BLUR).toFixed(2) });

// CSS box-shadow "0 18px 56px rgba(2,26,48,.38)" (blur radius R -> sigma R/2)  -> effect { type:'dropShadow', ... }
// filter: drop-shadow(x y r color) uses r as the sigma directly: pass { filter: true }
export function cssShadow(str, { filter = false } = {}) {
  const colorM = str.match(/(rgba?\([^)]*\)|#[0-9a-f]{3,8}|transparent)/i);
  const c = colorM ? cssColor(colorM[1]) : { hex: '#000000', alpha: 1 };
  const nums = str.replace(colorM ? colorM[1] : '', '').match(/-?[\d.]+px|-?[\d.]+(?=\s|$)/g) || [];
  const [x = 0, y = 0, r = 0] = nums.map(parseFloat);
  const sigma = filter ? r : r / 2;
  const dist = Math.hypot(x, y);
  const dir = dist ? ((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360 : 180;   // AE: 0 = up, clockwise
  if (/inset/.test(str)) throw new Error('cssShadow: inset shadows are not supported (use an inner shape instead)');
  return { type: 'dropShadow', color: c.hex, opacity: +(c.alpha * 100).toFixed(1), direction: +dir.toFixed(2), distance: +dist.toFixed(2), softness: +(sigma / K_SOFT).toFixed(2) };
}

// GSAP / CSS easing names -> CodeFlow ease (bezier). Elastic/bounce/steps/spring are not one bezier:
// use sampleKeys() for those.
const GSAP = {
  none: 'linear', linear: 'linear',
  'power1.in': 'inQuad', 'power1.out': 'outQuad', 'power1.inOut': 'inOutQuad',
  'power2.in': 'inCubic', 'power2.out': 'outCubic', 'power2.inOut': 'inOutCubic',
  'power3.in': [0.5, 0, 0.75, 0], 'power3.out': 'outQuart', 'power3.inOut': [0.76, 0, 0.24, 1],
  'power4.in': [0.64, 0, 0.78, 0], 'power4.out': 'outQuint', 'power4.inOut': 'inOutQuint',
  'sine.in': 'inSine', 'sine.out': 'outSine', 'sine.inOut': 'inOutSine',
  'expo.in': 'inExpo', 'expo.out': 'outExpo', 'expo.inOut': 'inOutExpo',
  'circ.in': [0.55, 0, 1, 0.45], 'circ.out': [0, 0.55, 0.45, 1], 'circ.inOut': [0.85, 0, 0.15, 1],
  'back.in': 'inBack', 'back.out': 'outBack',
  ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
};
export function webEase(name) {
  if (Array.isArray(name)) return name;
  let s = String(name).trim();
  let m = s.match(/cubic-bezier\(([^)]+)\)/);
  if (m) return m[1].split(',').map(Number);
  m = s.match(/^back\.out\(([\d.]+)\)$/);                   // GSAP back.out(1.7) ~ overshoot
  if (m) return [1 / 3, (+m[1] + 3) / 3, 2 / 3, 1];          // exact: back.out(s) is a cubic polynomial
  s = s.replace(/^(power\d|sine|expo|circ|back)$/, '$1.out'); // GSAP default = .out
  if (s in GSAP) return Ease.resolve(GSAP[s]);
  if (s in Ease.PRESETS) return Ease.resolve(s);
  throw new Error(`webEase: "${name}" is not a single bezier (elastic/bounce/spring/steps) - use sampleKeys()`);
}

// For motion no single bezier can express (spring, elastic, bounce, custom JS): sample it into linear keys.
// fn(u) -> value for u in 0..1 ; returns keys for layer.key(path, keys)
export function sampleKeys(t0, t1, fn, fps = 30) {
  const n = Math.max(2, Math.round((t1 - t0) * fps));
  const keys = [];
  for (let i = 0; i <= n; i++) keys.push([+(t0 + (t1 - t0) * i / n).toFixed(4), fn(i / n), 'linear']);
  return keys;
}

// Point-text baseline from a probe of the original (probe gives e.baseline = {x, y})
// center/right justified text: use the line's box centre / right edge as x.
export function textAnchor(probeEl, justify = 'left') {
  const [x, , w] = probeEl.lines && probeEl.lines[0] ? probeEl.lines[0] : probeEl.box;
  const y = probeEl.baseline ? probeEl.baseline.y : probeEl.box[1] + probeEl.box[3] * 0.8;
  return [justify === 'center' ? x + w / 2 : justify === 'right' ? x + w : x, y];
}
