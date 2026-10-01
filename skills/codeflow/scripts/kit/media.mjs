// Video helpers (ffmpeg only; no ffprobe needed): read clip info, extract frames for the player.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import { FFMPEG } from './browser.mjs';

// { w, h, duration, fps, frames, hasAlpha, hasAudio, pixFmt }
export function probeMedia(file) {
  if (!fs.existsSync(file)) throw new Error('video not found: ' + file);
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' });
  const s = r.stderr || '';
  const dur = s.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const v = s.match(/Stream #[^\n]*Video:[^\n]*/);
  if (!v) throw new Error('no video stream in ' + file);
  const line = v[0];
  const size = line.match(/,\s*(\d{2,5})x(\d{2,5})[\s,[]/);
  const fpsM = line.match(/([\d.]+)\s*fps/) || line.match(/([\d.]+)\s*tbr/);
  const pix = (line.match(/Video:\s*[^,]+,\s*([a-z0-9]+)/i) || [])[1] || '';
  const duration = dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0;
  const fps = fpsM ? parseFloat(fpsM[1]) : 30;
  return {
    w: size ? +size[1] : 0, h: size ? +size[2] : 0, duration: +duration.toFixed(3), fps,
    frames: Math.max(1, Math.round(duration * fps)),
    hasAlpha: /yuva|rgba|argb|bgra|abgr|gbrap/.test(pix) || /\balpha\b/i.test(line),
    hasAudio: /Stream #[^\n]*Audio:/.test(s), pixFmt: pix, line,
  };
}

// Extracts every frame at the clip's own frame rate into a cache folder (re-used while the file is unchanged).
// Frame i (0-based) shows clip time i / fps -> file f_<i+1>.jpg|png
export function extractFrames(file, info = probeMedia(file)) {
  const st = fs.statSync(file);
  const key = crypto.createHash('md5').update(path.resolve(file) + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 16);
  const dir = path.join(os.tmpdir(), 'codeflow-cache', key);
  const ext = info.hasAlpha ? 'png' : 'jpg';
  const done = path.join(dir, '.done');
  if (!fs.existsSync(done)) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // Colour: untagged HD video is BT.709 in browsers and After Effects, but ffmpeg would assume BT.601 (SD)
    // and shift every colour. Tagged video keeps its own matrix.
    const tagged = /bt709|bt470|smpte170|bt2020|bt601/i.test(info.line || '');
    const matrix = tagged ? 'auto' : (info.h >= 720 ? 'bt709' : 'bt601');
    const vf = `fps=${info.fps},scale=in_color_matrix=${matrix}:in_range=${/\bpc\b|yuvj/.test(info.line || '') ? 'pc' : 'tv'}:out_color_matrix=bt601:out_range=pc`;
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', vf];
    if (ext === 'jpg') args.push('-pix_fmt', 'yuvj420p', '-q:v', '2'); else args.push('-pix_fmt', 'rgba');
    args.push(path.join(dir, 'f_%05d.' + ext));
    const r = spawnSync(FFMPEG, args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('frame extraction failed for ' + file + ': ' + (r.stderr || '').slice(-400));
    fs.writeFileSync(done, String(Date.now()));
  }
  const count = fs.readdirSync(dir).filter(f => f.startsWith('f_')).length;
  return { dir, ext, count, fps: info.fps };
}
