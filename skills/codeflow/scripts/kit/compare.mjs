// Does the CodeFlow version look like the user's ORIGINAL video?
//   node kit/compare.mjs <spec.codeflow.json> <original.html | original.mp4> <outDir> 0.5,1.2,3 [--size 1920x1080] [--seek ...] [--offset 0]
// Writes <outDir>/report.json (SSIM per time, 1.0 = identical) and <outDir>/sheet.jpg = the WORST frames first
// (original | CodeFlow | difference x4). --worst N (default 8), --all also writes all.jpg in time order.
// --quick: the cheap check. Prints ONE summary line + a VERDICT (no per-frame lines) and only builds pictures for the worst 2 frames.
// Zoom into a region: node kit/zoom.mjs <outDir>/original/o_T.png <outDir>/codeflow/t_T.jpg x,y,w,h out.png
// --offset: seconds to ADD to the spec time to get the original's time (if the spec is a trimmed part of a longer video).
import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { renderStills, contactSheet } from './render.mjs';
import { originalStills } from './original.mjs';
import { closeBrowser, FFMPEG } from './browser.mjs';

export function ssim(a, b) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', a, '-i', b, '-lavfi', '[0:v]format=rgb24[x];[1:v]format=rgb24[y];[x][y]ssim', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = (r.stderr || '').match(/All:([\d.]+)/);
  return m ? +m[1] : null;
}
export function sideBySide(a, b, out) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-i', b, '-filter_complex',
    '[0:v]scale=640:360,format=rgb24,split[a1][a2];[1:v]scale=640:360,format=rgb24,split[b1][b2];[a1][b1]blend=all_mode=difference,lutrgb=r=val*4:g=val*4:b=val*4[d];[a2][b2][d]hstack=3', out]);
  return out;
}

export async function compare(specFile, original, outDir, times, { width = 1920, height = 1080, seek = 'auto', offset = 0, worstN = 8, all = false, quick = false } = {}) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const fps = spec.fps || 30;
  const exact = times.map(t => Math.round(t * fps) / fps);
  const oDir = path.join(outDir, 'original'), cDir = path.join(outDir, 'codeflow'), sDir = path.join(outDir, 'compare');
  [oDir, cDir, sDir].forEach(d => fs.mkdirSync(d, { recursive: true }));
  let oFiles;
  if (/\.(mp4|mov|webm|mkv)$/i.test(original)) {
    oFiles = exact.map(t => {
      const f = path.join(oDir, `o_${t.toFixed(2)}.png`);
      const n = Math.round((t + offset) * fps);
      execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', original, '-vf', `fps=${fps},select=eq(n\\,${n}),scale=${width}:${height}`, '-frames:v', '1', f]);
      return f;
    });
  } else {
    oFiles = await originalStills(original, exact.map(t => t + offset), oDir, { width, height, seek });
  }
  const cFiles = await renderStills(specFile, exact, cDir);
  // numbers first: SSIM for every time. Pictures are only made for the frames you will actually look at (the worst N).
  const report = exact.map((t, i) => ({ t, ssim: ssim(oFiles[i], cFiles[i]) }));
  if (!quick) report.forEach(r => console.log(`t=${r.t.toFixed(2)}  SSIM ${r.ssim}`));
  const vals = report.map(r => r.ssim).filter(v => v != null);
  const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
  const worst = Math.min(...vals);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ mean, worst, frames: report }, null, 1));
  // sheet.jpg = the WORST frames first (what you need to fix), all.jpg = every frame in time order
  const order = report.map((r, i) => i).sort((a, b) => (report[a].ssim ?? 0) - (report[b].ssim ?? 0));
  const sheets = {};
  for (const i of (all ? order : order.slice(0, worstN))) sheets[i] = sideBySide(oFiles[i], cFiles[i], path.join(sDir, `c_${report[i].t.toFixed(2)}.jpg`));
  contactSheet(order.slice(0, worstN).map(i => sheets[i]), path.join(outDir, 'sheet.jpg'), 1, 1440);
  if (all) contactSheet(report.map((_, i) => sheets[i]), path.join(outDir, 'all.jpg'), 1, 1440);
  if (!quick) console.log('worst frames:', order.slice(0, worstN).map(i => `${report[i].t.toFixed(2)} (${report[i].ssim})`).join(', '));
  console.log(`mean SSIM ${mean.toFixed(4)}  worst ${worst.toFixed(4)} (t=${report[order[0]].t.toFixed(2)})  frames ${report.length}  sheet: ${path.join(outDir, 'sheet.jpg')}`);
  // a plain verdict, so no image needs to be opened just to learn whether the result is good
  const low = order.filter(i => (report[i].ssim ?? 0) < 0.95);
  if (mean >= 0.97 && worst >= 0.93) console.log('VERDICT: GOOD ENOUGH (mean >= 0.97, no frame below 0.93). You can deliver; do not open the images.');
  else console.log(`VERDICT: NEEDS WORK. Frames below 0.95: ${low.map(i => `${report[i].t.toFixed(2)} (${report[i].ssim})`).join(', ') || 'none'}. Open ONLY sheet.jpg (the worst frames) and fix the cause.`);
  return { mean, worst, report };
}

const [, self, specFile, original, outDir, timesArg] = process.argv;
if (self && path.basename(self) === 'compare.mjs') {
  const flag = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const [w, h] = (flag('size') || '1920x1080').split('x').map(Number);
  const quick = process.argv.includes('--quick');
  compare(specFile, original, outDir, timesArg.split(',').map(Number), { width: w, height: h, seek: flag('seek') || 'auto', offset: +(flag('offset') || 0), worstN: +(flag('worst') || (quick ? 2 : 8)), all: process.argv.includes('--all'), quick })
    .catch(e => { console.error(e); process.exitCode = 1; }).finally(closeBrowser);
}
