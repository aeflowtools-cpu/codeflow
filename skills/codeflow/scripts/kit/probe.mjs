// Layout probe: opens the user's ORIGINAL html video at a time t and reports what the BROWSER actually drew
// (boxes, transforms, colours, radii, shadows, fonts, text baselines, svg geometry, images).
// Code often doesn't contain real positions (flexbox, centring, wrapping) — this gives the true numbers.
//   node kit/probe.mjs <video.html> <t> [out.json] [--size 1920x1080] [--root "#stage"] [--seek ...] [--all]
import fs from 'fs';
import path from 'path';
import { openOriginal } from './original.mjs';
import { closeBrowser } from './browser.mjs';

function snapshot({ rootSel, all }) {
  const out = [];
  const root = rootSel ? document.querySelector(rootSel) : document.body;
  const r2 = n => Math.round(n * 100) / 100;
  const pathOf = el => {
    const p = [];
    for (let e = el; e && e !== document.body && p.length < 6; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { s += '#' + e.id; p.unshift(s); break; }
      const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
      if (c.length) s += '.' + c.join('.');
      p.unshift(s);
    }
    return p.join(' > ');
  };
  const effOpacity = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return r2(o); };
  function baselineOf(el) {
    const tn = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
    if (!tn) return null;
    const mk = document.createElement('span');
    mk.style.cssText = 'display:inline-block;width:0;height:0;padding:0;margin:0;border:0;vertical-align:baseline';
    el.insertBefore(mk, tn);
    const b = mk.getBoundingClientRect();
    el.removeChild(mk);
    return { x: r2(b.left), y: r2(b.bottom) };
  }
  function lines(el) {
    const tn = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    const rects = [];
    tn.forEach(n => { const rg = document.createRange(); rg.selectNodeContents(n); [...rg.getClientRects()].forEach(r => rects.push([r2(r.left), r2(r.top), r2(r.width), r2(r.height)])); });
    return rects;
  }
  const walk = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const tag = el.tagName.toLowerCase();
    if (['script', 'style', 'link', 'meta', 'head', 'title', 'noscript', 'defs'].includes(tag)) return;
    const b = el.getBoundingClientRect();
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim();
    const visible = b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < innerWidth && b.top < innerHeight;
    const e = { path: pathOf(el), tag, box: [r2(b.left), r2(b.top), r2(b.width), r2(b.height)], opacity: +cs.opacity, effOpacity: effOpacity(el) };
    // layout = position BEFORE any CSS transforms (camera wrappers, scale-ins): sum of offsets up the chain
    if (el.offsetParent !== undefined && el.offsetWidth !== undefined) {
      let x = 0, y = 0;
      for (let q = el; q; q = q.offsetParent) { x += q.offsetLeft + (q !== el ? q.clientLeft : 0); y += q.offsetTop + (q !== el ? q.clientTop : 0); }
      e.layout = [r2(x), r2(y), el.offsetWidth, el.offsetHeight];
    }
    if (cs.transform !== 'none') { e.transform = cs.transform; e.origin = cs.transformOrigin; }
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)') e.bg = cs.backgroundColor;
    if (cs.backgroundImage !== 'none') e.bgImage = cs.backgroundImage.slice(0, 300);
    if (cs.borderRadius !== '0px') e.radius = cs.borderRadius;
    if (parseFloat(cs.borderTopWidth)) e.border = cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor;
    if (cs.boxShadow !== 'none') e.shadow = cs.boxShadow;
    if (cs.filter !== 'none') e.filter = cs.filter;
    if (cs.overflow !== 'visible') e.overflow = cs.overflow;
    if (cs.clipPath && cs.clipPath !== 'none') e.clipPath = cs.clipPath;
    if (cs.mixBlendMode !== 'normal') e.blend = cs.mixBlendMode;
    if (own) {
      e.text = own.slice(0, 300);
      e.font = { family: cs.fontFamily, size: parseFloat(cs.fontSize), weight: cs.fontWeight, style: cs.fontStyle, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, color: cs.color, align: cs.textAlign };
      e.baseline = baselineOf(el);
      if (e.layout && e.baseline) e.layoutBaseline = r2(e.layout[1] + (e.baseline.y - b.top) * (el.offsetHeight / (b.height || 1)));
      el.setAttribute('data-cf-i', String(out.length));
      e.lines = lines(el);
    }
    if (tag === 'img') { e.src = el.currentSrc || el.src; e.natural = [el.naturalWidth, el.naturalHeight]; e.objectFit = cs.objectFit; }
    if (tag === 'video') {
      e.src = el.currentSrc || el.src; e.natural = [el.videoWidth, el.videoHeight]; e.objectFit = cs.objectFit; e.objectPosition = cs.objectPosition;
      e.video = { currentTime: r2(el.currentTime), duration: r2(el.duration), rate: el.playbackRate, loop: el.loop, muted: el.muted, paused: el.paused };
    }
    if (el instanceof SVGElement) {
      try { const bb = el.getBBox(); e.bbox = [r2(bb.x), r2(bb.y), r2(bb.width), r2(bb.height)]; } catch {}
      try { const m = el.getScreenCTM(); if (m) e.ctm = [m.a, m.b, m.c, m.d, m.e, m.f].map(r2); } catch {}
      ['d', 'fill', 'stroke', 'stroke-width', 'x', 'y', 'width', 'height', 'rx', 'cx', 'cy', 'r', 'href', 'viewBox', 'text-anchor', 'font-family', 'font-size']
        .forEach(a => { const v = el.getAttribute(a) || (a === 'href' && el.getAttribute('xlink:href')); if (v) (e.attrs = e.attrs || {})[a] = String(v).slice(0, 400); });
      if (tag === 'text' || tag === 'tspan') e.text = el.textContent.trim().slice(0, 300);
    }
    if (all || visible || own) out.push(e);
    [...el.children].forEach(walk);
  };
  walk(root);
  return { viewport: [innerWidth, innerHeight], count: out.length, elements: out };
}

export async function probe(file, t, opts = {}) {
  const o = await openOriginal(file, opts);
  await o.seek(t);
  const snap = await o.page.evaluate(snapshot, { rootSel: opts.root || null, all: !!opts.all });
  // which font face the browser REALLY drew each text with (catches faux-bold / fallback fonts)
  try {
    const cdp = await o.page.context().newCDPSession(o.page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    for (let i = 0; i < snap.elements.length; i++) {
      const e = snap.elements[i];
      if (!e.text || !e.font) continue;
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `[data-cf-i="${i}"]` });
      if (!nodeId) continue;
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      e.usedFonts = fonts.map(f => f.postScriptName || f.familyName);
      const want = +e.font.weight;
      if (want >= 600 && e.usedFonts.every(n => !/semi|bold|black|heavy|extra/i.test(n))) e.fauxBold = true;
    }
  } catch (err) { snap.fontProbeError = err.message; }
  snap.t = t; snap.seekMode = o.mode;
  await o.close();
  return snap;
}

const [, self, file, tArg, out] = process.argv;
if (self && path.basename(self) === 'probe.mjs') {
  const flag = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const [w, h] = (flag('size') || '1920x1080').split('x').map(Number);
  probe(file, +tArg, { width: w, height: h, seek: flag('seek') || 'auto', fn: flag('fn'), root: flag('root'), all: process.argv.includes('--all') })
    .then(s => {
      const json = JSON.stringify(s, null, 1);
      if (out && !out.startsWith('--')) { fs.writeFileSync(out, json); console.log(`wrote ${out}: ${s.count} elements (seek: ${s.seekMode})`); }
      else console.log(json);
    })
    .catch(e => { console.error(e); process.exitCode = 1; }).finally(closeBrowser);
}
