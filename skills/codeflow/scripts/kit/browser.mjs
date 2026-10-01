// Headless Chrome session running the CodeFlow player (used for text measuring, stills and video).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { findFont, findOrFetchFont } from './fonts.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
// setup.mjs installs the dependencies into ~/.codeflow/runtime: outside the skill folder, so a plugin
// update (which replaces the skill folder) doesn't download them again. node_modules next to the kit also works.
export const RUNTIME = path.join(os.homedir(), '.codeflow', 'runtime');
const reqs = [createRequire(path.join(ROOT, 'package.json')), createRequire(path.join(RUNTIME, 'package.json'))];
const req = (name) => { let err; for (const r of reqs) { try { return r(name); } catch (e) { err = e; } } throw err; };

// ffmpeg: env -> bundled ffmpeg-static (installed by setup.mjs) -> ffmpeg on PATH
function findFfmpeg() {
  if (process.env.CODEFLOW_FFMPEG) return process.env.CODEFLOW_FFMPEG;
  try { const p = req('ffmpeg-static'); if (p && fs.existsSync(p)) return p; } catch {}
  try { if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg'; } catch {}
  return 'ffmpeg';
}
export const FFMPEG = findFfmpeg();

// Playwright: the kit's own dependency (installed by setup.mjs), then a globally installed one
function loadPlaywright() {
  const tries = [() => req('playwright-core'), () => req('playwright')];
  if (process.env.CODEFLOW_PLAYWRIGHT) tries.unshift(() => createRequire(process.env.CODEFLOW_PLAYWRIGHT)('playwright'));
  for (const t of tries) { try { return t(); } catch {} }
  throw new Error('CodeFlow: Playwright is missing. Run: node <codeflow>/scripts/setup.mjs');
}

let _browser = null;
async function browser() {
  if (_browser) return _browser;
  const { chromium } = loadPlaywright();
  // the user's installed Chrome, else Edge (always on Windows), else Playwright's own Chromium
  for (const opt of [{ channel: 'chrome' }, { channel: 'msedge' }, {}]) {
    try { _browser = await chromium.launch(opt); return _browser; } catch (e) { var last = e; }
  }
  throw new Error('CodeFlow: could not start Chrome or Edge: ' + (last && last.message));
}
// a plain page on the shared browser (used to open the user's ORIGINAL html video)
export async function newPage(width = 1920, height = 1080) {
  const b = await browser();
  const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGE ERROR', e.message));
  return page;
}
export async function closeBrowser() { if (_browser) { await _browser.close(); _browser = null; } }

// Font files for the player: installed / cached fonts, the font shipped inside a .codeflow, or Google Fonts.
export async function fontData(psNames, spec, specDir) {
  const out = {};
  for (const ps of psNames) {
    let f = findFont(ps);
    const shipped = spec && spec.fonts && spec.fonts[ps] && spec.fonts[ps].file;
    if (!f && shipped) {
      const file = path.isAbsolute(shipped) ? shipped : path.resolve(specDir || '.', shipped);
      if (fs.existsSync(file)) f = { file, ttc: false };
    }
    if (!f) f = await findOrFetchFont(ps);
    if (!f) throw new Error(`CodeFlow: font "${ps}" is not installed and not on Google Fonts (PostScript name). Install it or pick another font.`);
    if (f.ttc) throw new Error(`CodeFlow: font "${ps}" lives in a .ttc collection, which the player can't load yet: ${f.file}`);
    out[ps] = fs.readFileSync(f.file).toString('base64');
  }
  return out;
}

async function playerPage(w, h) {
  const b = await browser();
  const page = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PLAYER ERROR', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('PLAYER', m.text()); });
  await page.goto(pathToFileURL(path.join(ROOT, 'player/player.html')).href);
  return page;
}

// Text metrics from the exact font files (same files AE will use)
let _mpage = null;
export async function measure(items) {
  if (!_mpage) _mpage = await playerPage(200, 200);
  const fonts = await fontData([...new Set(items.map(i => i.font))]);
  return _mpage.evaluate(({ items, fonts }) => CodeFlow.measure(items, fonts), { items, fonts });
}

// Loads a spec into a player page. specDir = folder the asset paths are relative to.
export async function openSpec(spec, specDir, { K } = {}) {
  const main = spec.comps.find(c => c.id === spec.main);
  const page = await playerPage(main.w, main.h);
  const fonts = await fontData(Object.keys(spec.fonts || {}), spec, specDir);
  const base = pathToFileURL(specDir + path.sep).href;
  // video assets: pre-extract frames (cached) so every seek shows the exact clip frame
  const videoFrames = {};
  const { extractFrames, probeMedia } = await import('./media.mjs');
  for (const [id, a] of Object.entries(spec.assets || {})) {
    if (a.type !== 'video') continue;
    const file = path.isAbsolute(a.path) ? a.path : path.resolve(specDir, a.path);
    const info = probeMedia(file), fr = extractFrames(file, info);
    videoFrames[id] = { base: pathToFileURL(fr.dir + path.sep).href, ext: fr.ext, count: fr.count, fps: fr.fps };
  }
  await page.evaluate(async ({ spec, base, fonts, K, videoFrames }) => {
    if (K) Object.assign(CodeFlow.K, K);   // calibration overrides
    window.__cf = await CodeFlow.load(spec, { assetBase: base, fonts, videoFrames });
  }, { spec, base, fonts, K: K || null, videoFrames });
  return {
    page, main,
    seek: t => page.evaluate(t => window.__cf.seek(t), t),
    shot: (file, q = 92) => page.screenshot({ path: file, type: file.endsWith('.png') ? 'png' : 'jpeg', ...(file.endsWith('.png') ? {} : { quality: q }) }),
    close: () => page.close(),
  };
}
