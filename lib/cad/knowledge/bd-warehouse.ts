/**
 * bd_warehouse usage rules (MTR-200) — the standard-parts counterpart to the
 * fastener dimension tables. bd_warehouse (Apache-2.0, by the build123d
 * author) is pinned in the sidecar, so generated code MAY construct real
 * ISO/DIN standard parts instead of hand-modeling them. Conditional: only
 * included when the prompt references fasteners/bearings/inserts/threads,
 * per the prompt-budget discipline in ./index.ts.
 *
 * Canonical constructor shapes below are mirrored 1:1 in
 * cad-runner/tests/test_bd_warehouse_smoke.py (the Docker-only verification
 * gate) — keep them in sync.
 *
 * The FUNCTIONAL THREADS rules are kernel-verified (2026-08-04, OCP 7.9.3 +
 * build123d 0.11 + bd_warehouse 0.2.0, through the sidecar's own validation):
 *   - external ridge + body           → clean single watertight body
 *   - internal via Part(children=[…]) → watertight ONLY via voxel remesh
 *   - internal via ANY boolean        → shattered mesh, or OCC "succeeds"
 *     while silently DISCARDING the thread (fuse returns the unthreaded
 *     part with vol unchanged — verified by material probe)
 *   - hand-rolled helix sweeps        → the failure class that produced
 *     euler -166/-336 + 109 mm³ debris in prod (job df06cce4)
 */

export const BD_WAREHOUSE_RULES = `Standard parts — bd_warehouse (installed in the sidecar):
- NEVER hand-model a standard fastener, nut, washer, heat-set insert, or bearing. Construct it with bd_warehouse (parametric ISO/DIN/vendor tables), or — if it has no bd_warehouse coverage — use the documented envelope you were given.
- Canonical usage (size strings are "M{dia}-{pitch}"; washers take "M3"; heat-set inserts "M3-0.5-Standard", tabled M2-M5 only):
    from bd_warehouse.fastener import SocketHeadCapScrew, HexNut, HeatSetNut
    screw = SocketHeadCapScrew(size="M3-0.5", length=12, fastener_type="iso4762")
    insert = HeatSetNut(size="M3-0.5-Standard", fastener_type="McMaster-Carr")
    from bd_warehouse.bearing import SingleRowCappedDeepGrooveBallBearing
    bearing = SingleRowCappedDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")  # 608ZZ
- For FASTENER CONTEXT parts the default simple=True omits helical thread geometry — correct for printed parts, fit checks, and boolean subtraction; keep it.
- Fastener/bearing solids are context: subtract/mate against them for cavities, counterbores, and keep-outs. The printed part itself is still your own build123d code, and fasteners must NOT be fused into \`result\` unless the request is literally to print a fastener.

FUNCTIONAL THREADS (the user wants actual thread geometry) — kernel-verified rules, deviations WILL fail validation:
- NEVER hand-roll a thread from a helix + swept profile + booleans. That path crashes the kernel or produces non-watertight multi-body debris every time. Use bd_warehouse.thread.
- EXTERNAL thread (boss, bolt-like feature, bottle-cap male side) — fuse the ridge onto its core; this is clean and cheap:
    from bd_warehouse.thread import IsoThread, TrapezoidalThread
    ext = TrapezoidalThread(diameter=24, pitch=4, thread_angle=30, length=30, external=True,
                            end_finishes=("fade", "fade"), align=(Align.CENTER, Align.CENTER, Align.CENTER))
    core = Cylinder(radius=24 / 2 - 0.01, height=30)
    result = core + ext   # single watertight body
- INTERNAL thread (threaded hole/nut) — bore the hole at the thread's MAJOR diameter, then ship body + internal thread as a COMPOUND (this is bd_warehouse's own nut pattern; interference makes them overlap):
    thread = IsoThread(major_diameter=20, pitch=2.5, length=<bore depth>, external=False,
                       end_finishes=("fade", "fade"), align=(Align.CENTER, Align.CENTER, Align.CENTER))
    with BuildPart() as p:
        Box(40, 40, 40)
        Hole(20 / 2)
    result = Part(children=[p.part, thread])
  Do NOT fuse()/cut() internal threads into the body — OCC either shatters the mesh or silently drops the thread. The compound is expected to finalize through the mesh pipeline (lossy remesh, no STEP) — that is the correct, accepted outcome for internal threads.
- Printability: functional printed threads must be CHUNKY — major diameter >= 12 mm and coarse pitch (>= 2 mm); below that, spec a heat-set insert or nut pocket instead (see fastener tables).
- Position threads explicitly (align/rotation/Location) so the thread occupies exactly the bore/boss it belongs to.`;

/**
 * Whether the prompt references standard off-the-shelf parts OR functional
 * thread geometry. Deliberately word-bound and specific ("threaded insert",
 * not bare "insert") to keep the block out of prompts that don't need it.
 */
export function needsStandardParts(prompt: string): boolean {
  return /\b(screws?|bolts?|nuts?|washers?|bearings?|fasteners?|standoffs?|heat[-\s]?set|threads?|threaded)\b/i.test(
    prompt
  );
}

/**
 * Whether generated code opts into the internal-thread compound recipe
 * (bd_warehouse.thread with an internal thread). Internal threads are
 * watertight ONLY through the sidecar's lossy voxel remesh — booleans fail
 * or silently drop the thread — so callers pass allowRemesh on the FIRST
 * run for such code instead of burning repair attempts on a known-good
 * program whose only "defect" is needing the mesh pipeline.
 */
export function usesInternalThreadRecipe(code: string): boolean {
  return (
    /from\s+bd_warehouse\.thread\s+import/.test(code) &&
    /external\s*=\s*False/.test(code)
  );
}
