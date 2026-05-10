# Deferred: Fritzing `.fzz` extraction and Gerber preview

Wiring diagrams ship in two waves so far:

- **Phase 1** ([commit e8f5c5c](#)) — image diagrams (PNG / SVG / JPG / WEBP) attached to projects as `kind = 'image'` rows in `project_circuits`.
- **Phase 2** ([commits 0a69a3f, 66d04db](#)) — Wokwi project URL embeds (iframe in the lightbox) and KiCad source files (`.kicad_sch` / `.kicad_pcb` / `.kicad_pro`) rendered live in the lightbox via [KiCanvas](https://kicanvas.org).

The two `kind` values in the enum that are not yet wired are **`fritzing`** and **`gerber`**. Both were left out for honest reasons; this doc captures the path when we do come back for them.

## Fritzing `.fzz`

A `.fzz` is a zip wrapping a single `.fz` XML file plus optionally a `parts/` directory of custom part definitions. The hobbyist appeal is the rendered breadboard view — which Fritzing renders **at export time** from the `.fz` XML, not from anything stored inside the zip. There are three plausible paths:

1. **Source-only.** Accept the `.fzz` upload, store it under `circuits/<userId>/...`, render a generic placeholder tile labeled "Fritzing", expose a download link. Equivalent to the v1 KiCad UX before KiCanvas. ~1 hour.
2. **Auto-extract any embedded SVG.** Some `.fzz` files ship with one or more pre-rendered SVG views inside the zip. Server-side, `fflate` or `jszip` can unzip the bytes, scan for `*_breadboard.svg` / `*_schematic.svg` files, and stash the first hit as the preview. Misses the (majority?) of cases where the SVG isn't embedded. ~3 hours.
3. **Server-side Fritzing CLI render.** The Fritzing CLI can render `.fzz` to PNG/SVG. The binary is Linux-only and ~50 MB; doesn't run on Vercel's default runtime. Would need an out-of-band worker (Modal / Fly / Render), the same infra we'd want for animated OG anyway. ~1 day for the worker, ~half day for the wiring.

**Recommendation**: ship path 1 alone first ("Add Fritzing file" button that's just upload + download). Most projects that want a Fritzing diagram are exporting a PNG/SVG and uploading that via the existing image uploader — path 1 only matters for builders who want the editable source. Path 3 becomes attractive once we have the worker infra for OG animation.

## Gerber zips

Gerber is the lingua franca of PCB fabrication — a zip of `.gbr` / `.gbl` / `.gtl` etc. files describing each PCB layer. The hobbyist signal: someone uploading a Gerber zip is shipping a kit that's about to be fabbed.

Preview: [`@tracespace/parser`](https://github.com/tracespace/tracespace) + [`@tracespace/renderer`](https://github.com/tracespace/tracespace) parse Gerbers in pure JS and emit SVG layers. Lighter than KiCanvas, no external script. Runs anywhere — including Vercel's Node runtime.

**Recommendation**: when we add this, do the full preview path from day one. The package surface is small enough that a "source-only" interim feels like a regression compared to KiCanvas / Wokwi neighbors.

## Scope estimate when we come back

- Fritzing path 1 alone: half a day, including the new server action, button, and lightbox download affordance.
- Gerber with full SVG render: one day, including layer toggle UI in the lightbox.
- Fritzing path 3 (real renders) only worth pursuing after we have an out-of-band worker for animated OG — at which point it's a few-hour add to point at the same worker.
