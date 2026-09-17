import {
  buildSystemPrompt,
  selectSystemPromptSections,
  PLAN_SYSTEM_PROMPT,
} from "../prompt";
import { BREP_OUTPUT_FORMATS } from "../types";
import { buildSdfSystemPrompt, SDF_PLAN_PROMPT } from "./sdf-prompt";
import type { CadEngineId, CadEngineProfile } from "./types";

export {
  CAD_ENGINE_IDS,
  isCadEngineId,
  type CadEngineId,
  type CadEngineProfile,
} from "./types";

/**
 * Engine registry. The harness takes a profile instead of hardcoding
 * build123d at three points (system prompt, exemplar pool, sidecar call);
 * everything else in the loop is shared.
 *
 * BREP is byte-identical to the pre-registry behaviour — same assembled
 * prompt, same formats, same sidecar engine — so routing that does not ask
 * for an engine behaves exactly as before.
 */

const BREP: CadEngineProfile = {
  id: "brep",
  label: "build123d (B-rep)",
  sidecarEngine: "build123d",
  outputFormats: BREP_OUTPUT_FORMATS,
  systemPrompt: (prompt) =>
    buildSystemPrompt(selectSystemPromptSections(prompt)),
  planPrompt: PLAN_SYSTEM_PROMPT,
  storedEngine: "build123d",
  producesBrep: true,
};

const SDF: CadEngineProfile = {
  id: "sdf",
  label: "sdf_kit (implicit)",
  // The sidecar's "mesh" engine skips the OpenCASCADE warm import entirely
  // and requires `result` to be a trimesh — which is the contract the SDF
  // prompt writes to, and the reason an SDF run cannot fail inside OCCT.
  sidecarEngine: "mesh",
  // No STEP and no topo: mesh mode has no B-rep to export either from.
  outputFormats: ["stl"],
  systemPrompt: buildSdfSystemPrompt,
  planPrompt: SDF_PLAN_PROMPT,
  storedEngine: "sdf_kit",
  producesBrep: false,
};

const ENGINES: Record<CadEngineId, CadEngineProfile> = { brep: BREP, sdf: SDF };

/** The engine used when a caller does not choose one. */
export const DEFAULT_CAD_ENGINE: CadEngineId = "brep";

/** Profile for an engine id, falling back to the default for anything else. */
export function engineFor(id?: CadEngineId | null): CadEngineProfile {
  return ENGINES[id ?? DEFAULT_CAD_ENGINE] ?? ENGINES[DEFAULT_CAD_ENGINE];
}

/** Every profile, for the benchmark and the studio toggle. */
export function allEngines(): CadEngineProfile[] {
  return [BREP, SDF];
}
