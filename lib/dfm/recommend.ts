/**
 * Material shortlist from what the part has to do. Pure.
 *
 * It ranks the curated library (`lib/materials`), not the live CraftCloud
 * catalog: the curated rows carry the 1-5 strength / flexibility / detail /
 * heat scores and the process limits that the live catalog doesn't
 * (the live one has raw MPa and no ratings). The caller maps each pick to a
 * CraftCloud material id for quoting.
 *
 * Hard requirements filter; soft ones rank. A shortlist with nothing in it
 * says which requirement emptied it, so the agent can relax the right one
 * instead of guessing.
 */
import { MATERIALS, type MaterialMetadata } from "@/lib/materials/preset-library";
import type { MaterialFit } from "./printability";

export type Score = 1 | 2 | 3 | 4 | 5;
export type PriceTier = MaterialMetadata["priceRange"];

export interface Needs {
  strength?: Score;
  flexibility?: Score;
  detail?: Score;
  heatResistance?: Score;
}

export type UseCase =
  | "prototype"
  | "functional"
  | "display"
  | "outdoor"
  | "flexible"
  | "high_temp"
  | "miniature";

/** What each use case implies when the caller didn't spell out the numbers. */
export const USE_CASE_NEEDS: Record<UseCase, Needs & { maxPrice?: PriceTier }> = {
  prototype: { maxPrice: "budget" },
  functional: { strength: 3 },
  display: { detail: 4 },
  outdoor: { strength: 3, heatResistance: 3 },
  flexible: { flexibility: 4 },
  high_temp: { heatResistance: 4 },
  miniature: { detail: 4 },
};

export type Prefer = "cheapest" | "strongest" | "most_detail" | "most_flexible" | "most_heat_resistant";

export interface RecommendInput {
  useCase?: UseCase;
  needs?: Needs;
  maxPrice?: PriceTier;
  category?: MaterialMetadata["category"];
  prefer?: Prefer;
  /** Per-material fit for the actual part; `no` materials are ruled out. */
  fits?: readonly MaterialFit[];
  limit?: number;
}

export interface MaterialPick {
  materialId: string;
  name: string;
  method: MaterialMetadata["method"];
  category: MaterialMetadata["category"];
  priceTier: PriceTier;
  scores: MaterialMetadata["properties"];
  /** The catalog's one-paragraph description, for people (the widget). */
  summary: string;
  why: string[];
  watchOut: string[];
  /** Set when a `fits` verdict was passed: how it fares on this part. */
  fit?: { verdict: MaterialFit["verdict"]; reasons: string[] };
}

export interface RuledOut {
  name: string;
  reason: string;
}

const TIER_RANK: Record<PriceTier, number> = { budget: 0, mid: 1, premium: 2 };
const AXES = [
  ["strength", "strong"],
  ["flexibility", "flexible"],
  ["detail", "fine detail"],
  ["heatResistance", "heat resistant"],
] as const;
const PREFER_AXIS: Partial<Record<Prefer, keyof MaterialMetadata["properties"]>> = {
  strongest: "strength",
  most_detail: "detail",
  most_flexible: "flexibility",
  most_heat_resistant: "heatResistance",
};

/** Colour variants share every number, so list one of each. */
function distinctMaterials(): MaterialMetadata[] {
  const seen = new Set<string>();
  return MATERIALS.filter((m) => {
    const key = JSON.stringify([m.method, m.category, m.properties, m.constraints, m.priceRange, m.name.replace(/\s+(White|Black)$/i, "")]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function recommendMaterials(input: RecommendInput): {
  picks: MaterialPick[];
  ruledOut: RuledOut[];
  applied: Needs & { maxPrice?: PriceTier; category?: string };
} {
  const preset = input.useCase ? USE_CASE_NEEDS[input.useCase] : {};
  const needs: Needs = { ...preset, ...input.needs };
  delete (needs as { maxPrice?: unknown }).maxPrice;
  const maxPrice = input.maxPrice ?? preset.maxPrice;
  const fitById = new Map((input.fits ?? []).map((f) => [f.materialId, f]));

  const picks: Array<MaterialPick & { score: number }> = [];
  const ruledOut: RuledOut[] = [];

  for (const m of distinctMaterials()) {
    const fail = (reason: string) => ruledOut.push({ name: m.name, reason });

    if (input.category && m.category !== input.category) {
      fail(`Not in the ${input.category} family.`);
      continue;
    }
    if (maxPrice && TIER_RANK[m.priceRange] > TIER_RANK[maxPrice]) {
      fail(`${m.priceRange} price tier, over your ${maxPrice} limit.`);
      continue;
    }
    const short = AXES.filter(
      ([k]) => needs[k] !== undefined && m.properties[k] < (needs[k] as number)
    );
    if (short.length) {
      fail(
        short
          .map(([k, label]) => `${label} ${m.properties[k]}/5, needs ${needs[k]}`)
          .join("; ")
      );
      continue;
    }
    const fit = fitById.get(m.id);
    if (fit?.verdict === "no") {
      fail(fit.reasons.join(" "));
      continue;
    }

    // Rank: how far past each stated need, a bump for the preferred axis,
    // and a small pull toward cheaper when nothing else separates them.
    let score = 0;
    for (const [k] of AXES) {
      const need = needs[k];
      if (need !== undefined) score += 1 + 0.25 * (m.properties[k] - need);
    }
    const axis = input.prefer ? PREFER_AXIS[input.prefer] : undefined;
    if (axis) score += 2 * m.properties[axis];
    const cheapWeight = input.prefer === "cheapest" ? 3 : 0.5;
    score += cheapWeight * (2 - TIER_RANK[m.priceRange]);
    if (fit?.verdict === "risky") score -= 1.5;

    const why = AXES.filter(([k]) => m.properties[k] >= 4).map(
      ([k, label]) => `${label} (${m.properties[k]}/5)`
    );
    const watchOut = AXES.filter(([k]) => m.properties[k] <= 1 && k !== "flexibility")
      .map(([k, label]) => `low ${label} (${m.properties[k]}/5)`);
    if (m.properties.flexibility <= 1 && (needs.flexibility ?? 0) === 0) {
      watchOut.push("rigid: cracks rather than bends");
    }

    picks.push({
      score,
      materialId: m.id,
      name: m.name.replace(/\s+(White|Black)$/i, ""),
      method: m.method,
      category: m.category,
      priceTier: m.priceRange,
      scores: m.properties,
      summary: m.description,
      why: why.length ? why : ["a balanced all-rounder"],
      watchOut,
      ...(fit ? { fit: { verdict: fit.verdict, reasons: fit.reasons } } : {}),
    });
  }

  picks.sort((a, b) => b.score - a.score || TIER_RANK[a.priceTier] - TIER_RANK[b.priceTier]);
  return {
    picks: picks.slice(0, input.limit ?? 5).map((p) => stripScore(p)),
    ruledOut: ruledOut.slice(0, 12),
    applied: { ...needs, ...(maxPrice ? { maxPrice } : {}), ...(input.category ? { category: input.category } : {}) },
  };
}

function stripScore(p: MaterialPick & { score: number }): MaterialPick {
  const copy: Partial<typeof p> = { ...p };
  delete copy.score;
  return copy as MaterialPick;
}
