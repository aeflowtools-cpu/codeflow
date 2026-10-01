// CodeFlow kit — authoring API that writes a CodeFlow Motion Spec (see ../SPEC.md).
//   const P = new Project({ name, dir });  const c = P.comp('S01', 'S01 - Cards', { duration: 5 });
//   const card = c.shape('Card', { position: [960, 540], shapes: [rect({ size: [600, 400], roundness: 30, fill: '#fff' })] });
//   card.key('transform.scale', [[0, [80, 80], 'outBack'], [0.6, [100, 100]]]);
//   await P.save('scene.codeflow.json');
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { findFont, ensureFont } from './fonts.mjs';
import { measure as browserMeasure } from './browser.mjs';
import { probeMedia } from './media.mjs';

const require = createRequire(import.meta.url);
export const Ease = require('../shared/ease.js');

// ---------- small helpers ----------
const clone = x => JSON.parse(JSON.stringify(x));
const vec2 = v => (v == null ? v : typeof v === 'number' ? [v, v] : v);

function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  throw new Error('CodeFlow: cannot read image size of ' + file);
}

function normKeys(keys, defEase = 'outCubic') {
  return keys.map(k => {
    const [t, v, e] = Array.isArray(k) ? k : [k.t, k.v, k.e];
    return { t: +(+t).toFixed(4), v: clone(v), e: Ease.resolve(e == null ? defEase : e) };
  }).sort((a, b) => a.t - b.t);
}

// ---------- rest-pose matrices (parenting like AE's pick-whip: author in comp space, store parent space) ----------
const first = v => (Ease.isAnim(v) ? v.k[0].v : v);
function localRest(tr) {
  const a = first(tr.anchor) || [0, 0], p = first(tr.position) || [0, 0], s = first(tr.scale) || [100, 100];
  const r = (first(tr.rotation) || 0) * Math.PI / 180, c = Math.cos(r), n = Math.sin(r), sx = s[0] / 100, sy = s[1] / 100;
  const m = [c * sx, n * sx, -n * sy, c * sy, 0, 0];
  m[4] = p[0] - (m[0] * a[0] + m[2] * a[1]); m[5] = p[1] - (m[1] * a[0] + m[3] * a[1]);
  return m;
}
const mmul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
function minv(m) { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; }
const mapPt = (m, p) => [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];

function getAt(obj, parts) { let o = obj; for (const p of parts) { if (o == null) return undefined; o = o[p]; } return o; }
function setAt(obj, parts, val) {
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (o[p] == null) o[p] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[p];
  }
  o[parts[parts.length - 1]] = val;
}

// ---------- shape item helpers (used in layer.shapes) ----------
export function rect(o) { return { name: o.name || 'Rect', kind: 'rect', size: o.size, position: o.position || [0, 0], roundness: o.roundness || 0, fill: paint(o.fill), stroke: stroke(o.stroke, o.strokeWidth), trim: o.trim || null }; }
export function ellipse(o) { return { name: o.name || 'Ellipse', kind: 'ellipse', size: vec2(o.size), position: o.position || [0, 0], fill: paint(o.fill), stroke: stroke(o.stroke, o.strokeWidth), trim: o.trim || null }; }
export function pathShape(o) { return { name: o.name || 'Path', kind: 'path', path: o.path, fill: paint(o.fill), stroke: stroke(o.stroke, o.strokeWidth, o), trim: o.trim || null }; }
function paint(p) { if (!p) return null; return typeof p === 'string' ? { color: p, opacity: 100 } : { color: p.color, opacity: p.opacity == null ? 100 : p.opacity }; }
function stroke(s, w, o = {}) {
  if (!s) return null;
  const st = typeof s === 'string' ? { color: s } : { ...s };
  st.width = st.width != null ? st.width : (w != null ? w : 2);
  st.opacity = st.opacity == null ? 100 : st.opacity;
  st.cap = st.cap || o.cap || 'butt'; st.join = st.join || o.join || 'miter';
  if (o.dash && !st.dash) st.dash = o.dash;
  return st;
}

// ---------- Layer ----------
export class Layer {
  constructor(comp, type, name, o = {}) {
    this.comp = comp;
    const W = comp.def.w, H = comp.def.h;
    this.def = { id: `${comp.def.id}_${++comp.project._n}`, name, type };
    const d = this.def;
    if (o.parent) d.parent = typeof o.parent === 'string' ? o.parent : o.parent.def.id;
    d.in = o.in == null ? 0 : o.in;
    d.out = o.out == null ? comp.def.duration : o.out;
    if (o.start) d.start = o.start;
    let anchor = [0, 0], pos = [0, 0];
    if (type === 'null') { anchor = [50, 50]; }   // AE nulls are 100x100 with a centred anchor
    if (type === 'image' || type === 'video') { const a = comp.project.def.assets[o.asset]; anchor = [a.w / 2, a.h / 2]; pos = [W / 2, H / 2]; }
    if (type === 'solid') { anchor = [o.w / 2, o.h / 2]; pos = [W / 2, H / 2]; }
    if (type === 'precomp') { const c = comp.project.comps[o.comp]; anchor = [c.def.w / 2, c.def.h / 2]; pos = [W / 2, H / 2]; }
    d.transform = {
      anchor: o.anchor != null ? o.anchor : anchor,
      position: o.position != null ? o.position : pos,
      scale: vec2(o.scale != null ? o.scale : 100),
      rotation: o.rotation || 0,
      opacity: o.opacity == null ? 100 : o.opacity,
    };
    d.effects = [];
    d.masks = [];
    // With o.parent the given position/scale/rotation are COMP-space (as if the parent were at rest);
    // convert to parent space exactly like AE's pick-whip. Use o.space = 'parent' to pass raw values.
    this._conv = null;
    if (o.parent && o.space !== 'parent') {
      const par = typeof o.parent === 'string' ? comp.stack.find(l => l.def.id === o.parent) : o.parent;
      const pw = par.restWorld(), inv = minv(pw);
      const psx = Math.hypot(pw[0], pw[1]), psy = Math.hypot(pw[2], pw[3]), prot = Math.atan2(pw[1], pw[0]) * 180 / Math.PI;
      this._conv = {
        'transform.position': v => mapPt(inv, v),
        'transform.scale': v => [v[0] / psx, v[1] / psy],
        'transform.rotation': v => v - prot,
      };
      const tr = d.transform;
      tr.position = this._conv['transform.position'](tr.position);
      tr.scale = this._conv['transform.scale'](tr.scale);
      tr.rotation = this._conv['transform.rotation'](tr.rotation);
    }
    this._rest = clone(d.transform);
  }
  // the pose children are converted against: this layer's transform as it was when it was CREATED
  // (so children can be added even after the parent has been animated)
  restWorld() {
    const m = localRest(this._rest || this.def.transform);
    if (!this.def.parent) return m;
    const par = this.comp.stack.find(l => l.def.id === this.def.parent);
    return mmul(par.restWorld(), m);
  }
  get id() { return this.def.id; }
  set(p, v) { setAt(this.def, p.split('.'), clone(v)); return this; }
  get(p) { return getAt(this.def, p.split('.')); }
  // keys: [[t, value, ease?], ...]  ease = preset name | [x1,y1,x2,y2] | 'linear' | 'hold' (applies from this key to the next)
  // Values are COMP-space for position/scale/rotation of parented layers (converted like the pick-whip).
  key(p, keys, defEase, local = false) {
    const parts = p.split('.');
    const cur = getAt(this.def, parts);
    let list = normKeys(keys, defEase);
    if (!local && this._conv && this._conv[p]) list.forEach(k => { k.v = this._conv[p](k.v); });
    if (Ease.isAnim(cur)) {
      const merged = cur.k.filter(k => !list.some(n => Math.abs(n.t - k.t) < 1e-4)).concat(list);
      list = merged.sort((a, b) => a.t - b.t);
    }
    setAt(this.def, parts, { k: list });
    return this;
  }
  // Same as key() but values are already in this layer's own (parent) space, e.g. read back with get()
  keyLocal(p, keys, defEase) { return this.key(p, keys, defEase, true); }
  // effect('blur', { amount: 10 })  or  effect(cssShadow('0 10px 30px rgba(0,0,0,.3)'))  -> returns the effect index
  effect(type, params = {}) {
    const fx = typeof type === 'object' ? clone(type) : { ...clone(params), type };
    this.def.effects.push(fx);
    return this.def.effects.length - 1;
  }
  mask(pathObj, o = {}) { this.def.masks.push({ path: pathObj, mode: 'add', inverted: false, opacity: 100, feather: [0, 0], ...o }); return this; }
  // raw parenting: this layer's current values are ALREADY in the parent's space (no conversion)
  parentTo(l) { this.def.parent = l.def.id; return this; }
}

// ---------- Comp ----------
export class Comp {
  constructor(project, id, name, o) {
    this.project = project;
    this.def = { id, name, w: o.w || 1920, h: o.h || 1080, duration: o.duration, layers: [] };
    if (o.bgColor) this.def.bgColor = o.bgColor;
    this.stack = []; // paint order: first = bottom
  }
  _add(l) { this.stack.push(l); return l; }
  null(name, o = {}) { return this._add(new Layer(this, 'null', name, o)); }
  solid(name, o) { const l = new Layer(this, 'solid', name, o); l.def.solid = { color: o.color || '#000000', w: o.w || this.def.w, h: o.h || this.def.h }; return this._add(l); }
  shape(name, o = {}) { const l = new Layer(this, 'shape', name, o); l.def.shapes = clone(o.shapes || []); return this._add(l); }
  text(name, o) {
    const l = new Layer(this, 'text', name, o);
    l.def.text = { text: o.text, font: o.font, size: o.size, fill: o.fill || '#ffffff', tracking: o.tracking || 0, justify: o.justify || 'left', animators: [] };
    return this._add(l);
  }
  image(name, asset, o = {}) { return this._add(new Layer(this, 'image', name, { ...o, asset })).set('image', { asset }); }
  precomp(name, compId, o = {}) { return this._add(new Layer(this, 'precomp', name, { ...o, comp: compId })).set('precomp', { comp: compId }); }
  audio(name, asset, o = {}) { return this._add(new Layer(this, 'audio', name, o)).set('audio', { asset }); }
  // Video / stock footage. Timing, either:
  //   { at: 2.0, from: 3.5, dur: 4 }   -> at comp time 2.0 play the clip from its 3.5 s point, for 4 s
  //   { start, in, out }                -> AE-style: start = comp time of the clip's frame 0; in/out trim the layer
  // + rate (1 = normal speed, 2 = double), loop (repeat the clip), audio (use the clip's sound; default off)
  video(name, asset, o = {}) {
    const a = this.project.def.assets[asset];
    if (!a || a.type !== 'video') throw new Error(`video "${name}": asset "${asset}" is not a video asset`);
    const rate = o.rate || 1;
    const start = o.start != null ? o.start : (o.at != null ? o.at : 0) - (o.from || 0) / rate;
    const inP = o.in != null ? o.in : Math.max(0, o.at != null ? o.at : start);
    const clipEnd = start + a.duration / rate;
    const outP = o.out != null ? o.out : o.dur != null ? inP + o.dur : o.loop ? this.def.duration : Math.min(this.def.duration, clipEnd);
    const l = new Layer(this, 'video', name, { ...o, asset, in: inP, out: outP });
    l.def.start = +start.toFixed(4);
    l.def.video = { asset, rate, loop: !!o.loop, audio: !!o.audio };
    return this._add(l);
  }
  // move a layer to the top of the stack (paint last)
  toTop(l) { this.stack = this.stack.filter(x => x !== l).concat([l]); return l; }
}

// ---------- Project ----------
export class Project {
  constructor({ name, fps = 30, dir }) {
    this.dir = dir;
    this.def = { codeflow: 1, name, fps, fonts: {}, assets: {}, comps: [], main: null };
    this.comps = {};
    this._n = 0;
  }
  asset(id, type, relPath, o = {}) {
    const a = { type, path: relPath.split('\\').join('/') };
    if (type === 'image') { const [w, h] = o.w ? [o.w, o.h] : imageSize(path.resolve(this.dir, relPath)); a.w = w; a.h = h; }
    if (type === 'video') {
      const m = probeMedia(path.resolve(this.dir, relPath));
      Object.assign(a, { w: m.w, h: m.h, duration: m.duration, fps: m.fps, hasAudio: m.hasAudio, hasAlpha: m.hasAlpha });
    }
    this.def.assets[id] = a;
    return id;
  }
  comp(id, name, o) { const c = new Comp(this, id, name, o); this.comps[id] = c; return c; }
  setMain(id) { this.def.main = id; }
  measure(items) { return browserMeasure(items); }
  // PostScript name for a family + weight: an installed font, else downloaded from Google Fonts (static TTF).
  //   const ps = await p.font('Poppins', 600)   // 'Poppins-SemiBold'
  font(family, weight = 400, italic = false) { return ensureFont(family, weight, italic); }

  build() {
    const spec = clone(this.def);
    spec.comps = Object.values(this.comps).map(c => ({ ...clone(c.def), layers: c.stack.slice().reverse().map(l => clone(l.def)) }));
    // fonts used by text layers
    for (const c of spec.comps) for (const l of c.layers) if (l.type === 'text') {
      const ps = l.text.font;
      if (!spec.fonts[ps]) {
        const f = findFont(ps);
        if (!f) throw new Error(`CodeFlow: font "${ps}" (layer "${l.name}") is not installed. Get it first with ` +
          `const ps = await p.font('Family Name', weight), which also downloads Google Fonts`);
        spec.fonts[ps] = { family: f.family, style: f.style, weight: f.weight, file: f.file };
      }
    }
    const { errors, warnings } = validate(spec, this.dir);
    warnings.forEach(w => console.warn('warn:', w));
    if (errors.length) throw new Error('CodeFlow spec invalid:\n  ' + errors.join('\n  '));
    return spec;
  }
  save(file) {
    const spec = this.build();
    fs.writeFileSync(file, JSON.stringify(spec, null, 1));
    return spec;
  }
}

// ---------- validation (keeps specs inside what BOTH renderers support) ----------
const EFFECTS = new Set(['blur', 'dropShadow', 'fill', 'ramp']);
export function validate(spec, dir) {
  const errors = [], warnings = [];
  const compIds = new Set(spec.comps.map(c => c.id));
  if (!compIds.has(spec.main)) errors.push(`main comp "${spec.main}" not found`);
  for (const [id, a] of Object.entries(spec.assets)) if (dir && !fs.existsSync(path.resolve(dir, a.path))) errors.push(`asset ${id} missing: ${a.path}`);
  for (const c of spec.comps) {
    const ids = new Map(c.layers.map(l => [l.id, l]));
    for (const l of c.layers) {
      const where = `${c.name} / ${l.name}`;
      if (l.parent) {
        if (!ids.has(l.parent)) errors.push(`${where}: parent ${l.parent} not in comp`);
        let p = l.parent, n = 0;
        while (p && n++ < 100) p = ids.get(p) && ids.get(p).parent;
        if (n >= 100) errors.push(`${where}: parent cycle`);
      }
      if (l.type === 'null' && Ease.isAnim(l.transform.opacity)) warnings.push(`${where}: opacity keys on a null do nothing in AE (opacity is not inherited)`);
      if (l.type === 'precomp' && !compIds.has(l.precomp.comp)) errors.push(`${where}: precomp ${l.precomp.comp} not found`);
      if (l.type === 'video') {
        const a = spec.assets[l.video && l.video.asset];
        if (!a || a.type !== 'video') errors.push(`${where}: video asset missing`);
        else {
          const start = l.start || 0, rate = l.video.rate || 1, end = start + a.duration / rate;
          if (l.in < start - 1e-3) errors.push(`${where}: layer starts (in ${l.in}) before the clip's first frame (start ${start})`);
          if (!l.video.loop && l.out > end + 1 / (spec.fps || 30)) errors.push(`${where}: layer runs past the end of the clip (${end.toFixed(2)} s); shorten out, slow the rate, or loop`);
        }
      }
      for (const fx of l.effects || []) {
        if (!EFFECTS.has(fx.type)) errors.push(`${where}: unsupported effect ${fx.type}`);
        if (fx.type === 'ramp' && !['solid', 'shape'].includes(l.type)) errors.push(`${where}: ramp only on solid/shape layers`);
      }
      for (const m of l.masks || []) if (m.mode !== 'add' || m.inverted || (m.feather && (m.feather[0] || m.feather[1]))) errors.push(`${where}: only plain "add" masks are supported`);
      for (const sh of l.shapes || []) {
        if (sh.trim && sh.kind !== 'path') errors.push(`${where}: trim only on path shapes`);
        if (sh.trim && sh.fill) errors.push(`${where}: trim on a filled shape is not supported`);
        if (sh.trim && sh.stroke && sh.stroke.dash) errors.push(`${where}: trim + dash not supported`);
      }
      if (l.type === 'text') {
        for (const an of l.text.animators || []) for (const s of an.selectors || []) {
          if (!(Number.isInteger(s.start) && Number.isInteger(s.end))) errors.push(`${where}: selector ranges must be whole words`);
        }
      }
      // keyframe sanity
      const walk = (o, p) => {
        if (Ease.isAnim(o)) {
          o.k.forEach((k, i) => {
            if (i && k.t <= o.k[i - 1].t) errors.push(`${where}: keys not increasing at ${p}`);
            if (Ease.isPerDim(k.e) && !Array.isArray(k.v)) errors.push(`${where}: per-axis ease on a 1D value at ${p}`);
            if (Ease.isPerDim(k.e) && /anchor$/.test(p)) warnings.push(`${where}: per-axis eases on the anchor point: AE uses the first axis (put the camera move on position instead)`);
          });
          return;
        }
        if (o && typeof o === 'object') for (const k of Object.keys(o)) walk(o[k], p + '.' + k);
      };
      walk(l, '');
    }
  }
  return { errors, warnings };
}
