# Shader Roulette

**Drop in a song. Get a shader music video. Roll again and get a completely different one.**

🎬 **Video walkthrough** (click to watch on YouTube):

[![How to Turn Shadertoy Shaders into Music Videos: Shader-Selector + Shader Roulette walkthrough](https://img.youtube.com/vi/fMOA9ntqaAc/maxresdefault.jpg)](https://youtu.be/fMOA9ntqaAc)

---

## What this is

Shader Roulette is a single HTML file that turns any song into a music video made entirely of GLSL shaders. You give it a track; it listens, works out the structure of the song, picks a visual style, casts shaders from a library, decides where every cut, transition and hit lands, and plays the result live. One click renders it to an MP4.

It is also a **demo to learn from**. The whole thing is plain JavaScript and WebGL2, no framework, no dependencies, and the code is small enough to read in an afternoon (about 3,500 lines).

## It's a two-part demo

Roulette on its own is only half the story. It doesn't ship with a big shader collection. It **borrows yours**, from [Shader-Selector](https://github.com/hughesdo/Shader-Selector).

**Part 1: build your shader library**
Download and install [**Shader-Selector**](https://github.com/hughesdo/Shader-Selector), a coverflow browser for GLSL shaders. Import the Shadertoy shaders you love, rate them, and curate a personal collection that is actually yours.

**Part 2: point Roulette at it**
Open Shader Roulette, tell it where your library lives, drop in a song, and it builds a music video out of *your* taste. A handy little "put a video to my own music" maker.

Curate better shaders, get better videos. Anything you add to Shader-Selector shows up in the next roll with no rebuild.

## Quick start

1. **Get the library.** Clone and install [Shader-Selector](https://github.com/hughesdo/Shader-Selector) (needs Node 18+):
   ```
   git clone https://github.com/hughesdo/Shader-Selector
   cd Shader-Selector
   npm install
   npm run dev            # http://localhost:5180
   ```
   Import and curate shaders as described in its README (`tools/import_shadertoy.py` pulls shaders in by Shadertoy ID).
2. **Get Roulette.** Download `dist/shader-roulette.html` from this repo (or clone it). It's one self-contained file.
3. **Open it in Chrome or Edge.** Double-click works.
4. **Point it at your library.** Roulette looks for a library in this order:
   1. a `?lib=` address in the URL, e.g. `shader-roulette.html?lib=http://localhost:5180/library`
   2. the address saved in Settings
   3. a `library/` folder next to the page
   4. the public default, `https://hughesdo.github.io/Shader-Selector/library`

   With nothing configured it uses the public default, so you can try it before you curate anything.
5. **Drop a song** on the page (or click **Choose a song**). It starts playing the cut straight away. Press **Roll again** (or `R`) for a different one.
6. **Render MP4** when you like what you see.

**Copy credits** gives you a list of every shader in the cut with its author and Shadertoy link. Please use it when you post. These are other people's shaders.

## How it works

The person using it does one thing: provide a song. Everything else is the **director**.

```
song ─▶ analysis ─▶ structure ─▶ style ─▶ shots ─▶ casting ─▶ looks, transitions, hits ─▶ compositor ─▶ canvas / MP4
        (offline)   (sections)   (weighted)  (bars)   (probed)     (per-shot decisions)    (WebGL2)
```

| Stage | What happens |
| --- | --- |
| **Listen** | The whole track is analysed offline: tempo and beat grid, downbeats, kick/snare/hat onsets, five band envelopes, and section changes from a self-similarity novelty curve. |
| **Read the structure** | Sections are labelled intro, verse, build, drop, peak, break or outro from their energy. A timbre fingerprint lets a repeated chorus be recognised as the same section coming back. |
| **Pick a style** | Weighted by the song and never the same as last roll: *Pulse*, *Drift*, *Story*, *Chaos*, *Cinema*, *Mirror World*. |
| **Cut the shots** | Shot lengths come from the style and each section's energy, snapped to bars. The last bar before a drop can turn into beat-long stutters. |
| **Cast** | Decides how many shaders the song needs, draws them weighted by star rating and against recent use, compiles them, then renders each one tiny with loud fake music to measure brightness, motion and colour. Broken or black shaders are dropped and replaced. Quiet sections get calm shaders, loud ones get the busiest, and neighbours are pushed apart in colour. |
| **Vary** | Per shot: its own shader clock, sometimes a lens (kaleidoscope, mirror, polar tunnel, ripple…), a colour grade, or a double exposure with a second shader. |
| **Transition** | 29 transitions chosen by context. Drops get a hard cut on the downbeat; breakdowns get long dissolves. 14 come from [gl-transitions](https://gl-transitions.com), 15 are built in, several driven by the spectrum. |
| **Hit** | Snare flashes, RGB splits, shakes, freeze frames, kick shockwaves, feedback trails. |
| **Composite** | One frame is up to four shader renders (outgoing shot, its double-exposure partner, incoming shot, its partner), each through a look pass, then blends, the transition, an optional effect, and the hit pass. All offscreen until the final blit. |

Every roll gets a fresh random seed, and the page remembers what recent rolls used and pushes those to the back of the queue, so two rolls of the same song don't look alike. A **roll code** brings any cut back: type an earlier code with the same song and you get the same video.

### Audio for the shaders

The music texture is rebuilt offline from the decoded song to match a browser `AnalyserNode` (1024-point FFT), so the live preview and the frame-by-frame render react identically at any frame rate. Shaders get Shadertoy's 512×2 `iChannel0` layout: row 0 spectrum, row 1 waveform.

### Bring your own shaders

Drop `.glsl` files straight onto the page (Shadertoy-style `mainImage()` code, music on `iChannel0`). They're kept in the browser and included in every roll until you remove them.

## Tech stack

- **Plain JavaScript + WebGL2.** No framework, no runtime dependencies.
- **GLSL**: Shadertoy, full-program and gl-transition dialects, run by a small runtime ported from Shader-Selector.
- **Web Audio**: decoding and playback.
- **WebCodecs + [mp4-muxer](https://github.com/Vanilagy/mp4-muxer)**: frame-exact H.264 + AAC MP4 export. An FFmpeg-derived AAC WASM encoder is the fallback when the browser has no AAC.
- **Node 18+** for the build script only. It inlines everything (app, vendored libraries, gzip'd effects) into one HTML file.
- **Python + Playwright** for the headless test scripts in `test/`.

## Reliance on Shader-Selector

Roulette is deliberately thin on content and thick on decisions. The shaders, their ratings, their authors and their metadata all come from a **Shader-Selector library**, which is just a static folder:

```
library/
  index/manifest.json, page-*.json     the searchable index
  shaders/ab/cd/<id>/shader.json …     one folder per shader (+ .glsl, thumbnail)
  transitions/<name>/…                 gl-transitions
```

Roulette fetches the index at runtime and compiles shaders on demand, so:

- no library, no variety (there is one built-in shader, *Silk Ribbons*, so the page still produces a video);
- the library's star ratings steer which shaders get drawn;
- the runtime in `src/js/runtime.js` is a port of Shader-Selector's preprocess and renderer, so a shader that looks right there should look right here.

Roulette also bundles 71 post-effects from [SuperTool](https://github.com/hughesdo/SuperTool), laid over shots or whole sections on the beat.

## ⚠️ About recording

Recording is the weakest part of this project. It works, but don't treat it as production quality.

- **Render MP4** steps through the song frame by frame in the browser using WebCodecs. It's accurate, but it is browser-bound: it needs Chrome or Edge, it's slow at 4K, and it ties up your GPU and tab until it finishes.
- **Record live** is a fallback for browsers without WebCodecs. It captures the canvas in real time with `MediaRecorder`, so any dropped frame during playback is dropped from the video too.

**A better route:** render offline with **[ModernGL](https://moderngl.readthedocs.io/)** (Python). Run the same shaders headless on the GPU, feed it the analysis data, pipe frames straight into FFmpeg, and you get a faster, more robust render that doesn't depend on a browser tab, with no dropped frames and easy batch jobs. That would make a good next step if you want to build on this. The director and analysis logic would carry over; only the compositor and export would need to be rewritten.

## Project layout

| Path | What it is |
| --- | --- |
| `dist/shader-roulette.html` | The whole app in one file (~970 KB, most of it the AAC encoder) |
| `src/template.html` | Page markup and styles |
| `src/js/runtime.js` | Shader runtime: library loader, preprocessor, renderer |
| `src/js/director.js` | Styles, sections, shots, casting, looks, transitions, hits |
| `src/js/compositor.js` | Layers, look pass, double exposures, transition, effects, hit pass |
| `src/js/builtins.js` | Built-in transitions, look/blend/hit shaders, Silk Ribbons |
| `src/js/analysis.js`, `audio.js`, `codecs.js` | Song analysis, playback, MP4 export |
| `src/js/app.js` | UI wiring |
| `tools/pack_effects.mjs` | Packs SuperTool effects into `vendor/supertool-effects.json` |
| `test/` | Headless test harness (synthetic song, Playwright scripts) |

**Reading order if you're here to learn:** `analysis.js` → `director.js` → `compositor.js` → `runtime.js`.

Rebuild with `node build.mjs`.

## Credits

- Shaders: their original authors, credited in each shader's `shader.json` and in **Copy credits**.
- Transitions: [gl-transitions](https://gl-transitions.com) authors, MIT.
- Effects: [SuperTool](https://github.com/hughesdo/SuperTool) by Don Hughes ([@OneHung](https://x.com/OneHung)).
- Analysis, playback and export: [Timewarp Visualizer](https://github.com/hughesdo/Timewarp-Visualizer).
- Shader runtime and library: [Shader-Selector](https://github.com/hughesdo/Shader-Selector).
- MP4 writing: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) by Vanilagy (MIT). AAC fallback: FFmpeg (LGPL-2.1) with the bridge from `@mediabunny/aac-encoder` (MPL-2.0).
- Built with Claude by Anthropic, directed by Don Hughes.

## License

MIT for this code. See [LICENSE](LICENSE). Vendored libraries keep their own licenses in `vendor/licenses/`. Shaders belong to their authors.
