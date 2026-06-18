/**
 * Shared text-to-CAD feedback vocabulary. Pure (no `server-only`) so both
 * the studio client component and the server action can import it, and so
 * the eval tooling can roll up tag frequencies.
 *
 * Feedback is the highest-signal early eval data: the owner rates each
 * generation in-the-moment. Structured tags (not just freeform) are what
 * make it actionable — e.g. a spike in `dimensions_off` points straight at
 * adding clarify-before-generate to the harness.
 */

export const CAD_FEEDBACK_TAGS = [
  "great",
  "dimensions_off",
  "geometry_wrong",
  "not_printable",
  "misunderstood_prompt",
  "ugly",
] as const;

export type CadFeedbackTag = (typeof CAD_FEEDBACK_TAGS)[number];

export type CadRating = "good" | "bad";

/** Human labels for the tag chips. */
export const CAD_FEEDBACK_TAG_LABELS: Record<CadFeedbackTag, string> = {
  great: "Great",
  dimensions_off: "Dimensions off",
  geometry_wrong: "Geometry wrong",
  not_printable: "Not printable",
  misunderstood_prompt: "Misread prompt",
  ugly: "Ugly",
};

export function isCadFeedbackTag(s: string): s is CadFeedbackTag {
  return (CAD_FEEDBACK_TAGS as readonly string[]).includes(s);
}

export function isCadRating(s: string | null | undefined): s is CadRating {
  return s === "good" || s === "bad";
}
