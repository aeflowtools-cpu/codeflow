// Opens the user's ORIGINAL html motion video and seeks it to exact times (for reference stills / probing).
//   node kit/original.mjs <video.html> <outDir> 0.5,1.2,3 [--size 1920x1080] [--seek auto|fn|gsap|waapi|clock] [--fn seek]
// Seek adapters, tried in this order by "auto":
//   fn    - a global function the page exposes (window.seek / __seek / setTime / renderFrame / goToTime), called with SECONDS
//   gsap  - gsap.globalTimeline (paused, then seek)
//   waapi - CSS animations / Web Animations API (pause + currentTime)
//   clock - Playwright virtual clock for requestAnimationFrame / timer driven pages (forward-only)
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { newPage, closeBrowser } from './browser.mjs';

const FN_NAMES = ['seek', '__seek', 'setTime', 'renderFrame', 'goToTime', 'seekTo'];

export async function openOriginal(file, { width = 1920, height = 1080, seek = 'auto', fn } = {}) {
  let page = await newPage(width, height);
  const url = /^https?:|^file:/.test(file) ? file : pathToFileURL(path.resolve(file)).href;
  const load = async () => {
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.waitForTimeout(300);
  };
  if (seek === 'clock') await page.clock.install({ time: 0 });
  await load();
  let mode = seek;
  if (mode === 'auto') {
    mode = await page.evaluate(({ names, fn }) => {
      const list = fn ? [fn] : names;
      for (const n of list) if (typeof window[n] === 'function') return 'fn:' + n;
      if (window.gsap && window.gsap.globalTimeline) return 'gsap';
      if (document.getAnimations && document.getAnimations().length) return 'waapi';
      return 'clock';
    }, { names: FN_NAMES, fn });
    if (mode === 'clock') { await page.close(); page = await newPage(width, height); await page.clock.install({ time: 0 }); await load(); }
  } else if (mode === 'fn') mode = 'fn:' + (fn || 'seek');
  await page.evaluate(() => document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch (e) {} }));
  let clockAt = 0;
  async function seekTo(t) {
    if (mode.startsWith('fn:')) await page.evaluate(({ n, t }) => window[n](t), { n: mode.slice(3), t });
    else if (mode === 'gsap') await page.evaluate(t => { const g = window.gsap.globalTimeline; g.pause(); g.seek(t, false); }, t);
    else if (mode === 'waapi') await page.evaluate(t => { document.getAnimations().forEach(a => { a.pause(); a.currentTime = t * 1000; }); }, t);
    else {
      const ms = Math.round(t * 1000);
      if (ms < clockAt) throw new Error('clock mode can only move forward: request times in increasing order');
      await page.clock.runFor(ms - clockAt); clockAt = ms;
    }
    // <video> elements: wait until every seek has landed and a frame is decoded (max 4 s)
    await page.evaluate(() => Promise.race([
      Promise.all([...document.querySelectorAll('video')].map(v => new Promise(r => {
        if (!v.seeking && v.readyState >= 2) return r();
        const done = () => r();
        v.addEventListener('seeked', done, { once: true }); v.addEventListener('loadeddata', done, { once: true });
      }))),
      new Promise(r => setTimeout(r, 4000)),
    ]));
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
  return { page, mode, seek: seekTo, close: () => page.close() };
}

export async function originalStills(file, times, outDir, opts = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const o = await openOriginal(file, opts);
  const files = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    await o.seek(t);
    const f = path.join(outDir, `o_${t.toFixed(2)}.jpg`);
    await o.page.screenshot({ path: f, type: 'jpeg', quality: 92 });
    files.push({ t, file: f });
  }
  await o.close();
  console.log('seek mode:', o.mode);
  return times.map(t => files.find(x => x.t === t).file);
}

const [, self, file, outDir, timesArg] = process.argv;
if (self && path.basename(self) === 'original.mjs') {
  const flag = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const [w, h] = (flag('size') || '1920x1080').split('x').map(Number);
  originalStills(file, timesArg.split(',').map(Number), outDir, { width: w, height: h, seek: flag('seek') || 'auto', fn: flag('fn') })
    .then(f => console.log(f.join('\n'))).catch(e => { console.error(e); process.exitCode = 1; }).finally(closeBrowser);
}
