# Design study — closure archetypes: snap, hinge, screw-clamp

Companion to `modem-works.md` (which owns the drape/skin/split story). This
study distills how well-designed consumer enclosures CLOSE — the part-break
logic and the numbers that make a printed joint actually work. Method: distilled
convention + printed-fit engineering practice, re-derived and kernel-verified in
our own parametric exemplars (`lib/cad/knowledge/exemplars.ts`:
`snap_lid_sensor_node`, `hinged_case_pin_bores`, `strain_relief_clamshell`).
No third-party geometry or prose is reproduced; every number below is asserted
in exemplar code and executed against the real kernel.

## Part-break logic (applies to every archetype)

1. **The seam is a design line, not a leftover.** Put it on a shadow line —
   a component transition, a proportional break (deep body + shallow face) —
   never mid-face on a visible surface.
2. **One part carries the mechanism, the other the reveal.** Snap ridges,
   bosses, pilots, and pins live on the inner/functional part; the outer part
   shows an uninterrupted skin. Fastener heads face down or in.
3. **Mating features are crisp** (edge budget): lips, windows, ridges,
   registration pins locate; they get no cosmetic fillets.
4. **Every fit is a named parameter with an assert.** Printed joints live or
   die on 0.1–0.3 mm; a fit that isn't computed is a fit that drifts.

## Snap (tool-free, reopenable)

The reliable printed snap is a **lip ridge + wall window**, not a thin
cantilever hook (FDM cantilevers snap along layer lines):

- Lid lip drops inside the walls with `fit_gap ~0.25` per side.
- Half-round ridge segments (r ~1 mm) on the lip's outer face engage
  rectangular windows cut THROUGH the wall near the rim.
- **Engagement depth is the design variable**: ridge tip must land past the
  inner wall face by >= 0.5 mm (compute it: `lip_face + ridge_r − inner_wall`),
  and the window must clear the ridge by >= 0.4 mm vertically so it can click
  home. Asserted in `snap_lid_sensor_node`.
- Windows read as intentional vents/details when rhythmically placed — a
  visible window is honest; a hidden undercut is unprintable.

## Hinge (printed knuckles, pin bore)

- **Alternating knuckles on ONE axis**: two outer on the base, one center on
  the lid (or 3/2 at larger sizes). Center-on-lid keeps the lid's load path
  symmetric.
- Axis sits BEHIND the back wall with a small standoff (~0.2 mm) so barrels
  never rub the skin; webs tie each barrel into its part — a barrel joined by
  tangency is a barrel that ships as loose debris.
- **Pin bore = slip fit**: bore − pin >= 0.25 mm (3.0 mm pin → 3.3 mm bore;
  1.75 mm filament works as a field pin at 2.0–2.1). Barrel wall >= 1 mm
  around the bore.
- Axial gaps between knuckles >= 0.3 mm; parts export in the CLOSED assembled
  position and must show zero interpenetration. Asserted in
  `hinged_case_pin_bores`.

## Screw-clamp (serviceable, load-bearing)

For clamshells that clamp something (cables, shafts) or need repeat service:

- **Clearance above, thread below**: through-hole + counterbore in the outer
  half (M3: 3.4 mm clearance, ~6.5 mm counterbore), self-tap pilot (~0.8x
  thread dia) or heat-set boss (M3 insert: 4.0 mm bore) in the inner half.
- **Registration is separate from clamping**: two diagonal pins (r ~1.5,
  h ~1.6) with recesses grown by a printed clearance (+0.15 mm) align the
  halves before the screws pull them tight.
- Build both halves from **one parametric function** (a `top: bool` switch) —
  mirrored features can never drift apart. Pattern:
  `strain_relief_clamshell`.
- Strain-relief specifics: annular ribs bite the jacket by ~0.6 mm per side
  (grip without cutting), and entries flare outward so the cord has no sharp
  bend point at the mouth.

## Choosing between them

| Intent | Closure |
| --- | --- |
| Sealed-ish, assembled once | friction lip (`split_shell` default) |
| Tool-free, opened occasionally | snap ridge + window |
| Opened constantly / lid must swing | printed hinge + pin |
| Clamping load, repeat service | screws (+ registration pins) |

The recipe block (`lib/cad/knowledge/enclosure-recipe.ts`) compiles this menu
into the generation prompt for enclosure-shaped requests.
