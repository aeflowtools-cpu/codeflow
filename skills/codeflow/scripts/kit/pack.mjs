// Packs a CodeFlow spec + every asset it uses for delivery to the CodeFlow After Effects panel.
//   node kit/pack.mjs <spec.codeflow.json> [out.codeflow]            -> ONE file (zip: codeflow.json + assets/ + README.txt)
//   node kit/pack.mjs <spec.codeflow.json> --folder [outParentDir]   -> a FOLDER "<Name> (CodeFlow)" with the same contents
// Both have the identical layout, so the panel handles them the same way. Use the folder for heavy video projects.
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

import { findFont, readFontFile } from './fonts.mjs';

const require = createRequire(import.meta.url);
const { writeZip, readZip } = require('../shared/zip.js');
const safe = s => String(s || 'motion').replace(/[\\/:*?"<>|]+/g, '-');

function collect(specFile) {
  const dir = path.dirname(path.resolve(specFile));
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const files = [], used = new Set();
  let bytes = 0;
  for (const [id, a] of Object.entries(spec.assets || {})) {
    const src = path.isAbsolute(a.path) ? a.path : path.resolve(dir, a.path);
    if (!fs.existsSync(src)) throw new Error(`asset "${id}" not found: ${src}`);
    let base = path.basename(src), n = 1;
    while (used.has(base.toLowerCase())) base = path.basename(src, path.extname(src)) + '_' + (++n) + path.extname(src);
    used.add(base.toLowerCase());
    files.push({ name: 'assets/' + base, src });
    bytes += fs.statSync(src).size;
    a.path = 'assets/' + base;
  }
  // Fonts travel inside the file: the CodeFlow panel installs any the other computer doesn't have, so the
  // text stays editable text in the right font. Skipped only when the font file says "do not share" (fsType).
  const fontLines = [], fontsMissing = [];
  for (const [ps, f] of Object.entries(spec.fonts || {})) {
    let src = f.file && (path.isAbsolute(f.file) ? f.file : path.resolve(dir, f.file));
    if (!src || !fs.existsSync(src)) { const x = findFont(ps); src = x && x.file; }
    delete f.file;
    if (!src || !fs.existsSync(src)) { fontLines.push(`  - ${ps}  (NOT included: font file not found - install it yourself)`); fontsMissing.push(ps); continue; }
    const faces = readFontFile(src), info = faces.find(n => n.ps === ps) || faces[0];
    if (info && !info.shareable) { fontLines.push(`  - ${ps}  (NOT included: its license does not allow sharing - install it yourself)`); fontsMissing.push(ps); continue; }
    let base = path.basename(src), n = 1;
    while (used.has('fonts/' + base.toLowerCase())) base = path.basename(src, path.extname(src)) + '_' + (++n) + path.extname(src);
    used.add('fonts/' + base.toLowerCase());
    files.push({ name: 'assets/fonts/' + base, src });
    bytes += fs.statSync(src).size;
    f.file = 'assets/fonts/' + base;
    fontLines.push(`  - ${ps}  (included)`);
  }
  spec.packedWith = 'codeflow-kit';
  const readme = [
    `${spec.name} - CodeFlow motion file (by aeflowtools)`,
    '',
    'Import into After Effects:',
    '  1. Window > Extensions > CodeFlow',
    '  2. Open... this .codeflow file (or codeflow.json inside the folder), or drag it onto the panel',
    '  3. Click Build',
    '',
    fontLines.length ? 'Fonts (included fonts are installed by the CodeFlow panel when you build):\n' + fontLines.join('\r\n') : 'No fonts needed.',
    '',
  ].join('\r\n');
  return { spec, files, bytes, readme, fonts: fontLines.length - fontsMissing.length, fontsMissing };
}

export function pack(specFile, outFile, { folder = false } = {}) {
  const dir = path.dirname(path.resolve(specFile));
  const { spec, files, bytes, readme, fonts, fontsMissing } = collect(specFile);
  if (folder) {
    const outDir = path.resolve(path.join(outFile || dir, safe(spec.name) + ' (CodeFlow)'));
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(outDir, f.name)), { recursive: true }); fs.copyFileSync(f.src, path.join(outDir, f.name)); }
    fs.writeFileSync(path.join(outDir, 'codeflow.json'), JSON.stringify(spec));
    fs.writeFileSync(path.join(outDir, 'README.txt'), readme);
    return { saved: outDir, folder: outDir, open: path.join(outDir, 'codeflow.json'), assets: files.length, fonts, fontsMissing, bytes };
  }
  if (bytes > 1.5e9) throw new Error(`assets are ${(bytes / 1e9).toFixed(1)} GB: too big for one file - use --folder`);
  const entries = [
    { name: 'codeflow.json', data: Buffer.from(JSON.stringify(spec)) },
    { name: 'README.txt', data: Buffer.from(readme) },
    ...files.map(f => ({ name: f.name, data: fs.readFileSync(f.src) })),
  ];
  outFile = path.resolve(outFile || path.join(dir, safe(spec.name) + '.codeflow'));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, writeZip(entries));
  const size = fs.statSync(outFile).size;
  return { saved: outFile, file: outFile, folder: path.dirname(outFile), assets: files.length, fonts, fontsMissing, bytes: size, tip: size > 300e6 ? 'large file: consider --folder for easier sharing' : undefined };
}

// For tests: unpack next to the file (the panel does the same thing)
export function unpack(file, destDir) {
  destDir = destDir || file.replace(/\.codeflow$/i, '') + ' (codeflow)';
  for (const e of readZip(fs.readFileSync(file))) {
    const p = path.join(destDir, e.name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, e.data);
  }
  return path.join(destDir, 'codeflow.json');
}

const [, self, specFile, a2, a3] = process.argv;
if (self && path.basename(self) === 'pack.mjs') {
  try {
    const folder = process.argv.includes('--folder');
    const out = folder ? (a3 && !a3.startsWith('--') ? a3 : undefined) : (a2 && !a2.startsWith('--') ? a2 : undefined);
    const r = pack(specFile, out, { folder });
    console.log(JSON.stringify(r, null, 1));
    // Always tell the user exactly where it is (the skill repeats this line in its answer)
    console.log(`\nSAVED TO: ${r.saved}\nFOLDER:   ${r.folder}` + (r.fontsMissing.length ? `\nFONTS NOT INCLUDED: ${r.fontsMissing.join(', ')}` : ''));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
