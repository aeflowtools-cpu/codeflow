# Converting an existing HTML motion video to CodeFlow

**Goal:** the user's video, rebuilt as a CodeFlow spec that looks the same, packed into one `.codeflow` file.

**Method:**
1. Read the code to understand the intent.
2. Measure the browser for real numbers.
3. Author with the kit.
4. Compare against the original until it matches.

## Contents
1. Understand the source
2. Reference frames
3. Probe the real layout (and the fonts actually drawn)
4. Map HTML → CodeFlow (the table)
5. Timing and eases: make them exact
6. Write the conversion script (skeleton)
7. Compare, find the cause, fix
8. Pack and deliver
9. Pitfalls seen in real conversions

---

## 1. Understand the source
Read the entry HTML and its scripts, and answer these before writing anything:

- **How is time driven?** A global `seek(t)` / `renderFrame(t)`, a GSAP timeline, CSS `@keyframes`/transitions, Web Animations, or `requestAnimationFrame` with a clock. `original.mjs` auto-detects these.
- **The timing table:** most Claude-made videos keep one object of times (`T = { cardIn: .05, … }`). Reuse those exact numbers.
- **The ease functions:** copy the source's own ease formulas (`outCubic`, `outBack(k, s)`, custom camera splines). You will make them exact in §5.
- **Size, fps and duration:** from their render script (usually 1920×1080, 30 fps).
- **Scenes:** usually `div.layer`/`section` blocks shown and hidden by time, often with a "camera" wrapper that scales and translates.
- **Assets:** images, SVG files, video clips, audio/VO. For every `<video>`, find in the code how its time follows the timeline. The probe reports `video.currentTime` at the probed moment, which is a quick check of your formula.
  - Asset paths in the spec may be relative to the spec file or absolute (`D:/…`).
  - Never modify the user's source folder; write your files elsewhere and reference the assets from there.
- **Fonts:** family + weight → **PostScript name** (Poppins 500 = `Poppins-Medium`). Check what the browser *really* drew with the probe (§3, `usedFonts`).
  - If CSS asks for weight 600/700 but the browser drew `Inter-Regular` (`fauxBold: true`), that weight isn't installed. For a Google font, `await P.font('Inter', 600)` downloads the exact weight; otherwise use the nearest installed weight and tell the user which font to install to get it exact.
  - Font files ship inside the `.codeflow` and the panel installs missing ones, so the receiver doesn't need to install anything.
- **Outlined text:** if words in the source are `<path>` outlines (SVG frames exported from Figma with "Outline text" on), there is no text or font to recover. Never deliver them as images; ask the user to re-export with *Outline text* unchecked, or for the font name (see SKILL.md rule 5).

## 2. Reference frames
Pick check times: for every scene, one **settled** moment plus one **mid-motion** moment (about 10 times in total is plenty for the default Quick check; more only for an Exact check).

```bash
node scripts/kit/original.mjs video.html refs 0.5,1.3,2.2,5.0,7.2 --size 1920x1080
node scripts/kit/render.mjs …   # (for your own version, later)
```

If the user already has the rendered MP4, `compare.mjs` also accepts `.mp4` as the original.

## 3. Probe the real layout
```bash
node scripts/kit/probe.mjs video.html 2.0 probe_2.json [--root "#s1"]
```

Flexbox, centring, wrapping and fonts decide positions at run time, and those numbers are not in the code. For every element at time t the probe gives:
- **`box`**: where it is on screen, including all CSS transforms at that moment.
- **`layout`**: where it sits before any transforms (camera wrappers, scale-ins). Use this for positions inside a scene whose camera is animated, so you don't have to un-scale boxes by hand.
- **`opacity` / `effOpacity`**: its own opacity and the effective opacity after parents.
- **Styles:** `bg`, `radius`, `border`, `shadow`, `filter`, `overflow`, `transform`, `origin`.
- **Text:**
  - `font`, `text`;
  - `baseline` {x, y} (on screen) and `layoutBaseline` (pre-transform);
  - per-line boxes;
  - `usedFonts` (what the browser actually drew) and `fauxBold`.
- **SVG:** `bbox`, `ctm`, `attrs`.
- **Video:** `src`, `natural` size, `objectFit`, and `video: { currentTime, duration, rate, loop, muted }`.
- **Images:** `src`, `natural` size.

Probe each scene at a moment when it's at rest. Grep the JSON for the texts and classes you need rather than reading all of it.

## 4. Map HTML → CodeFlow
| In the source | In CodeFlow |
|---|---|
| Scene block shown between t0 and t1 | its own comp spanning the full duration, placed in main as a `precomp` layer with `in: t0, out: t1`. Keys use **global times** |
| "Camera" wrapper (scale/translate of a scene) | keys on the precomp layer (anchor = pivot, position = where it lands), or a null rig inside the scene. If x and y follow different curves, use **per-axis eases** (§5) |
| Container `opacity` fade (group fades as one) | whole scene: fade the scene precomp layer. Smaller group: make it a small precomp (**with margin for its shadow or glow**, since precomps clip) and fade that. Only fade layers one by one if the source does |
| `div` with background, border-radius | `shape` layer + `rect({ size, roundness, fill })`, layer `position` = box centre |
| CSS `border` (drawn inside the box) | `stroke` on the rect, rect `size` reduced by the border width (AE strokes sit centred on the path) |
| `box-shadow` | `layer.effect(cssShadow('0 18px 56px rgba(2,26,48,.38)'))` |
| `filter: drop-shadow(...)` | `cssShadow(str, { filter: true })` |
| `filter: blur(Npx)` | `layer.effect(cssBlur(N))`. Animated: key `effects.<i>.amount` in **AE units** (`cssBlur(px).amount`) |
| `transform-origin` | the layer's `anchor` (and the matching `position`) |
| translate / scale / rotate | `transform.position` / `transform.scale` (%) / `transform.rotation` (deg) |
| `<img>` | `P.asset(...)` + `c.image(...)`: anchor = image centre, `scale` = shown size / natural size × 100 |
| `object-fit: cover`, `overflow:hidden`, rounded clip | a `mask` (`rectPath(x, y, w, h, r)`) in the layer's own pixel space |
| Nested `<svg viewBox>` crop of an image | image layer + mask in image pixel space, `anchor` = crop centre |
| Inline SVG icon / path | `iconToPaths(svgBody)` or `svgPathToAE(d)` → `pathShape` per path; layer `scale` = displayed / viewBox size × 100 |
| `stroke-dasharray` line drawing on | path shape with `trim`, then `drawOn(layer, i, t, d)` |
| Text | `c.text(name, { text, font: '<PostScript>', size, fill, justify, tracking })`, position = baseline (`layoutBaseline` or `baseline`; the line centre for centred text). `letter-spacing: Lpx` → `tracking = L / size × 1000` |
| Multi-line text | one text layer per line (v1) |
| Per-word spans that blur/fade/rise in | ONE text layer + `wordReveal(layer, times, { hidden: { opacity: 0, position: [0, 26], blur: [b, b] } })`, with `b = cssBlur(12).amount` for a CSS `blur(12px)`. Per-word *scale* isn't supported; say so if the source uses it |
| Line that re-centres as words appear | `recenterOnReveal(layer, times, measure)` (overlapping reveals handled) |
| CSS `linear-gradient` (any number of stops) | `linearGradient(c, name, { from, to, stops })` from `recipes.mjs` (exact) |
| SVG/CSS `radial-gradient` glow | `radialGlow(c, name, { center, radius, color, alpha })` (exact linear falloff) |
| Transitions like zoom-whips | `whipOut(l, t, { blur: cssBlur(22).amount })` etc. (**AE units**) |
| `Math.sin(t)` drift | `sineKeys(t0, t1, A, w, p, B)` (exact) or `drift()`; different x/y frequencies → keys per axis on two nulls or per-axis sampled keys |
| spring / elastic / bounce / other custom math | `sampleKeys(t0, t1, u => value)` → linear keys (exact, less tidy) |
| DOM order / z-index | create layers in painting order: later-created layers draw on top (`c.toTop(layer)` to reorder) |
| `<audio>` / VO | `P.asset('vo', 'audio', 'vo.wav')` + `main.audio('VO', 'vo')` |
| `<video>` clip / stock footage | `P.asset('clip', 'video', src)` + `c.video(name, 'clip', { start, in, out })`. From the source's seek code, clip time = `(t - start) × rate` (e.g. `v.currentTime = 1.0 + (t - 0.5)` → `start: -0.5`). Or use `{ at, from, dur }`: at comp time `at`, play from clip time `from`, for `dur`. `object-fit: cover`/rounded frames → `scale` + a `mask` (`rectPath` in the clip's own pixels). Keep `audio: false` if the source video is `muted` |
| Image sequence swapped per frame (`img.src = frames/f_0012.jpg`) | rebuild the MP4 from those frames with ffmpeg (`ffmpeg -framerate 30 -i f_%04d.jpg -c:v libx264 -pix_fmt yuv420p clip.mp4`) and use a video layer |
| canvas / WebGL / CSS 3D / blend modes | not native. Rasterise static parts with `snap.mjs` into an image layer and tell the user |

## 5. Timing and eases: make them exact
The biggest SSIM gains come from motion that follows the source exactly.

- **Keep the source's times.** Copy its timing table verbatim.
- **Polynomial eases are exact beziers.** quad, cubic, `outBack(s)`, and any cubic polynomial of time are exactly `[1/3, y1, 2/3, y2]`.
  - The presets `outQuad/inQuad/outCubic/inCubic/outBack` are these exact Penner curves.
  - For other strengths: `import { exactEase, EASE_FN, backFn } from '…/kit/easefit.mjs'`, then `exactEase(backFn(2.2))`, `exactEase(EASE_FN.outExpo)` (fitted, error in `exactEase.lastError`), or `exactEase(f, u0, u1)` for part of a curve.
- **Camera splines** (`camAt()`-style Catmull/Hermite through keys) become `splineKeys([{ t, v: [x, y] }, …])`, which returns keys with **per-axis** eases.
  - Key those on **position**, not anchor: AE separates X/Y position, and each axis is exact.
  - For a zoom-around-focus camera (`translate(960 - fx·s, 540 - fy·s) scale(s)`), nest two nulls, content → PAN → ZOOM:
    - **ZOOM** sits at the screen centre (position = anchor = [960, 540]). Its scale follows the `s` spline (`splineKeys` on `[s·100, s·100]`).
    - **PAN** is a child of ZOOM. Its position follows `[960 - fx, 540 - fy]`, with per-axis `splineKeys`.
    - Put the content under PAN at its layout position.
  - The focus point then always lands at screen centre, with each curve exact.
- **`clamp(k * m)` style fades** (for example opacity reaching 1 at 1/3 of a pop): `reach(f, m)` gives the time where it saturates. Make that a key.
- **Two different curves on x and y** of the same key: give `[[bzX], [bzY]]` as the ease (arrays or preset names).

## 6. Write the conversion script
Put it next to your outputs (never inside the user's source folder). Import the kit by file URL.

```js
import path from 'path';
import { fileURLToPath } from 'url';
import { Project, rect, pathShape, Ease } from 'file:///SKILL/scripts/kit/index.mjs';
import * as B from 'file:///SKILL/scripts/kit/behaviors.mjs';
import { cssShadow, cssBlur, webEase, sampleKeys } from 'file:///SKILL/scripts/kit/css.mjs';
import { exactEase, EASE_FN, backFn, splineKeys } from 'file:///SKILL/scripts/kit/easefit.mjs';
import { linearGradient, radialGlow } from 'file:///SKILL/scripts/kit/recipes.mjs';
import { iconToPaths, rectPath } from 'file:///SKILL/scripts/kit/svgpath.mjs';
import { closeBrowser } from 'file:///SKILL/scripts/kit/browser.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const P = new Project({ name: 'My Video', fps: 30, dir: DIR });
const DUR = 15.6;
P.asset('logo', 'image', 'D:/their/project/assets/logo.png');   // absolute is fine
P.asset('vo', 'audio', 'D:/their/project/vo.wav');
const T = { /* the source's timing table, verbatim */ };
const M = await P.measure([{ font: 'Inter-Regular', size: 20, text: '$99/mo' }]);

// ---- scene 1 ----
const s1 = P.comp('S01', 'S01 - Cards', { duration: DUR });
const rig = s1.null('CARD RIG', { position: [960, 540] });
const card = s1.shape('Card', { parent: rig, position: [960, 540], shapes: [rect({ size: [680, 690], roundness: 30, fill: '#FFFFFF' })] });
card.effect(cssShadow('0 18px 56px rgba(2,26,48,.38)'));
rig.key('transform.scale', [[T.cardIn, [86, 86], exactEase(backFn(1.3))], [T.cardIn + 0.7, [100, 100]]]);

// ---- main ----
const main = P.comp('main', 'My Video', { duration: DUR });
main.audio('VO', 'vo');
linearGradient(main, 'BG', { from: [960, 0], to: [960, 1080], stops: ['#021A30', '#064583', '#0A6CC4'] });
radialGlow(main, 'Glow', { center: [0, 1076], radius: [1056, 648], color: '#9AD6FA', alpha: 0.95 });
const L1 = main.precomp('S01 - Cards', 'S01', { in: 0, out: 5.67 });
L1.key('transform.opacity', [[T.cardIn, 0, 'linear'], [T.cardIn + 0.2, 100]]);   // the scene fades as ONE group
B.whipOut(L1, 5.32, { blur: cssBlur(22).amount });
P.setMain('main');
P.save(path.join(DIR, 'my-video.codeflow.json'));
await closeBrowser();
```

## 7. Compare, find the cause, fix
```bash
node my-video.mjs
node scripts/kit/compare.mjs my-video.codeflow.json /path/video.html cmp 0.5,1.3,2.2,5.0,7.2 --quick
node scripts/kit/zoom.mjs cmp/original/o_2.20.jpg cmp/codeflow/t_2.20.jpg 600,300,400,200 zoom.png
```

`--quick` prints one summary line and a **VERDICT**. If it says GOOD ENOUGH, deliver and open nothing. If it says NEEDS WORK, open only `cmp/sheet.jpg`. It shows the **worst frames first**: original | CodeFlow | difference ×4, where black means identical. Read the difference column like this:

| What you see | Usual cause |
|---|---|
| Whole element outlined | position off: use the probe's `layout`/`box`, check anchor/origin, parent conversion |
| Ghost / double image in motion frames | timing or ease differs: copy the source times, make eases exact (§5), check per-axis curves |
| Parts showing through during a fade | layers faded one by one where the source fades a group: fade a precomp instead |
| Something bright where the original is empty | layer visible too early, or opacity keyed on a null (not inherited!) |
| Something missing | layer not created, hidden, clipped by a precomp's edge, or behind another layer |
| Soft glow / shadow halos | blur/shadow units: use `cssBlur`/`cssShadow`; for radial gradients use `radialGlow` |
| Text outlines only | 1-2 px anti-aliasing (or a faux-bold weight, see §1). Acceptable |
| Text shifted | baseline: use `layoutBaseline`/`baseline`; use the line centre for centred text |

**Quick (default):** stop as soon as the verdict is GOOD ENOUGH (mean SSIM ≥ 0.97, no frame below 0.93). Do at most 2 fix rounds; if it still says NEEDS WORK, deliver anyway and tell the user honestly which parts differ.
**Exact (only if the user asks for pixel-perfect):** iterate on more check times (drop `--quick`), then run a **dense check** (every 0.2 s) before delivering.

## 8. Pack and deliver
```bash
node scripts/kit/pack.mjs my-video.codeflow.json            # one file
node scripts/kit/pack.mjs my-video.codeflow.json --folder   # or a folder (heavy videos)
node scripts/kit/render.mjs my-video.codeflow.json video my-video-preview.mp4   # audio from the spec
```

Then tell the user:
- the **full path** of the `.codeflow` (or folder) and of the preview MP4: copy pack's `SAVED TO` / `FOLDER` lines;
- how to import it (After Effects → Window → Extensions → CodeFlow → Open or drag → Build);
- fonts: included in the file (installed by the panel), any listed under `FONTS NOT INCLUDED`, and any weight you substituted;
- what, if anything, is a picture instead of live layers;
- the match score.

## 9. Pitfalls seen in real conversions
- **Videos that just autoplay.** If the page never sets `video.currentTime` from its timeline, the capture pauses them at load, so reference frames show their first frame. Work out from the code when `play()` starts, and set the video layer's `start` to match.
- **Opacity inheritance.** HTML fades a container; AE doesn't pass opacity to children. This was the #1 cause of "the AEP looks different". Group fades → precomps.
- **Precomps clip to their size.** A component precomp with a drop shadow or glow needs margin around it.
- **A shadow on a see-through box.** CSS draws the full shadow; AE's Drop Shadow follows the layer's alpha, so a 12% fill gives a faint shadow. Accept it or mention it; a separate blurred shape darkens the inside.
- **Parent space.** Give comp-space values with `{ parent }`. Values read back with `layer.get()` are local, so re-key them with `keyLocal()`.
- **Guessed text widths.** Always measure; one wrong font weight throws off strikes, pills and centring.
- **Blur units.** The kit and behaviours use AE units. Every CSS blur/shadow goes through `cssBlur`/`cssShadow`.
- **Hand-tuned numbers in the source** (like `+ 26px`) are intentional; keep them.
- **Don't beautify** while converting. First match the original; only improve if the user asks.
