// Rasterise one element of the ORIGINAL html video at time t into a transparent PNG (for parts that can't be
// rebuilt as native layers: canvas/WebGL art, complex CSS illustrations). Use it as an image layer, placed at
// the reported box. Prefer native layers whenever possible - a picture is not editable in After Effects.
//   node kit/snap.mjs <video.html> <selector> <t> <out.png> [--size 1920x1080] [--seek ...]
import path from 'path';
import { openOriginal } from './original.mjs';
import { closeBrowser } from './browser.mjs';

export async function snap(file, selector, t, out, opts = {}) {
  const o = await openOriginal(file, opts);
  await o.seek(t);
  const el = await o.page.$(selector);
  if (!el) throw new Error('snap: no element matches ' + selector);
  const box = await el.boundingBox();
  await el.screenshot({ path: out, omitBackground: true });
  await o.close();
  return { file: out, box: box && [box.x, box.y, box.width, box.height], center: box && [box.x + box.width / 2, box.y + box.height / 2] };
}

const [, self, file, sel, tArg, out] = process.argv;
if (self && path.basename(self) === 'snap.mjs') {
  const flag = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const [w, h] = (flag('size') || '1920x1080').split('x').map(Number);
  snap(file, sel, +tArg, out, { width: w, height: h, seek: flag('seek') || 'auto' })
    .then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exitCode = 1; }).finally(closeBrowser);
}
