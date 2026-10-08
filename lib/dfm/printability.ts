/**
 * Turns mesh facts into "what is wrong with this part and what do I do
 * about it", plus a per-material verdict. Pure, like `mesh-analysis.ts`.
 *
 * Two kinds of finding, kept apart on purpose:
 *   - `issues`: facts about the MODEL (open holes, loose pieces, probable
 *     unit mistake). They apply whatever it is printed in.
 *   - `materials`: facts about the model AGAINST a material (does it fit
 *     the machine, are the walls thick enough for the process).
 *
 * Thresholds come from the curated library (`lib/materials`), the same
 * numbers the listing form and material pages already show people. They
 * are conservative process envelopes, not vendor guarantees, and the
 * response says so.
 */
import { modelFitsInVolume } from "@/lib/craftcloud/fits-volume";
import {
  MATERIALS,
  type MaterialMetadata,
  type PrintingMethod,
} from "@/lib/materials/preset-library";
import type { MeshAnalysis } from "./mesh-analysis";

export type Severity = "blocker" | "warning" | "info";

export interface PrintIssue {
  code: string;
  severity: Severity;
  message: string;
  fix: string;
}

export type Verdict = "good" | "risky" | "no";

export interface MaterialFit {
  materialId: string;
  name: string;
  method: PrintingMethod;
  verdict: Verdict;
  reasons: string[];
}

export interface ModelFacts {
  /** mm, after applying the file's declared unit. */
  bboxMm: { x: number; y: number; z: number };
  /** null when the format isn't parsed (STEP, AMF) or the parse failed. */
  analysis: MeshAnalysis | null;
  /** The unit the file was declared in, used to suggest a unit fix. */
  declaredUnit: "mm" | "cm" | "in";
}

const UNIT_TO_MM = { mm: 1, cm: 10, in: 25.4 } as const;
const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n.toFixed(1));

export function assessIssues(facts: ModelFacts): PrintIssue[] {
  const issues: PrintIssue[] = [];
  const { bboxMm, analysis, declaredUnit } = facts;
  const longest = Math.max(bboxMm.x, bboxMm.y, bboxMm.z);

  if (longest > 0 && (longest < 3 || longest > 1000)) {
    // Re-read the raw numbers under each unit a CAD export might have used,
    // and offer the ones that land on a sensible part size.
    const raw = longest / UNIT_TO_MM[declaredUnit];
    const guesses = (
      [
        ["mm", 1],
        ["cm", 10],
        ["inches", 25.4],
        ["metres", 1000],
      ] as const
    )
      .map(([label, f]) => ({ label, mm: raw * f }))
      .filter((g) => g.mm >= 5 && g.mm <= 400);
    issues.push({
      code: "unit_suspect",
      severity: "warning",
      message: `Longest side is ${fmt(longest)} mm with the unit set to ${declaredUnit}${
        longest < 3 ? ", smaller than a grain of rice" : ", bigger than any print bed"
      }.`,
      fix: guesses.length
        ? `Check the unit. As ${guesses.map((g) => `${g.label} it would be ${fmt(g.mm)} mm`).join(", or ")}. Re-register the file with the right fileUnit before quoting.`
        : "Check the unit the file was exported in and re-register it with the right fileUnit before quoting.",
    });
  }

  if (!analysis) return issues;

  if (analysis.triangleCount === 0) {
    issues.push({
      code: "empty_mesh",
      severity: "blocker",
      message: "The file has no triangles.",
      fix: "Re-export the model as a solid mesh (STL, 3MF or OBJ).",
    });
    return issues;
  }

  const t = analysis.topology;
  if (t && t.openEdges > 0) {
    issues.push({
      code: "not_watertight",
      severity: "blocker",
      message: `The surface has holes (${t.openEdges} open edges), so there is no inside to fill with material.`,
      fix: "Close the holes: run a mesh repair (Meshmixer, Netfabb, Blender 3D-Print Toolbox) or fix the gaps in CAD, then re-export.",
    });
  }
  if (t && t.nonManifoldEdges > 0) {
    issues.push({
      code: "non_manifold",
      severity: "blocker",
      message: `${t.nonManifoldEdges} edges are shared by three or more faces, which usually means overlapping or touching bodies.`,
      fix: "Union the overlapping bodies into one solid (boolean union) before export.",
    });
  }
  if (t && t.shells > 1) {
    issues.push({
      code: "multiple_shells",
      severity: "warning",
      message: `The file holds ${t.shells} separate pieces. They print as loose parts, and tiny ones can fall off the build plate or powder bed.`,
      fix: "If it is one part, join the pieces. If it is an assembly, order the parts as separate files so each is quoted and checked on its own.",
    });
  }
  if (analysis.invertedNormals) {
    issues.push({
      code: "inverted_normals",
      severity: "warning",
      message: "The triangles face inward, so slicers can read the part as hollow space.",
      fix: "Flip normals (Meshmixer: Analysis > Inspector, or Blender: Mesh > Normals > Flip) and re-export.",
    });
  }
  if (analysis.degenerateTriangles > 0) {
    issues.push({
      code: "degenerate_triangles",
      severity: "info",
      message: `${analysis.degenerateTriangles} triangles have no area.`,
      fix: "Usually harmless. A mesh repair pass removes them.",
    });
  }
  if (analysis.triangleCount > 2_000_000) {
    issues.push({
      code: "heavy_mesh",
      severity: "info",
      message: `The mesh has ${(analysis.triangleCount / 1e6).toFixed(1)} million triangles, which slows quoting and may be rejected by a vendor.`,
      fix: "Decimate the mesh. Under 500k triangles loses nothing visible on a printed part.",
    });
  }
  if (!t && analysis.triangleCount > 0) {
    issues.push({
      code: "topology_skipped",
      severity: "info",
      message: "The mesh is too large for the hole and loose-piece check, so only size and volume were checked.",
      fix: "Decimate the mesh and check again if you suspect holes.",
    });
  }
  return issues;
}

/**
 * Verdict per material. `verdict` is the WORST thing found for that
 * material: `no` means it cannot be made as modelled, `risky` means it
 * probably can with a design change or a vendor's say-so.
 */
export function assessMaterials(
  facts: ModelFacts,
  materials: readonly MaterialMetadata[] = MATERIALS
): MaterialFit[] {
  const { bboxMm, analysis } = facts;
  const dims = [bboxMm.x, bboxMm.y, bboxMm.z] as const;
  const thinnestSide = Math.min(...dims);
  const thickness = analysis?.meanThicknessMm ?? null;

  return materials.map((m) => {
    const reasons: string[] = [];
    let verdict: Verdict = "good";
    const worsen = (v: Verdict) => {
      if (v === "no" || verdict === "no") verdict = "no";
      else verdict = "risky";
    };

    const c = m.constraints;
    const volume = [c.maxDimensions.x, c.maxDimensions.y, c.maxDimensions.z] as const;
    if (!modelFitsInVolume(dims, volume)) {
      worsen("no");
      reasons.push(
        `Too big: needs ${dims.map(fmt).join(" x ")} mm, the largest ${m.method} build is ${volume.join(" x ")} mm (any orientation).`
      );
    }
    if (thinnestSide > 0 && thinnestSide < c.minWallThickness * 0.5) {
      worsen("no");
      reasons.push(
        `Too thin: the part is ${fmt(thinnestSide)} mm on its smallest side and ${m.method} needs about ${c.minWallThickness} mm.`
      );
    } else if (thinnestSide > 0 && thinnestSide < c.minWallThickness) {
      worsen("risky");
      reasons.push(
        `Borderline thin: ${fmt(thinnestSide)} mm on its smallest side against a ${c.minWallThickness} mm minimum for ${m.method}.`
      );
    }
    if (thickness !== null && thickness < c.minWallThickness) {
      worsen("risky");
      reasons.push(
        `Walls look thin: average thickness is about ${fmt(thickness)} mm (an estimate) against ${c.minWallThickness} mm needed. Thicken thin ribs and shells, or pick a finer process.`
      );
    }
    if (!reasons.length) reasons.push("Fits the build volume and the wall minimum.");

    return {
      materialId: m.id,
      name: m.name,
      method: m.method,
      verdict,
      reasons,
    };
  });
}

/** Short, process-specific design advice, only for processes in play. */
export const METHOD_TIPS: Record<PrintingMethod, string> = {
  FDM: "Layer lines make parts weaker across layers, so orient load along the layers. Overhangs past 45 degrees need supports that leave marks; chamfer them instead. Make holes 0.2 mm bigger than the pin they take.",
  SLS: "No supports needed, so interior and interlocking geometry works. Hollow parts need two or more escape holes of 4 mm or more for powder. Surfaces are slightly grainy; sharp edges under 0.5 mm round off.",
  MJF: "Like SLS: no supports, hollow parts need escape holes of 4 mm or more. Strong and uniform in every direction, grey as printed.",
  SLA: "Finest detail but brittle. Hollow parts need drain holes of 3 mm or more or the resin stays trapped. Supports leave small marks on the underside; keep show faces upright.",
  DLP: "Like SLA: finest detail, brittle, needs drain holes in hollow parts.",
  DMLS: "Metal prints need supports and stress relief, so design out overhangs where you can. Keep holes over 1 mm and expect to machine any surface that must be accurate.",
  "Binder Jetting":
    "Fragile before sintering and shrinks while it fires. Keep walls generous and avoid long thin spans.",
};

export function tipsFor(fits: readonly MaterialFit[]): Array<{
  method: PrintingMethod;
  tip: string;
}> {
  const methods = new Set(
    fits.filter((f) => f.verdict !== "no").map((f) => f.method)
  );
  return [...methods].map((method) => ({ method, tip: METHOD_TIPS[method] }));
}
