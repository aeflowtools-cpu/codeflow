# CodeFlow Motion Spec v1 (`*.codeflow.json`)

The spec is a scene description shaped like After Effects. Two renderers read it:
- **The web player** (`player/`) emulates AE for exactly this feature set. It makes previews and MP4s.
- **The CodeFlow AE extension** (`extension/host/codeflow.jsx`) builds native, editable AE comps.

**Rule:** only add a feature here after it is implemented in *both* renderers and covered by `tests/calibration`. The player must never do something AE can't.

## Top level
```json
{
  "codeflow": 1,
  "name": "Events - Part 1",
  "fps": 30,
  "fonts":  { "Poppins-Medium": { "family": "Poppins", "weight": 500, "file": "C:/Windows/Fonts/Poppins-Medium.ttf" } },
  "assets": { "dash": { "type": "image", "path": "assets/dashboard@2x.png", "w": 5058, "h": 2978 },
              "clip": { "type": "video", "path": "assets/stock.mp4", "w": 1920, "h": 1080, "duration": 12.5, "fps": 30, "hasAudio": true },
              "vo":   { "type": "audio", "path": "vo.wav" } },
  "comps":  [ { "id": "main", "name": "Events - Part 1", "w": 1920, "h": 1080, "duration": 15.6, "layers": [ ... ] } ],
  "main": "main"
}
```
- **Paths:** asset paths are relative to the spec file, or absolute.
- **Fonts:** fonts are keyed by **PostScript name**. That is the name AE uses. The player loads the exact same font file, so glyph metrics are identical.
- **Pixel aspect:** images and videos are built with square pixels (`par` 1), like the preview, whatever After Effects guesses from the file's tags. An asset may set `par` explicitly if it really is anamorphic.
- **Layer order:** `layers` is **top → bottom**, like the AE timeline (index 1 first).

## Animatable values
Any property marked **A** below is either a static value or keyframes:
```json
{ "k": [ { "t": 0.5, "v": [960, 700], "e": [0.33, 1, 0.68, 1] }, { "t": 1.1, "v": [960, 540] } ] }
```
- **Ease field (`e`):** `e` is the ease of the segment that starts at that key. It is one of:
  - `"linear"`
  - `"hold"`
  - a cubic-bezier `[x1,y1,x2,y2]`, with the x values in 0..1 as in CSS. A `y` outside 0..1 overshoots, which is allowed.
  - one bezier **per dimension**, `[[…], […]]`, for array values whose axes follow different curves.
    - In AE, position is separated into X and Y, so each axis is exact.
    - Non-spatial multi-value properties (scale, sizes) take one ease per dimension natively.
    - Anchor point uses the first axis only.
- **Types:** colours are `"#RRGGBB"`, numbers are px, degrees, percent (0-100) or seconds.
- **Interpolation:** a value before the first key equals the first key's value, and after the last key equals the last key's value.

## Layer (common fields)
```json
{ "id": "S01_card", "name": "Card", "type": "shape",
  "parent": "S01_rig",            // optional, id in the same comp
  "in": 0, "out": 5.67,            // visible range, comp time
  "start": 0,                      // startTime (precomp/footage time offset)
  "transform": { "anchor": A, "position": A, "scale": A, "rotation": A, "opacity": A },
  "effects": [ ... ], "masks": [ ... ] }
```
- **Transform:**
  - The world transform is `parent × translate(position) × rotate(rotation) × scale(scale/100) × translate(-anchor)`.
  - Parenting passes **only** transform. It does **not** pass opacity or effects, which is AE behaviour.
- **Defaults:** anchor `[0,0]`, scale `[100,100]`, rotation `0`, opacity `100`. The kit sets image and solid anchors to their centre.
- **Position in AE:** animated `position` is built with **Separate Dimensions** (X/Y are 1D), so overshoot works.
- **Anchor in AE:** animated `anchor` is spatial. Its segments are straight lines with one ease and no overshoot.

### Types
| type | fields |
|---|---|
| `null` | — |
| `solid` | `solid: { color, w, h }` |
| `shape` | `shapes: [ Shape... ]` (one AE shape group per entry, bottom → top) |
| `text` | `text: { text, font, size, fill, tracking, justify: "left"\|"center"\|"right", animators: [...] }` |
| `image` | `image: { asset }` |
| `precomp` | `precomp: { comp }` (renders that comp at `t - start`, clipped to its size) |
| `video` | `video: { asset, rate: 1, loop: false, audio: false }` (footage). At comp time t the clip shows its frame at `(t - start) × rate`, the same as an AE footage layer with that startTime and stretch = 100/rate. `in` ≥ `start`; without `loop`, `out` ≤ `start + duration/rate` |
| `audio` | `audio: { asset }` |

### Shape
```json
{ "name": "Rect", "kind": "rect", "size": A, "position": A, "roundness": A,
  "fill": { "color": A, "opacity": A }, "stroke": { "color": A, "width": A, "opacity": A, "cap": "butt|round|square", "join": "miter|round|bevel", "dash": [len, gap] },
  "trim": { "start": A, "end": A, "offset": A } }
```
- **Kinds:**
  - `rect` has a centre `position`, a `size` and a `roundness`, clamped to half the short side.
  - `ellipse` has a centre `position` and a `size`.
  - `path` has `path: { v:[[x,y]], i:[[dx,dy]], o:[[dx,dy]], c: true }`, the same as an AE Shape (tangents relative to the vertex).
- **Stroke:** the stroke is centred on the path, as in AE.
- **Trim:** `trim` is in percent and applies to that group's path.

### Text
- **Placement:** this is point text. The layer origin is the **baseline**:
  - at the left edge when `justify` is left;
  - at the centre when it is centre;
  - at the right edge when it is right.
- **Units:** `tracking` is in 1/1000 em (AE units).
- **Animators:**
```json
"animators": [ { "name": "Reveal",
   "props": { "opacity": 0, "position": [0, 26], "blur": [12, 12] },
   "selectors": [ { "name": "w1", "start": 0, "end": 1, "amount": A } ] } ]
```
- **Selectors in AE:** each selector is a Range Selector: Units Index, Based On **Words**, Shape Square, Smoothness 100, Mode Add.
- **Word amount:** the amount for word *i* is the sum of `amount/100` over the selectors whose `[start,end)` covers *i*, clamped to 0..1.
- **Animator props:** each is blended toward its value by that amount:
  - opacity is `lerp(100, v, a)`;
  - position offset is `v·a`;
  - blur is `v·a`.
- **Words** are split on whitespace, the same way AE counts them.

## Effects (in layer space, applied after masks, as in AE)
| type | fields | AE effect |
|---|---|---|
| `blur` | `amount` A | Gaussian Blur (Blurriness), Repeat Edge Pixels off |
| `dropShadow` | `color`, `opacity` A (%), `direction` (deg, 0 = up, clockwise), `distance`, `softness` A | Drop Shadow |
| `fill` | `color` A | Fill |
| `ramp` | `start` [x,y], `end` [x,y], `from`, `to` (colours) | Gradient Ramp (linear) |

## Delivery
- **Single file** `<Name>.codeflow`: a zip holding `codeflow.json`, `README.txt` and `assets/*`.
- **Folder** `<Name> (CodeFlow)/`: the same layout unzipped, better for big videos.
- The CodeFlow panel opens either one: the file, the folder, or its `codeflow.json`.
- **Fonts are shipped** in `assets/fonts/` (`fonts[ps].file` points there). On build, the panel installs any that After Effects doesn't have (per user, no admin needed), so text stays real, editable text in the right font. A font is left out only when its own licence flag forbids sharing (OS/2 fsType = restricted); `README.txt` lists every font and whether it is included.
- **Text is always text.** Never ship words as images, even when the source had them as outlines (see the skill's convert guide: outlined text is recovered as text).

## Masks
`masks: [ { path: {v,i,o,c}, mode: "add", inverted: false, opacity: 100, feather: [0,0] } ]`. Coordinates are in layer space.

## Calibration constants
- **What they cover:** how AE "Blurriness" and "Softness" map to the player's Gaussian σ.
- **Where they live:** `player/codeflow-player.js` (`CF.K`).
- **How to set them:** measure with `tests/calibration` against real AE renders. Never tune them per project.
