import { describe, it, expect } from "vitest";

import { planComposerSubmit } from "@/components/cad/composer-submit";

/**
 * MTR-217 — a pinned annotation can be sent as a revision without typed text,
 * and a clean instruction is synthesized so nothing downstream is blank.
 */
describe("planComposerSubmit", () => {
  it("allows a normal typed submit and passes the text through", () => {
    expect(planComposerSubmit("make it taller", 0)).toEqual({
      canSubmit: true,
      annotationOnly: false,
      instruction: "make it taller",
    });
  });

  it("blocks an empty submit with no annotations", () => {
    expect(planComposerSubmit("  ", 0)).toEqual({
      canSubmit: false,
      annotationOnly: false,
      instruction: "",
    });
    // Below the min length, still no annotations → blocked.
    expect(planComposerSubmit("ok", 0).canSubmit).toBe(false);
  });

  it("allows an annotation-only submit and synthesizes a singular instruction", () => {
    expect(planComposerSubmit("", 1)).toEqual({
      canSubmit: true,
      annotationOnly: true,
      instruction: "Address the annotated selection",
    });
  });

  it("pluralizes the synthesized instruction for multiple pins", () => {
    expect(planComposerSubmit("   ", 3)).toEqual({
      canSubmit: true,
      annotationOnly: true,
      instruction: "Address the annotated selections",
    });
  });

  it("treats a real typed message with pins as a normal (not annotation-only) submit", () => {
    // Typed text wins — the pins ride along via the annotation block downstream.
    expect(planComposerSubmit("round this face", 2)).toEqual({
      canSubmit: true,
      annotationOnly: false,
      instruction: "round this face",
    });
  });
});
