# CodeFlow for Claude

**Make motion videos with Claude that open in After Effects as native, editable comps.**
By [AE Flow Tools](https://aeflowtools.com) · version 1.1.1

Ask Claude to *"make it for CodeFlow"*. It writes your video as **one HTML file**. Drop that file on the **CodeFlow panel** in After Effects: the panel converts it in seconds (no AI, no tokens) and you click **Build** to get real comps: shape, text and image layers, precomps, parent layers for camera moves, and true bezier keyframes in the Graph Editor. It looks the same as the video Claude made.

- **Nothing to install on your computer for this skill.** Claude just writes a file. The conversion happens in the CodeFlow panel, using the Chrome or Edge you already have.
- **Text stays text.** Fonts travel with the converted folder, and the panel installs any that are missing.
- **Convert a video you already made** with Claude (HTML / SVG / CSS), or make a new one that is ready from the start.

## Install (Claude Code)

In Claude Code, run these two commands once:

```
/plugin marketplace add aeflowtools-cpu/codeflow
/plugin install codeflow@aeflowtools
```

Restart Claude Code. To update later:

```
claude plugin marketplace update aeflowtools
claude plugin update codeflow@aeflowtools
```

then restart. Or turn on **auto-update** for the **aeflowtools** marketplace in the `/plugin` menu.

## Claude app (chat or desktop)

Download **[`codeflow-skill.zip`](codeflow-skill.zip)** from this repo and upload it in **Settings → Capabilities → Skills**. When a new version comes out, download the zip again and re-upload it.

## You also need

- the **CodeFlow extension for After Effects, version 1.1 or newer** ([aeflowtools.com](https://aeflowtools.com)),
- **Google Chrome or Microsoft Edge** installed (free), which the panel uses quietly to read the video.

## How to use

> "Make a 10-second promo for my app, dark background, word-by-word headline. Make it for CodeFlow."

> "Make this ready for CodeFlow: C:\Projects\my-promo\index.html"

Claude tells you the full path of the HTML file. In After Effects: **Window → Extensions → CodeFlow**, drag the HTML file onto the panel, then **Build**.

**Making videos from Figma SVGs?** Export them with **Outline text unchecked** (Export → SVG → settings). Outlined text is only shapes, so it can't become editable text.

---
© AE Flow Tools. All rights reserved.
