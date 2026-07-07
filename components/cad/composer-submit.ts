/**
 * Pure decision for the studio composer's submit gate (MTR-217).
 *
 * A pinned annotation with no typed text is a valid revision on its own — the
 * annotations carry the instruction — so submit is allowed when there is either
 * enough typed text OR at least one annotation. When the user pinned without
 * typing, a human-readable instruction is synthesized so the sent bubble + the
 * turn's history label aren't blank and the server's min-length gate is cleared
 * (the annotation block is appended to it downstream).
 *
 * Kept pure + free of React/three imports so the branch table is unit-tested
 * without rendering the whole studio.
 */
export interface ComposerSubmitPlan {
  /** Whether the composer send button is enabled / submit() may proceed. */
  canSubmit: boolean;
  /** True when there's no usable typed text but at least one annotation. */
  annotationOnly: boolean;
  /** The instruction to send + show (synthesized for the annotation-only case). */
  instruction: string;
}

/** Minimum typed characters for a text-carrying submit (mirrors the server gate). */
const MIN_TEXT_LEN = 3;

export function planComposerSubmit(
  rawText: string,
  annotationCount: number
): ComposerSubmitPlan {
  const text = rawText.trim();
  const hasText = text.length >= MIN_TEXT_LEN;
  const hasAnnotations = annotationCount > 0;
  const annotationOnly = !hasText && hasAnnotations;
  const instruction = annotationOnly
    ? `Address the annotated selection${annotationCount > 1 ? "s" : ""}`
    : text;
  return { canSubmit: hasText || hasAnnotations, annotationOnly, instruction };
}
