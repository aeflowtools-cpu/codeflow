# CodeFlow for Claude

**Turn motion videos made with Claude into native, editable After Effects projects.**
By [AE Flow Tools](https://aeflowtools.com) · version 0.2.1

Ask Claude to *"make it for CodeFlow"* and you get a single **`.codeflow`** file. Open it in the **CodeFlow** panel in After Effects, click **Build**, and get real comps: shape, text and footage layers, precomps per scene, and true bezier keyframes in the Graph Editor. It looks the same as the video Claude made.

- **Convert** a motion video you already made with Claude (HTML, SVG, CSS, GSAP or JS, including stock footage and video clips).
- **Make a new one** that's editable in After Effects from the start: you get an MP4 preview plus the `.codeflow` file.
- **Text stays text.** Fonts travel inside the `.codeflow`, and the panel installs any that are missing.

## Install (Claude Code)

In Claude Code, run these two commands once:

```
/plugin marketplace add aeflowtools-cpu/codeflow
/plugin install codeflow@aeflowtools
```

Restart Claude Code. The first time you use it, CodeFlow downloads its tools (about 80 MB, one time per computer).

**Where to run it:** on your own computer, in the **Claude desktop app's Code tab with Local selected** or in the `claude` terminal app. That is fast and Claude can see your files. The Code tab on claude.ai in a browser (and the desktop app's Cloud option) runs on Anthropic's servers: it can't see your files and reinstalls the tools every session, so it is much slower.

You also need:
- **Node.js 18 or newer** ([nodejs.org](https://nodejs.org)),
- **Google Chrome or Microsoft Edge** (for previews),
- the **CodeFlow extension for After Effects** to import the files ([aeflowtools.com](https://aeflowtools.com)).

## Update

New versions are published here. To get the latest one, run in a terminal:

```
claude plugin marketplace update aeflowtools
claude plugin update codeflow@aeflowtools
```

then restart Claude Code. To get new versions automatically instead, turn on **auto-update** for the **aeflowtools** marketplace in the `/plugin` menu.

## Claude app (chat)

Download **[`codeflow-skill.zip`](codeflow-skill.zip)** from this repo and upload it in **Settings → Capabilities → Skills**. When a new version comes out, download the zip again and re-upload it. Claude Code gives the best results, because Claude can preview and check its work on your computer.

## How to use

> "Make this for CodeFlow: C:\Projects\my-promo\index.html"

> "Make a 10-second promo for my app, dark background, word-by-word headline. Make it for CodeFlow."

Claude tells you the full path of the `.codeflow` file when it's done. In After Effects: **Window → Extensions → CodeFlow → Open…** (or drag the file in) **→ Build**.

**Making videos from Figma SVGs?** Export them with **Outline text unchecked** (Export → SVG → settings). Outlined text is only shapes, so it can't become editable text.

---
© AE Flow Tools. All rights reserved.
