/**
 * CraftCloud's design limits for a material, read off its catalog entry:
 * the minimum wall and minimum feature size for each process it is made
 * with. Shown on the material page, in llms-full.txt and by the MCP
 * material tools, so a buyer or an agent sees the same figures the
 * printability check judges against.
 */
export interface DesignLimit {
  process: string;
  minWallMm: number;
  minDetailMm: number | null;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function designLimits(material: {
  printingMethods?: ReadonlyArray<{
    name: string;
    minWallThickness?: number | null;
    minDetails?: number | null;
  }>;
}): DesignLimit[] {
  return (material.printingMethods ?? [])
    .filter((p) => num(p.minWallThickness))
    .map((p) => ({
      process: p.name,
      minWallMm: p.minWallThickness as number,
      minDetailMm: num(p.minDetails) ? p.minDetails : null,
    }));
}

/**
 * "0.8 mm" when every process agrees, "SLS 0.8 mm, MJF 0.6 mm" when they
 * don't. Null when there is no figure.
 */
export function formatLimit(
  limits: readonly DesignLimit[],
  pick: (l: DesignLimit) => number | null
): string | null {
  const rows = limits
    .map((l) => ({ process: l.process, value: pick(l) }))
    .filter((r): r is { process: string; value: number } => r.value !== null);
  if (!rows.length) return null;
  if (rows.every((r) => r.value === rows[0].value)) return `${rows[0].value} mm`;
  return rows.map((r) => `${r.process} ${r.value} mm`).join(", ");
}
