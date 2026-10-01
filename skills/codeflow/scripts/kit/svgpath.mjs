// SVG path data -> After Effects shape paths ({v,i,o,c}, tangents relative to their vertex).
// Supports M L H V C S Q T A Z (absolute + relative). Arcs become cubic segments.

function tokenize(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) out.push(m[1] ? m[1] : parseFloat(m[2]));
  return out;
}

function arcToCubics(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  // SVG spec F.6.5 endpoint -> centre, then split into <=90deg cubic pieces
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const rad = phi * Math.PI / 180, cp = Math.cos(rad), sp = Math.sin(rad);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = co * (rx * y1p) / ry, cyp = co * -(ry * x1p) / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI;
  if (fs && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const seg = dt / n, k = 4 / 3 * Math.tan(seg / 4);
  const pt = (a) => { const ex = rx * Math.cos(a), ey = ry * Math.sin(a); return [cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]; };
  const der = (a) => { const ex = -rx * Math.sin(a), ey = ry * Math.cos(a); return [cp * ex - sp * ey, sp * ex + cp * ey]; };
  const out = [];
  let a0 = t1;
  for (let i = 0; i < n; i++) {
    const a1 = a0 + seg, p0 = pt(a0), p1 = pt(a1), d0 = der(a0), d1 = der(a1);
    out.push([p0[0] + k * d0[0], p0[1] + k * d0[1], p1[0] - k * d1[0], p1[1] - k * d1[1], p1[0], p1[1]]);
    a0 = a1;
  }
  return out;
}

// Returns an array of AE paths [{v,i,o,c}]
export function svgPathToAE(d) {
  const tk = tokenize(d);
  const paths = [];
  let cur = null, x = 0, y = 0, sx = 0, sy = 0, cmd = null, lastC = null, lastQ = null, i = 0;
  const start = (px, py) => { cur = { v: [[px, py]], i: [[0, 0]], o: [[0, 0]], c: false }; paths.push(cur); sx = px; sy = py; };
  const cubic = (c1x, c1y, c2x, c2y, px, py) => {
    const n = cur.v.length - 1;
    cur.o[n] = [c1x - cur.v[n][0], c1y - cur.v[n][1]];
    cur.v.push([px, py]); cur.i.push([c2x - px, c2y - py]); cur.o.push([0, 0]);
  };
  const line = (px, py) => { cur.v.push([px, py]); cur.i.push([0, 0]); cur.o.push([0, 0]); };
  const num = () => tk[i++];
  while (i < tk.length) {
    if (typeof tk[i] === 'string') cmd = tk[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'M') { x = ox + num(); y = oy + num(); start(x, y); cmd = rel ? 'l' : 'L'; lastC = lastQ = null; continue; }
    if (C === 'Z') {
      if (cur) {
        const n = cur.v.length - 1;
        if (n > 0 && Math.abs(cur.v[n][0] - cur.v[0][0]) < 1e-6 && Math.abs(cur.v[n][1] - cur.v[0][1]) < 1e-6) {
          cur.i[0] = cur.i[n]; cur.v.pop(); cur.i.pop(); cur.o.pop();
        }
        cur.c = true;
      }
      x = sx; y = sy; lastC = lastQ = null;
      if (i < tk.length && typeof tk[i] === 'number') start(x, y);
      continue;
    }
    if (!cur) start(x, y);
    if (C === 'L') { x = ox + num(); y = oy + num(); line(x, y); lastC = lastQ = null; }
    else if (C === 'H') { x = ox + num(); line(x, y); lastC = lastQ = null; }
    else if (C === 'V') { y = oy + num(); line(x, y); lastC = lastQ = null; }
    else if (C === 'C') {
      const a = ox + num(), b = oy + num(), c = ox + num(), e = oy + num(); x = ox + num(); y = oy + num();
      cubic(a, b, c, e, x, y); lastC = [c, e]; lastQ = null;
    } else if (C === 'S') {
      const r1 = lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
      const c = ox + num(), e = oy + num(); x = ox + num(); y = oy + num();
      cubic(r1[0], r1[1], c, e, x, y); lastC = [c, e]; lastQ = null;
    } else if (C === 'Q' || C === 'T') {
      let qx, qy;
      if (C === 'Q') { qx = ox + num(); qy = oy + num(); } else { qx = lastQ ? 2 * x - lastQ[0] : x; qy = lastQ ? 2 * y - lastQ[1] : y; }
      const px = ox + num(), py = oy + num();
      cubic(x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), px + 2 / 3 * (qx - px), py + 2 / 3 * (qy - py), px, py);
      x = px; y = py; lastQ = [qx, qy]; lastC = null;
    } else if (C === 'A') {
      const rx = num(), ry = num(), ph = num(), fa = num(), fs = num(), px = ox + num(), py = oy + num();
      for (const s of arcToCubics(x, y, rx, ry, ph, fa ? 1 : 0, fs ? 1 : 0, px, py)) cubic(...s);
      x = px; y = py; lastC = lastQ = null;
    } else throw new Error('svgPathToAE: unsupported command ' + cmd);
  }
  return paths.filter(p => p.v.length > 1 || p.c);
}

// Simple SVG elements used by icon glyphs -> AE path(s)
export function circlePath(cx, cy, r) {
  const k = 0.5522847498 * r;
  return { v: [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], i: [[-k, 0], [0, -k], [k, 0], [0, k]], o: [[k, 0], [0, k], [-k, 0], [0, -k]], c: true };
}
export function rectPath(x, y, w, h, r = 0) {
  if (!r) return { v: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]], c: true };
  const k = 0.5522847498 * r;
  return svgPathToAE(`M${x + r} ${y}H${x + w - r}C${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r}V${y + h - r}C${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h}H${x + r}C${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r}V${y + r}C${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}Z`)[0];
}

// Parses a tiny icon SVG body (rect/circle/path elements) into AE paths
export function iconToPaths(svgBody) {
  const out = [];
  const attr = (s, n) => { const m = s.match(new RegExp('\\s' + n + '="([^"]*)"')); return m ? m[1] : null; };
  for (const m of svgBody.matchAll(/<(path|rect|circle)\b([^>]*)\/?>/g)) {
    const tag = m[1], a = m[2];
    const dash = attr(a, 'stroke-dasharray');
    let ps = [];
    if (tag === 'path') ps = svgPathToAE(attr(a, 'd'));
    else if (tag === 'circle') ps = [circlePath(+attr(a, 'cx'), +attr(a, 'cy'), +attr(a, 'r'))];
    else ps = [rectPath(+attr(a, 'x'), +attr(a, 'y'), +attr(a, 'width'), +attr(a, 'height'), +(attr(a, 'rx') || 0))];
    ps.forEach(p => out.push({ path: p, dash: dash ? dash.split(/[\s,]+/).map(Number) : null }));
  }
  return out;
}
