/**
 * Metric fastener / thread reference for the harness — the highest-ROI,
 * fully license-clean numeric tables (dimensions are uncopyrightable facts;
 * cross-checked against Wikipedia "ISO metric screw thread" / "List of drill
 * and tap sizes" (CC BY-SA) and free vendor charts, re-tabled in our own
 * values). Drives correct clearance holes, counterbores, tapped bosses, and
 * heat-set insert bores — a common dimensional-accuracy failure mode.
 *
 * Print guidance: prefer clearance holes (free/medium class) or heat-set
 * insert bores over small printed threads, which fail at M5 and below.
 */

export interface MetricFastener {
  size: string;
  pitchMm: number;
  tapDrillMm: number;
  /** Medium-class through-hole clearance (ISO 273). */
  clearanceHoleMm: number;
  /** Socket-head cap screw (ISO 4762 / DIN 912): head dia & height, hex socket. */
  headDiaMm: number;
  headHeightMm: number;
  hexSocketMm: number;
  /** Recommended bore for a brass heat-set insert in a printed boss. */
  heatSetBoreMm: number;
}

export const METRIC_FASTENERS: Record<string, MetricFastener> = {
  M2: { size: "M2", pitchMm: 0.4, tapDrillMm: 1.6, clearanceHoleMm: 2.4, headDiaMm: 3.8, headHeightMm: 2.0, hexSocketMm: 1.5, heatSetBoreMm: 3.2 },
  M2_5: { size: "M2.5", pitchMm: 0.45, tapDrillMm: 2.05, clearanceHoleMm: 2.9, headDiaMm: 4.5, headHeightMm: 2.5, hexSocketMm: 2.0, heatSetBoreMm: 3.5 },
  M3: { size: "M3", pitchMm: 0.5, tapDrillMm: 2.5, clearanceHoleMm: 3.4, headDiaMm: 5.5, headHeightMm: 3.0, hexSocketMm: 2.5, heatSetBoreMm: 4.0 },
  M4: { size: "M4", pitchMm: 0.7, tapDrillMm: 3.3, clearanceHoleMm: 4.5, headDiaMm: 7.0, headHeightMm: 4.0, hexSocketMm: 3.0, heatSetBoreMm: 5.6 },
  M5: { size: "M5", pitchMm: 0.8, tapDrillMm: 4.2, clearanceHoleMm: 5.5, headDiaMm: 8.5, headHeightMm: 5.0, hexSocketMm: 4.0, heatSetBoreMm: 6.4 },
  M6: { size: "M6", pitchMm: 1.0, tapDrillMm: 5.0, clearanceHoleMm: 6.6, headDiaMm: 10.0, headHeightMm: 6.0, hexSocketMm: 5.0, heatSetBoreMm: 8.0 },
  M8: { size: "M8", pitchMm: 1.25, tapDrillMm: 6.8, clearanceHoleMm: 9.0, headDiaMm: 13.0, headHeightMm: 8.0, hexSocketMm: 6.0, heatSetBoreMm: 9.6 },
};

/** Pull the fastener rows referenced in a prompt (e.g. "M3", "m4 bolts"). */
export function fastenersInPrompt(prompt: string): MetricFastener[] {
  const found = new Map<string, MetricFastener>();
  const re = /\bm\s?(2\.5|2|3|4|5|6|8)\b/gi;
  for (const m of prompt.matchAll(re)) {
    const key = `M${m[1]}`.replace(".", "_");
    const row = METRIC_FASTENERS[key];
    if (row) found.set(row.size, row);
  }
  return [...found.values()];
}

export function formatFasteners(rows: MetricFastener[]): string {
  if (rows.length === 0) return "";
  const lines = [
    "Fastener dimensions (mm) — use clearance holes or heat-set bores, not small printed threads:",
  ];
  for (const f of rows) {
    lines.push(
      `- ${f.size}: clearance hole ${f.clearanceHoleMm}, counterbore ≈ ${(
        f.headDiaMm + 0.5
      ).toFixed(1)} dia × ${f.headHeightMm} deep (ISO 4762 head ${f.headDiaMm}×${f.headHeightMm}), tapped pilot ${f.tapDrillMm}, heat-set insert bore ${f.heatSetBoreMm}.`
    );
  }
  lines.push("- Keep ≥2 mm of material around any heat-set insert boss.");
  return lines.join("\n");
}
