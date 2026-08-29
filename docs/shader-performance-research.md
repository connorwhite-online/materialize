# Can custom shaders be near as performant as a CSS linear gradient?

**MTR-193** · Research report, July 2026. Question: can we extend the visual language with custom
GPU shaders (up to true-refraction "liquid glass") without sacrificing the performance of a tool
that people use to get work done — where the baseline is a CSS `linear-gradient` that costs
essentially nothing?

## TL;DR

**Yes for static and render-on-demand shader surfaces; no for always-animating full-screen
effects; and true liquid-glass refraction is not shippable cross-browser in 2026 without doing it
inside a WebGL canvas.**

The honest cost comparison:

| | Startup | Steady-state (idle) | Animating | GPU memory |
|---|---|---|---|---|
| Static CSS gradient | one rasterization, sub-ms | **zero** — cached tile texture, composited as a quad | n/a (animating painted pixels forces re-raster) | shares page tile textures |
| WebGL shader, render-on-demand | context create + shader compile (tens of ms, once) | **~zero** — the canvas is just another composited texture quad | per-frame fragment cost | dedicated backing + context (MBs) |
| WebGL shader, continuous rAF | same | full fragment cost **every frame, forever** | same | same |

A shader canvas that renders once (or only on interaction) and then sits still is, at the
compositor level, nearly indistinguishable from the gradient: both end up as a GPU texture drawn
as a quad each frame. The gap is entirely in (1) startup cost, (2) fixed memory overhead, (3) what
happens while animating, and (4) hard context-count limits. All four are manageable with the
mitigation toolkit below — which means the decision is per-surface, not all-or-nothing.

**Decision rules:**

1. A shader background that is static or animates only on interaction, pixel-capped at ≤ ~1M
   physical pixels, pausing on `visibilitychange` and `prefers-reduced-motion`: acceptable
   anywhere, including the quote flow.
2. One continuously-animating hero shader on the home page: acceptable (we already pay more than
   this for `HeroShowcase`'s 800 instanced particles).
3. Per-card / per-tile shader canvases: **never** — browsers cap live WebGL contexts (~8–16,
   oldest silently dies) and contexts can't share compiled shaders or textures.
4. Liquid-glass refraction over live DOM content (text, forms scrolling under glass): **not
   viable cross-browser today.** The SVG `feDisplacementMap`-via-`backdrop-filter` technique is
   Chromium-only; Safari/iOS — a large share of our buyers — can't render it. Refraction is only
   shippable when the thing being refracted lives inside the same WebGL canvas.

---

## 1. The baseline: what a CSS gradient actually costs

Chromium's pipeline splits rendering into *paint* (rasterize element content into layer backings)
and *composite* (draw those backings to screen). A gradient background is painted once into a
tile texture; frames that only move/scroll content reuse that backing — "invalidating one of
these layers only results in repainting the contents of that layer alone and recompositing"
([GPU Accelerated Compositing in Chrome][chromium-gac]). This was the single claim our
verification pass confirmed unanimously against the primary source.

The details that make the baseline so cheap ([RenderingNG data structures][renderingng]):

- Painted CSS becomes a **display list** of Skia commands; if a layout object hasn't changed, its
  display items are copied from the previous frame's list, and unchanged stacking contexts are
  skipped wholesale. A static gradient incurs ~zero repaint work after first paint.
- Rasterized content lives in **GPU texture tiles**; scrolling repositions existing tiles rather
  than re-shading anything.
- Even at first paint, the cost is small: Chrome's own (dated, 2013) paint-time measurements put a
  single element with the most expensive property combos — radial gradients, shadows, radii —
  under **1.56 ms** ([css-paint-times][paint-times]). Treat the number as an order of magnitude,
  not current data, but the architecture hasn't changed.

Two nuances that matter for us:

- **The gradient is only free while static.** Layer promotion happens for content whose changes
  can run on the compositor thread (transform, opacity, scroll). Animating a gradient's *painted
  pixels* (e.g. interpolating color stops via `@property`) forces re-raster every frame on the
  raster path — the "cheap CSS" comparison target quietly becomes not-cheap. Animated CSS
  gradients are usually faked with oversized backgrounds + `transform`/`background-position`
  tricks for exactly this reason.
- **`backdrop-filter` is not gradient-cheap either.** Filters and advanced blend modes force
  intermediate render passes in the compositor ([RenderingNG][renderingng]). Our `.glass-surface`
  (`blur(20px) saturate(1.8)`, `app/globals.css:304-313`) already pays a real per-frame GPU cost
  wherever content moves underneath it — we've just never noticed because blur radii and surface
  areas are modest. Fifty-two files use `backdrop-blur-*`; that's the existing budget line item
  closest to "shader-driven visuals."

## 2. What a WebGL shader canvas actually costs

- **An extra composited layer, structurally.** A canvas with a WebGL context always gets its own
  compositing layer and GPU backing ([chromium-gac]). Once rendered, it composites like any other
  layer — WebGL draws into an FBO texture the compositor consumes directly, no readback. Idle
  steady-state cost ≈ one textured-quad draw. This is the architectural fact that makes the whole
  idea viable.
- **Startup:** context creation plus shader compilation. Not huge for small fragment shaders, but
  non-zero and main-thread-visible; do it behind lazy mounts (we already do this for three.js via
  `next/dynamic`/`React.lazy` — the ~200–400 KB gzipped three.js chunk is the bigger number for
  r3f-based approaches; a raw-WebGL shader div à la paper-shaders is a few KB).
- **The per-frame bill is fill-rate.** Fragment cost = pixels shaded × cost per pixel. A
  mid-range phone viewport at `dpr` 2–3 is 2.5–8M physical pixels. At 60 fps full-screen that's
  150M–500M fragment evaluations/sec; a refraction/noise shader with dozens of ALU ops per pixel
  will visibly eat the frame budget on a Mali/Adreno mid-ranger and drain battery. (This paragraph
  is arithmetic, not a cited measurement — published per-device numbers essentially don't exist.)
- **Continuous rAF is the battery killer, by the book.** The three.js manual states it plainly:
  rendering continuously for content that doesn't animate "is a waste of the device's power and
  if the user is on portable device it wastes the user's battery" — and explicitly recommends
  render-on-demand for product-catalog-style viewers, i.e. exactly our category
  ([three.js: rendering on demand][ondemand]). rAF at least stops when the tab is hidden
  ([webglfundamentals animation][wgl-anim]); it does *not* stop when the canvas is merely
  scrolled off-screen — that's on us (IntersectionObserver).
- **Synchronous WebGL calls can jank the page.** `getError`/`getParameter` stall the calling
  thread ~1 ms+ and on the main thread that stalls scrolling ([MDN WebGL best practices][mdn-bp]).
  Keep per-frame GL work to uniform updates + one draw.
- **Hard context limits.** ~8 live WebGL contexts (typical; modern Chrome ~16); the 9th silently
  kills the oldest ([three.js: multiple scenes][multi]). Resources (compiled shaders, textures,
  geometry) cannot be shared across contexts, so N canvases pay N× compile and memory. This is a
  *correctness* cliff, not a perf slope: browse pages full of `ModelCardPreview` tiles + a shader
  background + the quote-flow preview could genuinely evict a context mid-session.
- **Mobile shader portability gotchas** ([MDN][mdn-bp]): unconditional `highp` breaks old mobile
  GPUs, `mediump` fallback can render corrupted on mobile while looking fine on desktop; on iOS,
  float-texture samplers silently degrade to `lowp` unless declared `highp`. Test on real phones.
- **iOS Safari has a history of WebGL-canvas-specific bugs** — e.g. iOS 14.2 leaked GPU memory on
  every on-screen WebGL canvas resize (≤300 MB → 1.25 GB → tab killed; WebKit #219780, fixed in
  14.3). The specific bug is history; the lesson (don't resize WebGL canvases per-frame, e.g.
  during the iOS URL-bar collapse) is not.

## 3. The toolkit that closes the gap

Everything below is an established, documented technique; together they get a shader surface to
"gradient-class" for everything except sustained animation.

1. **Render-on-demand.** Render once; re-render only on input/uniform change, via a
   `requestRenderIfNotRequested` flag ([three.js on-demand][ondemand]). r3f ships this as
   `frameloop="demand"` + `invalidate()`. Paper Shaders does it automatically: `speed: 0` stops
   the rAF loop entirely — "static shaders have no recurring performance costs"
   ([paper-shaders source][paper]).
2. **Cap physical pixels, upscale in CSS.** Render into a smaller drawing buffer and let the
   browser scale it — MDN's officially recommended quality-for-speed trade ([MDN][mdn-bp]).
   Paper Shaders exposes `maxPixelCount` (default 1920×1080×4 ≈ 8.3M px) and `minPixelRatio`
   (default 2) as first-class knobs ([paper]). For soft gradient-like visuals you can go far
   lower — dpr 1 or below is invisible after upscaling; that alone is a 4–9× fill-rate cut on a
   3× phone. Our `ModelViewer` already caps `dpr={[1, 2]}` (`model-viewer.tsx:798`) — same idea.
3. **Pause when not visible.** rAF gives you tab-visibility for free; add IntersectionObserver
   for scrolled-away canvases (our `model-card-preview.tsx:26-42` already has the pattern) and a
   `visibilitychange` pause (paper-shaders does this internally).
4. **One canvas, many surfaces.** If shader visuals ever appear in more than ~2 places per page,
   use a single full-viewport canvas with placeholder divs + `gl.viewport`/`gl.scissor` per
   region instead of per-element canvases — kills both the context limit and duplicated compiles
   ([three.js multiple scenes][multi], [webglfundamentals multiple views][wgl-views]). Known
   trade-off: on slow devices the canvas can visibly lag scroll by a frame; CSS-composited
   content never does. Prefer per-element canvases while count ≤ 2; switch to shared-canvas
   before count grows.
5. **Respect `prefers-reduced-motion`.** Drop to the static first frame. This matches the
   project's existing conventions (`MotionConfig reducedMotion="user"`, `globals.css:381-400`) —
   and, notably, our existing r3f canvases (hero autoRotate, particles, blob) don't honor it yet.
6. **Release contexts deliberately** (`WEBGL_lose_context`) when a shader surface unmounts for
   good ([MDN][mdn-bp]).
7. **CSS Houdini paint worklets are not the answer** for this. They paint via CPU canvas
   commands off the main thread — great for fancy borders, but they're not fragment shaders, they
   re-paint on invalidation, and support is effectively Chromium-only (partial Safari, Firefox
   never shipped it; the polyfill runs on the main thread) ([houdini-how][houdini]). Skip.

## 4. Liquid glass specifically

Three routes exist; only one survives contact with Safari.

**Route A — `backdrop-filter` blur/saturate ("glassmorphism").** What we already ship (`.glass`,
`.glass-surface` tokens). Cross-browser, compositor-integrated, cost scales with blurred area ×
radius (intermediate render passes). No refraction — no bent edges, no magnification. The
pragmatic 80%.

**Route B — SVG `feDisplacementMap` through `backdrop-filter` (the 2025 "CSS liquid glass").**
Physically-derived displacement maps (Snell's law baked into an RGBA map, R = X-displacement,
G = Y) applied to the live backdrop — genuinely true refraction over DOM content, no canvas
([kube.io write-up][kube]). Two disqualifiers:

- **Chromium-only.** Safari/WebKit does not apply SVG filters referenced from `backdrop-filter`
  (WebKit bug [#245510][wk245510], open; independently documented in [MDN BCD #24110][bcd] —
  "SVG filters not supported in Firefox or Safari"). The same filter works via plain `filter`,
  but that filters the element, not the live backdrop — useless for glass. A 3D-print
  marketplace cannot ship a signature visual that iPhone buyers don't see.
- **Dynamic cost.** Nearly any change to the glass shape/size forces a full displacement-map
  rebuild (CPU canvas work); only `<filter>`-attribute animations like `scale` are cheap
  ([kube]). Fine for a fixed-size pill, hostile to responsive containers.

Worth one graceful-degradation note: `@supports` can't reliably detect *SVG-in-backdrop-filter*
(the property parses everywhere), so Chromium-only progressive enhancement needs UA-class
sniffing — fragile. Industry consensus mid-2025 was blunt: "no standard, performant way to
recreate Liquid Glass in the browser… it breaks in Safari"
([grafit.agency][grafit]); the W3C SVG WG has an open discussion (w3c/svgwg#1142) about
standardizing it, so this may unblock in a year or two — worth a calendar check, not a bet.

**Route C — WebGL true refraction.** A fragment shader can only refract what it can sample, and
it cannot sample the DOM behind the canvas. So WebGL glass means **the refracted background must
live inside the canvas too** — which reframes the feature: not "glass over the page" but "a
self-contained shader scene containing its own backdrop (gradient/mesh/scene) plus a refracting
layer." That's fully cross-browser, and all the §3 mitigations apply (pixel-cap it, animate on
hover only, static otherwise). This is exactly the kind of thing we already know how to build —
`materialize-material.tsx` (custom GLSL with fresnel) and `materializing-blob.tsx` (20k-point
vertex-shader morph, one draw call) are the in-repo proof.

Also real: refraction sells the illusion through specular/edge behavior at high frequency —
which fights the low-res-upscale mitigation harder than soft gradients do. Budget dpr ≥ 1.5 for
glass edges, or keep glass elements small.

## 5. What this means for Materialize

Context that changes the calculus vs. a greenfield app:

- **We already pay WebGL tax on our hottest pages.** Home hero (`hero-showcase.tsx:239` — its own
  canvas, up to 800 instanced particles, continuous loop, non-passive touch handlers), the quote
  configurator (`quote-configurator.tsx:1125` mounts a live `MaterialPreview` canvas *inside the
  conversion path*), file pages, dashboard orders, browse tiles on hover. A "can we afford one
  more shader?" question is really "what's our per-page context + frame budget ledger?"
- **Nothing renders on demand today.** No `frameloop="demand"` anywhere; the cross-section
  feature explicitly relies on the always-on loop (`model-viewer.tsx:755`). The cheapest
  performance win in this whole document is retrofitting demand-rendering onto the *existing*
  viewer surfaces (with an explicit invalidate for the section-stencil path) — that likely buys
  back more battery than a new hero shader spends.
- **The visual language is deliberately flat** ("gradients retired — flat fills only,"
  `globals.css:214-219`), with glass/blur as the one sanctioned depth cue. Shader work that
  extends the *glass* motif (Route C vignettes, refractive hero object) fits; a swirling animated
  background gradient would contradict a documented design decision before it costs a single
  frame.

**Recommended path (each step shippable alone):**

1. **Adopt render-on-demand + reduced-motion on existing canvases first** (viewer `frameloop`,
   hero pause when `prefers-reduced-motion`, IntersectionObserver pause for hero when scrolled
   past). Establishes the discipline and the shared helpers new shader surfaces will use.
2. **Prototype one shader surface with paper-shaders-style constraints** — WebGL2, `speed 0` /
   interaction-driven, `maxPixelCount` ≈ 1M, visibility pause — on a low-stakes surface
   (e.g. material landing-page hero band), behind `prefers-reduced-motion`. Measure on a real
   mid-range Android + an older iPhone via Safari's timeline before promoting the pattern.
   (Building on our existing three.js stack avoids a new dependency; paper-shaders' README
   claims "maximum performance" but publishes no benchmarks — its *techniques* are the value,
   and we can implement them on r3f or raw WebGL2 in ~a hundred lines.)
3. **Liquid glass: do Route A now, Route C for one hero moment if desired, skip Route B** until
   WebKit ships SVG-in-`backdrop-filter` (recheck #245510 / w3c/svgwg#1142 ~quarterly).
4. **Add a page-level canvas budget rule** to AGENTS.md when the second decorative canvas ships:
   max 2 simultaneous WebGL contexts per route; beyond that, shared-canvas scissoring.

**Follow-up issues worth filing when we act:** demand-rendering for `ModelViewer`/hero;
reduced-motion gating for existing canvases (noted as missing today); context-count audit for
browse pages (`ModelCardPreview` × N + other canvases vs. the ~8-context floor).

---

### Sources

Primary: [Chromium: GPU Accelerated Compositing][chromium-gac] · [Chromium: RenderingNG data
structures][renderingng] · [web.dev: CSS paint times][paint-times] · [MDN: WebGL best
practices][mdn-bp] · [three.js manual: rendering on demand][ondemand] · [three.js manual:
multiple canvases][multi] · [paper-shaders source][paper] · [WebKit bug 245510][wk245510] ·
[MDN BCD #24110][bcd] · [web.dev: Houdini][houdini]. Secondary/practitioner: [webglfundamentals
(animation, multiple views)][wgl-anim] · [kube.io: Liquid Glass with CSS/SVG][kube] ·
[grafit.agency on liquid glass][grafit] · Apple Developer Forums (iOS 14.2 WebGL resize leak,
WebKit #219780).

Method note: claims above quote their sources directly; the paint/composite architecture claim
was additionally adversarially verified against the Chromium doc. The 2013 paint-time figures
and the 2020 Houdini support snapshot are dated and used qualitatively. Fill-rate arithmetic in
§2 is analysis, not measurement — step 2's on-device profiling is the check.

[chromium-gac]: https://www.chromium.org/developers/design-documents/gpu-accelerated-compositing-in-chrome/
[renderingng]: https://developer.chrome.com/docs/chromium/renderingng-data-structures
[paint-times]: https://web.dev/articles/css-paint-times
[mdn-bp]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
[ondemand]: https://threejsfundamentals.org/threejs/lessons/threejs-rendering-on-demand.html
[multi]: https://threejs.org/manual/en/multiple-scenes.html
[paper]: https://github.com/paper-design/shaders
[wk245510]: https://bugs.webkit.org/show_bug.cgi?id=245510
[bcd]: https://github.com/mdn/browser-compat-data/issues/24110
[houdini]: https://web.dev/articles/houdini-how
[wgl-anim]: https://webglfundamentals.org/webgl/lessons/webgl-animation.html
[wgl-views]: https://webglfundamentals.org/webgl/lessons/webgl-multiple-views.html
[kube]: https://kube.io/blog/liquid-glass-css-svg/
[grafit]: https://www.grafit.agency/blog/why-you-shouldnt-use-the-liquid-glass-effect-on-your-website-yet
