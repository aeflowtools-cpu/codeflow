/* CodeFlow web player — an After Effects emulator for the CodeFlow Motion Spec (see SPEC.md).
 * Renders a spec into one <svg>; seek(t) is deterministic, so Playwright can screenshot frames.
 * Semantics deliberately follow AE, not the web:
 *   - layers are flat siblings; parenting only multiplies transforms (opacity/effects are NOT inherited)
 *   - effects + masks live in layer space (they scale with the layer), effects apply after masks
 *   - filters run in sRGB (AE's default working space), not SVG's default linearRGB
 * Needs shared/ease.js loaded first (window.CodeFlowEase).
 */
(function (root) {
  'use strict';
  var E = root.CodeFlowEase;
  var NS = 'http://www.w3.org/2000/svg';
  var XL = 'http://www.w3.org/1999/xlink';

  var CF = {
    // AE value -> SVG gaussian sigma. Measured by tests/calibration against real AE renders.
    K: { blur: 0.28, softness: 0.22, textBlur: 0.28 },   // fitted 2026-09-30 (tests/calibration/fit.mjs, AE 24.5)
    version: '0.1.0',
  };

  var uid = 0;
  function nid(p) { uid += 1; return (p || 'cf') + uid; }
  function el(name, attrs, parent) {
    var n = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  var V = E.valueAt;

  // ---------- matrices (a b c d e f, SVG order) ----------
  function mul(m, n) {
    return [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  }
  function localMatrix(tr, t) {
    var a = V(tr.anchor, t) || [0, 0], p = V(tr.position, t) || [0, 0], s = V(tr.scale, t) || [100, 100];
    var r = (V(tr.rotation, t) || 0) * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r);
    var sx = s[0] / 100, sy = s[1] / 100;
    // T(p) * R(r) * S(s) * T(-a)
    var m = [c * sx, sn * sx, -sn * sy, c * sy, 0, 0];
    m[4] = p[0] - (m[0] * a[0] + m[2] * a[1]);
    m[5] = p[1] - (m[1] * a[0] + m[3] * a[1]);
    return m;
  }
  function mstr(m) { return 'matrix(' + m.map(function (x) { return +x.toFixed(6); }).join(' ') + ')'; }

  // ---------- geometry ----------
  function pathD(p) {
    var v = p.v, ii = p.i, o = p.o, n = v.length;
    if (!n) return '';
    var d = 'M' + v[0][0] + ' ' + v[0][1];
    var segs = p.c ? n : n - 1;
    for (var k = 0; k < segs; k++) {
      var a = k, b = (k + 1) % n;
      d += ' C' + (v[a][0] + o[a][0]) + ' ' + (v[a][1] + o[a][1]) + ' ' + (v[b][0] + ii[b][0]) + ' ' + (v[b][1] + ii[b][1]) + ' ' + v[b][0] + ' ' + v[b][1];
    }
    if (p.c) d += ' Z';
    return d;
  }
  function rectD(c, s, r) {
    var w = s[0], h = s[1], x = c[0] - w / 2, y = c[1] - h / 2;
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    if (!r) return 'M' + x + ' ' + y + 'h' + w + 'v' + h + 'h' + (-w) + 'Z';
    return 'M' + (x + r) + ' ' + y + 'H' + (x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w) + ' ' + (y + r) +
      'V' + (y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + w - r) + ' ' + (y + h) + 'H' + (x + r) +
      'A' + r + ' ' + r + ' 0 0 1 ' + x + ' ' + (y + h - r) + 'V' + (y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + (x + r) + ' ' + y + 'Z';
  }
  function ellipseD(c, s) {
    var rx = s[0] / 2, ry = s[1] / 2;
    return 'M' + (c[0] - rx) + ' ' + c[1] + 'A' + rx + ' ' + ry + ' 0 1 0 ' + (c[0] + rx) + ' ' + c[1] + 'A' + rx + ' ' + ry + ' 0 1 0 ' + (c[0] - rx) + ' ' + c[1] + 'Z';
  }

  // ---------- effects -> one SVG filter per layer ----------
  function buildFilter(defs, effects) {
    var f = el('filter', { id: nid('fx'), x: '-60%', y: '-60%', width: '220%', height: '220%', 'color-interpolation-filters': 'sRGB' }, defs);
    var prev = 'SourceGraphic', ups = [];
    effects.forEach(function (fx, i) {
      var r = 'r' + i;
      if (fx.type === 'blur') {
        var b = el('feGaussianBlur', { in: prev, stdDeviation: 0, result: r }, f);
        ups.push(function (t) { b.setAttribute('stdDeviation', Math.max(0, V(fx.amount, t) * CF.K.blur)); });
        prev = r;
      } else if (fx.type === 'dropShadow') {
        var a = el('feColorMatrix', { in: prev, type: 'matrix', values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0', result: r + 'a' }, f);
        var gb = el('feGaussianBlur', { in: r + 'a', stdDeviation: 0, result: r + 'b' }, f);
        var off = el('feOffset', { in: r + 'b', dx: 0, dy: 0, result: r + 'o' }, f);
        var fl = el('feFlood', { 'flood-color': '#000', 'flood-opacity': 1, result: r + 'f' }, f);
        el('feComposite', { in: r + 'f', in2: r + 'o', operator: 'in', result: r + 's' }, f);
        var mg = el('feMerge', { result: r }, f);
        el('feMergeNode', { in: r + 's' }, mg); el('feMergeNode', { in: prev }, mg);
        void a;
        ups.push(function (t) {
          var dir = (fx.direction == null ? 135 : V(fx.direction, t)) * Math.PI / 180, dist = V(fx.distance, t) || 0;
          off.setAttribute('dx', Math.sin(dir) * dist); off.setAttribute('dy', -Math.cos(dir) * dist);
          gb.setAttribute('stdDeviation', Math.max(0, (V(fx.softness, t) || 0) * CF.K.softness));
          fl.setAttribute('flood-color', V(fx.color, t) || '#000');
          fl.setAttribute('flood-opacity', (fx.opacity == null ? 50 : V(fx.opacity, t)) / 100);
        });
        prev = r;
      } else if (fx.type === 'fill') {
        var fl2 = el('feFlood', { 'flood-color': '#fff', result: r + 'f' }, f);
        el('feComposite', { in: r + 'f', in2: prev, operator: 'in', result: r }, f);
        ups.push(function (t) { fl2.setAttribute('flood-color', V(fx.color, t)); });
        prev = r;
      } else if (fx.type === 'ramp') {
        // handled as the paint of solids/shapes (see content builders)
      } else {
        throw new Error('CodeFlow player: unsupported effect ' + fx.type);
      }
    });
    return { id: f.id, update: function (t) { for (var i = 0; i < ups.length; i++) ups[i](t); } };
  }

  // ---------- text layout ----------
  function splitWords(s) {
    var out = [], re = /\S+/g, m;
    while ((m = re.exec(s))) out.push({ w: m[0], i: m.index });
    return out;
  }

  // ---------- comp / layer nodes ----------
  function CompNode(ctx, comp, parentEl) {
    this.ctx = ctx; this.comp = comp;
    this.g = el('g', { 'data-comp': comp.id }, parentEl);   // attached first: text layout needs a live DOM
    this.layers = [];
    var byId = {};
    // spec layers are top->bottom; paint bottom->top
    for (var i = comp.layers.length - 1; i >= 0; i--) {
      var ln = new LayerNode(ctx, this, comp.layers[i], this.g);
      byId[comp.layers[i].id] = ln;
      this.layers.push(ln);
    }
    this.layers.forEach(function (ln) { ln.parentNode = ln.spec.parent ? byId[ln.spec.parent] : null; });
    this.byId = byId;
  }
  CompNode.prototype.update = function (t) {
    var frame = {};
    for (var i = 0; i < this.layers.length; i++) this.layers[i].update(t, frame);
  };

  function LayerNode(ctx, compNode, spec, parentEl) {
    var self = this;
    this.ctx = ctx; this.spec = spec; this.compNode = compNode;
    this.tr = spec.transform || {};
    this.outer = el('g', { 'data-layer': spec.name || spec.id }, parentEl);
    var host = this.outer;
    this.fx = null;
    var fxList = (spec.effects || []).filter(function (e) { return e.type !== 'ramp'; });
    if (fxList.length) {
      this.fx = buildFilter(ctx.defs, fxList);
      host = el('g', { filter: 'url(#' + this.fx.id + ')' }, host);
    }
    if (spec.masks && spec.masks.length) {
      var cp = el('clipPath', { id: nid('mk'), clipPathUnits: 'userSpaceOnUse' }, ctx.defs);
      spec.masks.forEach(function (mk) { el('path', { d: pathD(mk.path) }, cp); });
      host = el('g', { 'clip-path': 'url(#' + cp.id + ')' }, host);
    }
    this.host = host;
    this.ups = [];
    var ramp = (spec.effects || []).filter(function (e) { return e.type === 'ramp'; })[0];
    var rampPaint = null;
    if (ramp) {
      var lg = el('linearGradient', { id: nid('rp'), gradientUnits: 'userSpaceOnUse', x1: ramp.start[0], y1: ramp.start[1], x2: ramp.end[0], y2: ramp.end[1] }, ctx.defs);
      el('stop', { offset: 0, 'stop-color': ramp.from }, lg); el('stop', { offset: 1, 'stop-color': ramp.to }, lg);
      rampPaint = 'url(#' + lg.id + ')';
    }
    var type = spec.type;
    if (type === 'solid') {
      el('rect', { x: 0, y: 0, width: spec.solid.w, height: spec.solid.h, fill: rampPaint || spec.solid.color }, host);
    } else if (type === 'image') {
      var as = ctx.spec.assets[spec.image.asset];
      var im = el('image', { x: 0, y: 0, width: as.w, height: as.h, preserveAspectRatio: 'none' }, host);
      im.setAttributeNS(XL, 'href', ctx.assetUrl(as.path));
      ctx.images.push(im);
    } else if (type === 'video') {
      // footage: show the clip frame for (t - start) * rate, frames pre-extracted by the kit (AE footage semantics)
      var va = ctx.spec.assets[spec.video.asset];
      var vim = el('image', { x: 0, y: 0, width: va.w, height: va.h, preserveAspectRatio: 'none' }, host);
      this.video = { el: vim, asset: va, frames: (ctx.videoFrames || {})[spec.video.asset], cur: null };
    } else if (type === 'shape') {
      (spec.shapes || []).forEach(function (sh) { self.buildShape(sh, rampPaint); });
    } else if (type === 'text') {
      this.buildText(spec.text);
    } else if (type === 'precomp') {
      var sub = ctx.compById[spec.precomp.comp];
      var clip = el('clipPath', { id: nid('pc'), clipPathUnits: 'userSpaceOnUse' }, ctx.defs);
      el('rect', { x: 0, y: 0, width: sub.w, height: sub.h }, clip);
      var holder = el('g', { 'clip-path': 'url(#' + clip.id + ')' }, host);
      this.sub = new CompNode(ctx, sub, holder);
    } else if (type !== 'null' && type !== 'audio') {
      throw new Error('CodeFlow player: unsupported layer type ' + type);
    }
  }

  LayerNode.prototype.buildShape = function (sh, rampPaint) {
    var p = el('path', {}, this.host);
    var fill = sh.fill, st = sh.stroke, tr = sh.trim;
    if (st) {
      p.setAttribute('stroke-linecap', st.cap || 'butt');
      p.setAttribute('stroke-linejoin', st.join || 'miter');
      p.setAttribute('stroke-miterlimit', 4);
      if (st.dash) p.setAttribute('stroke-dasharray', st.dash.join(' '));
    }
    this.ups.push(function (t) {
      var d;
      if (sh.kind === 'rect') d = rectD(V(sh.position, t) || [0, 0], V(sh.size, t), V(sh.roundness, t) || 0);
      else if (sh.kind === 'ellipse') d = ellipseD(V(sh.position, t) || [0, 0], V(sh.size, t));
      else d = pathD(V(sh.path, t));
      p.setAttribute('d', d);
      if (fill) { p.setAttribute('fill', rampPaint || V(fill.color, t)); p.setAttribute('fill-opacity', (fill.opacity == null ? 100 : V(fill.opacity, t)) / 100); }
      else p.setAttribute('fill', 'none');
      if (st) {
        p.setAttribute('stroke', V(st.color, t));
        p.setAttribute('stroke-width', V(st.width, t));
        p.setAttribute('stroke-opacity', (st.opacity == null ? 100 : V(st.opacity, t)) / 100);
      }
      if (tr) {
        var L = p.getTotalLength();
        var s = (tr.start == null ? 0 : V(tr.start, t)) / 100, e = (tr.end == null ? 100 : V(tr.end, t)) / 100;
        var off = (tr.offset == null ? 0 : V(tr.offset, t)) / 360;
        var a = Math.min(s, e) + off, b = Math.max(s, e) + off, len = Math.max(0, (b - a) * L);
        if (len <= 0.0001) { p.setAttribute('stroke-dasharray', '0 ' + (L + 1)); p.setAttribute('stroke-dashoffset', 0); }
        else { p.setAttribute('stroke-dasharray', len + ' ' + (L + 1)); p.setAttribute('stroke-dashoffset', -a * L); }
      }
    });
  };

  LayerNode.prototype.buildText = function (tx) {
    var ctx = this.ctx, host = this.host;
    var fam = ctx.fontFamily(tx.font);
    var anchor = tx.justify === 'center' ? 'middle' : tx.justify === 'right' ? 'end' : 'start';
    var ls = (tx.tracking || 0) / 1000 * tx.size;
    var style = 'font-family:' + fam + ';font-size:' + tx.size + 'px;letter-spacing:' + ls + 'px;white-space:pre';
    var anims = tx.animators || [];
    if (!anims.length) {
      var t0 = el('text', { x: 0, y: 0, 'text-anchor': anchor, fill: tx.fill, style: style }, host);
      t0.textContent = tx.text;
      return;
    }
    // lay out the full line once, then place each word at its laid-out x so per-word animation
    // never changes the layout (like AE's text animators)
    var full = el('text', { x: 0, y: 0, 'text-anchor': anchor, style: style, fill: 'none' }, host);
    full.textContent = tx.text;
    var words = splitWords(tx.text);
    var wordEls = words.map(function (w) {
      var x = full.getStartPositionOfChar(w.i).x;
      var g = el('g', {}, host);
      var fid = null, blurNode = null;
      var hasBlur = anims.some(function (a) { return a.props && a.props.blur; });
      if (hasBlur) {
        var f = el('filter', { id: nid('tb'), x: '-50%', y: '-100%', width: '200%', height: '300%', 'color-interpolation-filters': 'sRGB' }, ctx.defs);
        blurNode = el('feGaussianBlur', { stdDeviation: 0 }, f);
        fid = f.id;
      }
      var te = el('text', { x: x, y: 0, fill: tx.fill, style: style.replace('white-space:pre', 'white-space:pre'), filter: fid ? 'url(#' + fid + ')' : null }, g);
      te.textContent = w.w;
      return { g: g, blur: blurNode, te: te };
    });
    host.removeChild(full);
    this.ups.push(function (t) {
      var n = words.length;
      var offs = [], ops = [], blurs = [];
      for (var i = 0; i < n; i++) { offs.push([0, 0]); ops.push(100); blurs.push([0, 0]); }
      anims.forEach(function (an) {
        var amt = []; for (var i = 0; i < n; i++) amt.push(0);
        (an.selectors || []).forEach(function (sel) {
          var a = (sel.amount == null ? 100 : V(sel.amount, t)) / 100;
          for (var i = 0; i < n; i++) if (i >= sel.start && i < sel.end) amt[i] += a;
        });
        for (var i2 = 0; i2 < n; i2++) {
          var a2 = Math.max(0, Math.min(1, amt[i2]));
          var pr = an.props || {};
          if (pr.opacity != null) ops[i2] = ops[i2] * (1 + (pr.opacity / 100 - 1) * a2);
          if (pr.position) { offs[i2][0] += pr.position[0] * a2; offs[i2][1] += pr.position[1] * a2; }
          if (pr.blur) { blurs[i2][0] += pr.blur[0] * a2; blurs[i2][1] += pr.blur[1] * a2; }
        }
      });
      for (var j = 0; j < n; j++) {
        var w = wordEls[j];
        w.g.setAttribute('transform', 'translate(' + offs[j][0] + ' ' + offs[j][1] + ')');
        w.g.setAttribute('opacity', Math.max(0, Math.min(1, ops[j] / 100)));
        if (w.blur) w.blur.setAttribute('stdDeviation', (blurs[j][0] * CF.K.textBlur) + ' ' + (blurs[j][1] * CF.K.textBlur));
      }
    });
  };

  LayerNode.prototype.world = function (t, frame) {
    var id = this.spec.id;
    if (frame[id]) return frame[id];
    var m = localMatrix(this.tr, t);
    if (this.parentNode) m = mul(this.parentNode.world(t, frame), m);
    frame[id] = m;
    return m;
  };

  LayerNode.prototype.update = function (t, frame) {
    var s = this.spec;
    var vis = t >= (s.in == null ? -1e9 : s.in) && t < (s.out == null ? 1e9 : s.out);
    this.outer.style.display = vis ? '' : 'none';
    if (!vis && !this.childrenDependOnMe) { /* world() still computed lazily for children */ }
    if (!vis) return;
    this.outer.setAttribute('transform', mstr(this.world(t, frame)));
    var op = this.tr.opacity == null ? 100 : V(this.tr.opacity, t);
    this.outer.setAttribute('opacity', Math.max(0, Math.min(1, op / 100)));
    if (this.fx) this.fx.update(t);
    for (var i = 0; i < this.ups.length; i++) this.ups[i](t);
    if (this.sub) this.sub.update(t - (s.start || 0));
    if (this.video) this.updateVideo(t);
  };

  function pad5(n) { var x = String(n); while (x.length < 5) x = '0' + x; return x; }
  LayerNode.prototype.updateVideo = function (t) {
    var v = this.video, f = v.frames, s = this.spec;
    if (!f || !f.count) return;
    var ct = (t - (s.start || 0)) * (s.video.rate || 1);                 // clip time
    var n = Math.floor(ct * f.fps + 1e-6);
    if (s.video.loop) n = ((n % f.count) + f.count) % f.count;
    n = Math.max(0, Math.min(f.count - 1, n));
    if (v.cur === n) return;
    v.cur = n;
    var url = f.base + 'f_' + pad5(n + 1) + '.' + f.ext;
    var ctx = this.ctx;
    ctx.pending.push(new Promise(function (res) {
      var done = function () { v.el.removeEventListener('load', done); v.el.removeEventListener('error', done); res(); };
      v.el.addEventListener('load', done); v.el.addEventListener('error', done);
      v.el.setAttributeNS(XL, 'href', url);
    }));
  };

  // ---------- public API ----------
  // CF.load(spec, { container, assetBase: 'file:///D:/proj/', fonts: { 'Poppins-Medium': base64 },
  //                 videoFrames: { assetId: { base: 'file:///…/', ext: 'jpg', count, fps } } }) -> Promise<player>
  CF.load = function (spec, opts) {
    opts = opts || {};
    var ctx = { spec: spec, images: [], compById: {}, pending: [], videoFrames: opts.videoFrames || {} };
    spec.comps.forEach(function (c) { ctx.compById[c.id] = c; });
    var main = ctx.compById[spec.main];
    var svg = el('svg', { width: main.w, height: main.h, viewBox: '0 0 ' + main.w + ' ' + main.h });
    svg.style.display = 'block';
    ctx.defs = el('defs', {}, svg);
    el('rect', { width: main.w, height: main.h, fill: main.bgColor || '#000000' }, svg);
    ctx.assetUrl = function (p) {
      p = String(p).split('\\').join('/');
      if (/^[a-zA-Z]:\//.test(p)) return 'file:///' + encodeURI(p);      // absolute Windows path
      if (p.charAt(0) === '/') return 'file://' + encodeURI(p);           // absolute POSIX path
      if (/^[a-z][a-z0-9+.-]+:/i.test(p)) return p;                      // already a URL (file:, http:, data:)
      return (opts.assetBase || '') + encodeURI(p);   // relative to the spec file (spaces etc. escaped)
    };
    ctx.fontFamily = function (ps) { return '"CF_' + ps + '"'; };
    (opts.container || document.body).appendChild(svg);

    var fontJobs = Object.keys(opts.fonts || {}).map(function (ps) {
      var bin = atob(opts.fonts[ps]); var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var ff = new FontFace('CF_' + ps, buf.buffer);
      return ff.load().then(function (f) { document.fonts.add(f); });
    });
    return Promise.all(fontJobs).then(function () {
      var mainNode = new CompNode(ctx, main, svg);
      var waits = ctx.images.map(function (im) {
        return new Promise(function (res) {
          var probe = new Image();
          probe.onload = probe.onerror = function () { res(); };
          probe.src = im.getAttributeNS(XL, 'href');
        });
      });
      return Promise.all(waits).then(function () {
        var player = {
          svg: svg,
          // returns a Promise that resolves once every video frame for time t has loaded
          seek: function (t) { ctx.pending = []; mainNode.update(t); return Promise.all(ctx.pending); },
          duration: main.duration,
          fps: spec.fps || 30,
        };
        return player.seek(0).then(function () { return player; });
      });
    });
  };

  // Text metrics from the exact font files the spec uses (the kit bakes these into keyframes).
  // items: [{ font, size, tracking, text }] -> [{ width, words: [{ text, x, width }] }]
  var loadedFonts = {};
  CF.measure = function (items, fonts) {
    var jobs = Object.keys(fonts || {}).map(function (ps) {
      // (document.fonts.check() is true for UNKNOWN families too, so track loads explicitly)
      if (loadedFonts[ps]) return Promise.resolve();
      loadedFonts[ps] = true;
      var bin = atob(fonts[ps]); var buf = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      var ff = new FontFace('CF_' + ps, buf.buffer);
      return ff.load().then(function (f) { document.fonts.add(f); });
    });
    return Promise.all(jobs).then(function () {
      var svg = el('svg', { width: 10, height: 10 }, document.body);
      var out = items.map(function (it) {
        var ls = (it.tracking || 0) / 1000 * it.size;
        var t = el('text', { x: 0, y: 0, style: 'font-family:"CF_' + it.font + '";font-size:' + it.size + 'px;letter-spacing:' + ls + 'px;white-space:pre' }, svg);
        t.textContent = it.text;
        var res = { width: t.getComputedTextLength(), words: [] };
        splitWords(it.text).forEach(function (w) {
          var x0 = t.getStartPositionOfChar(w.i).x;
          var last = w.i + w.w.length - 1;
          var x1 = t.getEndPositionOfChar(last).x;
          res.words.push({ text: w.w, x: x0, width: x1 - x0 });
        });
        svg.removeChild(t);
        return res;
      });
      document.body.removeChild(svg);
      return out;
    });
  };

  root.CodeFlow = CF;
})(typeof self !== 'undefined' ? self : this);
