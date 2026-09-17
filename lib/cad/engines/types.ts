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
 * Everything that differs between engines, in one object. The harness loop —
 * brief, concept, plan, repair, judge, dimension checks, persistence — is
 * shared and reads this profile at the three points where it would otherwise
 * hardcode build123d.
 */
export interface CadEngineProfile {
  id: CadEngineId;
  /** Human label for the studio toggle and benchmark output. */
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
