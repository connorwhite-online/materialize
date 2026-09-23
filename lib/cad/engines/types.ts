import type { CadOutputFormat } from "../types";

/**
 * Geometry engines the harness can run a generation on.
 *
 * "brep"  — build123d on the OpenCASCADE kernel. Crisp faces and edges,
 *           exports STEP, carries topology for exact viewer picking.
 * "sdf"   — implicit fields meshed with marching cubes, with exact features
 *           booleaned in via manifold3d. No kernel, no STEP.
 *
 * This is a COMPARISON, not a permanent dual stack (see
 * docs/text-to-cad/11). Everything engine-specific is reachable from
 * ./index, so retiring the loser is a bounded deletion rather than an
 * archaeology exercise.
 */
export type CadEngineId = "brep" | "sdf";

export const CAD_ENGINE_IDS: CadEngineId[] = ["brep", "sdf"];

export function isCadEngineId(value: unknown): value is CadEngineId {
  return typeof value === "string" && (CAD_ENGINE_IDS as string[]).includes(value);
}

/**
 * Display names, defined HERE rather than on the profile because this module
 * imports no prompt text.
 *
 * The client bake-off panel needs these labels, and reaching them through the
 * registry would drag ~33KB of build123d + SDF system prompts into the
 * browser bundle. It had its own hand-copied copy for exactly that reason,
 * which is the drift PR #279 names: two strings that happen to agree until
 * one side is edited. One definition, no prompt text, both sides read it.
 */
export const CAD_ENGINE_LABELS: Record<CadEngineId, string> = {
  brep: "build123d (B-rep)",
  sdf: "sdf_kit (implicit)",
};

/**
 * Engine id for a stored `cadGenerations.engine` value. Rows store the
 * dialect that ran ("build123d", "sdf_kit"), not the id. Anything that isn't
 * SDF (including legacy rows and null) is B-rep. The mapping lives here
 * rather than on the profiles so the client studio can use it without
 * importing the prompts.
 */
export function engineIdForStored(stored: string | null | undefined): CadEngineId {
  return stored === "sdf_kit" ? "sdf" : "brep";
}

/**
 * Everything that differs between engines, in one object. The harness loop —
 * brief, concept, plan, repair, judge, dimension checks, persistence — is
 * shared and reads this profile at the three points where it would otherwise
 * hardcode build123d.
 */
export interface CadEngineProfile {
  id: CadEngineId;
  /** Human label (from CAD_ENGINE_LABELS) for the toggle and benchmark. */
  label: string;
  /** Value sent as the sidecar's `engine` field. */
  sidecarEngine: "build123d" | "mesh";
  /** Formats requested from the sidecar on every run. */
  outputFormats: CadOutputFormat[];
  /**
   * Codegen/repair system prompt for a user prompt. MUST be deterministic:
   * same prompt in, same bytes out, computed once per job and reused across
   * every attempt so the cached prefix stays stable.
   */
  systemPrompt(prompt: string): string;
  /** Plan-step system prompt. */
  planPrompt: string;
  /**
   * Value persisted on `cadGenerations.engine`. Kept distinct from `id` so
   * the stored history stays readable as the dialect that ran
   * ("build123d"), which is what the column has always meant.
   */
  storedEngine: string;
  /** Can emit STEP and topology (exact face picking, feature chips). */
  producesBrep: boolean;
}
