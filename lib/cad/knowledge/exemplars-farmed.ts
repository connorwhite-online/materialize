/**
 * GENERATED CATALOG — managed by scripts/exemplar-farm/promote.ts.
 *
 * Farmed exemplars: candidates produced by the offline exemplar farm
 * (scripts/exemplar-farm/farm.ts — best-of-N generation → VLM judge →
 * refinement → sidecar verification), then HUMAN-approved via promote.ts.
 * `verified: true` remains a human signature by policy: promote.ts re-runs
 * the source through the sidecar at promotion time and a person has looked
 * at the render before an entry lands here.
 *
 * Do not hand-edit entries in place — re-farm or promote a revised
 * generation (promote.ts --from-generation) so provenance stays honest.
 * Hand-DELETING a stale entry is fine.
 */
import type { CadExemplar } from "./exemplars";

export const FARMED_EXEMPLARS: CadExemplar[] = [
  // promote.ts appends entries here.
];
