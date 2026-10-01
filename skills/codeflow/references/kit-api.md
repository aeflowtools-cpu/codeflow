# CodeFlow kit API

All modules are ES modules in `scripts/kit/`. Import them by file URL from your script:

```js
import { Project, rect, ellipse, pathShape, Ease } from 'file:///<skill>/scripts/kit/index.mjs';
```

## Project (`index.mjs`)
```js
const P = new Project({ name: 'My Video', fps: 30, dir: DIR });   // dir = folder the asset paths are relative to
P.asset(id, 'image' | 'video' | 'audio', path)  // relative to dir, or absolute; image/video size, video duration/fps/audio read automatically
const c = P.comp(id, name, { w: 1920, h: 1080, duration, bgColor })
P.setMain('main')
await P.measure([{ font: 'Inter-Medium', size: 30, text: 'Label', tracking: 0 }])
      // -> [{ width, words: [{ text, x, width }] }], measured with the real installed font file
const ps = await P.font('Poppins', 600)        // 'Poppins-SemiBold': installed font, else downloaded from Google Fonts
P.save(file)                                   // validates, resolves fonts, writes the spec (throws on errors)
```
Always `await closeBrowser()` (from `browser.mjs`) at the end of a script that measured text.

## Layers (`Comp` methods)
Creation order = painting order: **later layers draw on top**. `c.toTop(layer)` moves one up.

```js
c.null(name, { position })                       // anchor [50,50] like AE nulls
c.solid(name, { color, w, h })                   // anchor = centre
c.shape(name, { position, shapes: [rect(...), ellipse(...), pathShape(...)] })
c.text(name, { text, font: 'Poppins-Medium', size, fill, justify: 'left'|'center'|'right', tracking, position })
c.image(name, assetId, { position, scale })      // anchor = image centre
c.precomp(name, compId, { in, out, anchor, position })
c.audio(name, assetId)
c.video(name, assetId, { at, from, dur, rate = 1, loop, audio = false, position, scale })   // footage; or AE-style { start, in, out }
```

Common options for every layer: `parent`, `in`, `out`, `start`, `anchor`, `position`, `scale` (number or [x,y], %), `rotation` (deg) and `opacity` (0–100).

- With `parent`, values are **comp-space** and are converted to the parent's space (pick-whip behaviour), using the parent's pose at the moment the child is created. Create children before animating their parents.
- Add `space: 'parent'` to pass raw parent-space values instead.

### Shapes (drawn relative to the layer origin)
```js
rect({ size: [w, h], position: [0, 0], roundness, fill: '#fff' | { color, opacity }, stroke: { color, width, cap, join, dash: [l, g] } | '#hex', strokeWidth, trim })
ellipse({ size: d | [w, h], position, fill, stroke })
pathShape({ path: { v, i, o, c }, fill, stroke, trim: { start: 0, end: 0, offset: 0 } })
```

Path helpers (`svgpath.mjs`):
- `svgPathToAE(d)` returns `[path…]`;
- `iconToPaths('<path d=…/><circle …/>')` returns `[{ path, dash }]`;
- `rectPath(x, y, w, h, r)`;
- `circlePath(cx, cy, r)`.

### Layer methods
```js
layer.key(path, [[t, value, ease], [t2, value2]])  // ease = preset | [x1,y1,x2,y2] | 'linear' | 'hold', for the segment starting at that key
layer.keyLocal(path, keys)                         // same, values already in the layer's own space (read back with get())
layer.set(path, value) ; layer.get(path)
layer.effect('blur', { amount }) | layer.effect(cssShadow('0 10px 30px rgba(0,0,0,.3)'))   // -> effect index
layer.mask(rectPath(x, y, w, h, r))                // plain add mask, layer space
layer.parentTo(otherLayer)                         // raw parenting (values already in parent space)
```

Key paths:
- transform: `transform.position | scale | rotation | opacity | anchor`;
- shapes: `shapes.<i>.size | position | roundness | fill.color | fill.opacity | stroke.color | stroke.width | trim.end`;
- effects: `effects.<i>.amount | opacity | softness | distance | color`;
- text selectors: `text.animators.<a>.selectors.<s>.amount`.

### Effects
| Effect | Parameters |
|---|---|
| `blur` | `amount` (AE Blurriness) |
| `dropShadow` | `color`, `opacity` %, `direction` (deg, 0 = up, clockwise), `distance`, `softness` |
| `fill` | `color` (recolours the layer, which is useful for animated text/icon colours) |
| `ramp` | `start`, `end`, `from`, `to` (on solid/shape layers) |

Converting from CSS: `cssBlur(px)` and `cssShadow('x y blur colour')` (in `css.mjs`) give values that *look* like the browser version.

## Eases
- **Presets:**
  - `linear`, `hold`, `easyEase`;
  - `in|out|inOut` + `Sine|Quad|Cubic|Quint|Expo`;
  - `outQuart`, `outBack`, `inBack`.
  - Quad, Cubic and Back are the **exact** Penner polynomials.
- **Per axis:** `[[x1,y1,x2,y2], [x1,y1,x2,y2]]` or `['outCubic', 'inOutSine']` gives one ease per dimension. AE gets separated X/Y position, and each axis is exact.
- **Custom overshoot:** `Ease.back(amount)` gives an outBack with a chosen overshoot handle (0.567 standard, 1.0 strong).
- **`css.mjs`:**
  - `webEase('power2.out' | 'back.out(1.7)' | 'ease-out' | 'cubic-bezier(…)')` (back.out is exact);
  - `sampleKeys(t0, t1, u => value)`: linear keys for springs, bounce, elastic and any JS math.
- **`easefit.mjs`:**
  - `exactEase(fn, u0 = 0, u1 = 1)` is exact for cubic polynomials and fitted otherwise (`exactEase.lastError`);
  - `EASE_FN` (Penner functions) and `backFn(s)`;
  - `splineKeys([{ t, v: [x, y] }, …])`: Catmull/Hermite path → keys with per-axis eases, zero speed at the ends;
  - `sineKeys(t0, t1, A, w, p, B)`: exact sine drift;
  - `reach(f, m)`: when a `clamp(f(u)·m)` reaches 1.

## Recipes (`recipes.mjs`)
```js
linearGradient(c, 'BG', { from: [960, 0], to: [960, 1080], stops: ['#021A30', '#064583', '#0A6CC4'] })   // any stops, exact
radialGlow(c, 'Glow', { center: [x, y], radius: r | [rx, ry], color, alpha, steps = 16 })                  // linear-falloff radial gradient
```

## Behaviours (`behaviors.mjs`)
```js
fadeIn(l, t, d = .3, ease = 'outCubic') ; fadeOut(l, t, d, ease)
pop(l, t, d = .45, { from: [0,0], to, overshoot = .56 })
slideIn(l, t, d = .5, offset = [0, 60], ease)
whipOut(l, t, { d = .28, scale = 1.6, blur = 22 }) ; whipIn(l, t, { d = .6, from = 1.45, blur = 20, fade = .2 })   // blur in AE units: CSS px -> cssBlur(px).amount
wordReveal(textLayer, times, { dur = .38, ease, hidden = { opacity: 0, position: [0, 26], blur: [12, 12] } })
recenterOnReveal(textLayer, times, measureResult, { dur = .3 })
drawOn(l, shapeIndex, t, d = .25)
drift(l, 'transform.position', [ax, ay], period, t0, t1)
```

## Command line tools
| Command | Does |
|---|---|
| `node scripts/setup.mjs` | one-time install and checks |
| `node scripts/kit/render.mjs spec stills t1,t2 [dir]` | preview stills |
| `node scripts/kit/render.mjs spec sheet out.jpg t1,t2,… [cols]` | contact sheet |
| `node scripts/kit/render.mjs spec video out.mp4 [--from a --to b] [--audio vo.wav]` | preview MP4. Audio comes from the spec's audio layers and clips with `audio: true`, unless `--audio` is given |
| `node scripts/kit/original.mjs video.html dir t1,t2 [--size WxH] [--seek auto\|fn\|gsap\|waapi\|clock]` | stills of the user's original HTML video |
| `node scripts/kit/probe.mjs video.html t out.json [--root sel]` | real layout of the original at time t: `box` (on screen), `layout` (before transforms), `baseline`/`layoutBaseline`, `usedFonts`/`fauxBold` |
| `node scripts/kit/snap.mjs video.html selector t out.png` | rasterise one element (fallback for non-native parts) |
| `node scripts/kit/compare.mjs spec original.html\|.mp4 outDir t1,t2 [--quick] [--offset s] [--worst 8] [--all]` | SSIM per frame; `sheet.jpg` = worst frames first. **`--quick`: the cheap default, one summary line + a VERDICT, pictures only for the worst 2 frames** |
| `node scripts/kit/zoom.mjs original.png codeflow.jpg x,y,w,h out.png [scale]` | magnified original / CodeFlow / difference of one region |
| `node scripts/kit/pack.mjs spec [out.codeflow]` | the single-file deliverable (assets + font files); prints `SAVED TO:` / `FOLDER:` full paths |
| `node scripts/kit/pack.mjs spec --folder [parentDir]` | the same as a folder `<Name> (CodeFlow)/` (heavy video projects) |
| `node scripts/kit/ae.mjs ping \| build spec \| save file.aep` | direct build into an open After Effects with CodeFlow (ask first) |
