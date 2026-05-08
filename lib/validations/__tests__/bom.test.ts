import { describe, it, expect } from "vitest";
import {
  bomItemSchema,
  replaceBomSchema,
  MAX_BOM_ITEMS,
  MAX_BOM_QUANTITY,
} from "../bom";

const ok = {
  name: "M3x10 socket head screw",
  quantity: 4,
};

describe("bomItemSchema", () => {
  it("accepts a minimal valid item", () => {
    expect(bomItemSchema.safeParse(ok).success).toBe(true);
  });

  it("trims name", () => {
    const r = bomItemSchema.safeParse({ ...ok, name: "  Screw  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Screw");
  });

  it("rejects empty name", () => {
    expect(bomItemSchema.safeParse({ ...ok, name: "" }).success).toBe(false);
    expect(
      bomItemSchema.safeParse({ ...ok, name: "    " }).success
    ).toBe(false);
  });

  it("rejects name over 200 chars", () => {
    expect(
      bomItemSchema.safeParse({ ...ok, name: "x".repeat(201) }).success
    ).toBe(false);
  });

  it("coerces a string quantity", () => {
    const r = bomItemSchema.safeParse({ ...ok, quantity: "2.5" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity).toBe(2.5);
  });

  it("rejects zero / negative quantity", () => {
    expect(bomItemSchema.safeParse({ ...ok, quantity: 0 }).success).toBe(false);
    expect(
      bomItemSchema.safeParse({ ...ok, quantity: -1 }).success
    ).toBe(false);
  });

  it("rejects quantity over the cap", () => {
    expect(
      bomItemSchema.safeParse({ ...ok, quantity: MAX_BOM_QUANTITY + 1 })
        .success
    ).toBe(false);
  });

  it("accepts an https sourceUrl", () => {
    const r = bomItemSchema.safeParse({
      ...ok,
      sourceUrl: "https://example.com/screw",
    });
    expect(r.success).toBe(true);
  });

  it("rejects an http sourceUrl", () => {
    const r = bomItemSchema.safeParse({
      ...ok,
      sourceUrl: "http://example.com/screw",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed URL", () => {
    const r = bomItemSchema.safeParse({ ...ok, sourceUrl: "not a url" });
    expect(r.success).toBe(false);
  });

  it("treats empty string sourceUrl as undefined", () => {
    const r = bomItemSchema.safeParse({ ...ok, sourceUrl: "" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sourceUrl).toBeUndefined();
  });

  it("strips empty optional fields to undefined", () => {
    const r = bomItemSchema.safeParse({
      ...ok,
      unit: "",
      notes: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.unit).toBeUndefined();
      expect(r.data.notes).toBeUndefined();
    }
  });
});

describe("replaceBomSchema", () => {
  it("accepts an empty list (clears the BOM)", () => {
    expect(replaceBomSchema.safeParse([]).success).toBe(true);
  });

  it(`rejects more than ${MAX_BOM_ITEMS} items`, () => {
    const items = Array(MAX_BOM_ITEMS + 1).fill(ok);
    expect(replaceBomSchema.safeParse(items).success).toBe(false);
  });

  it(`accepts exactly ${MAX_BOM_ITEMS} items`, () => {
    const items = Array(MAX_BOM_ITEMS).fill(ok);
    expect(replaceBomSchema.safeParse(items).success).toBe(true);
  });
});
