import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { fileAssets, files } from "@/lib/db/schema";
import { getObjectBytes } from "@/lib/storage";
import {
  parseMeshTriangles,
  type MeshFormat,
} from "@/lib/hashing/mesh-fingerprint";
import { analyzeTriangles, type MeshAnalysis } from "@/lib/dfm/mesh-analysis";
import {
  assessIssues,
  assessMaterials,
  tipsFor,
  type MaterialFit,
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
  try {
    const bytes = await getObjectBytes(asset.storageKey);
    const triangles = parseMeshTriangles(bytes, asset.format as MeshFormat);
    if (triangles) analysis = analyzeTriangles(triangles, unit);
  } catch (err) {
    logError("mcp.printability.load", err);
  }

  if (analysis) {
    return {
      facts: { bboxMm: analysis.bboxMm, analysis, declaredUnit: unit },
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
    estimatedWallThicknessMm: number | null;
  };
  issues: PrintIssue[];
  /** True when nothing blocks an order: no `blocker` issues. */
  printable: boolean;
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

  const issues = assessIssues(facts);
  const materials = assessMaterials(facts);
  const notes = [
    "Size limits and minimum walls are process-wide envelopes, not a promise from any one vendor. Final acceptance is the vendor's.",
  ];
  if (coverage === "bounding-box") {
    notes.push(
      "Only the size was checked: this format isn't read for holes or wall thickness. Upload an STL, 3MF or OBJ for the full check."
    );
  }
  if (a?.meanThicknessMm != null) {
    notes.push(
      "Wall thickness is an estimate from volume and surface area. A low number is a real warning; a high one doesn't prove every wall is thick enough."
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
      estimatedWallThicknessMm:
        a?.meanThicknessMm != null ? round(a.meanThicknessMm) : null,
    },
    issues,
    printable: !issues.some((i) => i.severity === "blocker"),
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
      fits = assessMaterials(loaded.facts);
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
