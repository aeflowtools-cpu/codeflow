# CodeFlow HTML video: rules and patterns

The converter reads the browser's own result: for every frame at 30 fps it records, for every visible element, its position, size, scale, rotation, opacity, blur, colours, text and fonts. It then fits a few keyframes with bezier eases through those numbers. So write the page the way you would for the browser, with these habits.

## The page skeleton
```html
<style> html,body{margin:0;width:1920px;height:1080px;overflow:hidden;background:#0B1426} .abs{position:absolute} * {box-sizing:border-box} </style>
<script>
const DURATION = 12;                       // seconds
function seek(t) { /* put everything on screen for time t */ }
let playing = true, t0 = 0; const realSeek = seek;
window.seek = t => { playing = false; realSeek(t); }; window.DURATION = DURATION;
(function tick(now){ if (playing) realSeek(((now - t0) / 1000) % (DURATION + .6)); requestAnimationFrame(tick); })(0);
</script>
```
(`assets/template.html` has the full, tested version.)

## Make `seek(t)` pure
- Same `t` → same picture, in any order (the converter may jump around). Never accumulate state between calls.
- Randomness: use a seeded function, e.g. `const rnd = i => { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); };`.
- No `Date.now()`, no `setTimeout` that changes the picture, no CSS `transition` / `animation`, no `<video>` playback.
- Show / hide scenes with `display` (`el.style.display = on ? 'block' : 'none'`), and also set opacity: layers only exist while visible, which keeps the After Effects timeline tidy.
- Rebuilding DOM inside `seek` (innerHTML) works, but elements are matched by their position in the page, so keep the structure stable. Prefer fixed elements whose style you change.

## Tweens
```js
const tw = (t, t0, d, ease = E.out) => ease(clamp((t - t0) / d));   // 0..1
set(el, { opacity: k, transform: `translateY(${lerp(30, 0, k)}px) scale(${lerp(.9, 1, k)})`, filter: blur(lerp(12, 0, k)) });
```
- Compose transforms in one string; all of translate / scale / rotate are read exactly.
- `transform-origin` can be anything; it is read.
- Animate `width` / `height` of a box directly (a progress bar growing, a pill widening): it becomes a size animation.
- A colour that changes (text, background, border): set it from `lerp` of rgb numbers.

## Patterns that convert cleanly
- **Word-by-word reveal:** one `<span style="display:inline-block">` per word inside one text element; each span gets `opacity`, `translateY`, `blur`. (The panel builds one text layer per span; they stay editable.)
- **Camera move:** put a whole scene inside one container and animate that container's `transform: translate() scale()`. It becomes one parent layer that everything follows.
- **Card lift:** `box-shadow: 0 30px 80px rgba(0,0,0,.45)` plus a `translateY` and `scale`. A glow is `box-shadow: 0 0 40px rgba(47,91,255,.6)`; a ring is `box-shadow: 0 0 0 10px #2F5BFF`.
- **Clipped reveal:** `overflow:hidden` on the container, content slides inside it. Rounded corners are kept.
- **Draw-on line / progress arc:** SVG `<path pathLength="100" stroke-dasharray="100 100" stroke-dashoffset="100">` and animate `stroke-dashoffset` from 100 to 0. Also works for a `<circle>` ring.
- **Icons:** inline SVG with `stroke`, `fill`, `stroke-linecap`. Keep them as shapes (they stay vector in After Effects).
- **Number counters / typing:** change the text in `seek`. Each different text becomes its own layer with its own on-screen range.
- **Background:** a 2-stop `linear-gradient` plus one or two `radial-gradient(...)` glows. Anything more complex: use an image.

## Sound
`<audio>` elements in the HTML come into After Effects as audio layers: `<audio id="voice" src="assets/voice.mp3" data-start="0.5" preload="auto"></audio>`. `data-start` is the time in seconds on the video's timeline where the sound begins (default 0); the layer lasts as long as the file (cut at the end of the video). The `id` becomes the layer name. Use WAV or MP3 (After Effects opens those everywhere). Sounds created only in JavaScript (`new Audio()`) are invisible to the converter: always write the tag. Volume, fades and looping are not carried over (set levels in After Effects).

To hear it in the browser preview (browsers need one click on the page before they allow sound), call this from the playback loop, not from `seek`:
```js
const sounds = [...document.querySelectorAll('audio')];
function syncSound(t, on) {
  for (const a of sounds) {
    const local = t - (parseFloat(a.dataset.start) || 0);
    if (!on || local < 0 || local > (a.duration || 1e9)) { if (!a.paused) a.pause(); }
    else if (a.paused || Math.abs(a.currentTime - local) > 0.3) { a.currentTime = local; a.play().catch(() => {}); }
  }
}
```

## Sizes and fonts
- Vertical video: 1080×1920 in the CSS; the comp is created at that size. Keep everything in px.
- Fonts: name an installed font or give an `@font-face` pointing to a file in `assets/`. Google Fonts through a `<link>` work while the computer is online (static weights 400-900). Text is always converted as real text in the same font; the font file travels with the converted folder, so a colleague can open it too.

## Check list before you hand the file over
- [ ] stage size set in px, `overflow:hidden`
- [ ] `DURATION` and `seek(t)` present, pure, deterministic
- [ ] playback loop works (open the page in Chrome: it plays and loops)
- [ ] words are real text; nothing important is an outlined path or a `<canvas>`
- [ ] elements named with ids / classes; one wrapper per scene
- [ ] nothing from the "does not convert" list, or the user has been told
- [ ] any voice-over / music is an `<audio>` tag with `data-start`

## What the panel tells the user
After converting, the panel shows: layers · size · length · time taken, the folder it saved (next to the HTML, called "<Name> (CodeFlow)"), and a "Not converted exactly" list for anything it had to approximate. Mention to the user to read that list.
