/**
 * Kernel-failure repair playbook (MTR-198). CAD Skills' `repair-loop.md` +
 * `build123d-modeling.md` (MIT, distilled from real usage) encode exactly the
 * OCCT failure modes an LLM hits, each with likely causes and a standard fix.
 * This compiles their 8-class taxonomy into a deterministic stderr→class→fixes
 * enricher: no model call, just regex over the sidecar's error string.
 *
 * Pure (no `server-only`) so the harness (scripted repair hint), the agentic
 * loop (tool-result context), the eval runner, and tests all share it.
 *
 * This taxonomy is also the initial label set for the failure miner (MTR-186):
 * its clustering should emit these class ids, seeded by this human-curated map.
 */

/** The 8 failure classes (CAD Skills' taxonomy). Stable ids — MTR-186's labels. */
export type KernelFailureClass =
  | "source_import_syntax"
  | "invalid_missing_geometry"
  | "fillet_chamfer_failure"
  | "wrong_scale_bbox"
  | "missing_feature"
  | "selector_fragility"
  | "positioning_joint_mismatch"
  | "tool_failure";

export const KERNEL_FAILURE_CLASS_IDS: KernelFailureClass[] = [
  "source_import_syntax",
  "invalid_missing_geometry",
  "fillet_chamfer_failure",
  "wrong_scale_bbox",
  "missing_feature",
  "selector_fragility",
  "positioning_joint_mismatch",
  "tool_failure",
];

interface FailureClassSpec {
  label: string;
  /** stderr/exception patterns that indicate this class. */
  patterns: RegExp[];
  /** The standard fixes for this class (CAD Skills' guidance, distilled). */
  fixes: string[];
}

/**
 * Ordered most-specific → most-generic. `classifyKernelError` returns the first
 * class whose patterns match, so put syntax/selector before the catch-all
 * tool_failure. `tool_failure` deliberately has broad patterns and sits last.
 */
export const KERNEL_FAILURE_TAXONOMY: Record<KernelFailureClass, FailureClassSpec> = {
  source_import_syntax: {
    label: "source import / syntax error",
    patterns: [
      /syntaxerror/i,
      /indentationerror/i,
      /\bnameerror\b/i,
      /is not defined/i,
      /no module named/i,
      /importerror/i,
      /cannot import name/i,
      /unexpected (eof|indent)/i,
    ],
    fixes: [
      "The script did not run as Python. Fix the syntax/import: use only `from build123d import *` (plus `from bd_warehouse.fastener import ...` / `from bd_warehouse.bearing import ...` for standard parts, and `from sdf_kit import *` for implicit mode); do not import packages the sidecar lacks.",
      "Define every name before use; a NameError usually means a typo or a missing intermediate variable.",
    ],
  },
  invalid_missing_geometry: {
    label: "invalid / missing geometry (open sketch, tool never enters the solid)",
    patterns: [
      /open\s*(wire|sketch|edge|profile)/i,
      /not\s*closed/i,
      /empty\s*(compound|sketch|shape|geometry)/i,
      /null\s*(shape|topods)/i,
      /no\s*(faces|solids|result)\b/i,
      /degenerat/i,
      /zero[-\s]?(thickness|area|volume)/i,
    ],
    fixes: [
      "Close every sketch profile before extruding — an open wire produces no solid.",
      "OVERSHOOT boolean tools: extend a cutting tool past the faces it enters AND exits (≈1 mm beyond both for a through-cut). Coincident/coplanar tool and target faces are a classic kernel failure — never make them flush.",
      "Ensure a subtractive tool actually intersects the target volume (not merely touching); give it real overlap.",
    ],
  },
  fillet_chamfer_failure: {
    label: "fillet / chamfer failure (most failure-prone op — do it last)",
    patterns: [
      /fillet/i,
      /chamfer/i,
      /\bblend\b/i,
      /try\s*a\s*smaller\s*value/i,
      /radius/i,
      /makefillet|chfi/i,
    ],
    fixes: [
      "REDUCE the radius substantially (at least halve it) — keep it well under the thinnest adjacent wall (≈≤0.4× local thickness); never retry the same value.",
      "Apply the fillet/chamfer to FEWER, specifically-selected edges, or wrap it in try/except and fall back to a smaller radius.",
      "Move fillets/chamfers to the very LAST step: every prior boolean invalidates edge selectors, so postpone them until the solid is otherwise final.",
    ],
  },
  wrong_scale_bbox: {
    label: "wrong scale / bounding box (order-of-magnitude or unit error)",
    patterns: [
      /dimensions?\s*(off|wrong|mismatch)/i,
      /out\s*of\s*spec/i,
      /bbox|bounding\s*box/i,
      /too\s*(large|small|big|tiny)/i,
      /scale/i,
      /order[-\s]?of[-\s]?magnitude/i,
    ],
    fixes: [
      "Sanity-check proportions in millimeters against the brief BEFORE generating — order-of-magnitude and collision errors pass geometric validation but are still wrong.",
      "Every dimension is a named parameter; set it to the exact spec value rather than rescaling the whole part.",
    ],
  },
  missing_feature: {
    label: "missing feature (Mode.ADD/SUBTRACT confusion, blind cut too shallow)",
    patterns: [
      /mode\.(add|subtract)/i,
      /\bsubtract\b|\badd\b.*mode/i,
      /blind|too\s*shallow|did\s*not\s*(cut|reach)/i,
      /hole.*(shallow|not\s*through)/i,
    ],
    fixes: [
      "Check Mode: additions use `mode=Mode.ADD`, cuts use `mode=Mode.SUBTRACT` — a swapped mode silently adds material where a pocket was intended.",
      "A blind cut that must go through needs depth ≥ wall thickness plus overshoot; prefer a through-cut that overshoots both faces by ≈1 mm.",
    ],
  },
  selector_fragility: {
    label: "selector fragility (index-based edge/face picks break after booleans)",
    patterns: [
      /index\s*out\s*of\s*range/i,
      /list\s*index/i,
      /empty\s*(selection|filter|group)/i,
      /no\s*(edges|faces|vertices)\s*(found|matched|selected)/i,
      /selector/i,
      /\[\s*-?\d+\s*\]/,
    ],
    fixes: [
      "Prefer axis/position selectors over list indexes: `filter_by(Axis.Z)`, `group_by(Axis.Z)[-1]`, `sort_by(Axis.Z)` — a bare `[i]` index is invalidated by every preceding boolean.",
      "Re-select faces/edges immediately before the operation that consumes them, after all booleans that could renumber them.",
    ],
  },
  positioning_joint_mismatch: {
    label: "positioning / joint mismatch (connect_to fixes the wrong side)",
    patterns: [
      /connect_to|\.connect\b/i,
      /joint/i,
      /interpenetrat|overlap.*part/i,
      /reversed|wrong\s*(side|direction|orientation)/i,
      /location.*mismatch/i,
    ],
    fixes: [
      "For assemblies, the FIXED part stays put and the MOVING part is placed onto it; `.connect_to()` moves the caller — check you did not fix the wrong side.",
      "Derive mating frames from inspected geometry (measure the face/hole), not from assumed origins; imported STEP origins are arbitrary.",
      "Assembled parts must touch with zero interpenetration — position them at their real assembled coordinates, never translated apart for presentation.",
    ],
  },
  tool_failure: {
    label: "kernel/tool failure (boolean or export crashed)",
    patterns: [
      /brep|topods|standard_(failure|constructionerror)|occ|opencascade/i,
      /boolean|fuse|common|cut\s*failed/i,
      /not\s*watertight/i,
      /killed|oom|memory|timed?\s*out|segmentation/i,
      /export|stl|step/i,
    ],
    fixes: [
      "Simplify the boolean sequence: fewer overlapping/tangent booleans, and make solids genuinely OVERLAP (not merely touch) before fusing.",
      "If a non-watertight mesh: in mesh/SDF mode pad the field with a void border (`np.pad(..., constant_values=<void>)`) then `merge_vertices()` + `fix_normals()`; in build123d, reduce coincident faces.",
      "If it crashed/hung, the geometry was too heavy — drastically reduce boolean count, dense patterns, and detail; build the simplest geometry that still reads as the object.",
    ],
  },
};

export interface KernelFailureMatch {
  class: KernelFailureClass;
  label: string;
  fixes: string[];
}

/**
 * Classify a sidecar error/stderr string into its failure class. Returns the
 * first (most-specific) matching class, or null when nothing matches (the
 * harness then keeps its generic hint). Deterministic — regex only.
 */
export function classifyKernelError(
  note: string | null | undefined
): KernelFailureMatch | null {
  if (!note) return null;
  for (const id of KERNEL_FAILURE_CLASS_IDS) {
    const spec = KERNEL_FAILURE_TAXONOMY[id];
    if (spec.patterns.some((re) => re.test(note))) {
      return { class: id, label: spec.label, fixes: spec.fixes };
    }
  }
  return null;
}

/**
 * The enriched repair hint appended to a failed attempt: the named failure
 * class + its standard fixes. Empty string when unclassifiable, so callers can
 * fall through to their existing generic guidance.
 */
export function enrichRepairHint(note: string | null | undefined): string {
  const match = classifyKernelError(note);
  if (!match) return "";
  return [
    `Likely failure class: ${match.label}. Standard fixes for this class:`,
    ...match.fixes.map((f) => `- ${f}`),
    "Change only the smallest responsible section of the code, then rerun the failed check (do not regenerate the whole script).",
  ].join("\n");
}
