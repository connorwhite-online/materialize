# Design study — display bezels & wall-mount backs

Companion to `modem-works.md` and `closure-archetypes.md`. Two archetypes that
make an enclosure read as a *product*: a front face that frames a display, and
a back that mounts to a wall without visible hardware. Distilled from standard
module datasheets + printed-mount practice, re-derived as original parametric
exemplars (`oled_window_front_plate_box`, `wall_mount_keyhole_bin`) and
kernel-verified. No third-party geometry is reproduced.

## Display bezel (front-plate aperture)

The amateur tell is an aperture sized to the *module outline* — the board
falls through, the glass edge shows, the traces show. The bezel is a
**three-datum problem**, and all three come from the module's datasheet:

| Datum (SSD1306 0.96" breakout) | Value | Role |
| --- | --- | --- |
| glass outline | 26.7 x 19.3 | aperture must be SMALLER (glass seats behind it) |
| active/emitting area | 21.7 x 10.9 | aperture must be LARGER + margin (never crop pixels) |
| mounting-hole grid | 23.5 x 23.8, M2 | posts on the plate's BACK, pilots stopped short of the face |

- Aperture between the two: ~23.0 x 12.0 for the 0.96" part. Assert both
  bounds — `aperture < glass` and `aperture > active + 0.8` — so a datum edit
  fails loudly.
- **Bevel the aperture outward** (~45°, 1–1.2 mm): reads as a designed bezel,
  improves off-axis viewing, and prints support-free when the face plate lies
  face-down.
- The module hangs off the plate, not the box: posts on the plate's back at
  the true hole grid, M2 self-tap pilots (D1.6) stopped >= 1.2 mm short of the
  visible face. Keep posts clear of the aperture (assert grid/2 − post_r >
  aperture/2).
- Plate joins the body as a **rebated front aperture + lip** (a shallow frame
  the lip seats into) so the seam is a shadow line around the face.
- Kernel gotcha (verified): `offset(openings=<side face>)` silently no-ops
  once corner fillets bound that face — build the cavity as an explicit inner
  offset (plan radius = corner_r − wall) instead. Interior corners stay crisp
  per the edge budget.

## Wall-mount back (keyhole)

Concealed mounting is a **keyhole**, and a keyhole is three asserted numbers:

- **Head hole** passes the screw head: head dia + ~1 mm (M4/#8 pan ~7 mm →
  8 mm hole).
- **Slot** passes only the shank: shank + 0.4–0.6 mm, and *strictly less than
  the head* so the part locks when it slides down (assert
  `shank + 0.4 <= slot < head`).
- **Rise** ~8 mm: enough travel to capture, short enough to hide the head
  hole behind the part's mass.

Structure:

- 2 mm shells don't capture a screw head — cut keyholes through **internal
  reinforcement pads** (~2.5 mm proud of the wall, sized to cover hole + full
  slot travel + 4 mm margin, asserted).
- **Two keyholes, level**, as wide apart as the back allows: one screw is a
  pivot, two are a datum. Level keyholes = self-leveling installation.
- The pads live inside; the outside face stays an uninterrupted skin with two
  small openings — hardware invisible once hung.

Both archetypes are retrievable by keyword and via the plan-step catalog; the
enclosure recipe block points board/module prompts at true datums.
