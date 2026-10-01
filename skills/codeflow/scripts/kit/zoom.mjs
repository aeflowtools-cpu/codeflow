// Zoomed look at one region: original | CodeFlow | difference x4, magnified.
//   node kit/zoom.mjs <original.png> <codeflow.jpg> x,y,w,h out.png [scale=3]
import path from 'path';
import { execFileSync } from 'child_process';
import { FFMPEG } from './browser.mjs';

export function zoom(a, b, [x, y, w, h], out, s = 3) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-i', b, '-filter_complex',
    `[0:v]crop=${w}:${h}:${x}:${y},scale=${w * s}:${h * s}:flags=neighbor,format=rgb24,split[a1][a2];` +
    `[1:v]crop=${w}:${h}:${x}:${y},scale=${w * s}:${h * s}:flags=neighbor,format=rgb24,split[b1][b2];` +
    `[a1][b1]blend=all_mode=difference,lutrgb=r=val*4:g=val*4:b=val*4[d];[a2][b2][d]hstack=3`, out]);
  return out;
}
const [, self, a, b, box, out, sc] = process.argv;
if (self && path.basename(self) === 'zoom.mjs') console.log(zoom(a, b, box.split(',').map(Number), out, +(sc || 3)));
