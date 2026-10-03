# What the CodeFlow panel does with an HTML video

The panel opens the page in Chrome/Edge (headless), plays it frame by frame in its own virtual time (so timers, `requestAnimationFrame`, GSAP, CSS animations and transitions, Web Animations and SVG `<animate>` all run exactly as for a viewer), and records what every element looks like on every frame. Then it fits keyframes with bezier eases and builds After Effects comps.

## How long, how big
- Length: `DURATION` (or `TOTAL`, `TOTAL_MS` …) in the script, else measured by playing the page (a page that loops: one cycle; a page that plays once: until nothing moves any more, plus 1 s).
- Size: the fixed-size stage the page draws (an element of any size that the page scales to fit the window, or a usual video size such as 1920×1080 / 1080×1920 / 1080×1080, is found and used at its real size).

## Native, editable layers
- **Text** → text layers in the same font (the font actually drawn, also for `system-ui` stacks; font files travel with the converted folder and are installed for the user). Colour changes, letter spacing, per-word / per-letter animation (each split piece is its own text layer), outlined text (`-webkit-text-stroke`) as a text stroke, 2-colour gradient text (`background-clip: text`) as text matting a gradient layer.
- **Boxes** (divs) → shape layers: colour, border, radius, box shadows (also spread / two shadows), 2-colour linear and radial gradients (also fading to transparent), blur and drop-shadow filters, animated size / radius / colour.
- **SVG** → shape layers: paths (also animated `d`, several pieces, holes), rect / circle / ellipse / line / polygon, fills and strokes, 2-colour gradients (also transparent), draw-on strokes (Trim Paths), moving dashes / dots (dash offset), blur / drop-shadow / glow filters, clip paths, `<mask>` reveals (the mask's shapes become a track matte).
- **Transforms** → keyframes on position / scale / rotation; containers that move several things become parent nulls; **CSS 3D** (rotateX/Y, perspective, preserve-3d, flips with backface-visibility, a 3D card inside a tilted 3D phone) → an After Effects camera + 3D layers per perspective scene (the content of every plane stays editable).
- **Masks** → `overflow:hidden` boxes and CSS `clip-path` (inset, circle, ellipse, polygon, path; animated wipes too) → precomps with animated masks.
- **Blend modes** (`mix-blend-mode`) → After Effects blending modes.
- **Pictures** (`<img>`, SVG `<image>`) → footage layers; **video clips** (`<video>`, H.264 MP4) → footage with the same timing (Time Remap when the page holds / jumps); **sound** (`<audio data-start>`) → audio layers.

## Pictures (still in place, motion as keyframes)
No After Effects equivalent, so these come in as pictures (or a picture sequence when they change):
- `<canvas>` / WebGL drawing (JPEG frames when opaque, PNG with transparency otherwise);
- gradients with 3+ colours, conic / repeating gradients, CSS background images, SVG patterns and noise / turbulence / displacement filters;
- CSS `mask-image` (on a box that holds other elements: a picture sequence of it), SVG masks / clip paths made of text or images, CSS `clip-path: url()`;
- per-side borders, dashed / dotted borders, outlines, inner shadows, `::before` / `::after` decorations, gradient text with 3+ colours or transparency;
- SVG `<use>` (the symbol becomes one picture that keeps its motion).

## Clips and sound
```html
<video id="screen" src="assets/screen.mp4" muted playsinline style="position:absolute; left:160px; top:140px; width:960px; height:540px; object-fit:cover"></video>
<audio id="voice" src="assets/voice.mp3" data-start="0.5"></audio>
```
- The page may play the clip normally (autoplay) or set `currentTime` itself; both convert. H.264 MP4 only (After Effects cannot open WebM). Keep `muted` unless the clip's own sound is wanted.
- Audio tags become audio layers starting at `data-start` seconds; volume / fades are not carried over. Sound made only in JavaScript (`new Audio()`, Web Audio) is not seen: write the tag.

## Fonts
Any installed font, Google Fonts (`<link>`), or `@font-face` with a file in `assets/`. Static weights 100-900 in hundreds; variable-font in-between weights snap to the nearest real one.
