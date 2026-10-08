/**
 * Design limits straight from CraftCloud's catalog: minimum wall, minimum
 * feature and largest build, per process and per material. Pure; the
 * catalog fetch lives in `lib/mcp/internal/printability.ts`.
 *
 * These replace the editorial numbers in `lib/materials` wherever the
 * catalog has a figure. The editorial ones stay as the fallback for a
 * material the catalog doesn't cover (and when the catalog is down), and
 * every verdict says which source it used.
 */
import type { MaterialMetadata } from "@/lib/materials/preset-library";

export interface CatalogMaterialLimits {
  id: string;
  name: string;
  technology?: string;
  maximumPrintingDimensions?: readonly number[];
  printingMethods?: ReadonlyArray<{
    name: string;
    minWallThickness?: number | null;
    minDetails?: number | null;
  }>;
}

export type LimitsSource = "craftcloud" | "editorial";
export type MaterialWithLimits = MaterialMetadata & { limitsFrom: LimitsSource };

export interface ProcessLimits {
  process: string;
  minWallMm: number;
  minDetailMm: number | null;
  /** The largest build any material on this process offers (mm, x/y/z). */
  maxBuildMm: [number, number, number] | null;
  materialCount: number;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const dims3 = (v: readonly number[] | undefined): v is [number, number, number] =>
  !!v && v.length === 3 && v.every((x) => num(x) && x > 0);

/** How our editorial process names read in CraftCloud's catalog. */
const PROCESS_ALIASES: Record<string, string[]> = {
  DMLS: ["SLM / DMLS", "High-Detail SLM", "DMP"],
  "Binder Jetting": ["Binder Jetting"],
};
const sameProcess = (editorial: string, catalog: string) =>
  editorial === catalog || (PROCESS_ALIASES[editorial] ?? []).includes(catalog);

/**
 * One row per process CraftCloud publishes a minimum wall for, taken
 * from 3D-printing materials only (CNC and casting have none).
 */
export function processLimits(
  catalog: readonly CatalogMaterialLimits[]
): ProcessLimits[] {
  const byProcess = new Map<string, ProcessLimits>();
  for (const m of catalog) {
    if (m.technology && m.technology !== "3d_printing") continue;
    for (const p of m.printingMethods ?? []) {
      if (!num(p.minWallThickness)) continue;
      const row = byProcess.get(p.name) ?? {
        process: p.name,
        minWallMm: p.minWallThickness,
        minDetailMm: null,
        maxBuildMm: null,
        materialCount: 0,
      };
      row.materialCount++;
      row.minWallMm = Math.min(row.minWallMm, p.minWallThickness);
      if (num(p.minDetails)) {
        row.minDetailMm =
          row.minDetailMm === null ? p.minDetails : Math.min(row.minDetailMm, p.minDetails);
      }
      if (dims3(m.maximumPrintingDimensions)) {
        const d = m.maximumPrintingDimensions;
        const vol = (x: readonly number[]) => x[0] * x[1] * x[2];
        if (!row.maxBuildMm || vol(d) > vol(row.maxBuildMm)) row.maxBuildMm = [...d];
      }
      byProcess.set(p.name, row);
    }
  }
  return [...byProcess.values()].sort((a, b) => a.process.localeCompare(b.process));
}

/**
 * Give each editorial material CraftCloud's figures. `lookup` maps an
 * editorial id to the matching catalog material (or null). Where the
 * catalog is silent a field keeps its editorial value, and a material
 * with no catalog figure at all is marked `editorial`.
 */
export function withCatalogLimits(
  materials: readonly MaterialMetadata[],
  lookup: (editorialId: string) => CatalogMaterialLimits | null,
  processes: readonly ProcessLimits[] = []
): MaterialWithLimits[] {
  return materials.map((m) => {
    const cc = lookup(m.id);
    const methods = (cc?.printingMethods ?? []).filter((p) => num(p.minWallThickness));
    // The method the editorial row names, else the most permissive one:
    // the order goes to whichever vendor can make it.
    const method =
      methods.find((p) => sameProcess(m.method, p.name)) ??
      [...methods].sort((a, b) => a.minWallThickness! - b.minWallThickness!)[0];
    const build = cc && dims3(cc.maximumPrintingDimensions) ? cc.maximumPrintingDimensions : null;
    if (!method && !build) {
      // No catalog material matched: use CraftCloud's figures for the
      // process itself (every FDM material shares one wall minimum).
      // The largest build is left alone, since "largest anywhere" would
      // pass almost anything.
      const proc = processes.find((p) => sameProcess(m.method, p.process));
      if (!proc) return { ...m, limitsFrom: "editorial" as const };
      return {
        ...m,
        limitsFrom: "craftcloud" as const,
        constraints: {
          ...m.constraints,
          minWallThickness: proc.minWallMm,
          minDetail: proc.minDetailMm ?? m.constraints.minDetail,
        },
      };
    }

    return {
      ...m,
      limitsFrom: "craftcloud" as const,
      constraints: {
        minWallThickness: method?.minWallThickness ?? m.constraints.minWallThickness,
        minDetail: num(method?.minDetails) ? method.minDetails : m.constraints.minDetail,
        maxDimensions: build
          ? { x: build[0], y: build[1], z: build[2] }
          : m.constraints.maxDimensions,
      },
    };
  });
}
