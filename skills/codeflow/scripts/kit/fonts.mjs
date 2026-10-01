// Finds font files by PostScript name (the name After Effects uses), so the web player renders with the
// exact same font file as AE. Reads the sfnt 'name' + 'OS/2' tables directly (TTF/OTF/TTC).
// Fonts that are not installed can be fetched from Google Fonts (static TTF per weight) into ~/.codeflow/fonts,
// which is searched like an installed font folder. pack.mjs ships the font files inside the .codeflow.
import fs from 'fs';
import os from 'os';
import path from 'path';

export const FONT_CACHE = path.join(os.homedir(), '.codeflow', 'fonts');
const DIRS = (process.platform === 'win32'
  ? [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts'), path.join(process.env.LOCALAPPDATA || '', 'Microsoft/Windows/Fonts')]
  : ['/Library/Fonts', path.join(os.homedir(), 'Library/Fonts'), '/System/Library/Fonts', '/usr/share/fonts', path.join(os.homedir(), '.fonts')]
).concat([FONT_CACHE]);

export const WEIGHTS = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 };

function readNames(buf, base) {
  const numTables = buf.readUInt16BE(base + 4);
  let nameOff = -1, os2Off = -1, variable = false;
  for (let i = 0; i < numTables; i++) {
    const r = base + 12 + i * 16;
    const tag = buf.toString('latin1', r, r + 4);
    if (tag === 'fvar') variable = true;
    if (tag === 'name') nameOff = buf.readUInt32BE(r + 8);
    if (tag === 'OS/2') os2Off = buf.readUInt32BE(r + 8);
  }
  if (nameOff < 0) return null;
  const count = buf.readUInt16BE(nameOff + 2), strOff = nameOff + buf.readUInt16BE(nameOff + 4);
  const out = {};
  for (let i = 0; i < count; i++) {
    const r = nameOff + 6 + i * 12;
    const plat = buf.readUInt16BE(r), id = buf.readUInt16BE(r + 6), len = buf.readUInt16BE(r + 8), off = buf.readUInt16BE(r + 10);
    if (![1, 2, 4, 6, 16, 17].includes(id)) continue;
    const s = strOff + off;
    let str;
    if (plat === 3 || plat === 0) { const b = Buffer.from(buf.subarray(s, s + len)); b.swap16(); str = b.toString('utf16le'); }
    else if (plat === 1) str = buf.toString('latin1', s, s + len);
    else continue;
    if (!(id in out) || plat === 3) out[id] = str;
  }
  const weight = os2Off >= 0 ? buf.readUInt16BE(os2Off + 4) : 400;
  // OS/2 fsType: 0x0002 alone = "Restricted License embedding" (the font's licence says: do not share it)
  const fsType = os2Off >= 0 ? buf.readUInt16BE(os2Off + 8) : 0;
  const style = out[17] || out[2] || 'Regular';
  return { ps: out[6], family: out[16] || out[1], style, full: out[4], weight, italic: /italic|oblique/i.test(style), variable, shareable: (fsType & 0x000F) !== 0x0002 };
}

export function readFontFile(file) {
  const buf = fs.readFileSync(file);
  const tag = buf.toString('latin1', 0, 4);
  const bases = tag === 'ttcf' ? Array.from({ length: buf.readUInt32BE(8) }, (_, i) => buf.readUInt32BE(12 + i * 4)) : [0];
  return bases.map(b => readNames(buf, b)).filter(Boolean).map(n => ({ ...n, ttc: bases.length > 1 }));
}

let INDEX = null;
export function fontIndex(refresh = false) {
  if (INDEX && !refresh) return INDEX;
  INDEX = {};
  for (const dir of DIRS) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!/\.(ttf|otf|ttc)$/i.test(f)) continue;
      const file = path.join(dir, f);
      try {
        const fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        const buf = Buffer.alloc(Math.min(size, 4 * 1024 * 1024));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        const tag = buf.toString('latin1', 0, 4);
        const bases = tag === 'ttcf' ? Array.from({ length: buf.readUInt32BE(8) }, (_, i) => buf.readUInt32BE(12 + i * 4)) : [0];
        for (const b of bases) {
          const n = readNames(buf, b);
          // same PostScript name twice: prefer a static font over a variable one (AE handles static fonts best)
          if (n && n.ps && (!INDEX[n.ps] || (INDEX[n.ps].variable && !n.variable))) INDEX[n.ps] = { ...n, file: file.split('\\').join('/'), ttc: bases.length > 1 };
        }
      } catch { /* unreadable font: skip */ }
    }
  }
  return INDEX;
}

export function findFont(ps) { return fontIndex()[ps] || null; }

// Installed (or cached) faces of a family, e.g. families('Poppins') -> [{ps, weight, italic, ...}]
export function familyFaces(family) {
  const want = family.toLowerCase().replace(/\s+/g, '');
  return Object.values(fontIndex()).filter(f => (f.family || '').toLowerCase().replace(/\s+/g, '') === want);
}

// Downloads one static TTF (family + weight + italic) from Google Fonts into FONT_CACHE. Returns the file or null.
export async function fetchGoogleFont(family, weight = 400, italic = false) {
  const url = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/\s+/g, '+')}:ital,wght@${italic ? 1 : 0},${weight}`;
  let css;
  try {
    const r = await fetch(url);              // a plain (non-browser) client gets TTF urls, which AE can install
    if (!r.ok) return null;
    css = await r.text();
  } catch { return null; }
  const m = css.match(/url\((https:[^)]+\.ttf)\)/);
  if (!m) return null;
  const r2 = await fetch(m[1]);
  if (!r2.ok) return null;
  const buf = Buffer.from(await r2.arrayBuffer());
  fs.mkdirSync(FONT_CACHE, { recursive: true });
  const tmp = path.join(FONT_CACHE, 'download.tmp');
  fs.writeFileSync(tmp, buf);
  const info = readFontFile(tmp)[0];
  const file = path.join(FONT_CACHE, (info && info.ps ? info.ps : `${family.replace(/\s+/g, '')}-${weight}${italic ? 'i' : ''}`) + '.ttf');
  fs.renameSync(tmp, file);
  fontIndex(true);
  return file;
}

// The PostScript name for family + weight (+ italic): installed or cached face first, else Google Fonts.
//   await ensureFont('Poppins', 600)  -> 'Poppins-SemiBold'
export async function ensureFont(family, weight = 400, italic = false) {
  const pick = () => familyFaces(family).filter(f => f.italic === italic && !f.ttc && Math.abs(f.weight - weight) < 50 && !f.variable)[0];
  let f = pick();
  if (!f) { await fetchGoogleFont(family, weight, italic); f = pick(); }
  if (!f) {
    const near = familyFaces(family).map(x => `${x.ps} (${x.weight}${x.italic ? ' italic' : ''})`);
    throw new Error(`CodeFlow: no "${family}" ${weight}${italic ? ' italic' : ''} installed or on Google Fonts` + (near.length ? `. Installed faces: ${near.join(', ')}` : ''));
  }
  return f.ps;
}

// PostScript name -> {family, weight, italic} guess, e.g. 'PlusJakartaSans-SemiBoldItalic'
export function parsePostScript(ps) {
  const [fam, style = 'Regular'] = ps.split('-');
  const family = fam.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  const s = style.toLowerCase();
  const italic = /italic|oblique/.test(s);
  const key = s.replace(/italic|oblique/g, '') || 'regular';
  return { family, weight: WEIGHTS[key] || 400, italic };
}

// findFont, and if the font isn't installed, fetch it from Google Fonts by its PostScript name
export async function findOrFetchFont(ps) {
  let f = findFont(ps);
  if (f) return f;
  const g = parsePostScript(ps);
  await fetchGoogleFont(g.family, g.weight, g.italic);
  return findFont(ps);
}
