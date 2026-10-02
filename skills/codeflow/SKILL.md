---
name: codeflow
description: Make motion videos (promos, explainers, kinetic text, UI animations) as ONE HTML file that opens in After Effects as native, editable comps with the CodeFlow panel (by aeflowtools). Use this whenever the user says "make it for CodeFlow", "codeflow", "make this editable in After Effects", "send this animation to AE", "I need an .aep / editable After Effects version", or wants an HTML / SVG / CSS / JS motion video they can open in After Effects. Also use it when they already have an HTML motion video and want to check it will convert. There is nothing to install and nothing to run: you write the HTML file, the user drops it on the CodeFlow panel, and the panel does the conversion in seconds, without AI.
---

# CodeFlow: motion video as HTML → editable After Effects

**How it works.** You write the video as one HTML file that follows a few rules (below). The user drops that file on the **CodeFlow panel** in After Effects (Window → Extensions → CodeFlow). The panel opens the page in Chrome/Edge behind the scenes, reads every frame (position, size, colour, opacity, blur, text, fonts), and builds real layers, keyframes and bezier eases. Then they click **Build**. There is no AI in the conversion, nothing for you to run, and no Node, ffmpeg or Playwright on the user's side. Your job is the HTML.

Because the panel reads what the browser actually draws, **anything that looks right in Chrome converts**, as long as it stays inside the rules. Keep the page simple and the result is clean.

## 1. Start from the template
Copy `assets/template.html` and replace its scenes. It already has the stage, `DURATION`, `seek(t)`, easing helpers, a word-by-word reveal, a card with rows, a gradient background and a glow. It converts at about 0.97 or better as it stands. Do not rebuild the scaffolding.

## 2. The contract (these four are mandatory)
1. **Fixed stage.** `html, body { margin:0; width:1920px; height:1080px; overflow:hidden }` (the template keeps the two numbers in `:root`). Any size works (1080×1920 for vertical, 1080×1080 for square); say it in the CSS, in px. The panel makes the comp that size.
2. **`const DURATION = <seconds>`** (a number, or a function that returns one).
3. **`function seek(t)`** (also `window.seek = …`). It puts everything on screen for time `t` in seconds. It must be a **pure function of t**: the same `t` always gives the same picture. No `Date.now()`, no `Math.random()` (use a seeded generator), no CSS transitions, no CSS `animation`, no timers that change things. All motion is computed inside `seek` from `t`, with easing functions.
4. **Playback loop at the bottom** so the user can watch it in a browser: `requestAnimationFrame` calling `seek` while a `playing` flag is on; calling `window.seek(t)` from outside turns playback off. The template shows the exact pattern.

(Pages driven only by CSS `@keyframes` or the Web Animations API also convert, with no `seek` needed. But `seek(t)` is the dependable way. Use it.)

## 3. What converts well (use freely)
- **Boxes:** `position:absolute` divs with background colour, `border-radius`, `border`, `box-shadow` (also two shadows, with spread), `overflow:hidden` (becomes a clipped precomp), 2-stop `linear-gradient`, radial glows `radial-gradient(Wpx Hpx at x y, color, transparent)`.
- **Text:** real HTML text or SVG `<text>`, any installed font or an `@font-face` file next to the page; `letter-spacing`, `text-transform`, `text-shadow`, a colour that changes over time. Weights 400/500/600/700/800/900 (not 850). Keep one style per element; split words into `<span>`s for word-by-word motion.
- **Motion:** `transform` (translate / scale / rotate, nested containers too), `opacity`, `filter: blur()` and `drop-shadow()`, animated `width` / `height` / `left` / `top`, colour changes, rounded corners that grow. Camera moves = animate one big container.
- **Images:** `<img src="assets/x.png">` and SVG `<image>`; any size, scaled, moved, faded, blurred.
- **SVG:** `rect`, `circle`, `ellipse`, `path`, `line`, `polyline`, `polygon`, `text`, groups with `transform`; fills, strokes, `stroke-linecap/linejoin`; **draw-on strokes** with `stroke-dasharray` + `stroke-dashoffset` (becomes Trim Paths); `clip-path` with one rect/circle/path; nested `<svg>` viewports; SVG filters for blur and drop shadow; linear gradients (2 stops), radial fade-out glows.
- **Structure:** give elements meaningful `id`s and `class`es ("card", "row-3", "cta-pill"): they become the layer names in After Effects. Wrap each scene in its own `<div id="scene2">`. A header or logo that stays on screen across scenes can sit outside the scenes. Text that wraps onto several lines becomes one text layer per line.
- **Placing things exactly:** to put a line under a word, measure the word once with `getBoundingClientRect()` inside `seek` (or after `document.fonts.ready`) and place from that; do not guess widths.

## 4. What does NOT convert (avoid, or tell the user)
- `<canvas>`, WebGL, `<video>` elements: not read. For a screen recording or stock clip, leave an empty placeholder box in the HTML and tell the user to place the footage in After Effects.
- 3D (`perspective`, `rotateX/Y`, `translateZ`), `mix-blend-mode`, `backdrop-filter`, `mask-image`, `clip-path: polygon()` / `inset()`, CSS `conic-gradient`, gradients with 3+ stops or transparency in the middle, `background-clip:text` gradient text (comes in as its first colour), `::before` / `::after` decoration, pattern fills, tiled backgrounds.
- **Outlined text.** SVGs exported from Figma with "Outline text" on contain no letters, only paths. They come in as shapes, not editable text. Export from Figma with *Outline text* off, or rebuild the words as `<text>` / HTML text.
- Variable-weight fonts between the installed weights (850, 650): they snap to the nearest real weight and text widths shift a little.
- A **group fade** (opacity on a container that holds overlapping children) is applied to each child separately, so overlaps look slightly different in the middle of the fade. Fade the scene quickly (0.3-0.5 s) or fade children one by one when it matters.

If the user needs something from this list, build the rest in HTML and say plainly which part they must finish in After Effects.

## 5. Deliver
1. Save the video as `<Name>.html` with its images/fonts in an `assets/` folder next to it (relative paths). One folder per video.
2. Tell the user, plainly and **with the full path of the HTML file** (they look for it in Explorer/Finder):
   - how to open it: double-click the HTML to watch it in Chrome;
   - how to convert: After Effects → **Window → Extensions → CodeFlow**, drag the HTML file onto the panel (or **Open…**), wait a few seconds, check the line that says what was not converted exactly, click **Build**;
   - the panel needs **Google Chrome or Microsoft Edge** installed (free); it never needs Node;
   - anything from section 4 that is in the video.
3. A video is done when it plays correctly in Chrome and follows the contract. You cannot run the converter yourself (it lives in the user's panel), so keep the page plain and follow the template.

## Working style
- Write the whole video as one HTML file. Do not split it into many files and do not add a build step.
- Build long videos in scenes inside one `seek(t)`: a `show(sceneEl, t >= a && t < b)` per scene, tweens with `tw(t, start, duration, ease)`.
- A **counter** or typewriter that changes its text every frame makes one text layer per distinct text (a 0 to 128 counter is about 50 layers). That is fine; for long ones, change the number in steps.
- A draw-on stroke with round caps shows a dot at 0 length: also set its opacity to 0 until it starts.
- To animate SVG, `el.style.transform = 'translate(…) scale(…)'` (with `transform-box: fill-box; transform-origin: center`) and `el.setAttribute('transform', …)` are both read correctly. Put transforms on shapes or `<g>` elements, not on the outer `<svg>` (wrap it in a `<div>` and transform that).
- Use easing functions from the template (`out`, `outQuint`, `inOut`, `back`): they become real bezier eases in After Effects. Springs and bounce also work (the panel samples them), but they are less tidy to edit.
- Look at the page once (a screenshot at 3-4 moments is enough; call `window.seek(t)` first, then capture). Local `file://` pages sometimes show only as static pictures in a built-in browser pane: if so, serve the folder with any simple local web server, or use Chrome headless. Do not iterate for pixel-perfection: the converter reproduces what the browser shows.

More detail on rules and patterns: `references/rules.md`.
