import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { getObjectBytes } from "@/lib/storage";
import {
  parseMeshTriangles,
  type MeshFormat,
} from "@/lib/hashing/mesh-fingerprint";
import {
  analyzeTriangles,
  sampleWallThickness,
  type MeshAnalysis,
  type WallSample,
} from "@/lib/dfm/mesh-analysis";
import {
  processLimits,
  withCatalogLimits,
  type CatalogMaterialLimits,
  type MaterialWithLimits,
} from "@/lib/dfm/limits";
import {
  assessIssues,
  assessMaterials,
  assessProcesses,
  tipsFor,
  type MaterialFit,
  type ProcessFit,
  type ModelFacts,
  type PrintIssue,
} from "@/lib/dfm/printability";
import {
  recommendMaterials,
  type MaterialPick,
  type Needs,
  type Prefer,
  type PriceTier,
  type UseCase,
  type RuledOut,
} from "@/lib/dfm/recommend";
import { MATERIALS } from "@/lib/materials/preset-library";
import { matchCraftCloudMaterialId } from "@/lib/materials/craftcloud-resolver";
import { getCraftCloudCatalog } from "@/lib/craftcloud/catalog";
import { logError } from "@/lib/logger";

interface LoadedModel {
  facts: ModelFacts;
  filename: string;
  /** How much of the check could run on this file. */
  coverage: "mesh" | "bounding-box" | "none";
}

/**
 * Same access rule as quoting: the owner, or anyone for a published file.
 * Reads the model bytes from R2 and parses them in-process. STEP and AMF
 * aren't parsed server-side, so those fall back to the bounding box we
 * stored at upload, which still answers "does it fit".
 */
async function loadModel(
  userId: string,
  fileAssetId: string
): Promise<LoadedModel | { error: string }> {
  const [row] = await db
    .select({
      asset: fileAssets,
      ownerId: files.userId,
      fileStatus: files.status,
    })
    .from(fileAssets)
    .innerJoin(files, eq(fileAssets.fileId, files.id))
    .where(eq(fileAssets.id, fileAssetId))
    .limit(1);

  if (!row) return { error: "File not found" };
  if (row.ownerId !== userId && row.fileStatus !== "published") {
    return { error: "Forbidden" };
  }

  const { asset } = row;
  const unit = asset.fileUnit as "mm" | "cm" | "in";
  let analysis: MeshAnalysis | null = null;
  let wall: WallSample | null = null;
  try {
    const bytes = await getObjectBytes(asset.storageKey);
    const triangles = parseMeshTriangles(bytes, asset.format as MeshFormat);
    if (triangles) {
      analysis = analyzeTriangles(triangles, unit);
      const closed =
        analysis.topology !== null &&
        analysis.topology.openEdges === 0 &&
        analysis.topology.nonManifoldEdges === 0;
      if (closed) {
        wall = sampleWallThickness(triangles, unit, analysis.invertedNormals);
      }
    }
  } catch (err) {
    logError("mcp.printability.load", err);
  }

  if (analysis) {
    return {
      facts: { bboxMm: analysis.bboxMm, analysis, wall, declaredUnit: unit },
      filename: asset.originalFilename,
      coverage: "mesh",
    };
  }

  const stored = asset.geometryData?.dimensions;
  if (stored) {
    return {
      facts: { bboxMm: stored, analysis: null, declaredUnit: unit },
      filename: asset.originalFilename,
      coverage: "bounding-box",
    };
  }
  return {
    facts: { bboxMm: { x: 0, y: 0, z: 0 }, analysis: null, declaredUnit: unit },
    filename: asset.originalFilename,
    coverage: "none",
  };
}


/**
 * CraftCloud's limits for every printing process and for each curated
 * material, or the editorial numbers when the catalog can't be reached.
 */
async function catalogLimits(): Promise<{
  materials: MaterialWithLimits[];
  processes: ReturnType<typeof processLimits>;
  fromCatalog: boolean;
}> {
  try {
    const catalog = await getCraftCloudCatalog();
    const list = Array.from(catalog.materialById.values());
    const lookup = (presetId: string): CatalogMaterialLimits | null => {
      const id = matchCraftCloudMaterialId(
        presetId,
        list.map((m) => ({ id: m.id, name: m.name }))
      );
      return id ? (catalog.materialById.get(id) ?? null) : null;
    };
    const processes = processLimits(list);
    return {
      materials: withCatalogLimits(MATERIALS, lookup, processes),
      processes,
      fromCatalog: true,
    };
  } catch (err) {
    logError("mcp.printability.catalog", err);
    return {
      materials: withCatalogLimits(MATERIALS, () => null),
      processes: [],
      fromCatalog: false,
    };
  }
}

const round = (n: number, d = 2) => Number(n.toFixed(d));

export interface PrintabilityResult {
  file: { name: string; checked: LoadedModel["coverage"] };
  geometry: {
    sizeMm: { x: number; y: number; z: number };
    volumeCm3: number | null;
    surfaceAreaCm2: number | null;
    triangles: number | null;
    watertight: boolean | null;
    shells: number | null;
    /** Measured inward from sampled surface points. Null when not measurable. */
    wallThickness: {
      method: "ray-cast";
      samplesMeasured: number;
      thinnestMm: number;
      thinEndMm: number;
      medianMm: number;
    } | null;
    /** Volume over surface area: a rough average, used only without a measurement. */
    averageThicknessMm: number | null;
  };
  issues: PrintIssue[];
  /** True when nothing blocks an order: no `blocker` issues. */
  printable: boolean;
  /** Per CraftCloud process, judged on CraftCloud's own limits. */
  processes: ProcessFit[];
  materials: MaterialFit[];
  bestFits: MaterialPick[];
  designTips: Array<{ method: string; tip: string }>;
  notes: string[];
}

export async function checkPrintabilityForUser(input: {
  userId: string;
  fileAssetId: string;
}): Promise<PrintabilityResult | { error: string }> {
  const loaded = await loadModel(input.userId, input.fileAssetId);
  if ("error" in loaded) return loaded;
  const { facts, coverage } = loaded;
  const a = facts.analysis;

  if (coverage === "none") {
    return {
      error:
        "This file can't be measured yet (STEP and AMF files are checked from their size once processing finishes). Try again in a few seconds, or upload an STL, 3MF or OBJ for a full check.",
    };
  }

  const limits = await catalogLimits();
  const issues = assessIssues(facts);
  const materials = assessMaterials(facts, limits.materials);
  const processes = assessProcesses(facts, limits.processes);
  const notes = [
    limits.fromCatalog
      ? "Minimum walls, minimum detail and largest builds are CraftCloud's published figures for each process. A vendor can still reject a part."
      : "CraftCloud's catalog was unreachable, so limits are our own conservative figures.",
  ];
  if (coverage === "bounding-box") {
    notes.push(
      "Only the size was checked: this format isn't read for holes or wall thickness. Upload an STL, 3MF or OBJ for the full check."
    );
  }
  if (facts.wall) {
    notes.push(
      `Wall thickness was measured at ${facts.wall.samples} points spread over the surface. A feature thinner than the spacing between points can be missed, so a clean result is strong evidence rather than proof.`
    );
  } else if (a?.meanThicknessMm != null) {
    notes.push(
      "The mesh was too large to measure walls directly, so thickness is a rough average from volume and surface area. A low number is a real warning; a high one doesn't prove every wall is thick enough."
    );
  } else if (a) {
    notes.push(
      "Walls weren't measured because the mesh isn't closed. Fix the holes and check again."
    );
  }

  return {
    file: { name: loaded.filename, checked: coverage },
    geometry: {
      sizeMm: {
        x: round(facts.bboxMm.x),
        y: round(facts.bboxMm.y),
        z: round(facts.bboxMm.z),
      },
      volumeCm3: a ? round(a.volumeMm3 / 1000) : null,
      surfaceAreaCm2: a ? round(a.surfaceAreaMm2 / 100) : null,
      triangles: a?.triangleCount ?? null,
      watertight: a?.topology
        ? a.topology.openEdges === 0 && a.topology.nonManifoldEdges === 0
        : null,
      shells: a?.topology?.shells ?? null,
      wallThickness: facts.wall
        ? {
            method: "ray-cast",
            samplesMeasured: facts.wall.samples,
            thinnestMm: round(facts.wall.minMm),
            thinEndMm: round(facts.wall.thinMm),
            medianMm: round(facts.wall.medianMm),
          }
        : null,
      averageThicknessMm:
        a?.meanThicknessMm != null ? round(a.meanThicknessMm) : null,
    },
    issues,
    printable: !issues.some((i) => i.severity === "blocker"),
    processes,
    materials,
    bestFits: recommendMaterials({ fits: materials, limit: 3 }).picks,
    designTips: tipsFor(materials),
    notes,
  };
}

export interface RecommendInputForUser {
  userId: string;
  useCase?: UseCase;
  needs?: Needs;
  maxPrice?: PriceTier;
  category?: (typeof MATERIALS)[number]["category"];
  prefer?: Prefer;
  fileAssetId?: string;
  limit?: number;
}

export interface RecommendResult {
  picks: Array<MaterialPick & { craftCloudMaterialId: string | null }>;
  ruledOut: RuledOut[];
  applied: ReturnType<typeof recommendMaterials>["applied"];
  basedOnFile: string | null;
  notes: string[];
}

export async function recommendMaterialsForUser(
  input: RecommendInputForUser
): Promise<RecommendResult | { error: string }> {
  let fits: MaterialFit[] | undefined;
  let basedOnFile: string | null = null;
  const notes: string[] = [];

  if (input.fileAssetId) {
    const loaded = await loadModel(input.userId, input.fileAssetId);
    if ("error" in loaded) return loaded;
    if (loaded.coverage === "none") {
      notes.push(
        "The file couldn't be measured yet, so the shortlist ignores its size."
      );
    } else {
      fits = assessMaterials(loaded.facts, (await catalogLimits()).materials);
      basedOnFile = loaded.filename;
    }
  }

  const result = recommendMaterials({ ...input, fits });

  // Map each pick to the live catalog so the agent can pass it straight to
  // materialize_get_quote. A null means no confident match: say so rather
  // than guess, and the agent can browse materialize_list_materials.
  let catalogMaterials: Array<{ id: string; name: string }> = [];
  try {
    const catalog = await getCraftCloudCatalog();
    catalogMaterials = Array.from(catalog.materialById.values()).map((m) => ({
      id: m.id,
      name: m.name,
    }));
  } catch (err) {
    logError("mcp.recommend.catalog", err);
    notes.push(
      "The live catalog was unavailable, so picks carry no materialId. Use materialize_list_materials to find them."
    );
  }

  if (!result.picks.length) {
    notes.push(
      "Nothing met every requirement. ruledOut says which requirement removed each material; relax the one that removes the most."
    );
  }
  notes.push(
    "Scores are 1-5 editorial ratings of each material family, not lab measurements. materialize_get_material has the measured figures."
  );

  return {
    picks: result.picks.map((p) => ({
      ...p,
      craftCloudMaterialId: matchCraftCloudMaterialId(
        p.materialId,
        catalogMaterials
      ),
    })),
    ruledOut: result.ruledOut,
    applied: result.applied,
    basedOnFile,
    notes,
  };
}
