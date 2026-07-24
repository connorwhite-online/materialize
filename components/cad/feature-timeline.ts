/**
 * Construction-timeline helpers for the feature-chip strip (MTR-224).
 *
 * Pure — no React, no THREE. The sidecar emits `features[]` in op-execution
 * order, and that order IS construction order: nothing here (or anywhere
 * downstream) may sort or group it. These helpers map features onto ordered
 * timeline entries (step number + icon kind + accessible name) and answer the
 * reverse question "which feature owns this topo face id?" for face→chip
 * highlighting.
 */

import type { CadFeature } from "@/lib/cad/types";

/**
 * Icon buckets for the timeline strip. Known B-rep ops keep their own icon;
 * anything else (currently the sidecar's `"other"`, plus any op value a future
 * sidecar might emit) collapses into `"generic"`.
 */
export type TimelineIconKind =
  | "extrude"
  | "revolve"
  | "boolean"
  | "fillet"
  | "chamfer"
  | "shell"
  | "loft"
  | "hole"
  | "generic";

const ICON_KIND: Record<string, TimelineIconKind> = {
  extrude: "extrude",
  revolve: "revolve",
  boolean: "boolean",
  fillet: "fillet",
  chamfer: "chamfer",
  shell: "shell",
  loft: "loft",
  hole: "hole",
};

/** Human noun per icon kind — the op half of a chip's accessible name. */
const OP_NOUN: Record<TimelineIconKind, string> = {
  extrude: "Extrude",
  revolve: "Revolve",
  boolean: "Boolean",
  fillet: "Fillet",
  chamfer: "Chamfer",
  shell: "Shell",
  loft: "Loft",
  hole: "Hole",
  generic: "Operation",
};

/** Map a sidecar op string onto its timeline icon bucket. */
export function iconKindForOp(op: string): TimelineIconKind {
  return ICON_KIND[op] ?? "generic";
}

/** One chip in the construction-timeline strip. */
export interface TimelineEntry {
  feature: CadFeature;
  /** 1-based position in construction order. */
  step: number;
  iconKind: TimelineIconKind;
  /** Full accessible name: step + op + label (buttons carry this as aria-label). */
  accessibleName: string;
}

/**
 * Features → ordered timeline entries. Preserves the input (sidecar emission)
 * order verbatim — op-execution order IS the timeline.
 */
export function timelineEntries(features: CadFeature[]): TimelineEntry[] {
  return features.map((feature, i) => {
    const iconKind = iconKindForOp(feature.op);
    const noun = OP_NOUN[iconKind];
    const label = feature.label.trim();
    // Skip the label when it's just the op name again ("Fillet" chip labeled
    // "Fillet") so screen readers don't hear the word twice.
    const accessibleName =
      label && label.toLowerCase() !== noun.toLowerCase()
        ? `Step ${i + 1}: ${noun} — ${label}`
        : `Step ${i + 1}: ${noun}`;
    return { feature, step: i + 1, iconKind, accessibleName };
  });
}

/**
 * Reverse lookup: the feature that owns a topo face id. Later ops can re-claim
 * faces touched by earlier ones, so when several features list the same face
 * the LAST one in construction order wins — the most recent op is the one the
 * face visually belongs to. Returns null when no feature claims the face
 * (faces of un-instrumented geometry).
 */
export function featureForFaceId(
  features: CadFeature[],
  faceId: number
): CadFeature | null {
  for (let i = features.length - 1; i >= 0; i--) {
    if (features[i].faceIds.includes(faceId)) return features[i];
  }
  return null;
}

/**
 * Feature ids owning any of the given topo face ids — the set of chips to
 * mark when the user has annotated faces in the viewer. Unowned face ids are
 * ignored.
 */
export function featureIdsForFaceIds(
  features: CadFeature[],
  faceIds: number[]
): Set<string> {
  const out = new Set<string>();
  for (const faceId of faceIds) {
    const owner = featureForFaceId(features, faceId);
    if (owner) out.add(owner.id);
  }
  return out;
}
