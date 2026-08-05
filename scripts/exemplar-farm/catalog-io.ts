/**
 * Pure helpers shared by farm.ts / promote.ts and their tests: the farmed
 * candidate shape, catalog-file serialization, and the authored-id collision
 * guard. Kept dependency-free so vitest can cover them without a sidecar or
 * model credentials.
 */
import type { CadExemplar } from "../../lib/cad/knowledge/exemplars";

export interface FarmCandidate {
  /** `farm_<class id>` — never collides with authored ids by construction. */
  id: string;
  title: string;
  keywords: string[];
  /** The bank prompt that produced it (provenance, kept in the JSON only). */
  prompt: string;
  lesson: string;
  code: string;
  score: number;
  perDimension: Record<string, number>;
  farmedAt: string;
}

/** Entries whose ids collide with the authored catalog (must be empty). */
export function authoredCollisions(
  candidates: Pick<FarmCandidate, "id">[],
  authoredIds: string[]
): string[] {
  const authored = new Set(authoredIds);
  return candidates.map((c) => c.id).filter((id) => authored.has(id));
}

/** Upsert candidates into the farmed pool (id-keyed; promote = replace). */
export function upsertFarmed(
  existing: CadExemplar[],
  incoming: CadExemplar[]
): CadExemplar[] {
  const out = [...existing];
  for (const entry of incoming) {
    const i = out.findIndex((e) => e.id === entry.id);
    if (i >= 0) out[i] = entry;
    else out.push(entry);
  }
  return out;
}

/**
 * Render the whole generated catalog module. JSON.stringify for every string
 * (incl. multi-line code) — less pretty than template literals but immune to
 * escaping bugs; the file is generated, not read for pleasure.
 */
export function serializeFarmedCatalog(entries: CadExemplar[]): string {
  const body = entries
    .map((e) =>
      [
        "  {",
        `    id: ${JSON.stringify(e.id)},`,
        `    title: ${JSON.stringify(e.title)},`,
        `    keywords: ${JSON.stringify(e.keywords)},`,
        `    lesson: ${JSON.stringify(e.lesson)},`,
        `    code: ${JSON.stringify(e.code)},`,
        `    verified: ${e.verified},`,
        "  },",
      ].join("\n")
    )
    .join("\n");
  return `/**
 * GENERATED CATALOG — managed by scripts/exemplar-farm/promote.ts.
 *
 * Farmed exemplars: candidates produced by the offline exemplar farm
 * (scripts/exemplar-farm/farm.ts — best-of-N generation → VLM judge →
 * refinement → sidecar verification), then HUMAN-approved via promote.ts.
 * \`verified: true\` remains a human signature by policy: promote.ts re-runs
 * the source through the sidecar at promotion time and a person has looked
 * at the render before an entry lands here.
 *
 * Do not hand-edit entries in place — re-farm or promote a revised
 * generation (promote.ts --from-generation) so provenance stays honest.
 * Hand-DELETING a stale entry is fine.
 */
import type { CadExemplar } from "./exemplars";

export const FARMED_EXEMPLARS: CadExemplar[] = [
${body}${entries.length ? "\n" : "  // promote.ts appends entries here.\n"}];
`;
}
