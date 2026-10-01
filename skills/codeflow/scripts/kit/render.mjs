// node kit/render.mjs <spec.json> stills 0.5,1.2,3 [outDir]
// node kit/render.mjs <spec.json> video <out.mp4> [--from 0] [--to 15.6] [--audio file.wav]
// node kit/render.mjs <spec.json> sheet <out.jpg> 0.5,1,2,3 [cols]      (contact sheet of stills)
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { openSpec, closeBrowser, FFMPEG } from './browser.mjs';

export async function renderStills(specFile, times, outDir) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });
  const p = await openSpec(spec, path.dirname(path.resolve(specFile)));
  const files = [];
  for (const t of times) {
    await p.seek(t);
    const f = path.join(outDir, `t_${t.toFixed(2)}.jpg`);
    await p.shot(f);
    files.push(f);
  }
  await p.close();
  return files;
}

// Every sound the spec plays, in main-comp time: audio layers + video layers with audio:true, through precomps.
export function collectAudio(spec, dir) {
  const comps = Object.fromEntries(spec.comps.map(c => [c.id, c]));
  const clips = [];
  const walk = (comp, offset, lo, hi, depth) => {
    if (depth > 20) return;
    for (const l of comp.layers) {
      const a0 = Math.max(lo, offset + (l.in ?? 0)), a1 = Math.min(hi, offset + (l.out ?? comp.duration));
      if (a1 <= a0) continue;
      if (l.type === 'precomp') { walk(comps[l.precomp.comp], offset + (l.start || 0), a0, a1, depth + 1); continue; }
      const isAudio = l.type === 'audio', isVid = l.type === 'video' && l.video.audio;
      if (!isAudio && !isVid) continue;
      const a = spec.assets[isAudio ? l.audio.asset : l.video.asset];
      if (!a || (isVid && a.hasAudio === false)) continue;
      const file = path.isAbsolute(a.path) ? a.path : path.resolve(dir, a.path);
      const rate = isVid ? (l.video.rate || 1) : 1, start = offset + (l.start || 0);
      clips.push({ file, at: a0, dur: a1 - a0, src: (a0 - start) * rate, rate, loop: isVid && l.video.loop, clipDur: a.duration });
    }
  };
  const main = comps[spec.main];
  walk(main, 0, 0, main.duration, 0);
  return clips;
}

export async function renderVideo(specFile, out, { from = 0, to, audio, audioFrom } = {}) {
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const dir = path.dirname(path.resolve(specFile));
  const p = await openSpec(spec, dir);
  const fps = spec.fps || 30;
  to = to == null ? p.main.duration : to;
  const n = Math.round((to - from) * fps);
  const fr = path.join(path.dirname(path.resolve(out)), '.frames_' + path.basename(out, '.mp4'));
  fs.rmSync(fr, { recursive: true, force: true });
  fs.mkdirSync(fr, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await p.seek(from + i / fps);
    await p.shot(path.join(fr, `f_${String(i).padStart(5, '0')}.jpg`), 95);
    if (i % 90 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await p.close();
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps), '-i', path.join(fr, 'f_%05d.jpg')];
  let hasAudio = false;
  if (audio) {                          // explicit file (e.g. a VO) overrides the spec's own audio
    args.push('-ss', String(audioFrom != null ? audioFrom : from), '-t', String(to - from), '-i', audio);
    hasAudio = true;
  } else {
    const clips = collectAudio(spec, dir).filter(c => c.at + c.dur > from && c.at < to);
    if (clips.length) {
      const parts = [];
      clips.forEach((c, i) => {
        const cut = Math.max(0, from - c.at), at = Math.max(0, c.at - from), dur = c.dur - cut;
        if (c.loop) args.push('-stream_loop', '-1');
        args.push('-i', c.file);
        let tempo = '', r = c.rate;
        while (r > 2) { tempo += 'atempo=2,'; r /= 2; }
        while (r < 0.5) { tempo += 'atempo=0.5,'; r /= 0.5; }
        if (Math.abs(r - 1) > 1e-6) tempo += `atempo=${r.toFixed(5)},`;
        parts.push(`[${i + 1}:a]atrim=start=${(c.src + cut * c.rate).toFixed(4)}:duration=${(dur * c.rate).toFixed(4)},asetpts=PTS-STARTPTS,${tempo}aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(at * 1000)}:all=1[a${i}]`);
      });
      args.push('-filter_complex', parts.join(';') + ';' + clips.map((c, i) => `[a${i}]`).join('') + `amix=inputs=${clips.length}:normalize=0:duration=longest,atrim=0:${(to - from).toFixed(4)}[aout]`);
      args.push('-map', '0:v', '-map', '[aout]');
      hasAudio = true;
    }
  }
  args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  if (audio) args.push('-shortest');
  args.push(out);
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
  fs.rmSync(fr, { recursive: true, force: true });
  return out;
}

export function contactSheet(files, out, cols = 3, w = 640) {
  const tmp = path.join(path.dirname(out), '.sheet_' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  files.forEach((f, i) => fs.copyFileSync(f, path.join(tmp, String(i + 1).padStart(3, '0') + '.jpg')));
  const rows = Math.ceil(files.length / cols);
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(tmp, '%03d.jpg'),
    '-vf', `scale=${w}:-1,tile=${cols}x${rows}`, '-frames:v', '1', out]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return out;
}

// CLI
const [, self, specFile, mode, a, b, c] = process.argv;
if (self && path.basename(self) === 'render.mjs') {   // (a URL-path comparison broke on paths with spaces)
  const flag = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  (async () => {
    if (mode === 'stills') {
      const files = await renderStills(specFile, a.split(',').map(Number), b || path.join(path.dirname(specFile), 'stills'));
      console.log(files.join('\n'));
    } else if (mode === 'sheet') {
      const times = b.split(',').map(Number);
      const tmp = path.join(path.dirname(path.resolve(a)), '.stills_tmp');
      const files = await renderStills(specFile, times, tmp);
      contactSheet(files, a, Number(c) || 3);
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log('wrote', a);
    } else if (mode === 'video') {
      await renderVideo(specFile, a, { from: +(flag('from') || 0), to: flag('to') ? +flag('to') : undefined, audio: flag('audio') });
      console.log('wrote', a);
    } else {
      console.log('usage: render.mjs <spec> stills|sheet|video ...');
    }
    await closeBrowser();
  })().catch(async e => { console.error(e); await closeBrowser(); process.exit(1); });
}
