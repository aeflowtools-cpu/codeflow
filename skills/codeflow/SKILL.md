---
name: codeflow
description: Make HTML motion videos (promos, explainers, product demos, kinetic type, logo reveals, UI animations, charts, social reels) that the CodeFlow panel (by aeflowtools) turns into native, editable After Effects layers and keyframes. Use this whenever the user says "make it for CodeFlow", "codeflow", "make this editable in After Effects", "send this animation to AE", "I need an .aep / editable After Effects version", or asks for an HTML / SVG / CSS / GSAP / canvas motion video they want to open in After Effects. Also use it when they already have an HTML motion video and ask whether it will convert. Nothing to install: you write the HTML, the user drops it on the CodeFlow panel, and the panel converts it in seconds without AI.
---

# CodeFlow: any HTML motion video → editable After Effects

**This skill does not decide how the video looks or moves.** Make exactly what the user asks for, in the style and with the techniques you would use anyway: GSAP, CSS animations, Web Animations, SVG, plain JavaScript with `requestAnimationFrame`, canvas, video clips. The CodeFlow panel opens the page in Chrome/Edge, plays it frame by frame, and rebuilds what it shows as After Effects layers (text layers, shape layers, masks, 3D planes, blend modes, footage), so the result in After Effects looks the same as in the browser.

The skill only adds a few habits so the conversion is clean.

## The habits (all of them, every time)
1. **One HTML file**, with its pictures, clips, sounds and font files in an `assets/` folder next to it (relative paths). Libraries and Google Fonts from a CDN are fine.
2. **A fixed-size stage in px** for the video frame, e.g. 1920×1080 (or 1080×1920, 1080×1080, whatever the user wants). Scaling the stage to fit the browser window is fine.
3. **Say how long it is:** `const DURATION = 12;` (seconds) anywhere in the script. Without it the panel works it out by playing the page, which is slower and can guess wrong on loops.
4. **It plays by itself** when the page opens (no "click to start"), and the same moment always looks the same (random positions are fine: the panel fixes the random seed).
5. **Words are real text** (HTML or SVG `<text>`), never pictures of text or outlined paths, so they stay editable in After Effects.
6. **Clips and sound:** video as `<video src="assets/clip.mp4" muted>` in H.264 MP4; voice-over / music as `<audio src="assets/voice.mp3" data-start="0.5">` (`data-start` = second on the timeline where it begins).

That's all. Everything else is your normal way of working.

## What becomes a picture instead of an editable layer
The panel converts nearly everything natively. A few things have no After Effects equivalent and come in as pictures (or a picture sequence) that still sit in the right place with their movement as keyframes:
- drawing on a `<canvas>` / WebGL (each frame becomes a picture);
- gradients with 3 or more colours, conic and repeating (striped) gradients, CSS background images and noise textures;
- SVG filters other than blur / drop shadow / glow (turbulence, displacement …), `mask-image` on a box that holds other elements;
- borders that differ per side, dashed borders, `::before` / `::after` decorations, inner shadows.

You don't have to avoid them. If the user wants a part to be editable in After Effects (for example a background they will recolour), build it from normal elements instead, and tell them which parts will be pictures. `references/convert.md` has the details.

## Deliver
1. Save `<Name>.html` (+ `assets/`), one folder per video.
2. Tell the user, with the **full path of the HTML file**:
   - watch it: double-click the HTML (Chrome or Edge);
   - convert it: After Effects → **Window → Extensions → CodeFlow**, drag the HTML onto the panel (or **Open…**), wait for it to read the frames, then click **Build**;
   - the panel needs Chrome or Edge installed and an internet connection (fonts / libraries from the web);
   - which parts (if any) will come in as pictures.

## Check it
If you can open a browser, open the page once and make sure it plays without errors (the console is clean, nothing is missing). How you judge the video itself is up to you and the user.
