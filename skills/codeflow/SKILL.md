---
name: codeflow
description: Export motion videos made with Claude to After Effects as native, editable comps using CodeFlow (by aeflowtools). Use this whenever the user says "make it for CodeFlow", "codeflow", "export to After Effects", "send this animation to AE", "I need an .aep / editable After Effects version", or wants an HTML / SVG / CSS / GSAP / JS motion video (promo, explainer, kinetic text, UI animation, including ones with stock footage / video clips and images) turned into something a motion designer can edit. Also use it when the user wants to make a NEW motion video that must open in After Effects too. It converts existing HTML motion videos into a single .codeflow file, or authors new ones directly in CodeFlow format (MP4 preview + .codeflow), which the CodeFlow After Effects extension builds into layers, keyframes and precomps that look the same.
---

# CodeFlow: motion videos → editable After Effects

CodeFlow gives Claude-made motion videos a way into After Effects.
- **What you produce:** one file, `<Name>.codeflow`. It holds every comp, layer, keyframe, ease, text animator and asset.
- **What the user does:** in After Effects they open **Window → Extensions → CodeFlow**, open or drag in the file, and click **Build**. They get native shape, text and image layers, precomps per scene, and real bezier eases in the Graph Editor.
- **Why the preview can be trusted:** the kit's web player emulates After Effects for exactly the features CodeFlow supports. Its previews match the After Effects build (measured ≈99% frame similarity), so what you check in the browser is what the user gets in AE.

Paths below are relative to this skill folder: `scripts/kit/…`, `references/…`. Run the kit with Node.

## Where to run it
CodeFlow needs Node, a browser and ffmpeg on a computer that also holds the user's files. So where Claude is running matters a lot:
- **Best: the user's own computer.** The Claude desktop app's **Code** tab with **Local** selected, or Claude Code in a terminal or IDE. It is fast, it can open the user's files, and the tools are installed once.
- **Slow and limited: a cloud session.** The Code tab on claude.ai in a browser, or the desktop app set to **Cloud**, runs on Anthropic's servers. It cannot see the user's folders or their After Effects, and every new session downloads the tools again.
- **Not suitable: normal Claude chat.** It cannot run the kit, so nothing can be previewed or checked.

If you notice a cloud session (the user's folders are not there, or setup keeps downloading things), say so once and suggest switching to the desktop app's Code tab with **Local** selected. Then carry on if they prefer.

## Step 0: setup (first time on a machine)
```bash
node scripts/setup.mjs
```
This installs the two dependencies (playwright-core, ffmpeg-static) and checks Chrome/Edge, ffmpeg and fonts. If something fails, tell the user exactly what it asks for, e.g. install Node 18+ or Google Chrome.

## Which job is this?
- **Convert:** the user already has a motion video Claude made as HTML/SVG/CSS/JS. It may be a file in their folder, code earlier in the conversation, or an HTML plus its rendered MP4. Read `references/convert.md` and follow it.
- **Author:** the user wants a new video that should also open in After Effects. Read `references/author.md` and follow it.

Authoring is cheaper and more exact than converting, because the preview and After Effects share one source and there is no mapping step. If the user has no finished video yet, author. If they have an HTML video, convert it, and mention that their next video is faster to make directly in CodeFlow.

For both jobs, keep `references/kit-api.md` open while writing code. Read `references/spec.md` only when you need exact file-format details.

## The rules that make After Effects match
The player behaves like After Effects, not like a web page. These are the differences that bite. Knowing *why* lets you handle cases these notes don't cover.
1. **Opacity is not inherited through parents in AE.** A faded null does nothing to its children. HTML fades a `<div>` and everything inside it, so this is the most common conversion mistake. Match HTML's group fade like this:
   - If the whole scene fades, key the opacity on the scene's precomp layer.
   - If a smaller group fades as one (a card, a pill, a toggle), give it its own small precomp and fade that. Precomps clip to their size, so leave margin for shadows and glows.
   - Fade layers one by one with `fadeAll` only when the source really fades them one by one. Overlapping parts show through when faded separately.
2. **Parenting passes transforms only.** Give positions in comp space with `{ parent }`, and the kit converts them to the parent's space exactly like AE's pick-whip does, using the parent's pose when it was created. Use `parentTo()` and `keyLocal()` only when your numbers are already in parent space.
3. **Eases are cubic-beziers, and usually exact.**
   - Any cubic polynomial of time (quad, cubic, back(s), Hermite spline segments) is *exactly* a bezier `[1/3, y1, 2/3, y2]`. The presets `outQuad/inQuad/outCubic/inCubic/outBack` are those exact Penner curves.
   - For the source's own JS ease functions, use `exactEase(fn)` from `easefit.mjs`: exact for polynomials, fitted to about 0.1% otherwise.
   - When X and Y follow different curves (camera splines), give **one ease per axis**: `[[bz], [bz]]`, or `splineKeys()` for a whole Catmull/Hermite path. AE gets separated X/Y position with each axis exact.
4. **Springs, elastic, bounce and other non-bezier motion:** sample them with `sampleKeys()` into linear keys. The result is exact, just less tidy to edit.
5. **Words are always real text layers, never pictures.** Text is point text on its baseline. Fonts are referenced by PostScript name, e.g. `Poppins-Medium`; get it with `const ps = await P.font('Poppins', 500)`, which finds the installed font or downloads it from Google Fonts. Measure widths with `P.measure()`, never guess; it uses the real font files.
   - **Outlined text in the source** (an SVG where the words are `<path>`s, no `<text>`: Figma exports SVG with "Outline text" on by default) carries no letters and no font. Don't turn it into PNGs. Stop and tell the user: "The text in these SVGs is outlined, so it can't become editable text. In Figma, export the SVGs again with *Outline text* unchecked (Export → SVG → ⋯ settings), or tell me the font and I'll rebuild the text." Continue only with their answer.
6. **Word-by-word reveals use ONE text layer.** `wordReveal()` adds one Text Animator with a Range Selector per word, so every word's timing is a draggable key in AE. That is what a motion designer expects to edit.
7. **Only these effects:** blur, drop shadow, fill and gradient ramp. They are calibrated.
   - **Units are After Effects units, not CSS pixels.** Always convert CSS values: `cssBlur(px)` (≈3.6× px) and `cssShadow('…')`. That includes the blur inside behaviours: `whipOut(l, t, { blur: cssBlur(22).amount })`, `wordReveal(… hidden: { blur: [b, b] })` with `b = cssBlur(12).amount`.
   - For gradients use `recipes.mjs`: `linearGradient()` handles any number of stops, and `radialGlow()` gives a true linear-falloff radial gradient. Both are exact against the SVG originals.
8. **Video clips and stock footage are real footage layers.** Use `P.asset(id, 'video', path)` + `c.video(name, id, { at, from, dur, rate, loop, audio })`. The player shows the exact clip frame and AE gets a footage layer with the same trim, speed and loop. Clip sound is off unless `audio: true`.
9. **Stay inside the spec's feature set** (see `references/spec.md`). If the source uses something outside it (3D transforms, WebGL/canvas, blend modes, feathered masks, video filters), don't fake it silently:
   - rasterise static parts with `scripts/kit/snap.mjs` into an image layer (never text: see 5);
   - tell the user what came in as a picture instead of live layers.

## Always verify before delivering (Quick by default)
Render the CodeFlow version and check it; never deliver blind. Checking is where most time and tokens go, so use the cheap way unless the user wants more.
- **Converting, Quick (the default).** Check about 10 times: for each scene one settled moment and one mid-motion moment. Run
  `node scripts/kit/compare.mjs <spec> <original.html|mp4> <outDir> <times> --quick`.
  It prints **one summary line and a VERDICT**.
  - **GOOD ENOUGH** (mean ≥ 0.97, no frame below 0.93): deliver. Do not open any images.
  - **NEEDS WORK:** open only `<outDir>/sheet.jpg` (the worst frames: original | CodeFlow | difference ×4), fix the cause, run again. At most **2 fix rounds**, then deliver and tell the user honestly what still differs. Differences that are only a 1-2 px text anti-alias halo are fine.
  - Zoom into a suspicious area only if needed: `node scripts/kit/zoom.mjs <outDir>/original/o_T.png <outDir>/codeflow/t_T.jpg x,y,w,h zoom.png`.
- **Converting, Exact.** Only when the user asks for pixel-perfect: more check times, a dense check every 0.2 s, zoomed diffs, and iterate until the mean is ≥ 0.97 with no frame below ~0.93. Run `compare.mjs` without `--quick`.
- **Authoring:** render one contact sheet of settled and in-between moments (`node scripts/kit/render.mjs <spec> sheet out.jpg t1,t2,…`) and review it the way a motion designer would.

## Deliver
1. Pack the deliverable:
   - **One file:** `node scripts/kit/pack.mjs <spec.codeflow.json> [out.codeflow]`. Easy to share.
   - **A folder:** `node scripts/kit/pack.mjs <spec.codeflow.json> --folder [parentDir]` makes `<Name> (CodeFlow)/`. Better for heavy video projects (roughly > 300 MB).
   - Both contain the spec, every image, video and audio file, **and the font files**: the CodeFlow panel installs any font the other computer is missing, so the text opens in the right font. A font is left out only if its own license flag forbids sharing; pack prints `FONTS NOT INCLUDED` then.
   - Pack prints `SAVED TO: <full path>` and `FOLDER: <full path>`.
2. Also render the preview MP4 when useful: `node scripts/kit/render.mjs <spec> video preview.mp4`. It mixes the spec's own audio: audio layers plus clips with `audio: true`. Use `--audio vo.wav` to use one file instead.
3. Tell the user, plainly:
   - **the full path of the `.codeflow` file (or folder) and of the preview MP4, every time**: copy the `SAVED TO` / `FOLDER` lines from pack. Never just say "saved" or give a bare file name; people look for the file in Explorer/Finder;
   - how to import it (CodeFlow panel → Open or drag the file/folder → Build);
   - fonts: included and installed automatically, or which ones they must install (`FONTS NOT INCLUDED`);
   - anything that came in as a picture instead of live layers;
   - the match score if you converted.

**Optional direct build:** if you are running on the user's own computer and After Effects is open with CodeFlow, `node scripts/kit/ae.mjs build <spec>` builds straight into their open project. Ask first: it adds comps to whatever project they have open. It uses their CodeFlow license (or one of the 3 free builds); if it answers with a license message, show that message to the user as-is, and deliver the `.codeflow` file normally.

## Working style
- **Keep it cheap.** The references already contain what you need, so do not open the kit's source files. If a function is unclear, call it on a tiny example. Probe only the elements and times you need (`--root`) instead of dumping whole pages. Write the conversion script once, scene by scene, and look at images sparingly (the verdict first, the worst frames second).
- Build in parts for long videos (15-20 s each) so previews stay fast to check.
- Name layers the way a motion designer would ("Card", "Row 3 - Pill", "CARD RIG"), and use one precomp per scene. The After Effects project is the product the user will live in, so its structure matters as much as the pixels.
