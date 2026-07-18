import { describe, it, expect } from "vitest";
import {
  classifyKernelError,
  enrichRepairHint,
  KERNEL_FAILURE_CLASS_IDS,
  KERNEL_FAILURE_TAXONOMY,
} from "@/lib/cad/repair-taxonomy";

describe("classifyKernelError — kernel taxonomy (MTR-198 / MTR-213)", () => {
  it("classifies a fillet failure and names the standard fix", () => {
    const m = classifyKernelError(
      "BRepFilletAPI: fillet radius 6.0 too large — try a smaller value"
    );
    expect(m?.class).toBe("fillet_chamfer_failure");
    expect(m?.fixes.join(" ")).toMatch(/reduce the radius/i);
  });

  it("classifies a coplanar/through-cut boolean failure as missing geometry", () => {
    const m = classifyKernelError(
      "Boolean produced a null shape: tool and target faces are coplanar"
    );
    // coplanar tool/target → invalid/missing geometry (overshoot fix)
    expect(m?.class).toBe("invalid_missing_geometry");
    expect(m?.fixes.join(" ")).toMatch(/overshoot/i);
  });

  it("classifies an index-based selector failure", () => {
    const m = classifyKernelError("IndexError: list index out of range");
    expect(m?.class).toBe("selector_fragility");
    expect(m?.fixes.join(" ")).toMatch(/axis\/position selectors/i);
  });

  it("classifies a syntax / import error", () => {
    const m = classifyKernelError("NameError: name 'Bx' is not defined");
    expect(m?.class).toBe("source_import_syntax");
  });

  it("classifies fragment-gate disconnected solids as parts-dict (not fuse)", () => {
    const m = classifyKernelError(
      "part contains 2 disconnected solids (volumes 19200, 9600 mm^3) — " +
        "every exported part must be one fused solid: union intentional " +
        "geometry into the body, delete stray debris, or export separate " +
        "pieces via the parts dict"
    );
    expect(m?.class).toBe("disconnected_assembly");
    expect(m?.fixes.join(" ")).toMatch(/`parts`\s*dict/i);
    expect(m?.fixes.join(" ")).toMatch(/do not union\/fuse/i);
  });

  it("falls back to tool_failure for a generic kernel/boolean crash", () => {
    const m = classifyKernelError("OCC boolean fuse failed unexpectedly");
    expect(m?.class).toBe("tool_failure");
  });

  it("returns null for an unclassifiable string", () => {
    expect(classifyKernelError("")).toBeNull();
    expect(classifyKernelError("the design is printable but visually weak")).toBeNull();
  });
});

describe("enrichRepairHint", () => {
  it("names the class + fixes + retry-granularity rule", () => {
    const hint = enrichRepairHint("fillet radius too large, try a smaller value");
    expect(hint).toMatch(/failure class/i);
    expect(hint).toMatch(/fillet/i);
    expect(hint).toMatch(/smallest responsible section/i);
  });

  it("returns empty string when unclassifiable so callers keep their generic hint", () => {
    expect(enrichRepairHint("printable but visually weak")).toBe("");
  });
});

describe("taxonomy shape (initial label set for MTR-186)", () => {
  it("exposes stable class ids, each with patterns + fixes", () => {
    // 8 CAD-Skills classes + disconnected_assembly (fragment-gate → parts dict).
    expect(KERNEL_FAILURE_CLASS_IDS).toHaveLength(9);
    expect(KERNEL_FAILURE_CLASS_IDS).toContain("disconnected_assembly");
    for (const id of KERNEL_FAILURE_CLASS_IDS) {
      const spec = KERNEL_FAILURE_TAXONOMY[id];
      expect(spec.patterns.length).toBeGreaterThan(0);
      expect(spec.fixes.length).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });
});
