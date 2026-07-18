import { describe, expect, it } from "vitest";
import {
  isAssemblyOverview,
  resolveEffectiveSelectedPartId,
} from "../assembly-selection";

const parts = [
  { fileAssetId: "asset-lid" },
  { fileAssetId: "asset-base" },
];

describe("resolveEffectiveSelectedPartId", () => {
  it('keeps null as "All parts"', () => {
    expect(resolveEffectiveSelectedPartId(parts, null)).toBeNull();
  });

  it("keeps a selection that matches a current part", () => {
    expect(resolveEffectiveSelectedPartId(parts, "asset-base")).toBe(
      "asset-base"
    );
  });

  it("treats a stale selection (e.g. after revision) as All parts", () => {
    expect(resolveEffectiveSelectedPartId(parts, "asset-old-lid")).toBeNull();
  });

  it("treats any selection as All parts when there are no parts", () => {
    expect(resolveEffectiveSelectedPartId([], "asset-lid")).toBeNull();
  });
});

describe("isAssemblyOverview", () => {
  it("is true only for multi-part + All parts", () => {
    expect(isAssemblyOverview(2, null)).toBe(true);
    expect(isAssemblyOverview(2, "asset-lid")).toBe(false);
    expect(isAssemblyOverview(1, null)).toBe(false);
    expect(isAssemblyOverview(0, null)).toBe(false);
  });
});
