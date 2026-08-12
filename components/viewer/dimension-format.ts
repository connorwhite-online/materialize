/**
 * Display formatting for the dimension annotation layer (MTR-197).
 *
 * Pure and separate from `dimension-layer.tsx` on purpose (same split as
 * `topology.ts` / `mesh-selection.ts`): the layer's TRUST behavior — what
 * colour/glyph/text a verdict earns — is the thing most worth asserting, and
 * the studio surface it renders on is doubly auth-gated, so a browser bot
 * can't reach it. Keeping these pure makes the honesty rail unit-testable
 * without importing three.js / R3F.
 *
 * THE INVARIANT: a check that did not RUN must never be presented as a pass.
 * `calloutStatus` is the single decision point for that, so pass/fail/not-run
 * can't drift apart between the 3D callouts, the legend glyphs, and the text.
 */

import type { DimensionCheckResult } from "@/lib/cad/dimension-check";

/** How a verdict is presented. `not-run` is never styled as a pass. */
export type CalloutStatus = "pass" | "fail" | "not-run";

/** Trim to 2 dp and drop trailing zeros: 49.98, 50, 7.5. */
export function fmtMm(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/**
 * The one place a verdict becomes a presentation state. `ran: false` →
 * `not-run` regardless of `ok`, so a null/garbage `ok` on an unrun check can
 * never surface as verified.
 */
export function calloutStatus(check: DimensionCheckResult): CalloutStatus {
  if (!check.ran) return "not-run";
  return check.ok === true ? "pass" : "fail";
}

/** Pass = emerald, fail = red, not-run = muted grey. */
export function statusColor(check: DimensionCheckResult): string {
  switch (calloutStatus(check)) {
    case "pass":
      return "#059669";
    case "fail":
      return "#dc2626";
    default:
      return "#9ca3af";
  }
}

/**
 * "spec 50 ±0.5 mm · 49.98 ✓" — the measured-beside-claimed core of the
 * layer. A not-run check reads "not verified" and a ran-but-unmatched one
 * "not found"; neither ever renders a measured number it doesn't have.
 */
export function verdictText(check: DimensionCheckResult): string {
  const unit = check.target.kind === "count" ? "" : " mm";
  const tol =
    check.tolerance != null && check.tolerance > 0
      ? ` ±${fmtMm(check.tolerance)}`
      : "";
  const spec = `${fmtMm(check.target.value)}${tol}${unit}`;
  if (!check.ran) return `${spec} · not verified`;
  if (check.got == null) return `${spec} · not found`;
  return `${spec} · ${fmtMm(check.got)}${unit} ${check.ok === true ? "✓" : "✗"}`;
}
