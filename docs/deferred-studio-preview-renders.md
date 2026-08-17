# Deferred: studio-quality preview renders, in the file's material family

A file's preview render is captured by `components/viewer/thumbnail-capture.tsx` — a manual three-point rig lighting `meshStandardMaterial`, on a transparent background, at a fixed normalized size. That one image is what represents the file on browse cards, library tiles, search results, JSON-LD, and the link preview when someone shares it. It is the highest-leverage image in the product, and it currently looks like a viewport grab rather than a product shot.

The wishlist: make it read like a **studio render**, and show the model in a material that reflects what the file is actually meant to be printed in.

## Two halves

### 1. Make the render beautiful

Candidates: a real studio HDRI for image-based lighting, a ground/contact shadow so the part sits somewhere rather than floating, tone mapping, a considered background, maybe a subtle bloom or falloff.

Two constraints that are already load-bearing and will bite:

- **No external HDRIs.** drei's `Environment` presets fetch from `raw.githack.com`, which drops CORS headers — this already caused intermittent console spam and failures, which is why `ModelViewer` passes `environment={null}`. Any IBL has to be self-hosted in `public/`, and its weight counts against the capture path.
- **The transparent background is a contract, not a default.** It is what lets the OG card render a capture `contain`-fit and still read as full-bleed, because the capture's transparency and the card's `#0a0a0a` are the same colour (§ Link previews in AGENTS.md). Introduce a background and that pairing has to be re-decided in the same change.

### 2. Drive the material from the file's recommendation

The rig already accepts `recommendedMaterialId` but only uses it to look up a flat `color`. The ask is a **material family** — resin vs. nylon vs. metal vs. filament — expressed through real surface properties: roughness, metalness, clearcoat, sheen, subsurface. A titanium part and a PLA part should not render as the same grey plastic in two tints.

Mind the two-catalog gotcha (§ Material catalog gotcha): `lib/materials/` (curated display slugs) and `lib/craftcloud/catalog.ts` (upstream UUIDs) do not share ids, and `files` carries both `recommendedMaterialId` and `recommendedCcMaterialId`. A family map has to be keyed off whichever of the two is actually populated.

## Why this is cheaper than it looks

"Update preview" (MTR / PR #221) deliberately re-renders **offscreen through this same rig** rather than screenshotting the live canvas. So every improvement here lands on both the automatic first capture and the owner-triggered re-shoot at once, and every file stays re-shootable at any time from any angle. The rig is the single place to change.

## Open questions

- **Does the material treatment apply to the live detail viewer too, or only to captures?** Consistency argues for both; mobile GPU budget argues for captures only. The viewer already has a separate self-lit `MaterializeMaterial` path for the studio, so there is precedent for them differing.
- **Do existing thumbnails get re-captured on a rig change?** A silent mass re-render changes every card in the product at once. The alternative — only re-shoot on demand — leaves the catalogue looking inconsistent for as long as it takes creators to notice the button.
- **Does a background break more than the OG card?** Browse cards and library tiles paint their own muted gradient behind the transparent pixel; an opaque capture would sit on top of that rather than blending into it.
