# Authoring a new motion video in CodeFlow format

The video is written directly as a CodeFlow spec with the kit. The same file gives the MP4 preview (player) and the After Effects build. No conversion is needed later, and the two match by construction.

## Workflow
1. **Brief.** Get the script (VO text), assets (logo, UI screenshots, Figma SVG exports), a style reference and the VO audio if there is one. Ask only for what's missing.
2. **Storyboard.**
   - Split the script into scenes of one beat each (1.5–5 s). Long videos go in parts of 15–20 s, at roughly 2.6 spoken words per second.
   - Number scenes continuously (S01, S02, …) and write them to `storyboard.md` with the VO line, the visual and the motion notes for each.
   - Alternate kinetic-text moments with visual proof (UI, cards, product).
3. **Timing.**
   - If there is VO, time the motion to the words. Kinetic words should land on their spoken word.
   - Phrase starts: `ffmpeg -i vo.wav -af silencedetect=noise=-35dB:d=0.18 -f null -`.
   - Word times: ask the user, or use speech recognition if available. On Windows, PowerShell `System.Speech` DictationGrammar works on short per-phrase WAV clips cut at the silences; it gives word offsets within each clip.
   - Without VO, pace at one beat every 1.5–4 s.
4. **Styleframes.** Author the part's scenes with the kit. Render a contact sheet of settled moments and **show it to the user before animating**; layout changes are cheap now and expensive later.
   ```bash
   node scripts/kit/render.mjs part1.codeflow.json sheet part1-frames.jpg 1.0,4.5,7.0,10.2 3
   ```
5. **Motion.** Add keys and behaviours. Render sheets of in-between times to check the motion, then the full preview:
   ```bash
   node scripts/kit/render.mjs part1.codeflow.json video part1.mp4 --audio vo.wav
   ```
6. **Deliver.** Run `node scripts/kit/pack.mjs part1.codeflow.json` and give the user the **full paths** of the `.codeflow` file (pack's `SAVED TO` / `FOLDER` lines) and of the MP4, plus the import instructions. Fonts travel inside the file.

## Project structure (what the user will see in After Effects)
- **One comp per scene**, each spanning the full duration and keyed on the global timeline. The main comp places it as a precomp layer trimmed with `in`/`out`. Motion designers open scenes individually, so give them good names ("S02 - Meet Events").
- **Main comp:** background (a solid + `ramp`, plus blurred ellipse glows), the scene precomps in order (later = on top) and the VO audio layer.
- **Transitions** between scenes are keys on the precomp layers: `whipOut(layer, t)`, `whipIn(layer, t)`, or plain fades and slides.
- **Rigs:** use nulls to move groups (`CARD RIG`, `EVENTS PILL`). Remember that nulls don't fade their children.

## Motion vocabulary (kit behaviours)
| Want | Use |
|---|---|
| Card or pill appears with a bounce | `pop(layer, t, 0.45, { from: [0, 0] })` (outBack, one exact bezier) |
| Element eases in from below | `slideIn(layer, t, 0.5, [0, 60])` + `fadeIn` |
| Word-by-word kinetic line | ONE text layer + `wordReveal(layer, wordTimes, { dur: 0.38 })`; add `recenterOnReveal()` to keep the visible words centred |
| Line draws on / strike-through | path shape with `trim`, then `drawOn(layer, 0, t, 0.25)` |
| Scene exit / entry with energy | `whipOut` (scale ×1.6 + blur 22 + fade, 0.28 s) / `whipIn` (from ×1.45, blurred, outExpo 0.6 s) |
| Camera push on a UI screenshot | image layer, key `transform.anchor` (the focus point, in image px) + `transform.scale`, eased `inOutSine` |
| Living background | `drift(glow, 'transform.position', [40, 20], 18, 0, dur)` |
| Cursor click | arrow `pathShape`, position keys (`inOutCubic`), scale dip 125→103→125 over 0.18 s |
| Toggle / switch | thumb rect position +W (`inOutCubic` 0.38 s) + a small scaleX squash; label colours via a `fill` effect keyed white↔grey |
| Staggered list | the same behaviour per item with `t + i × 0.07`–`0.12` |

## Stock footage and video clips
- `P.asset('clip', 'video', 'footage/city.mp4')` reads the size, length, fps and whether the clip has sound.
- `c.video('City B-roll', 'clip', { at: 3.0, from: 1.2, dur: 4 })` plays the clip from its 1.2 s point at 3.0 s, for 4 s.
  - `rate: 0.5` is slow motion, and `loop: true` repeats the clip.
  - `audio: true` keeps the clip's own sound, which the preview MP4 mixes in automatically.
- Transform, mask and effects work like any layer: cover-crop with `scale` + `mask`, and add a drop shadow, fades or zoom-whips.
- Deliver heavy footage projects as a folder: `pack.mjs --folder`.

## Units and looks
- Blur and shadow values are **After Effects units**. When you think in CSS pixels, convert them with `cssBlur(px)` / `cssShadow('…')` from `css.mjs`.
- Backgrounds: `linearGradient()` (any stops) and `radialGlow()` from `recipes.mjs` give clean, editable, exact gradients.
- Motion from your own formulas: `exactEase(fn)` / `splineKeys()` (`easefit.mjs`) turn them into exact keys.

## Eases that feel right
- **Entrances:** `outCubic`, `outQuint`, `outExpo`, or `Ease.back(0.3–1.0)` for a pop.
- **Exits:** `inQuad`, `inCubic`.
- **Moves between two rests:** `inOutCubic`, `inOutSine`.
- **Linear:** only for constant drifts and slow push-ins.

## Craft notes
- **Layout:** 1920×1080 with ~120 px safe margins. Centred hero compositions read best; one idea per beat.
- **Kinetic text:** keep it to the key phrase of the VO line, not subtitles.
- **UI screenshots:** use them at 2× resolution (render SVGs to 2× PNG) so camera push-ins stay sharp. Scale 50% = true size.
- **Measuring:** use `P.measure()` for any width that drives layout: pill widths, strike lengths, centring icon+label pairs.
- **Brands:** don't use real third-party brand names or logos in visuals unless the user supplies them.
