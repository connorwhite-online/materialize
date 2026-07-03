import { describe, it, expect, vi, beforeEach } from "vitest";

// buildBrief is a single completion -> strict JSON -> zod; mock the model
// client so tests drive the parse/validate path, not the network.
const completeText = vi.fn();
const hasModelCredentials = vi.fn(() => true);
vi.mock("@/lib/cad/model-client", () => ({
  completeText: (...args: unknown[]) => completeText(...args),
  hasModelCredentials: () => hasModelCredentials(),
}));

import {
  cadBriefSchema,
  buildBrief,
  formatBriefForPrompt,
  formatBriefForConcept,
  type CadBrief,
} from "@/lib/cad/brief";
import { formatComponentHints, componentCutoutFor } from "@/lib/cad/knowledge/components";

const VALID_BRIEF = {
  v: 1,
  part: "enclosure for a 60x40mm sensor board",
  components: [
    {
      name: "pcb",
      box: [62, 42, 12],
      clearance: 1.0,
      mounts: { pattern: "corners", inset: 3.5, screw: "M2.5" },
    },
  ],
  interfaces: [{ type: "port", std: "usb-c", face: "+X" }],
  keepOut: [],
  form: { language: "soft-premium" },
  envelope: { max: [90, 70, 30] },
  process: null,
};

beforeEach(() => {
  completeText.mockReset();
  hasModelCredentials.mockReturnValue(true);
});

describe("cadBriefSchema", () => {
  it("accepts the documented shape and defaults the collections", () => {
    const r = cadBriefSchema.safeParse({ v: 1, part: "a bracket" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.components).toEqual([]);
      expect(r.data.interfaces).toEqual([]);
    }
  });

  it("rejects a brief without a part restatement", () => {
    expect(cadBriefSchema.safeParse({ v: 1 }).success).toBe(false);
  });

  it("tolerates unknown extra fields (schema will churn)", () => {
    const r = cadBriefSchema.safeParse({ ...VALID_BRIEF, futureField: 42 });
    expect(r.success).toBe(true);
  });
});

describe("buildBrief", () => {
  it("parses strict JSON out of the completion", async () => {
    completeText.mockResolvedValue(JSON.stringify(VALID_BRIEF));
    const brief = await buildBrief({ prompt: "an enclosure" });
    expect(brief?.part).toContain("sensor board");
    expect(brief?.components[0]?.box).toEqual([62, 42, 12]);
  });

  it("extracts JSON even when the model wraps it in prose", async () => {
    completeText.mockResolvedValue(
      `Here is the brief:\n${JSON.stringify(VALID_BRIEF)}\nDone.`
    );
    expect(await buildBrief({ prompt: "x" })).not.toBeNull();
  });

  it.each([
    ["no JSON at all", "I cannot help with that"],
    ["malformed JSON", "{ part: nope"],
    ["schema-invalid JSON", JSON.stringify({ v: 1 })],
  ])("returns null on %s (best-effort contract)", async (_label, reply) => {
    completeText.mockResolvedValue(reply);
    expect(await buildBrief({ prompt: "x" })).toBeNull();
  });

  it("returns null when the completion throws", async () => {
    completeText.mockRejectedValue(new Error("api down"));
    expect(await buildBrief({ prompt: "x" })).toBeNull();
  });

  it("returns null without model credentials", async () => {
    hasModelCredentials.mockReturnValue(false);
    expect(await buildBrief({ prompt: "x" })).toBeNull();
    expect(completeText).not.toHaveBeenCalled();
  });
});

describe("formatting", () => {
  const brief = cadBriefSchema.parse(VALID_BRIEF) as CadBrief;

  it("formatBriefForPrompt carries the load-bearing numbers", () => {
    const text = formatBriefForPrompt(brief);
    expect(text).toContain("62");
    expect(text).toContain("42");
    expect(text).toContain("usb-c");
  });

  it("formatBriefForConcept stays a short form/envelope description", () => {
    const text = formatBriefForConcept(brief);
    expect(text.length).toBeLessThan(400);
    expect(text.toLowerCase()).toContain("soft-premium");
  });

  it("formatComponentHints resolves standard cutout dimensions", () => {
    const hints = formatComponentHints(brief);
    const usbc = componentCutoutFor("usb-c");
    expect(usbc).not.toBeNull();
    // The hint block must state the real cutout width for the matched std.
    expect(hints).toContain(String(usbc!.cutoutWMm));
  });
});
