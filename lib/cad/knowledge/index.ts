/**
 * Knowledge retrieval for the text-to-CAD harness. Pure (no `server-only`) so
 * both the harness and the eval runner can use it. Assembles a compact
 * design-knowledge block per request:
 *
 *   - Aesthetics directives — always (universal).
 *   - Repair playbook — always (universal build-order/overshoot discipline).
 *   - Process DFM — the target process if known, else the conservative
 *     multi-process envelope (generation can precede material choice).
 *   - Fastener tables — only when the prompt references metric screw sizes.
 *   - bd_warehouse standard-parts rules — only when the prompt references
 *     fasteners/bearings/inserts (never hand-model a standard part; MTR-200).
 *   - Ergonomic defaults — only when the prompt implies a human-held part.
 *   - Enclosure recipe — only when the prompt is enclosure-shaped (the
 *     drape-and-split default + closure patterns, MTR-192).
 *
 * Keeping it conditional keeps each prompt focused (the more you cram in, the
 * less weight any one rule carries).
 */
import { AESTHETICS_RULES } from "./aesthetics";
import {
  MULTI_PROCESS_SAFE,
  PROCESS_DFM,
  formatProcessDfm,
  type CadProcess,
} from "./dfm";
import { fastenersInPrompt, formatFasteners } from "./fasteners";
import { BD_WAREHOUSE_RULES, needsStandardParts } from "./bd-warehouse";
import { ERGONOMIC_RULES, needsErgonomics } from "./ergonomics";
import { REPAIR_PLAYBOOK_RULES } from "./repair-playbook";
import { ENCLOSURE_RECIPE_RULES, needsEnclosureRecipe } from "./enclosure-recipe";

export interface KnowledgeContext {
  prompt: string;
  /** Target CraftCloud process if known at generation time. */
  process?: CadProcess | null;
}

export function buildKnowledgeBlock({
  prompt,
  process,
}: KnowledgeContext): string {
  const sections: string[] = [AESTHETICS_RULES, REPAIR_PLAYBOOK_RULES];

  sections.push(
    formatProcessDfm(process ? PROCESS_DFM[process] : MULTI_PROCESS_SAFE)
  );

  const fasteners = fastenersInPrompt(prompt);
  if (fasteners.length > 0) sections.push(formatFasteners(fasteners));

  // Standard parts (MTR-200): whenever fasteners/bearings/inserts are in play,
  // teach the bd_warehouse constructors so none of them get hand-modeled.
  if (fasteners.length > 0 || needsStandardParts(prompt)) {
    sections.push(BD_WAREHOUSE_RULES);
  }

  if (needsErgonomics(prompt)) sections.push(ERGONOMIC_RULES);

  if (needsEnclosureRecipe(prompt)) sections.push(ENCLOSURE_RECIPE_RULES);

  return sections.join("\n\n");
}

export { type CadProcess } from "./dfm";
