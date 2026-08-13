import "server-only";

import { completeText, hasModelCredentials } from "./model-client";
import { modelForRole } from "./models";
import { logError } from "@/lib/logger";

/**
 * Concept-direction intelligence (the diverge/converge model of design
 * exploration). The v1 picker offered the same three preset styles on every
 * build — guaranteed spread, zero relevance to the object at hand. Now a
 * LIGHTWEIGHT model pass decides both:
 *
 *   - WHETHER a turn warrants concepting at all (classifyConceptPhase):
 *     fresh builds explore; form-changing revisions refine near the current
 *     target; detail edits (hole sizes, tolerances, add-a-port) skip —
 *     concept cards on a dimensional tweak are pure friction.
 *   - WHICH directions to offer (proposeConceptDirections): exploration
 *     spans the plausible design space OF THIS OBJECT (broad, genuinely
 *     different); refinement orbits the chosen direction (close variations,
 *     one quality varied each).
 *
 * The heavyweight machinery (flux/kontext renders, the picker card, judge
 * enforcement) only runs where the cheap router says it earns its cost —
 * intake stays light, generation stays heavy.
 *
 * Best-effort throughout: exploration falls back to the fixed presets
 * (spread beats nothing), refinement falls back to [] (keep the current
 * target rather than offer irrelevant presets), classification falls back
 * to "skip" (never add friction on a guess).
 */

export interface ConceptDirection {
  /** 2-3 word card label ("Soft minimal"). */
  label: string;
  /** Concrete form language, <= ~12 words. */
  detail: string;
}

/** Preset fallback — guaranteed spread when the proposal model is unavailable. */
export const FALLBACK_DIRECTIONS: ConceptDirection[] = [
  { label: "Soft minimal", detail: "gentle uniform radii, calm restrained surfaces" },
  { label: "Rugged industrial", detail: "chamfered edges, purposeful sturdy massing" },
  { label: "Sculptural", detail: "flowing blended masses, organic stance" },
];

export type ConceptPhase = "explore" | "refine" | "skip";

const EXPLORE_SYSTEM = `You are an industrial designer proposing aesthetic DIRECTIONS for a product concept.
For the requested object, propose exactly 3 GENUINELY DIFFERENT directions that span its plausible design space — each one viable, manufacturable, and appropriate to what the object is and where it lives. No gimmicks, no themes, no decoration-for-its-own-sake.
Output ONLY strict JSON (no fence, no commentary): [{"label":"2-3 words","detail":"concrete form language, <= 12 words"}, ...] — exactly 3 entries.`;

const REFINE_SYSTEM = `You are an industrial designer proposing CLOSE VARIATIONS of an established product direction.
The design direction is already chosen — propose exactly 3 variations that keep it clearly recognizable while each varying ONE quality (e.g. edge softness, stance, surface articulation, proportion). No pivots to a different aesthetic.
Output ONLY strict JSON (no fence, no commentary): [{"label":"2-3 words","detail":"concrete form language, <= 12 words"}, ...] — exactly 3 entries.`;

function parseDirections(text: string): ConceptDirection[] | null {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(raw)) return null;
    const out = raw
      .filter(
        (d): d is { label: string; detail: string } =>
          !!d &&
          typeof (d as { label?: unknown }).label === "string" &&
          typeof (d as { detail?: unknown }).detail === "string"
      )
      .map((d) => ({
        label: d.label.trim().slice(0, 40),
        detail: d.detail.trim().slice(0, 120),
      }))
      .filter((d) => d.label.length > 0);
    return out.length >= 2 ? out.slice(0, 3) : null;
  } catch {
    return null;
  }
}

/**
 * Directions for the picker. Exploration falls back to the presets;
 * refinement falls back to [] (caller keeps the current target).
 */
export async function proposeConceptDirections(opts: {
  prompt: string;
  phase: "explore" | "refine";
  signal?: AbortSignal;
}): Promise<ConceptDirection[]> {
  const fallback = opts.phase === "explore" ? FALLBACK_DIRECTIONS : [];
  if (!hasModelCredentials()) return fallback;
  try {
    const text = await completeText({
      system: opts.phase === "explore" ? EXPLORE_SYSTEM : REFINE_SYSTEM,
      prompt:
        opts.phase === "explore"
          ? `Requested object: ${opts.prompt}`
          : `The build being refined: ${opts.prompt}`,
      model: modelForRole("plan"),
      role: "concept-directions",
      signal: opts.signal,
    });
    return parseDirections(text) ?? fallback;
  } catch (err) {
    logError("proposeConceptDirections", err);
    return fallback;
  }
}

/**
 * Should this turn concept at all — and how wide? Fresh builds explore
 * without a model call; revisions get one cheap classification. Any doubt
 * or failure → "skip" (friction is worse than a missed card).
 */
export async function classifyConceptPhase(opts: {
  prompt: string;
  isRevision: boolean;
  signal?: AbortSignal;
}): Promise<ConceptPhase> {
  if (!opts.isRevision) return "explore";
  if (!hasModelCredentials()) return "skip";
  try {
    const verdict = await completeText({
      system:
        "You route whether a 3D-model revision warrants NEW design-direction concepts. Reply with ONE word:\n" +
        "REFINE — the instruction meaningfully changes the part's overall form, shape, or style (reshape it, restyle it, make it look different, major silhouette change).\n" +
        "SKIP — dimensional tweaks, feature edits, fixes, or small adjustments (hole sizes, tolerances, add/move a port, thicker wall, fillet a corner, split into parts).\n" +
        "EXPLORE — an explicit fresh redesign (start over, completely different design).\n" +
        "When in doubt, SKIP.\n" +
        "Reply with only the single word.",
      prompt: opts.prompt,
      model: modelForRole("plan"),
      role: "concept-directions",
      signal: opts.signal,
    });
    if (/\bEXPLORE\b/i.test(verdict)) return "explore";
    if (/\bREFINE\b/i.test(verdict)) return "refine";
    return "skip";
  } catch (err) {
    logError("classifyConceptPhase", err);
    return "skip";
  }
}
