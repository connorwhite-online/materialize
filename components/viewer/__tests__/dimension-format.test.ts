import { describe, expect, it } from "vitest";

import {
  calloutStatus,
  fmtMm,
  statusColor,
  verdictText,
} from "../dimension-format";
import type { DimensionCheckResult } from "@/lib/cad/dimension-check";

/**
 * The dimension layer's HONESTY RAIL, at the presentation level (MTR-197).
 *
 * The studio surface these render on is doubly auth-gated (Clerk +
 * TEXT_TO_CAD_ALLOWED_EMAILS), so the PR browser bot can't reach it. These
 * assert the property that actually carries the trust claim: a check that did
 * not RUN is never presented as verified — not by colour, not by glyph state,
 * not by text.
 */

const PASS_GREEN = "#059669";
const FAIL_RED = "#dc2626";
const MUTED_GREY = "#9ca3af";

function check(over: Partial<DimensionCheckResult> = {}): DimensionCheckResult {
  return {
    target: { label: "overall height", kind: "bbox_span", axis: "z", value: 50 },
    ran: true,
    ok: true,
    got: 50,
    delta: 0,
    tolerance: 0.5,
    ...over,
  };
}

describe("calloutStatus — the single pass/fail/not-run decision point", () => {
  it("maps ran+ok to pass, ran+!ok to fail, !ran to not-run", () => {
    expect(calloutStatus(check())).toBe("pass");
    expect(calloutStatus(check({ ok: false }))).toBe("fail");
    expect(calloutStatus(check({ ran: false, ok: null }))).toBe("not-run");
  });

  it("never reports pass for a check that did not run, whatever `ok` says", () => {
    // A stale/garbage ok on an unrun check (bad persisted payload, older
    // writer) must not be able to surface as verified.
    for (const ok of [true, false, null] as const) {
      expect(calloutStatus(check({ ran: false, ok }))).toBe("not-run");
    }
  });

  it("treats a ran check with a null verdict as failed, never as passed", () => {
    expect(calloutStatus(check({ ran: true, ok: null }))).toBe("fail");
  });
});

describe("statusColor", () => {
  it("colours pass emerald, fail red, not-run muted", () => {
    expect(statusColor(check())).toBe(PASS_GREEN);
    expect(statusColor(check({ ok: false }))).toBe(FAIL_RED);
    expect(statusColor(check({ ran: false, ok: null }))).toBe(MUTED_GREY);
  });

  it("never paints an unrun check with the pass colour", () => {
    for (const ok of [true, false, null] as const) {
      expect(statusColor(check({ ran: false, ok }))).not.toBe(PASS_GREEN);
    }
  });
});

describe("verdictText", () => {
  it("shows spec, tolerance and the MEASURED value with a check mark on pass", () => {
    expect(verdictText(check({ got: 49.98, delta: 0.02 }))).toBe(
      "50 ±0.5 mm · 49.98 mm ✓"
    );
  });

  it("marks an out-of-spec measurement with a cross", () => {
    expect(verdictText(check({ ok: false, got: 42, delta: 8 }))).toBe(
      "50 ±0.5 mm · 42 mm ✗"
    );
  });

  it("reads 'not verified' — never a measured number — when the check did not run", () => {
    const text = verdictText(
      check({ ran: false, ok: null, got: undefined, delta: undefined })
    );
    expect(text).toBe("50 ±0.5 mm · not verified");
    expect(text).not.toContain("✓");
  });

  it("never claims a value for an unrun check even if one is present on the row", () => {
    // Defensive: `got` should be absent on a not-run result, but if a stale
    // payload carries one it must not be presented as a verified measurement.
    const text = verdictText(check({ ran: false, ok: true, got: 50 }));
    expect(text).toContain("not verified");
    expect(text).not.toContain("✓");
  });

  it("reads 'not found' for a ran check with no matching geometry", () => {
    expect(
      verdictText(
        check({
          target: { label: "hole dia", kind: "diameter", value: 8 },
          ok: false,
          got: undefined,
          delta: undefined,
          tolerance: 0.5,
        })
      )
    ).toBe("8 ±0.5 mm · not found");
  });

  it("omits the mm unit for count targets", () => {
    expect(
      verdictText(
        check({
          target: { label: "parts", kind: "count", of: "part", value: 2 },
          got: 2,
          tolerance: 0,
        })
      )
    ).toBe("2 · 2 ✓");
  });

  it("omits the tolerance band when it is zero or absent", () => {
    expect(verdictText(check({ tolerance: 0, got: 50 }))).toBe("50 mm · 50 mm ✓");
    expect(verdictText(check({ tolerance: undefined, got: 50 }))).toBe(
      "50 mm · 50 mm ✓"
    );
  });
});

describe("fmtMm", () => {
  it("trims to 2 dp and drops trailing zeros", () => {
    expect(fmtMm(49.9832)).toBe("49.98");
    expect(fmtMm(50)).toBe("50");
    expect(fmtMm(50.0)).toBe("50");
    expect(fmtMm(7.5)).toBe("7.5");
    expect(fmtMm(0.125)).toBe("0.13");
  });
});
