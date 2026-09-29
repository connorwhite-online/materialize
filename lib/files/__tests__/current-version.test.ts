import { describe, it, expect } from "vitest";
import {
  currentAssetsByFileId,
  pickCurrentAsset,
} from "@/lib/files/current-version";

const v1 = { id: "a1", fileId: "f1", createdAt: new Date("2026-01-01") };
const v2 = { id: "a2", fileId: "f1", createdAt: new Date("2026-02-01") };
const v3 = { id: "a3", fileId: "f1", createdAt: new Date("2026-03-01") };

describe("pickCurrentAsset", () => {
  it("returns the version the pointer names, not the first row", () => {
    expect(pickCurrentAsset("a2", [v1, v2, v3])).toBe(v2);
    expect(pickCurrentAsset("a3", [v3, v1, v2])).toBe(v3);
  });

  it("falls back to the oldest asset without a pointer (pre-versioning pick)", () => {
    expect(pickCurrentAsset(null, [v3, v2, v1])).toBe(v1);
    expect(pickCurrentAsset(undefined, [v2, v1])).toBe(v1);
  });

  it("falls back when the pointer names an asset that isn't in the list", () => {
    expect(pickCurrentAsset("moved-away", [v2, v1])).toBe(v1);
  });

  it("breaks createdAt ties on id so the pick is deterministic", () => {
    const t = new Date("2026-01-01");
    const b = { id: "b", createdAt: t };
    const a = { id: "a", createdAt: t };
    expect(pickCurrentAsset(null, [b, a])).toBe(a);
    expect(pickCurrentAsset(null, [a, b])).toBe(a);
  });

  it("returns null for a file with no assets", () => {
    expect(pickCurrentAsset("a1", [])).toBeNull();
  });
});

describe("currentAssetsByFileId", () => {
  it("picks each file's live version out of one batched query", () => {
    const other = { id: "b1", fileId: "f2", createdAt: new Date("2026-01-05") };
    const orphan = { id: "x", fileId: null, createdAt: new Date() };
    const out = currentAssetsByFileId(
      [v1, other, v2, orphan, v3],
      new Map<string, string | null>([
        ["f1", "a3"],
        ["f2", null],
      ])
    );
    expect(out.get("f1")).toBe(v3);
    expect(out.get("f2")).toBe(other);
    expect(out.size).toBe(2);
  });
});
