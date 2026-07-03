# Design study — Modem Works: Dream Recorder + Terra

Measured 2026-07-03 from the published print files (trimesh: dihedral-angle
distributions, ray-sampled wall thickness, mid-height section fits). Owner
designated both as the quality bar for Materialize enclosures ("phenomenal
examples of what I'm trying to do").

**Provenance + license.** Dream Recorder: `github.com/modem-works/dream-recorder`,
**MIT** — geometry may be used, modified, and redistributed with attribution
(a NOTICE entry is required if any derived artifact ships). Terra:
`github.com/modem-works/terra`, **GPLv3** — study freely; do NOT ship derived
geometry or code in the product without accepting copyleft terms. Everything
below is measurement + distilled principle (uncopyrightable facts), safe to use
anywhere.

## Measurements

| Part | Dims (mm) | Wall p25/med/p75 | Smooth¹ | Crisp¹ | Plan-form² |
| --- | --- | --- | --- | --- | --- |
| DR back (body) | 229 × 97 × 51 | 3.4 / 5.7 / 7.3 | 97.2% | 0.7% | squircle n≈4.6 |
| DR front (lens plate) | 229 × 96 × 15 | 1.85 / **1.94** / 1.95 | 99.2% | 0.8% | continuous curve |
| Terra shell top (resin) | 85 × 73 × 21 | 1.3 / **1.7** / 1.9 | 99.1% | 0.8% | lens n≈1.7 |
| Terra shell bottom (resin) | 85 × 73 × 23 | 1.5 / **1.7** / 1.9 | 97.8% | 2.0% | lens n≈1.7 |
| Terra skeleton top (SLS) | 80 × 54 × 21 | 1.9 / 2.0 / 2.8 | 77.3% | **21.3%** | — |
| Terra skeleton bottom (SLS) | 50 × 49 × 26 | 1.5 / 1.7 / 2.0 | 92.7% | 7.1% | — |

¹ % of face-adjacency angles < 5° (smooth) / ≥ 25° (crisp).
² Superellipse |x/a|ⁿ + |y/b|ⁿ = 1 fit to the mid-height section; n=2 is an
ellipse, n→∞ a rectangle. DR fit err 0.038, Terra 0.009.

## The distilled moves

1. **Plan-forms are continuous curves, never filleted rectangles.** Dream
   Recorder is a *squircle* (n≈4.6 — between rounded-rect and ellipse, with no
   straight-to-arc transition anywhere). Terra is a *lens* (n≈1.7, softer than
   an ellipse). This is the single biggest gap vs our exemplar pool: our
   `rounded_enclosure` scores 98.6% on the same smoothness metric yet reads as
   a box, because box-plus-corner-fillet has tangency breaks and flat runs a
   squircle never has. **Metric caveat: smoothness is necessary, not
   sufficient — the gestalt lives in the plan-form and proportion.**
2. **Wall discipline is severe.** Visible shells hold one thin wall: Terra
   1.7mm median (IQR 1.3–1.9), DR front 1.94mm with an IQR of 0.10mm. Organic
   outside ≠ blobby inside — the skin is a constant-thickness offset of a
   beautiful surface (exactly `offset_field(cavity, wall)` in sdf terms).
3. **Shell/skeleton split.** The beautiful part carries no function; the
   functional part carries no beauty. Shells: ~99% smooth, zero mounts.
   Skeletons (internal, SLS): 7–21% crisp edges, all bosses/clips/mounts.
   Two-material, two-process. Our harness's equivalent: an organic sdf skin
   over a crisp build123d chassis — the `from_mesh` bridge exists precisely
   for this composition.
4. **Proportion classes.** Desk object (DR): 229×97×51 — long low bar, 2.4:1
   plan ratio, front face is one continuous lens. Handheld (Terra): 85×73×22 —
   near-square pebble, thickness ≈ 0.3 × width. Both split into a deep body +
   shallow face along the natural shadow line.

## Actions for the exemplar/template program (MTR-189/190)

- Add a **superellipse prism** primitive to sdf_kit (`sq_prism(P, a, b, n,
  z0, z1)`) and teach the plan-form rule in the ORGANIC-FUNCTIONAL prompt
  section: squircle n 4–5 for desk devices, lens n 1.7–2.2 for handhelds;
  never extruded-rect-plus-fillets for organic product shells.
- Author the next exemplars as **shell + skeleton pairs** (parts dict):
  organic superellipse shell (uniform 1.8mm wall) over a crisp internal
  chassis with bosses — the Modem architecture in parametric form.
- Wall-uniformity is machine-checkable (ray-sampled IQR) — candidate for a
  style gate beside the aesthetic judge.
- Dream Recorder (MIT) geometry may additionally serve as a dimensional
  ground-truth target for a reverse-engineered exemplar, with NOTICE
  attribution, if we choose; Terra must remain study-only.
