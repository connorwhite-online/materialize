/**
 * bd_warehouse usage rules (MTR-200) — the standard-parts counterpart to the
 * fastener dimension tables. bd_warehouse (Apache-2.0, by the build123d
 * author) is pinned in the sidecar, so generated code MAY construct real
 * ISO/DIN standard parts instead of hand-modeling them. Conditional: only
 * included when the prompt references fasteners/bearings/inserts, per the
 * prompt-budget discipline in ./index.ts.
 *
 * Canonical constructor shapes below are mirrored 1:1 in
 * cad-runner/tests/test_bd_warehouse_smoke.py (the Docker-only verification
 * gate) — keep them in sync.
 */

export const BD_WAREHOUSE_RULES = `Standard parts — bd_warehouse (installed in the sidecar):
- NEVER hand-model a standard fastener, nut, washer, heat-set insert, or bearing. Construct it with bd_warehouse (parametric ISO/DIN/vendor tables), or — if it has no bd_warehouse coverage — use the documented envelope you were given.
- Canonical usage (size strings are "M{dia}-{pitch}"; washers take "M3"; heat-set inserts "M3-0.5-Standard", tabled M2-M5 only):
    from bd_warehouse.fastener import SocketHeadCapScrew, HexNut, HeatSetNut
    screw = SocketHeadCapScrew(size="M3-0.5", length=12, fastener_type="iso4762")
    insert = HeatSetNut(size="M3-0.5-Standard", fastener_type="McMaster-Carr")
    from bd_warehouse.bearing import SingleRowCappedDeepGrooveBallBearing
    bearing = SingleRowCappedDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")  # 608ZZ
- The default simple=True omits helical thread geometry — correct for printed parts, fit checks, and boolean subtraction; keep it.
- These solids are context: subtract/mate against them for cavities, counterbores, and keep-outs. The printed part itself is still your own build123d code, and fasteners must NOT be fused into \`result\` unless the request is literally to print a fastener.`;

/**
 * Whether the prompt references standard off-the-shelf parts. Deliberately
 * word-bound and specific ("threaded insert", not bare "insert") to keep the
 * block out of prompts that don't need it.
 */
export function needsStandardParts(prompt: string): boolean {
  return /\b(screws?|bolts?|nuts?|washers?|bearings?|fasteners?|standoffs?|heat[-\s]?set|threaded\s+inserts?)\b/i.test(
    prompt
  );
}
